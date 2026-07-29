# Integration Architecture (core, vendor-agnostic)

The reusable pattern behind every client integration in this repo: system
boundaries, the canonical-object rule, orchestration design, and the
control-plane schema. Vendor-specific detail (which ERP, which EDI platform,
which 3PL, actual credentials) lives in `adapters/` and `clients/<name>/` —
see the root `README.md` for how the three zones fit together.

---

## 1. Systems and responsibilities

Four roles, four non-overlapping jobs, regardless of which vendors fill them
for a given client. The primary failure mode for this class of integration
is business logic bleeding across boundaries — guard against it
deliberately.

| Role | Filled by (this repo's adapters) | Owns | Must NOT own |
|---|---|---|---|
| **Brain** | n8n (client-specific workflows in `clients/<name>/n8n/`) | Orchestration, scheduling, routing, API calls, moving data between layers | Being a system of record; hand-rolled EDI mapping |
| **Translator** | An EDI adapter (`adapters/edi/<platform>/`) | All EDI/X12 ↔ JSON transformation | Operational order/inventory truth |
| **Truth** | An ERP adapter (`adapters/erp/<erp>/`) | Orders, items, inventory, shipments, receipts, invoices | Transport/EDI concerns |
| **Control plane** | Supabase (schema in `core/supabase/migrations/`) | Run logs, status, correlation IDs, idempotency keys, mapping tables | Business truth — it *mirrors* the ERP, never overrides it |
| **Transport** (only if a 3PL/partner needs static-IP SFTP) | Either the EDI platform's own hosted SFTP (cheapest if available) or a dedicated bridge (e.g. AWS Transfer Family Connector) | Static-IP transport, staging, archive, retry | Any business transformation |

### Boundary decisions (non-negotiable)

- **The EDI adapter owns transformation.** Don't rebuild X12 mapping in n8n
  if the EDI platform can transform it.
- **The ERP adapter owns operational truth.** Supabase and n8n never become
  an alternate source of order/inventory state.
- **Transport is a dumb pipe.** No business rules in the transport layer
  beyond what's needed for envelope/transport safety.
- **Supabase is the control plane, not the source of truth.** It records
  what happened and enables idempotency/replay/observability. It does not
  decide business outcomes.

---

## 2. The canonical-object principle

The single most important design rule — see `canonical-objects.md` for the
actual shapes.

Every inbound document is parsed into a **neutral canonical object** before
it touches the destination system. Every outbound document is built *from*
a canonical object. Never map ERP format directly to EDI format.

```
EDI doc (adapters/edi/*/lib/parse*.js)   ──▶  canonical object  ──▶  adapters/erp/*/lib/build*.js
ERP record (adapters/erp/*/lib/parse*.js) ──▶  canonical object  ──▶  adapters/edi/*/lib/build*.js
```

Why this matters: it's what makes flows independently testable, lets you
swap an ERP or EDI platform for a new client without rewriting the other
side, and gives every writeback a single well-understood input shape.

---

## 3. Orchestration design (n8n)

Compose small workflows; never build monoliths.

### Flow skeleton — every workflow follows this shape

`trigger → dedupe (idempotency) → fetch source → parse to canonical → map to
target → write/send → log status → on error: route to errors table`.

### Scheduling — flows run independently, not in coordinated lockstep

Every flow dedupes and logs against the same Supabase tables before doing
anything, so **overlapping or out-of-order runs across different workflows
are a non-event** — no need to coordinate timing between them. Give each
flow its own trigger on its own natural cadence: polling flows every
5–30 min depending on how time-sensitive the document type is; anything
that's naturally a reaction to another flow completing (e.g. an outbound
confirmation triggered by an inbound one) should be called via n8n's Execute
Sub-workflow rather than given its own poll.

n8n allows multiple trigger nodes per workflow — keep a Manual Trigger on
every flow for on-demand testing alongside its Schedule Trigger. A
workflow's non-manual triggers only fire once it's **Published/Active**, not
merely saved.

### n8n workflow development conventions

Practices adopted after repeated friction — follow for every new workflow,
any client:

1. **Build with Manual Trigger first; add Schedule Trigger only once proven.**
2. **After every import, re-select every credential before doing anything
   else.** Imported nodes can show the right credential *name* while the
   link isn't actually bound ("Credentials not found" / "Authorization
   failed" despite looking selected) — re-selecting fixes it. Check every
   credential-using node, not just the one that errors first. Also: **import
   onto a genuinely blank new workflow**, not a duplicated/already-populated
   one — import merges onto whatever's already on the canvas.
3. **Sample-data fallback for testability.** When a flow depends on upstream
   data that may not exist yet, fall back to a realistic hardcoded sample so
   the workflow is runnable and demonstrable in isolation.
4. **Consistent naming** so a client's workflows sort and read together
   (this repo uses a `<Client>:` prefix).
5. **Tag workflows** (n8n's tag feature) by category — e.g. `inbound`,
   `outbound`, `dev-utility` — once there are enough to need it.
6. **Export workflow JSON back into the repo after every meaningful change.**
   This is the real source of truth — it already recovered a project once
   after an n8n account reset wiped all live workflows.
7. **Postgres pooler gotcha**: a Supabase credential in n8n needs SSL =
   require **and** "Ignore SSL Issues" on, or you get a self-signed-cert
   error.

### The live-schema-discovery method

For any EDI platform whose JSON schema isn't fully documented: POST a
minimal/empty payload for the target transaction type, read the validation
error (it names the exact missing/wrong field), add that field, repeat.
Full worked example: `adapters/edi/orderful/schema-notes.md`. See
`adapter-contract.md` for the general technique.

---

## 4. Control-plane schema (Supabase)

Defined in `core/supabase/migrations/` — same schema for every client,
applied to that client's own Supabase project (`npm run migrate`, see root
README).

```
transactions        -- one row per document, any direction
  id, correlation_id, doc_type, direction, partner, stream (TEST|LIVE),
  external_ids jsonb, status, payload_ref, created_at, updated_at
  -- status: created|transformed|staged|sent|acked|processed|errored|replayed

sku_map             -- retailer/partner UPC/SKU <-> ERP SKU <-> 3PL item id
partner_map         -- EDI trading partner <-> ERP customer <-> partner routing
idempotency_keys    -- unique hash(retailer/partner + reference + date)
errors              -- root cause, owner, next action, retry eligibility
```

Add a `files` table (S3/SFTP file lifecycle) if the client's integration
involves a file-based transport bridge.

### Correlation ID — the spine

One durable correlation ID per business transaction, stamped into Supabase
rows, transport filenames, EDI platform references, and ERP writeback notes.
This is what ties an outbound confirmation-request document back to its
matching inbound confirmation. If the EDI platform/3PL already groups
related documents by a shared reference number (e.g. a depositor order
number), use that as the correlation ID rather than inventing a new one —
it survives the round trip through the 3PL.

---

## 5. Cross-cutting requirements

- **Idempotency (mandatory).** Most ERPs have no native idempotency — dedupe
  in Supabase *before* every create/writeback. This is what prevents a
  replay from double-posting an order, shipment, or receipt.
- **Everything replayable.** Design every job so re-running a source
  transaction is safe. Never delete/overwrite raw files.
- **Observability is a feature, not cleanup.** Status transitions and error
  visibility are first-class. Minimum dashboard: latest files, failures,
  pending files, last successful poll, stuck transactions.
- **Correlation everywhere.** Logs, filenames, EDI platform refs, ERP
  writeback notes all carry the correlation ID.

---

## 6. Build methodology

Cut thin end-to-end **vertical slices** over horizontal milestones, so there
is always something demoable and each slice de-risks the next — e.g. prove
the inbound order-creation loop completely (auth → read → parse → write)
before starting on outbound confirmations, rather than building "all the
auth for every system" then "all the parsing for every system" as separate
horizontal passes.

A client's actual slice plan and current status live in
`clients/<name>/docs/implementation-plan.md`.

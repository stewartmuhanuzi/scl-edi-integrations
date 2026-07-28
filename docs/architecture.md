# SCL Footwear Integration — Architecture

Retailer EDI ↔ Apparel Magic ↔ DCG (3PL) integration. This document is the
canonical technical reference: system boundaries, data model, orchestration
design, and the build sequence. It reflects decisions already validated
against the live Orderful and Apparel Magic APIs.

---

## 1. Systems and responsibilities

Four systems, four non-overlapping jobs. The primary failure mode for this
class of integration is business logic bleeding across boundaries — guard
against it deliberately.

| Layer | System | Owns | Must NOT own |
|---|---|---|---|
| **Brain** | n8n Cloud | Orchestration, scheduling, routing, API calls, moving files between layers | Being a system of record; hand-rolled EDI mapping |
| **Translator** | Orderful (Mosaic v3) | All X12 ↔ JSON/flat-file transformation (850/810/856 retail + 888/940/943/944/945 warehouse) | Operational order/inventory truth |
| **Truth** | Apparel Magic | Orders, items, inventory, shipments, receipts, invoices, ASN source data | Transport/EDI concerns |
| **Control plane** | Supabase | Run logs, status, correlation IDs, idempotency keys, mapping tables, dashboard | Business truth — it *mirrors* AM, never overrides it |
| **Transport** | AWS Transfer Family SFTP Connector + S3 | Static-IP SFTP push/pull to DCG, raw file staging + archive | Any business transformation |

### Boundary decisions (non-negotiable)

- **Orderful owns transformation.** Do not rebuild X12 mapping in n8n if
  Orderful can transform it. This includes the 900-series flat files for DCG.
- **Apparel Magic owns operational truth.** Supabase and n8n never become an
  alternate source of order/inventory state.
- **AWS is a dumb pipe.** Static-IP SFTP transport, staging, archive, retry,
  logging. No business rules in AWS unless required for envelope/transport
  safety.
- **Supabase is the control plane, not the source of truth.** It records what
  happened and enables idempotency/replay/observability. It does not decide
  business outcomes.

---

## 2. The canonical-object principle

The single most important design rule.

Every inbound document is parsed into a **neutral canonical object** before it
touches the destination system. Every outbound document is built *from* a
canonical object. Never map system-A format directly to system-B format.

```
850 (Orderful JSON)  ──parse──▶  canonical Order  ──map──▶  Apparel Magic sales order
AM shipment          ──parse──▶  canonical Shipment ──map──▶ 856 (Orderful) / 810 (Orderful)
945 (Orderful JSON)  ──parse──▶  canonical Shipment ──map──▶ AM shipment writeback
```

Canonical objects to define (matches scope §8 data-mapping priorities):
`Order`, `Item`, `Shipment`, `Receipt`, `Invoice`, `ASN`, `TradingPartner`.

`src/lib/parse850.js` is the reference implementation of the 850 → canonical
`Order` transform. In production this logic runs inside the n8n `850 → AM`
workflow (Code node) or a Supabase Edge Function; the Node version stays as
the spec + local test harness.

Why this matters: it's what makes flows independently testable, lets us swap a
trading partner or 3PL without rewriting the other side, and gives every
writeback a single well-understood input shape.

---

## 3. Document flows

### Inbound — retailer → warehouse

| Doc | Name | Path | Trigger |
|---|---|---|---|
| 850 | Purchase Order | Retailer → Orderful → AM sales order | Retailer submits PO |
| 888 | Item Maintenance | AM → Orderful → AWS → DCG | New/changed item |
| 940 | Warehouse Shipping Order | AM → Orderful → AWS → DCG | Order released for fulfillment |
| 943 | Stock Transfer Shipment Advice | AM → Orderful → AWS → DCG | Expected inbound receipt |

### Outbound — warehouse → retailer

| Doc | Name | Path | Trigger |
|---|---|---|---|
| 944 | Stock Transfer Receipt Advice | DCG → AWS → Orderful → AM | DCG receives goods |
| 945 | Warehouse Shipping Advice | DCG → AWS → Orderful → AM | DCG ships an order |
| 856 | Advance Ship Notice | AM → Orderful → Retailer | After 945 posts to AM |
| 810 | Invoice | AM → Orderful → Retailer | After fulfillment/invoicing rules met |

**Sequencing rule:** an 888 for a new/changed item must be sent and accepted
by DCG before that item may appear on a 940 or 943.

---

## 4. Orchestration design (n8n)

Compose small workflows; never build monoliths. Use n8n **Execute Workflow**
nodes to share the pieces every flow needs.

### Shared sub-workflows (build once, reuse everywhere)

- **`AM Adapter`** — wraps Apparel Magic access. Injects `time` + `token` as
  query params, normalizes responses to canonical objects, and centralizes
  the auth quirk (see §7). Nothing else calls AM directly.
- **`Orderful Adapter`** — list/get transactions, fetch decoded message body,
  post outbound transactions.
- **`Log Transaction`** — upserts a `transactions` row in Supabase with
  correlation ID + status transition.
- **`Handle Error`** — routes failures to the error state, writes `errors`,
  emits an alert.

### Flow workflows (one per document flow)

Inbound: `850 → AM Sales Order`, `AM Item → 888`, `AM Released Order → 940`,
`AM Inbound Transfer → 943`.

Outbound: `945 → AM Shipment`, `944 → AM Receipt`, `AM Shipment → 856 ASN`,
`AM Invoice → 810`.

Each flow follows the same skeleton:
`trigger → dedupe (idempotency) → fetch source → parse to canonical → map to
target → write/send → log status → on error: Handle Error`.

### Scheduling — flows run independently, not in coordinated lockstep

Every flow dedupes and logs against the same Supabase tables before doing
anything, so **overlapping or out-of-order runs across different workflows
are a non-event** — no need to coordinate timing between them. Each gets its
own trigger on its own natural cadence:

| Flow | Trigger | Cadence |
|---|---|---|
| `850 Ingest` (retailer PO intake) | Schedule | Every 5–15 min (polling Orderful; no webhook set up) |
| `940`/`943` (AM → DCG) | Schedule | Every 15–30 min |
| `944`/`945` (DCG → AM) | Schedule | Every 15–30 min (matches 3PL batch cadence) |
| `856`/`810` (AM → retailer) | **Reactive**, not scheduled | Called via Execute Sub-workflow right after a `945` posts |
| Auth-test / dev-utility workflows | Manual only | Never scheduled |

n8n allows multiple trigger nodes per workflow — keep the Manual Trigger on
every flow for on-demand testing alongside its Schedule Trigger. A workflow's
non-manual triggers only fire once it's **Published/Active**, not merely
saved.

### n8n workflow development conventions

Practices adopted after repeated friction — follow for every new workflow:

1. **Build with Manual Trigger first; add Schedule Trigger only once proven.**
2. **After every import, re-select every credential before doing anything
   else.** Imported nodes can show the right credential *name* while the
   link isn't actually bound ("Credentials not found" / "Authorization
   failed" despite looking selected) — re-selecting fixes it. Check every
   credential-using node, not just the one that errors first.
3. **Sample-data fallback for testability.** When a flow depends on upstream
   data that may not exist yet (e.g. AM shipments/invoices before any order
   has been fulfilled), fall back to a realistic hardcoded sample so the
   workflow is runnable and demonstrable in isolation.
4. **Consistent naming**: prefix `SCL:` so workflows sort and read together.
5. **Tag workflows** (n8n's tag feature) by category — `inbound`, `outbound`,
   `dev-utility` — once there are enough to need it.
6. **Export workflow JSON back into the repo (`n8n/`) after every meaningful
   change.** This is the real source of truth — it already recovered the
   project once after an n8n account reset wiped all live workflows.
7. **Postgres pooler gotcha**: Supabase credential needs SSL = require **and**
   "Ignore SSL Issues" on, or you get a self-signed-cert error.

---

## 5. Control-plane schema (Supabase)

```
transactions        -- one row per document, any direction
  id, correlation_id, doc_type, direction, partner, stream (TEST|LIVE),
  external_ids jsonb, status, payload_ref, created_at, updated_at
  -- status: created|transformed|staged|sent|acked|processed|errored|replayed

files               -- AWS/DCG file lifecycle, mirrors S3
  id, transaction_id, s3_key, filename, direction, status,
  checksum, attempts, last_error

sku_map             -- retailer UPC/SKU <-> AM style/SKU <-> DCG item id
partner_map         -- Orderful trading partner <-> AM customer <-> retailer routing
idempotency_keys    -- unique hash(retailer + PO# + order_date + partner)
errors              -- root cause, owner, next action, retry eligibility
```

### Correlation ID — the spine

One durable correlation ID per business transaction, stamped into Supabase
rows, S3 filenames, Orderful references, and AM writeback notes. This is what
ties a 945 back to its originating 940, and a 944 back to its 943.

Orderful groups the 900-series warehouse transactions by a shared **depositor
order number** — use that as (or deterministically map it to) the correlation
ID for warehouse flows so the linkage survives the round trip through DCG.

---

## 6. AWS static-IP SFTP bridge

The only reason AWS is in this architecture: n8n Cloud has **dynamic** outbound
IPs, and DCG requires a **whitelisted static IP** for SFTP.

```
Outbound:  n8n → write file to S3 /dcg/outbound/pending/
                → AWS Transfer Family SFTP Connector → DCG SFTP
                → on success move to /outbound/sent/  (else /outbound/failed/)

Inbound:   EventBridge cron → Connector retrieves from DCG SFTP
                → lands in S3 /dcg/inbound/pending/
                → n8n reads/processes → /inbound/processed/  (else /inbound/failed/)
```

S3 layout:

```
/dcg/outbound/pending|sent|failed/
/dcg/inbound/pending|processed|failed/
/dcg/archive/
```

Rules:
- Use the SFTP **Connector**, never a full Transfer Family **server endpoint**
  (~$216/mo vs ~$5–25/mo). DCG hosts the server; we connect outbound to them.
- Service-managed connector provides static IPs for DCG to allowlist.
- Store DCG SFTP credentials in AWS Secrets Manager, not in n8n.
- Treat inbound files as immutable raw evidence — process a copy, keep the
  original in archive. All failures land in an error folder with enough
  metadata to replay.
- Don't poll aggressively; a 15-minute cron pickup is ~$3/mo and plenty for
  3PL cadence.

Estimated run cost: **$5–25/month** (Connector + S3 + Secrets Manager +
CloudWatch).

---

## 7. Auth reference (validated against live APIs)

### Orderful (Mosaic v3)
- Base: `https://api.orderful.com/v3`
- Header: `orderful-api-key: <token>` (not Bearer)
- List is cursor-paginated (`nextCursor`); no `limit` param. Filter with
  `stream=TEST|LIVE`, `transactionType`, etc.
- Message body is a separate GET: `/transactions/{id}/message`.

### Apparel Magic
- Base: `https://sclfootwear.app.apparelmagic.com/api/json/{endpoint}/`
- Auth: `time` (unix seconds) + `token` as **query-string params**. Confirmed
  quirks:
  - The docs' JSON-body example does **not** work — the app reads `$_GET`, not
    the request body.
  - There is **no** HTTP Basic Auth wall; the Apache-style 401 page is a PHP
    response for a missing/invalid token. Don't chase Basic Auth.
  - `time` must be fresh per request (stale timestamps are rejected).
  - Nested params use PHP bracket notation: `pagination[page_size]=5`,
    `parameters[0][field]=sku_id`.
  - Login is single-session (`already_logged_in`), but the API token is
    independent of the UI session, so this doesn't affect API calls.

Secrets live in `.env` locally and in n8n's credential store (Header Auth for
Orderful, Query Auth for Apparel Magic) — never hardcoded in workflow JSON.

---

## 8. Cross-cutting requirements

- **Idempotency (mandatory).** Apparel Magic has no native idempotency.
  Dedupe in Supabase *before* every create/writeback using
  `hash(retailer + PO# + order_date + partner)` for orders, and correlation ID
  for warehouse confirmations. This is what prevents a replay from
  double-posting an order, shipment, or receipt.
- **Everything replayable.** Design every job so re-running a source
  transaction is safe. Never delete/overwrite raw files.
- **Observability is a feature, not cleanup.** Status transitions and error
  visibility are first-class. Minimum dashboard: latest files, failures,
  pending files, last successful poll, stuck transactions.
- **Correlation everywhere.** Logs, filenames, Orderful refs, AM writeback
  notes all carry the correlation ID.

---

## 9. Build sequence (vertical slices)

Cut thin end-to-end slices over horizontal milestones, so there is always
something demoable and each slice de-risks the next.

| Slice | Scope | Unblocks / proves |
|---|---|---|
| **1** | `850 → AM sales order`, wired in n8n + Supabase logging + idempotency | Full inbound brain, zero AWS/DCG dependency. Everything already proven. |
| **2** | AWS bridge smoke test: S3 + Transfer Family connector + one dummy round-trip to DCG test SFTP, IP whitelisted | Unblocks all warehouse-facing flows |
| **3** | `AM order → 940 → DCG` and `945 → AM shipment` | The core fulfillment loop |
| **4** | `856` + `810` back to retailer | Closes the retailer loop |
| **5** | `888` item master + `943`/`944` receiving loop | Inbound goods |
| **6** | Reconciliation dashboard + alerting (Supabase-backed), then cutover | Go-live readiness |

Current status: Orderful + Apparel Magic auth and reads proven; 850 → canonical
parser built and validated. **Next: Slice 1.**

---

## 10. Open questions (resolve before the dependent slice)

**Orderful**
- Does the transform emit DCG-ready flat files for 888/940/943, and via which
  API surface (Mosaic vs traditional)? Build an 888 proof-of-concept early —
  it's the highest-risk item.

**Apparel Magic**
- Which order status = "released to DCG" (trigger for 940)?
- Are invoices/ASNs generated inside AM or triggered by the integration?
- Can it accept shipment/receipt writeback against existing orders (for
  945/944)?

**DCG**
- SFTP host, folder structure, file naming, sample files, and ack/reject
  behavior. Request DCG's implementation guide + sample files at kickoff.

---

## 11. References

- Orderful transaction types: https://docs.orderful.com/reference/available-transaction-types
- Orderful 3PL / 900-series: https://docs.orderful.com/v3/docs/enabling-3pl-vendors-for-edi
- Orderful 940 / 945 docs: https://docs.orderful.com/docs/940-warehouse-shipping-order
- AWS Transfer Family SFTP Connectors (static IP, pricing by call/GB)
- Project scope: `SCL_Footwear_Integration_Scope_V1` (developer handoff)

# EDI Integration Platform

A reusable pattern for building ERP ↔ EDI integrations, orchestrated in
**n8n** and backed by **Supabase**. Originally built for SCL Footwear
(ApparelMagic ↔ Orderful ↔ DCG), restructured so the next client engagement
reuses the core pattern and swaps in new adapters rather than starting over.

## The three zones

```
core/           universal, vendor-agnostic — reused by every client
  lib/            shared Node helpers (env loading, logging)
  supabase/       control-plane schema (same for every client)
  *.md            the canonical-object contract, the adapter contract,
                   the architecture pattern

adapters/       one folder per vendor, swappable per client
  erp/<name>/     an ERP integration (e.g. apparelmagic/) — auth client,
                   parsers (ERP → canonical), builders (canonical → ERP)
  edi/<name>/     an EDI platform integration (e.g. orderful/) — same shape

clients/<name>/ one folder per client engagement
  n8n/            the actual workflows (import these into n8n)
  .env            that client's credentials
  docs/           that client's specifics — retailer list, 3PL notes, status
```

**Building a new client:** reuse `core/` as-is. If they use ApparelMagic
and/or Orderful, reuse the matching adapter(s) too. If not, write a new
adapter following `core/adapter-contract.md` (same shape as the existing
ones — auth client, `parse*.js`, `build*.js`, a `README.md` of gotchas).
Then build that client's `n8n/` workflows wiring the adapters together, and
their `clients/<name>/docs/`.

See `core/architecture.md` for the full pattern (system boundaries, the
canonical-object rule, orchestration/scheduling conventions) and
`core/canonical-objects.md` / `core/adapter-contract.md` for what a new
adapter needs to provide.

## SCL Footwear — current client

Retailer EDI ↔ ApparelMagic ↔ DCG (3PL), all in `clients/scl-footwear/`.

Working today:
- **850 → ApparelMagic sales order** — live, proven
  (`clients/scl-footwear/n8n/flows/850-inbound.json`)
- **856/810 (retailer ASN + invoice)** — schema fully mapped against
  Orderful, workflow built
  (`clients/scl-footwear/n8n/flows/856-810-outbound.json`), pending the real
  post-945 trigger
- **AM data pulls** (pick tickets, purchase orders, products/inventory) —
  scaffolding for the future 943 DCG flow
  (`clients/scl-footwear/n8n/flows/am-data-pulls.json`)
- **888 (item master) → DCG over AWS SFTP** — self-built X12 codec
  (`adapters/edi/x12-dcg/`) — **proven live** 2026-08-01, a real file built,
  uploaded to S3, and delivered to DCG's SFTP server on the TEST stream
  (`clients/scl-footwear/n8n/flows/888-outbound.json`)
- **940 (warehouse shipping order) → DCG over AWS SFTP** — built 2026-08-01,
  one X12 file per pick ticket
  (`clients/scl-footwear/n8n/flows/940-outbound.json`), structurally
  verified, not yet run against real DCG

Full status: [clients/scl-footwear/docs/implementation-plan.md](clients/scl-footwear/docs/implementation-plan.md).
Client-specific architecture: [clients/scl-footwear/docs/architecture.md](clients/scl-footwear/docs/architecture.md).

## Getting set up (per client)

1. **EDI platform token** — e.g. for Orderful, Settings > API Credentials at
   <https://ui.orderful.com>, plus a test trading partner (Orderful's *Retail
   Scenario Testing Demo*) for a safe round-trip before touching a real
   partner.
2. **ERP API key** — per the ERP adapter's `README.md` for auth specifics.
3. **Supabase** — create a project for the client, copy
   `clients/<name>/.env.example` to `.env` and fill in the pooler connection
   details, then `npm install && npm run migrate -- <name>` to create the
   control-plane tables (auto-detects the client if there's only one).
4. **n8n** — one shared n8n account across all clients. Create a top-level
   folder named after this client (sub-structure: 3PL/DCG folder, Retailer
   Templates, Retailers, Tools — see `core/architecture.md` §3), then import
   each workflow in `clients/<name>/n8n/flows/` (and `tools/` as needed) one
   at a time onto a **blank** new workflow inside the matching subfolder;
   re-select every credential-using node after import. See
   `clients/<name>/n8n/README.md`.

## Docs index

- [core/architecture.md](core/architecture.md) — the reusable pattern
- [core/canonical-objects.md](core/canonical-objects.md) — the object shapes every adapter must produce/consume
- [core/adapter-contract.md](core/adapter-contract.md) — what a new adapter needs, and the live-schema-discovery method
- [adapters/erp/apparelmagic/README.md](adapters/erp/apparelmagic/README.md)
- [adapters/edi/orderful/README.md](adapters/edi/orderful/README.md) + [schema-notes.md](adapters/edi/orderful/schema-notes.md)
- [adapters/edi/x12-dcg/README.md](adapters/edi/x12-dcg/README.md) — planned self-built X12-over-SFTP codec for the DCG leg
- [clients/scl-footwear/docs/](clients/scl-footwear/docs/) — implementation plan, architecture, DCG notes, EDI field mapping, status

## Claude Code skills

`.claude/skills/` packages the recurring workflows above as invokable
skills, so building the next adapter or client follows the same checklist
every time instead of being re-derived from scratch:

- `add-adapter` — scaffold a new ERP or EDI-platform adapter
- `discover-api-schema` — reverse-engineer an undocumented API's auth/schema
- `build-n8n-workflow` — build/import/maintain an n8n workflow correctly
- `add-client` — scaffold a new client engagement folder
- `add-retailer` — onboard a new retailer trading partner (per-retailer workflow folder) within an existing client
- `check-code-quality` — syntax/JSON validation, stale-reference sweep, and adapter-contract boundary checks

# SCL EDI Integration

Automated EDI integration bridging **Orderful** (Mosaic API), **ApparelMagic**,
and **DCG** (3PL) for **SCL Footwear**, orchestrated entirely in **n8n** and
backed by **Supabase**.

## What this does

SCL Footwear trades with retail partners over EDI and fulfills through DCG.
This integration removes manual data entry across the whole loop:

| EDI doc | Meaning | Direction | Job |
|---------|---------|-----------|-----|
| **850** | Purchase Order | Retailer → SCL | Create sales order in ApparelMagic |
| **856** | Advance Ship Notice (ASN) | SCL → Retailer | Send shipment/carton/tracking data |
| **810** | Invoice | SCL → Retailer | Send the invoice |
| **888/832** | Item Maintenance | SCL → DCG | Sync item master |
| **940** | Warehouse Shipping Order | SCL → DCG | Release an order for fulfillment |
| **943** | Stock Transfer Shipment Advice | SCL → DCG | Advance notice of incoming stock |
| **944** | Stock Transfer Receipt Advice | DCG → SCL | Confirm goods received |
| **945** | Warehouse Shipping Advice | DCG → SCL | Confirm goods shipped |

## Architecture

```
Retailer  ──EDI──►  Orderful (Mosaic API)  ◄──►  n8n workflows  ◄──►  ApparelMagic API
                            │                                              │
                            └──────────── DCG (3PL, via SFTP) ◄─────────────┘
                                                     │
                                                 Supabase
                                    (logging, SKU/partner mapping,
                                     idempotency, status, retries)
```

- **n8n** — the only runtime. All orchestration, transformation, and API
  calls happen in n8n workflows (`n8n/`) — nothing runs as a standalone
  service. `src/lib/*.js` holds the reviewable reference implementation of
  each transform; the logic is manually ported into the corresponding n8n
  Code node (n8n Cloud can't import local repo files).
- **Supabase** — control-plane datastore: transaction audit log, mapping
  tables (retailer SKU ↔ ApparelMagic SKU, partner IDs), dedup/idempotency,
  status tracking, error/retry queues.
- **Orderful** — all EDI/X12 ↔ JSON transformation.
- **ApparelMagic** — the operational source of truth (orders, items,
  shipments, invoices).

Full detail: [docs/architecture.md](docs/architecture.md).

## Status

Current build status, phase by phase: [docs/implementation-plan.md](docs/implementation-plan.md).

Working today:
- **850 → ApparelMagic sales order** — live, proven (`n8n/flows/850-inbound.json`)
- **856/810 (retailer ASN + invoice)** — schema fully mapped against Orderful, workflow built (`n8n/flows/856-810-outbound.json`), pending the real post-945 trigger

## Repo layout

```
n8n/
  flows/       production workflows — import these into n8n
  tools/       manual dev/test utilities (auth checks, one-off order create/cancel)
src/lib/       reference implementation of each canonical parser/builder
scripts/
  migrate.js   applies Supabase SQL migrations — npm run migrate
supabase/
  migrations/  SQL schema for the control-plane tables
docs/          architecture, implementation plan, DCG specs, discovery notes
```

## Getting set up

1. **Orderful token** — Settings > API Credentials in <https://ui.orderful.com>.
2. **Orderful demo partner** — add the *Retail Scenario Testing Demo* under
   Integration Testing to get a built-in trading partner for the
   850 → 856 → 810 round-trip. Test transactions are never delivered live.
3. **ApparelMagic** — issue an API key for the SCL instance
   (<https://sclfootwear.app.apparelmagic.com>). Auth is `time`+`token` as
   **query-string params** — see architecture.md §7 for confirmed quirks.
4. **Supabase** — copy `.env.example` to `.env`, fill in the pooler
   connection details, then `npm install && npm run migrate` to create the
   control-plane tables.
5. **n8n** — import each workflow in `n8n/flows/` (and `n8n/tools/` as
   needed) one at a time; re-select every credential-using node after
   import. See [n8n/README.md](n8n/README.md).

## Docs

- [Architecture](docs/architecture.md) — system boundaries, canonical-object model, n8n orchestration + scheduling conventions, Supabase control plane, auth reference, build sequence.
- [Implementation plan](docs/implementation-plan.md) — step-by-step build checklist, phase by phase.
- [DCG integration notes](docs/dcg-integration-notes.md) — DCG contacts, confirmed specs, open decisions.
- [Orderful outbound schema notes](docs/orderful-outbound-schema-notes.md) — live-discovered 856/810 JSON schema.
- [EDI flow & field mapping notes](docs/edi-flow.md)
- Orderful quick start: <https://docs.orderful.com/reference/welcome-to-mosaic>
- Orderful testing: <https://docs.orderful.com/reference/testing-your-integration>

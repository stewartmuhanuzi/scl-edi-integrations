# n8n workflows

Organized by **usage**, not history.

## `flows/` — production business logic + retailer-facing templates

Scheduled/schedulable, run against real data, follow the standard skeleton
(dedupe → do work → log status → error branch). See
[core/architecture.md §3](../../../core/architecture.md#3-orchestration-design-n8n) for
the scheduling plan and development conventions.

Two roles live here: **shared DCG/3PL-facing flows** (one warehouse for every
retailer — e.g. `am-data-pulls.json`) and the **retailer-facing templates**
(`850-inbound.json`, `856-810-outbound.json`) that get copied per retailer
into [`retailers/`](retailers/). See [`retailers/README.md`](retailers/README.md)
and the `add-retailer` skill for how a retailer copy is parameterized.

- **`850-inbound.json`** — `SCL: 850 → AM (full pipeline)`. Pulls retailer
  POs from Orderful, parses, dedupes/logs to Supabase, creates the Apparel
  Magic sales order.
- **`856-810-outbound.json`** — `SCL: 856 ASN + 810 Invoice (Orderful
  outbound)`. Builds and creates outbound ASN/Invoice transactions in
  Orderful from Apparel Magic shipment/invoice data (falls back to a
  realistic sample if none exists yet).
- **`am-data-pulls.json`** — `SCL: AM Data Pulls (pick tickets, purchase
  orders, products)`. Pulls + parses Apparel Magic pick tickets, purchase
  orders, and products/inventory into canonical objects — scaffolding for
  the future 940/943/888 DCG flows. **Read-only, no Orderful calls yet** —
  the Orderful side is blocked until DCG's Trading Partnership is active
  with those transaction types (see ../docs/dcg-integration-notes.md).

## `tools/` — manual dev/test utilities

Manual-trigger only, never scheduled. For debugging and one-off testing.

- **`test-orderful-auth.json`** — Orderful auth smoke test
- **`test-apparelmagic-auth.json`** — ApparelMagic auth smoke test
- **`am-create-test-order.json`** — manually create one test order in AM
- **`am-cancel-order.json`** — cancel an order (cleanup helper)

## Import notes

After importing any workflow, **re-select every credential-using node**
before running — imported nodes can show the right credential name while the
link isn't actually bound. See ../../../core/architecture.md §3, point 2.

Credentials used across these workflows: **Header Auth account** (Orderful),
**Query Auth account** (ApparelMagic), **Postgres account** (Supabase).

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
  the future 943 DCG flow (888 and 940 are now built, see below). Read-only,
  no DCG-facing calls. Has its own dedicated "Get AM Inventory (for Pick
  Tickets)" node (separate from the one already used for products/SKUs) so
  pick-ticket lines get real UPC + full color name — a second, redundant
  Inventory call rather than reusing the existing node across two branches,
  which would have given it two incoming connections and fired it twice.
- **`888-outbound.json`** — `SCL: 888 Item Maintenance (AM → X12 → DCG)`.
  Pulls a few real Apparel Magic products/SKUs, builds an 888 X12 file
  (`adapters/edi/x12-dcg/lib/{envelope,itemCode,build888}.js`, ported into a
  Code node), dedupes/logs to Supabase, uploads to S3, and pushes it to DCG
  via the AWS Transfer Family Connector's `StartFileTransfer` API. **Proven
  live** (2026-08-01) — a real file was built, uploaded, and delivered to
  DCG's SFTP server on the TEST stream. Several field values are still
  unconfirmed placeholders — see `adapters/edi/x12-dcg/schema-notes.md` and
  the workflow's own `meta.instructions` before doing a real (non-test) send.
- **`940-outbound.json`** — `SCL: 940 Warehouse Shipping Order (AM → X12 →
  DCG)`. Pulls a few real Apparel Magic pick tickets (falls back to one
  sample if none exist yet), a generic AM customer lookup, and AM Inventory
  (enriches each pick-ticket line with real UPC + full color name — pick
  tickets alone don't carry UPC, same combine pattern as 888/`parseItem.js`),
  builds one 940 X12 file **per pick ticket** (unlike 888, which batches many
  items into one file — each pick ticket is its own shipment), same
  dedupe/upload/push/mark-sent pattern as 888. Not yet run against real
  DCG — built 2026-08-01, structurally verified only. Known gaps (customer
  name from an unfiltered lookup, several omitted fields) documented in
  `adapters/edi/x12-dcg/schema-notes.md` and the workflow's own
  `meta.instructions`.

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
**Query Auth account** (ApparelMagic), **Postgres account** (Supabase),
**AWS account** (S3 + Transfer Family, for the DCG-facing flows — needs
`s3:PutObject` on the target bucket and `transfer:StartFileTransfer` /
`transfer:ListFileTransferResults` on the connector).

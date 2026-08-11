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
  orders, and products/inventory into canonical objects — the scaffolding
  888/940/943 (see below) were all built on top of. Read-only, no
  DCG-facing calls. Has its own dedicated "Get AM Inventory (for Pick
  Tickets)" node (separate from the one already used for products/SKUs) so
  pick-ticket lines get real UPC + full color name — a second, redundant
  Inventory call rather than reusing the existing node across two branches,
  which would have given it two incoming connections and fired it twice.
- **`888-outbound.json`** — `SCL: 888 Item Maintenance (AM → X12 → DCG)`.
  Pulls a few real Apparel Magic products/SKUs, builds an 888 X12 file
  (`adapters/edi/x12-dcg/lib/{envelope,itemCode,build888}.js`, ported into a
  Code node), dedupes/logs to Supabase, uploads to S3, and pushes it to DCG
  via the AWS Transfer Family Connector's `StartFileTransfer` API. **Proven
  live** (2026-08-10) — a real file (`SCL_888_2026-08-10T17-12-34-503Z.txt`)
  was built, uploaded, and delivered to DCG's SFTP server on the TEST
  stream, confirmed two independent ways: `ListFileTransferResults` returned
  `StatusCode: COMPLETED`, and `StartDirectoryListing` showed the exact file
  sitting in `\From_SCL_TEST\`. (An earlier 2026-08-01 run only looked
  successful — the initial 200 from `StartFileTransfer` doesn't mean
  delivery — and never actually reached DCG; see `dcg-sftp-design.md` for
  the full root-cause chain: missing `RemoteDirectoryPath`, an
  under-scoped connector execution role, and finally an `undefined`
  filename in `StartFileTransfer`'s body, fixed 2026-08-10.) Several field
  values are still unconfirmed placeholders — see
  `adapters/edi/x12-dcg/schema-notes.md` and the workflow's own
  `meta.instructions` before doing a real (non-test) send.
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
  `meta.instructions`. **Proven live** (2026-08-10) — the `StartFileTransfer`
  `fileName` reference fix (see 888's entry above) was applied to the live
  n8n canvas and confirmed working against real DCG.
- **`943-outbound.json`** — `SCL: 943 Warehouse Shipment Advice (AM → X12 →
  DCG)`. Pulls a few real Apparel Magic purchase orders (falls back to one
  sample if none exist yet), builds one 943 X12 file **per purchase order**
  (each PO is its own shipment-advice transaction to DCG, same per-shipment
  pattern as 940 — not batched like 888), same dedupe/upload/push/mark-sent
  pattern as 888/940. No Inventory combine needed here — DCG's 943 spec
  deliberately sends no UPC. Built 2026-08-10, structurally verified only,
  not yet run against real DCG. Known gaps (placeholder warehouse code, an
  order-number field whose position is genuinely inconsistent between DCG's
  own two real samples, several undocumented real-sample fields deliberately
  not replicated) documented in `adapters/edi/x12-dcg/schema-notes.md` and
  the workflow's own `meta.instructions`. **Proven live** (2026-08-10) — a
  real file (`SCL_943_100_2026-08-10T19-02-51-435Z.txt`) was built,
  uploaded, and delivered to DCG's SFTP server on the first real attempt,
  confirmed `COMPLETED` via `ListFileTransferResults`.
- **`sync-am-custom-fields.json`** — `SCL: AM Custom Fields Sync`.
  Preliminary work per Mike's 2026-08-07 request. Pulls Orders/Products/
  Purchase Orders/Pick Tickets/Customers in parallel, generically captures
  any `attN_*` custom-attribute field per record (ApparelMagic's
  per-instance-configurable fields — see
  `adapters/erp/apparelmagic/README.md`'s gotchas), and upserts into the new
  `am_custom_fields` table (`core/supabase/migrations/0002_am_custom_fields.sql`
  — run this migration before executing the flow). Read-only from AM's side,
  no DCG/Orderful involvement, not scheduled (manual trigger only). Not yet
  wired into any canonical object or outbound mapping — read-and-store only,
  per Mike's literal request; built and verified against real AM data
  2026-08-10.

## `tools/` — manual dev/test utilities

Manual-trigger only, never scheduled. For debugging and one-off testing.

- **`test-orderful-auth.json`** — Orderful auth smoke test
- **`test-apparelmagic-auth.json`** — ApparelMagic auth smoke test
- **`am-create-test-order.json`** — manually create one test order in AM
- **`am-cancel-order.json`** — cancel an order (cleanup helper)
- **`check-dcg-directory.json`** — browses a folder on DCG's real SFTP
  server (via the connector's `StartDirectoryListing` API) so you can
  confirm a file actually landed where DCG expects, without waiting on Chi
  Cao to check. Defaults to `/From_SCL_TEST`. Needs
  `transfer:StartDirectoryListing` added to the n8n IAM user's policy — see
  `docs/n8n-aws-iam-policy.json` — **and** the connector's own separate
  execution role (`scl-dcg-transfer-connector-role`) needs S3 access to
  whatever prefix you point `OutputDirectoryPath` at (confirmed live
  2026-08-06: that role was scoped only to `dcg/*`, not `outbound/*` or
  `dcg-listings/*`, which silently broke real file sends too — see
  `dcg-sftp-design.md`).
- **`check-transfer-result.json`** — checks the *real* outcome of a specific
  `StartFileTransfer` call via `ListFileTransferResults`. Needed because the
  initial 200 response only confirms AWS accepted the request, not that the
  transfer actually completed — this exact blind spot is how two failed
  sends went unnoticed (see `dcg-sftp-design.md`). Needs a `TransferId` from
  the send flow's `StartFileTransfer (DCG)` node output, passed via pinned
  trigger data (`{ "transferId": "..." }`).

## Import notes

After importing any workflow, **re-select every credential-using node**
before running — imported nodes can show the right credential name while the
link isn't actually bound. See ../../../core/architecture.md §3, point 2.

Credentials used across these workflows: **Header Auth account** (Orderful),
**Query Auth account** (ApparelMagic), **Postgres account** (Supabase),
**AWS account** (S3 + Transfer Family, for the DCG-facing flows — needs
`s3:PutObject` on the target bucket and `transfer:StartFileTransfer` /
`transfer:ListFileTransferResults` on the connector).

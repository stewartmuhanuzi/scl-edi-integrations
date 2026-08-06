# Implementation Plan — Step by Step

A flat, ordered checklist to build the integration. Work top to bottom; don't
start a phase until the previous phase's "Done when" is true. Each item is
small and verifiable on purpose.

See [architecture.md](architecture.md) for the *why* behind any of this.

Legend: `[x]` done · `[ ]` to do

## Current status (2026-07-26)

- **Phase 1 (850 → AM order): done and proven live.** Real Orderful PO → AM
  sales order, idempotent, logged to Supabase.
- **Phase 2 (DCG SFTP bridge): BLOCKED on DCG.** Trade request sent in
  Orderful, sitting at "Waiting on partner" for Chi Cao to accept. Nothing
  further to do here until she does.
- **Phase 3 (940 out / 945 back):** blocked behind Phase 2.
- **Reprioritized — Phase 4 (856/810 retailer outbound) starts now, out of
  order.** Per Mike: since DCG is stalled, rough in the 856 (ASN) and 810
  (Invoice) transform logic against Apparel Magic's existing `shipments/` and
  `invoices/` endpoints directly. Doesn't need a live 945 to build the
  canonical-object mapping and Orderful payload construction — same pattern as
  `parse850.js`. Wire the real trigger (post-945) later.

---

## Phase 0 — Foundation & access (do this first)

Nothing here is code. It removes the blockers that otherwise stall every later
phase.

- [x] Orderful account + API token, auth proven (`orderful-api-key` header)
- [x] Apparel Magic API token, auth proven (`time`+`token` query params)
- [x] Orderful *Retail Scenario Testing Demo* partner sending TEST 850s
- [x] Local repo scaffolded with `.env` (secrets out of git)
- [x] Create the **Supabase project** for this integration (control-plane tables live)
- [x] **AWS account confirmed**: "SCL Footwear" (`465573888733`), region us-east-2 (Ohio) — reversed back to AWS for the DCG bridge (see Phase 2)
- [x] DCG contact established (Chi Cao, DCG EDI team) — self-hosted SFTP confirmed, X12 flat files confirmed. Sample files (940/943/888/832) referenced as sent — **need actual files pulled into `dcg-specs/`**. See [dcg-integration-notes.md](dcg-integration-notes.md).
- [x] AWS Transfer Family SFTP Connector confirmed live both ends (2026-07-30) — see Phase 2
- [ ] Get DCG SFTP credentials (Chi Cao said sent — confirm received) into `.env`
- [x] **Resolved**: 888 (not 832) for item master, per Mike's direction — see dcg-integration-notes.md. Still open: keep/drop `N9|GM` carton-scan segment on 943.
- [ ] Write down the **access matrix**: every system, who owns it, test vs prod, where the credential lives
- [ ] Confirm the two blocking Apparel Magic questions:
  - [ ] Which endpoint/method creates a **sales order**? (`orders/` POST shape)
  - [ ] Which order **status** = "released to DCG" (the 940 trigger)?

**Done when:** Supabase + AWS projects exist, DCG test details are in hand, and
you know how to create an AM sales order via API.

---

## Phase 1 — Slice 1: `850 → Apparel Magic sales order`

The whole inbound brain, no AWS/DCG dependency. This is the first real
production workflow.

### Supabase setup
- [x] Create tables: `transactions`, `idempotency_keys`, `errors`, `sku_map`, `partner_map` (via `npm run migrate`)
- [x] Add a Postgres credential in n8n (shared pooler; SSL require + Ignore SSL Issues on)

### n8n shared sub-workflows (build once, reuse)
- [ ] `Orderful Adapter` — list transactions, fetch message body
- [ ] `AM Adapter` — inject `time`+`token`, normalize responses
- [ ] `Log Transaction` — upsert a `transactions` row with correlation ID + status
- [ ] `Handle Error` — write `errors`, set errored status, emit alert

### The `850 → AM` flow (n8n/flows/850-inbound.json)
- [x] Trigger (manual for now; swap to schedule later) polling Orderful `stream=TEST`
- [x] Filter to `850_PURCHASE_ORDER` only
- [x] Fetch the message body (`/transactions/{id}/message`)
- [x] Parse to canonical `Order` (parse850 logic ported into a Code node)
- [x] Dedupe + log atomically: claim `idempotency_keys`, and only insert `transactions` when newly claimed (single SQL CTE in "Claim & Log")
- [x] Map canonical `Order` → AM sales-order payload
- [x] Create the order via `POST /api/json/orders/` (auth in body: time+token+order array) — order #5 created live in the AM test company (qty 45, $899.55)
- [x] Dedupe gate ("New PO?") skips create on re-runs
- [ ] Seed `sku_map` + `partner_map` so lines use real per-SKU AM ids (currently all lines use one fallback sku_id)
- [ ] Error branch → `errors`

### Verify
- [ ] Run against the 3 known demo 850s → 3 AM sales orders created
- [ ] Re-run the workflow → **no duplicates** (idempotency holds)
- [ ] Force a failure (bad SKU) → lands in `errors`, doesn't create a partial order

**Done when:** a TEST 850 reliably becomes an AM sales order, is logged, and is
safe to replay.

---

## Phase 2 — Slice 2: AWS SFTP bridge to DCG smoke test

**Current plan (2026-07-29, reversed back to AWS):** an **AWS Transfer Family
SFTP _Connector_ + S3** bridge provides the static IP DCG whitelists, and we
**build/parse the X12 ourselves** (no Orderful on this leg). Full design:
[dcg-sftp-design.md](dcg-sftp-design.md). The earlier "Orderful hosts the
SFTP + Convert" plan is dropped — a side benefit is that the Orderful
relationship gate no longer blocks 940/943/888.

- [x] Get DCG's sample 940/943/888/832 files + field-mapping specs into the repo (`dcg-specs/`)
- [x] **Resolved with Mike (2026-07-30): use 888** (not 832) for item master — see dcg-integration-notes.md for the corrected reasoning
- [ ] Confirm with Mike: **drop `N9|GM`** carton-scan segment on the 943 — recommended, AM has no carton-level packing data
- [ ] Confirm with Mike/Chi Cao: `build940.js` defaults to transaction-type code `42` (Customer Order) — a well-supported default since all Customer Order sub-flavors share that code in VIDA's mapping (only Distribution `10` / Rework `13` differ), but not yet explicitly confirmed as correct for SCL's model
- [ ] Get DCG's SFTP host/port/creds + read/write directories from Chi Cao; confirm the X12 envelope IDs DCG expects for SCL
- [x] AWS account, S3 bucket, Transfer Family SFTP Connector to DCG confirmed live both ends (2026-07-30) — connector `c-71cf9ddb758b4376b`, `sftp://20.14.2.67:22`, account "SCL Footwear" (465573888733), us-east-2
- [x] Connector's static IP whitelisted by DCG — confirmed working from both sides
- [x] **Outbound smoke test DONE (2026-08-01)**: `888-outbound.json` ran end-to-end for real — 3 real AM products → X12 built → S3 `outbound/pending/` → `StartFileTransfer` → DCG. Every node green through Mark Sent. TEST stream, but a genuinely delivered file, not just an internal dry run.
- [ ] Inbound smoke test: `StartFileTransfer` RetrieveFilePaths pulls a DCG file into S3, confirm n8n reads it
- [ ] Add the Supabase `files` table + ISA13 control-number sequence (migration `0002`) and write to them on every transfer

**Done when:** a file round-trips n8n → S3 → AWS SFTP → DCG → S3 → n8n with
the static IP confirmed, and each hop is logged. **Outbound half done
(2026-08-01)**; inbound (DCG → S3 → n8n) still open — needed for 944/945.

---

## Phase 3 — Slice 3: the fulfillment loop (`940` out, `945` back)

The core money path. Depends on Phases 1 + 2.

- [x] Pull real field shape from AM's `pick_tickets/` endpoint (source for 940 — a released order becomes a pick ticket)
- [x] `adapters/erp/apparelmagic/lib/parsePickTicket.js` — AM pick ticket → canonical `PickTicket`. Updated 2026-08-02 (per Mike's note that Inventory, not just Products, is needed for real SKU data) to take a `skusById` lookup from `GET /api/json/inventory/` and enrich each line with UPC + full color name — pick_ticket_items alone doesn't carry either, same combine pattern already used by `parseItem.js`.
- [x] `n8n/flows/am-data-pulls.json` — pulls + parses AM pick tickets (also purchase orders, products/inventory) to canonical objects, sample-fallback if empty
- [x] `adapters/edi/x12-dcg/lib/build940.js` — canonical `PickTicket` → 940 X12, built 2026-08-01 per Mike's go-ahead. Structurally verified against `sample-940.txt`; several fields deliberately omitted (no canonical source) — see `schema-notes.md`. 940 sub-type resolved: `42` (Customer Order) is well-supported, not a guess — all Customer Order flavors share that code in VIDA's mapping.
- [x] `n8n/flows/940-outbound.json` — pulls real AM pick tickets (sample-fallback if empty), a generic AM customer lookup, and AM Inventory (for the UPC/color-name enrichment above), builds one 940 X12 **per pick ticket** (not batched, unlike 888), dedupes/logs/uploads/pushes same pattern as `888-outbound.json`. Built and structurally verified 2026-08-01/02; not yet run against real DCG.
- [ ] Run the 940 flow's first live TEST-stream send to DCG and confirm receipt with Mike/Chi Cao
- [ ] `N1|BT` customer name currently comes from an unfiltered AM customer lookup (page_size 1, not matched to the pick ticket's actual `customerId`) — AM's customers/ endpoint filter-by-ID capability hasn't been confirmed; fix once confirmed
- [ ] `945 → AM Shipment`: cron `RetrieveFilePaths` from DCG → `parse945` X12 → canonical `Shipment` → AM shipment writeback
- [ ] Tie 945 back to its originating 940 via correlation ID (depositor order number)
- [ ] Idempotent writeback: replaying a 945 doesn't double-post the shipment
- [ ] Verify end-to-end with one order: released → 940 sent → 945 returned → AM updated

**Done when:** an AM order flows to DCG as a 940 and its 945 confirmation posts
back to AM, once.

---

## Phase 4 — Slice 4: retailer outbound (`856` ASN + `810` invoice)

Closes the retailer loop. Formally depends on Phase 3 (needs real shipment
data from a live 945), but the **transform logic is being roughed in now**
(out of sequence, per Mike) since it only needs Apparel Magic's existing
`shipments/`/`invoices/` data — the real 945-driven trigger gets wired later.

- [x] Pull real field shapes from AM's `shipments/` (boxes/box_items/UCC) and
      `invoices/` (invoice_items) endpoints
- [x] Discover Orderful's 856/810 JSON schema live (POST + read validation
      errors) — see [adapters/edi/orderful/schema-notes.md](../../../adapters/edi/orderful/schema-notes.md)
      for exactly what's confirmed vs. still guessed
- [x] `adapters/erp/apparelmagic/lib/parseShipment.js` — AM shipment → canonical `Shipment`
- [x] `adapters/erp/apparelmagic/lib/parseInvoice.js` — AM invoice → canonical `Invoice`
- [x] `adapters/edi/orderful/lib/build856.js` — canonical `Shipment` → Orderful 856 message. **Full schema confirmed live**: header/BSN/HL hierarchy (S/O/P/I)/N1/carrier/dates/PO-ref/carton-marks(MAN)/item-id(LIN)/item-qty(SN1)
- [x] `adapters/edi/orderful/lib/build810.js` — canonical `Invoice` → Orderful 810 message. **Full schema confirmed live**: header/BIG/N1 (ST+BT)/line items (`baselineItemDataInvoice`)/total (`totalMonetaryValueSummary.amount`)
- [x] Both builders' JSON structure validated by successfully creating real TEST transactions in Orderful (ids in adapters/edi/orderful/schema-notes.md)
- [ ] Remaining gap is guideline-level (retailer-specific requirements), not schema — revisit once mapping to a real retailer
- [ ] Wire the real trigger: call `build856`/`build810` after a 945 posts to AM (blocked behind Phase 2/3)
- [ ] `AM Shipment → 856 ASN`: after 945 posts, build canonical `ASN` → Orderful → retailer
- [ ] `AM Invoice → 810`: when invoicing rules are met, build canonical `Invoice` → Orderful → retailer
- [ ] Confirm ASN carton/pack hierarchy + tracking are correct (highest chargeback risk)
- [ ] Confirm invoice reconciles to the 850/856 (watch the 44.9775-style raw precision — round consistently)
- [ ] Verify full happy path: 850 → order → 940 → 945 → 856 + 810 to retailer

**Done when:** a completed shipment produces a correct ASN and invoice back to
the retailer.

---

## Phase 5 — Slice 5: item master + receiving (`888`, `943`, `944`)

- [x] Pull real field shapes from AM's `products/` (header) + `inventory/` (per-SKU UPC/color/size) endpoints
- [x] Pull real field shape from AM's `purchase_orders/` endpoint (source for 943 — incoming vendor stock DCG needs advance notice of)
- [x] `adapters/erp/apparelmagic/lib/parseItem.js` — AM product + SKUs → canonical `Item` (888 source)
- [x] `adapters/erp/apparelmagic/lib/parsePurchaseOrder.js` — AM purchase order → canonical `PurchaseOrder` (943 source)
- [x] `n8n/flows/am-data-pulls.json` — pulls + parses AM purchase orders and products/inventory to canonical objects
- [x] `adapters/edi/x12-dcg/lib/{envelope,build888}.js` — canonical `Item` → 888 X12, verified byte-for-byte against `sample-888.txt`. Several fields (vendor name, vendor item number, division code, case-pack handling) are documented assumptions — see `adapters/edi/x12-dcg/schema-notes.md` — confirm with Chi Cao before a live send.
- [x] `n8n/flows/888-outbound.json` — `AM Item → 888`: pulls real AM products/SKUs → builds 888 X12 → dedupes/logs to Supabase → `S3 Put` → `StartFileTransfer` → DCG. Ready to run in TEST mode.
- [x] S3 bucket confirmed: `scl-dcg-sftp-bridge` (us-east-2, created 2026-07-09) — already wired into the flow
- [x] IAM policy written: `docs/n8n-aws-iam-policy.json` (verified action names + connector ARN format against AWS's real API docs) — least-privilege S3 PutObject/GetObject/ListBucket on `scl-dcg-sftp-bridge` + transfer:StartFileTransfer/ListFileTransferResults/DescribeConnector on the connector
- [ ] Create the IAM user in the console, attach the policy, generate the access key, and create the "AWS account" credential in n8n (steps in `dcg-sftp-design.md`)
- [ ] Resolve the remaining schema-notes.md open questions with Chi Cao (vendor name, ISA sender/receiver IDs, division code) before flipping to a real (non-test) send
- [ ] Run the 888 flow's first live TEST-stream send to DCG and confirm receipt with Mike/Chi Cao
- [ ] Then `build943.js`
- [ ] Enforce sequencing: item master accepted before the item can appear on a 940/943
- [ ] `AM Inbound Transfer → 943`: expected receipt → build X12 → `S3 Put` → `StartFileTransfer` → DCG
- [ ] `944 → AM Receipt`: cron `RetrieveFilePaths` → `parse944` X12 → AM receipt/inventory writeback
- [ ] Tie 944 back to its originating 943 via correlation ID
- [ ] Handle receiving exceptions: short, over, damaged, duplicate

**Done when:** items sync to DCG and the inbound receiving loop (943 → 944)
updates AM inventory.

---

## Phase 6 — Ops, reconciliation, cutover

- [ ] Reconciliation dashboard (Supabase-backed): latest files, failures, pending, last poll, stuck transactions
- [ ] Alerting: failed transfers, failed transforms, stale/missing expected files
- [ ] Retry/replay controls from error states
- [ ] End-to-end edge-case tests: duplicate, partial shipment, partial receipt, unknown item, SFTP outage
- [ ] Complete Orderful + DCG certification
- [ ] UAT with SCL operations on representative real orders
- [ ] Production cutover: freeze mappings, migrate config test→prod, controlled smoke test
- [ ] Hypercare: monitor first prod transactions, daily reconciliation, escalation matrix

**Done when:** the full retail-to-3PL-to-retail loop passes UAT with monitoring
live, and production is cut over with a runbook.

---

## Guardrails (apply in every phase)

- Secrets never in code or workflow JSON — `.env` locally, credential store in n8n, Secrets Manager in AWS.
- Every flow: dedupe → do work → log status → on error route to `errors`.
- Never delete/overwrite raw files; move through lifecycle folders.
- Always map through canonical objects, never system-A → system-B directly.
- Stamp the correlation ID into logs, filenames, Orderful refs, and AM writebacks.

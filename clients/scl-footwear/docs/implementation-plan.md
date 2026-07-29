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
- [x] ~~Create an AWS account/project for the SFTP bridge~~ — superseded, see Phase 2 (Orderful hosts the static-IP transport to DCG instead of AWS)
- [x] DCG contact established (Chi Cao, DCG EDI team) — self-hosted SFTP confirmed, X12 flat files confirmed. Sample files (940/943/888/832) referenced as sent — **need actual files pulled into `dcg-specs/`**. See [dcg-integration-notes.md](dcg-integration-notes.md).
- [ ] Get DCG SFTP credentials (Chi Cao said sent — confirm received) into `.env`
- [ ] Resolve two DCG decisions (see dcg-integration-notes.md): 888 vs 832, keep/drop `N9|GM` carton-scan segment on 943
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

## Phase 2 — Slice 2: Orderful ↔ DCG SFTP bridge smoke test

**Superseded plan:** originally AWS Transfer Family; decided instead to let
**Orderful** be the static-IP SFTP bridge to DCG (Orderful connects to DCG's
self-hosted server, so DCG whitelists Orderful's IP, not ours) plus
**Orderful's Convert API** for X12↔JSON transformation. See
[dcg-integration-notes.md](dcg-integration-notes.md) and architecture.md §6
(pending rewrite once this is proven).

- [x] Get DCG's sample 940/943/888/832 files + field-mapping specs into the repo (`dcg-specs/`)
- [ ] Confirm with Mike: use **832** (not 888) for item master — recommended, see dcg-integration-notes.md
- [ ] Confirm with Mike: **drop `N9|GM`** carton-scan segment on the 943 — recommended, AM has no carton-level packing data
- [ ] Confirm with Mike: which VIDA "order flavor" (Customer Order Direct-to-Store/DC vs Distribution/Rework) matches SCL's model — determines the 940's `W0506` transaction-type code
- [ ] Test Orderful's Convert endpoint against a real DCG sample file (start with 940 — smallest/cleanest) — confirm it produces a matching/valid output
- [x] Set up the Trading Partnership with DCG in Orderful (EDI, DCG as Leader/guideline-owner, Chi Cao as partner contact) — trade request sent, status "Waiting on partner"
- [ ] Configure **Outbound** channel (Orderful → DCG): carries 888/940/943
- [ ] Configure **Inbound** channel (DCG → Orderful): carries 944/945
- [ ] Get Orderful's static IP(s) from the channel setup; send to Mike → DCG for whitelisting
- [ ] Outbound smoke test: one dummy/test file Orderful → DCG, confirm receipt
- [ ] Inbound smoke test: confirm a DCG file lands and is retrievable via Orderful
- [ ] Add `files` table writes so every transfer is tracked in Supabase

**Done when:** a file round-trips n8n → Orderful → DCG → Orderful → n8n with
the static IP confirmed, and each hop is logged.

---

## Phase 3 — Slice 3: the fulfillment loop (`940` out, `945` back)

The core money path. Depends on Phases 1 + 2.

- [x] Pull real field shape from AM's `pick_tickets/` endpoint (source for 940 — a released order becomes a pick ticket)
- [x] `adapters/erp/apparelmagic/lib/parsePickTicket.js` — AM pick ticket → canonical `PickTicket`
- [x] `n8n/flows/am-data-pulls.json` — pulls + parses AM pick tickets (also purchase orders, products/inventory) to canonical objects, sample-fallback if empty
- [ ] **BLOCKED**: `build940.js` (canonical `PickTicket` → Orderful 940 message) — confirmed live that Orderful rejects any 940/943/888/944/945 POST with "relationship doesn't exist" against both the demo partner and DCG's ISA. This isn't a schema question; it needs the DCG Trading Partnership active with these transaction types enabled first. See dcg-integration-notes.md.
- [ ] `AM Released Order → 940`: detect released orders → build canonical → Orderful transform → S3 → DCG
- [ ] Confirm Orderful emits a DCG-loadable 940 flat file (validate the transform output early)
- [ ] `945 → AM Shipment`: cron pull from DCG → Orderful parse → canonical `Shipment` → AM shipment writeback
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
      errors) — see [orderful-outbound-schema-notes.md](orderful-outbound-schema-notes.md)
      for exactly what's confirmed vs. still guessed
- [x] `adapters/erp/apparelmagic/lib/parseShipment.js` — AM shipment → canonical `Shipment`
- [x] `adapters/erp/apparelmagic/lib/parseInvoice.js` — AM invoice → canonical `Invoice`
- [x] `adapters/edi/orderful/lib/build856.js` — canonical `Shipment` → Orderful 856 message. **Full schema confirmed live**: header/BSN/HL hierarchy (S/O/P/I)/N1/carrier/dates/PO-ref/carton-marks(MAN)/item-id(LIN)/item-qty(SN1)
- [x] `adapters/edi/orderful/lib/build810.js` — canonical `Invoice` → Orderful 810 message. **Full schema confirmed live**: header/BIG/N1 (ST+BT)/line items (`baselineItemDataInvoice`)/total (`totalMonetaryValueSummary.amount`)
- [x] Both builders' JSON structure validated by successfully creating real TEST transactions in Orderful (ids in orderful-outbound-schema-notes.md)
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
- [x] `adapters/erp/apparelmagic/lib/parseItem.js` — AM product + SKUs → canonical `Item` (888/832 source)
- [x] `adapters/erp/apparelmagic/lib/parsePurchaseOrder.js` — AM purchase order → canonical `PurchaseOrder` (943 source)
- [x] `n8n/flows/am-data-pulls.json` — pulls + parses AM purchase orders and products/inventory to canonical objects
- [ ] **BLOCKED**: `build888.js`/`build832.js` and `build943.js` — same relationship-gate blocker as 940, see Phase 3 note and dcg-integration-notes.md. Also still pending Mike's 832-vs-888 decision once unblocked.
- [ ] `AM Item → 888`: on new/changed item → Orderful → S3 → DCG (build the 888 PoC early — highest-risk transform)
- [ ] Enforce sequencing: 888 accepted before the item can appear on a 940/943
- [ ] `AM Inbound Transfer → 943`: expected receipt → Orderful → S3 → DCG
- [ ] `944 → AM Receipt`: cron pull → Orderful parse → AM receipt/inventory writeback
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

# SCL Integration — Status & Discussion (call with Mike)

_Last updated: 2026-07-15_

## Where we are in one line

The full **inbound read path is live** — retailer POs (850) flow from Orderful,
get parsed, deduplicated, and logged to our database, and the ApparelMagic
order payload is built and ready. We are paused right before **writing to
ApparelMagic**, because that account is production-only.

---

## ✅ Implemented and working (against live systems)

- **Orderful connected** — authenticated, pulling live TEST purchase orders
  (850s) and their full decoded contents.
- **ApparelMagic connected (read)** — authenticated, reading products/orders.
  Auth was non-obvious; that's solved.
- **Supabase database live** — control-plane tables for transaction logging,
  deduplication, error tracking, and the mapping tables.
- **n8n "850 Ingest" workflow running end to end:**
  1. Pull TEST 850s from Orderful
  2. Filter to purchase orders
  3. Fetch full PO contents
  4. Normalize to a clean internal order format
  5. Build the ApparelMagic order payload (dry-run — not sent)
  6. Deduplicate + log every PO to the database (re-running never double-posts)
- **Architecture + build plan documented** for the whole scope (retail EDI,
  3PL files, AWS relay, go-live).

## 🟡 In progress / immediate next

- **Seed the mapping tables** — retailer partner → AM customer, and retailer
  SKU/UPC → AM item. These fill in the last two fields the order needs.
- **Schedule the workflow** (currently triggered manually).

## 🟢 Unblocked — AM is in TESTING MODE

- The ApparelMagic instance is in **testing mode** (banner: "delete testing
  data / switch to production"), so creating test orders is **safe** — it's
  the sandbox, not live. The 850 → AM order-create workflow is built and ready
  to run. Only prerequisite: the test company needs baseline setup (division,
  warehouse, base currency) and a customer + SKU with those defaults before an
  order will post — otherwise AM returns "No division/warehouse/AR/currency".

## ⬜ Not started (later phases, per plan)

- **AWS static-IP SFTP bridge** to DCG (needed for all warehouse file flows).
- **Warehouse document flows** — 888 items, 940 ship orders, 943/944
  receiving, 945 shipment confirmations.
- **Retailer outbound** — 856 ASN, 810 invoice.
- **Monitoring dashboard, alerting, go-live.**

---

## Questions for Mike (in priority order)

### 1. ApparelMagic test company setup (RESOLVED — now a setup task)
- Confirmed the AM instance is in **testing mode** — safe to test. It's freshly
  set up (Get Started 0%). Who completes the baseline config (division,
  warehouse, base currency) and provides a **test customer + SKU** we create
  orders against? Needed before the 850 → AM create will succeed.

### 2. ApparelMagic order details
- For a retailer PO, which **AM customer** should the order be created under?
- What order **status means "released to DCG"** (the trigger to send a 940)?
- Does the test/target customer have its **default division, warehouse, AR
  account, and currency** set? (AM rejects order creation without them.)
- Are **invoices and ASNs generated inside AM**, or should the integration
  trigger them?

### 3. DCG (3PL) — needed before any warehouse work
- SFTP **host, test credentials, folder structure, and file naming**?
- Can they share **sample files** (888/940/943/944/945) and their
  acknowledgement/rejection behavior?
- Their **IP whitelist process** for our AWS static IP?

### 4. AWS
- Whose **AWS account** do we use (SCL's, ours, new)? Who owns/pays for it?

### 5. Orderful transformation
- Confirm Orderful can **transform and emit the DCG flat files** (888/940/943)
  and parse 944/945 — i.e. we lean on Orderful rather than hand-building EDI.
  (This is the assumption the whole plan rests on.)

### 6. Master data ownership
- Who owns the **retailer↔AM customer** and **SKU/UPC↔AM item** mappings, and
  where does that data come from? (These drive every order.)

### 7. First real retailer
- Which **actual retailer** goes live first, and do we have their EDI spec /
  required documents / test partner in Orderful?

---

## Suggested near-term sequence
1. Stand up (or confirm) an **AM test company** → unblocks order creation.
2. **Seed mappings** for the test retailer + a few test SKUs.
3. Create the **first end-to-end test order** (850 → AM) in the test env.
4. In parallel: get **DCG SFTP details + sample files** and **AWS account**
   decision so warehouse work can start.

# SCL Footwear — Architecture (client-specific)

This client's instance of the generic pattern in `core/architecture.md`.
Read that first — this doc only covers what's specific to SCL.

## Stack

| Role | Vendor | Adapter |
|---|---|---|
| ERP / Truth | ApparelMagic | `adapters/erp/apparelmagic/` |
| EDI / Translator | Orderful (Mosaic v3) | `adapters/edi/orderful/` |
| 3PL | DCG Fulfillment | `adapters/edi/x12-dcg/` (planned) — self-built X12 over AWS SFTP, see below |

Current build status and slice plan: [implementation-plan.md](implementation-plan.md).
DCG-specific findings, contacts, and open decisions:
[dcg-integration-notes.md](dcg-integration-notes.md).

## Document flows

### Inbound — retailer → warehouse

| Doc | Name | Path | Trigger |
|---|---|---|---|
| 850 | Purchase Order | Retailer → Orderful → AM sales order | Retailer submits PO |
| 888/832 | Item Maintenance | AM → X12 → AWS SFTP → DCG | New/changed item |
| 940 | Warehouse Shipping Order | AM → X12 → AWS SFTP → DCG | Order released for fulfillment |
| 943 | Stock Transfer Shipment Advice | AM → X12 → AWS SFTP → DCG | Expected inbound receipt |

### Outbound — warehouse → retailer

| Doc | Name | Path | Trigger |
|---|---|---|---|
| 944 | Stock Transfer Receipt Advice | DCG → AWS SFTP → X12 → AM | DCG receives goods |
| 945 | Warehouse Shipping Advice | DCG → AWS SFTP → X12 → AM | DCG ships an order |
| 856 | Advance Ship Notice | AM → Orderful → Retailer | After 945 posts to AM |
| 810 | Invoice | AM → Orderful → Retailer | After fulfillment/invoicing rules met |

**Sequencing rule:** an 888 for a new/changed item must be sent and accepted
by DCG before that item may appear on a 940 or 943.

## Transport to DCG: AWS SFTP + self-built X12

**Current decision (2026-07-29):** the DCG warehouse leg goes over an **AWS
Transfer Family SFTP Connector + S3** bridge, and we **build/parse the X12
ourselves** — Orderful is not involved in this leg at all (it stays only for
the retailer 850/856/810 leg). AWS acts as the SFTP client from a static IP
DCG whitelists; n8n Cloud's dynamic IPs can't be whitelisted directly.

This reverses the earlier "Orderful hosts the DCG SFTP + Convert" plan. A
side benefit: it removes the Orderful trading-partnership relationship gate
that was blocking 940/943/888 — the only remaining external dependency is
DCG's SFTP credentials, not a partner acceptance.

Full design (components, S3 layout, the outbound/inbound flows, the new
`adapters/edi/x12-dcg/` codec, control numbers): **[dcg-sftp-design.md](dcg-sftp-design.md)**.

## Open questions specific to ApparelMagic (not covered in dcg-integration-notes.md)

- Which order status = "released to DCG" (the 940 trigger)?
- Are invoices/ASNs generated inside AM or triggered by the integration?
- Can AM accept shipment/receipt writeback against existing orders (for
  945/944, once unblocked)?

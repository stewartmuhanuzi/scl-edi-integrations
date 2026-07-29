# SCL Footwear — Architecture (client-specific)

This client's instance of the generic pattern in `core/architecture.md`.
Read that first — this doc only covers what's specific to SCL.

## Stack

| Role | Vendor | Adapter |
|---|---|---|
| ERP / Truth | ApparelMagic | `adapters/erp/apparelmagic/` |
| EDI / Translator | Orderful (Mosaic v3) | `adapters/edi/orderful/` |
| 3PL | DCG Fulfillment | No adapter (SFTP relationship via Orderful — see below) |

Current build status and slice plan: [implementation-plan.md](implementation-plan.md).
DCG-specific findings, contacts, and open decisions:
[dcg-integration-notes.md](dcg-integration-notes.md).

## Document flows

### Inbound — retailer → warehouse

| Doc | Name | Path | Trigger |
|---|---|---|---|
| 850 | Purchase Order | Retailer → Orderful → AM sales order | Retailer submits PO |
| 888 | Item Maintenance | AM → Orderful → DCG | New/changed item |
| 940 | Warehouse Shipping Order | AM → Orderful → DCG | Order released for fulfillment |
| 943 | Stock Transfer Shipment Advice | AM → Orderful → DCG | Expected inbound receipt |

### Outbound — warehouse → retailer

| Doc | Name | Path | Trigger |
|---|---|---|---|
| 944 | Stock Transfer Receipt Advice | DCG → Orderful → AM | DCG receives goods |
| 945 | Warehouse Shipping Advice | DCG → Orderful → AM | DCG ships an order |
| 856 | Advance Ship Notice | AM → Orderful → Retailer | After 945 posts to AM |
| 810 | Invoice | AM → Orderful → Retailer | After fulfillment/invoicing rules met |

**Sequencing rule:** an 888 for a new/changed item must be sent and accepted
by DCG before that item may appear on a 940 or 943.

## Transport to DCG: Orderful-hosted, not AWS

Earlier design (superseded): a dedicated AWS Transfer Family SFTP Connector
+ S3 bridge, since n8n Cloud has dynamic outbound IPs and DCG requires a
whitelisted static IP.

**Current decision:** Orderful hosts this instead. Orderful connects to
DCG's self-hosted SFTP server directly, so DCG whitelists **Orderful's**
static IP rather than one we'd have to stand up and maintain ourselves. This
removes AWS/S3/Secrets Manager from the stack entirely for this client. See
`dcg-integration-notes.md` for the full reasoning and current blocker
(DCG's Trading Partnership needs to be accepted with the 940/943/888/944/945
transaction types enabled before this transport can be tested).

## Open questions specific to ApparelMagic (not covered in dcg-integration-notes.md)

- Which order status = "released to DCG" (the 940 trigger)?
- Are invoices/ASNs generated inside AM or triggered by the integration?
- Can AM accept shipment/receipt writeback against existing orders (for
  945/944, once unblocked)?

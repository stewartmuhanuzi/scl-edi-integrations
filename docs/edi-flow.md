# EDI flow & field mapping notes

Working notes for the Orderful ↔ ApparelMagic integration. Fill in specifics as
they're confirmed against each system's API and the retailer's EDI spec.

## The order lifecycle

```
1. Retailer sends 850 (PO)          Orderful ──► n8n ──► ApparelMagic (create order)
2. SCL sends 855 (PO ack)           ApparelMagic ──► n8n ──► Orderful
3. SCL ships, sends 856 (ASN)       ApparelMagic ──► n8n ──► Orderful
4. SCL sends 810 (invoice)          ApparelMagic ──► n8n ──► Orderful
```

## Inbound: 850 → ApparelMagic sales order

| 850 field | ApparelMagic field | Notes |
|-----------|--------------------|-------|
| PO number | order reference | must be unique; used for idempotency |
| Trading partner ID | customer / account | via mapping table in Supabase |
| Buyer SKU / UPC | product / style | needs SKU crosswalk |
| Qty, price | line items | watch UOM (each vs. case/prepack) |
| Ship-to | address | |
| Ship window / cancel date | dates | chargeback risk if missed |

## Outbound docs

- **855 (ack)** — confirm accept/reject per line. Some retailers require this
  within a set window.
- **856 (ASN)** — hardest doc. Carton/pack hierarchy (SSCC/GS1 labels),
  tracking numbers, carrier. Errors here drive most chargebacks.
- **810 (invoice)** — must match the 850/856; mismatches get rejected.

## Supabase tables (draft)

- `transactions` — every doc in/out: type, direction, partner, external IDs,
  status, timestamps, raw payload.
- `sku_map` — retailer SKU/UPC ↔ ApparelMagic style/SKU.
- `partner_map` — Orderful trading partner ↔ ApparelMagic customer.
- `errors` — failed transforms/deliveries for retry.

## Open questions

- [ ] Orderful: webhooks vs. polling for inbound 850s?
- [ ] Orderful Mosaic: exact auth header + transaction endpoints (confirm in docs).
- [ ] ApparelMagic: API auth scheme + order-create endpoint for the SCL instance.
- [ ] Which real retailer(s) first, and their EDI spec / required docs?
- [ ] UOM handling — do POs come in prepacks/cases?

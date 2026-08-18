# Canonical objects — the shape contract

This is the vendor-neutral vocabulary every ERP and EDI adapter maps into and
out of. It's descriptive, not enforced by types — these are the shapes that
`adapters/erp/apparelmagic/lib/parse*.js` already produce and
`adapters/edi/orderful/lib/build*.js` already consume. A new adapter for a
different ERP or EDI platform must produce/consume the same shapes so the
rest of the pipeline (n8n workflows, Supabase control plane) doesn't change.

Why this matters (see also `architecture.md` §2, the canonical-object
principle): never map ERP format directly to EDI format. Always go
ERP → canonical → EDI, and EDI → canonical → ERP. That's what makes an
adapter swap possible without touching anything else.

## `Order` (from an inbound 850 / retailer PO)

Produced by: `adapters/edi/orderful/lib/parse850.js`
Consumed by: `adapters/erp/apparelmagic/lib/buildAMOrder.js`

```js
{
  poNumber, orderDate, terms,
  shipBy, deliverBy, requestedDelivery,   // ISO dates, present if the source had them
  shipTo: { name, code, address, city, state, zip, country },
  lines: [{ line, sku, upc, qty, uom, unitPrice }],
}
```

## `Shipment` (ERP shipment record → outbound 856 ASN)

Produced by: `adapters/erp/apparelmagic/lib/parseShipment.js`
Consumed by: `adapters/edi/orderful/lib/build856.js`

```js
{
  shipmentId, customerId, customerName, invoiceId,
  date, trackingNumber, billOfLading, qty, qtyBoxes, weight,
  cartons: [{
    boxNumber, ucc,               // ucc = SSCC/UCC-128 carton code, if tracked
    qty, weight,
    items: [{ productId, color, size, styleNumber, description, qty, weight }],
  }],
}
```

## `Invoice` (ERP invoice record → outbound 810)

Produced by: `adapters/erp/apparelmagic/lib/parseInvoice.js`
Consumed by: `adapters/edi/orderful/lib/build810.js`

```js
{
  invoiceId, orderId, customerId, poNumber, invoiceDate, dueDate, termsId,
  shipTo: { name, address1, address2, city, state, zip, country },
  trackingNumber, shipVia,
  totals: { subtotal, discountPct, discountAmount, taxRate, taxAmount, freightAmount, total },
  lines: [{ productId, skuId, color, size, styleNumber, description, qty, unitPrice, amount, isTaxable }],
}
```

## `PickTicket` (ERP pick ticket → outbound 940)

Produced by: `adapters/erp/apparelmagic/lib/parsePickTicket.js` (call with the
raw pick ticket record **and** a `{ [sku_id]: inventoryRecord }` lookup, same
two-endpoint-combine pattern as `Item` — the pick ticket's own line items
don't carry UPC or full color name; those live on `GET /api/json/inventory/`)

```js
{
  pickTicketId, orderId, customerId, customerPo, warehouseId, date, dateDue,
  shipTo: { name, address1, address2, city, state, zip, country },
  shipVia, trackingNumber, qty, amount,
  lines: [{ productId, skuId, color, colorName, size, styleNumber, description, upc, qty, unitPrice, amount, isTaxable }],
}
```

## `PurchaseOrder` (ERP vendor PO → outbound 943)

Produced by: `adapters/erp/apparelmagic/lib/parsePurchaseOrder.js`

```js
{
  purchaseOrderId, vendorId, warehouseId, date, dateStart, dateDue,
  shipTo: { address1, address2, city, state, zip, country },
  shipVia, trackingNumber,
  customerCode, salesOrderRef,   // AM att1_customer / att2_sales_order → 943 N9|CH / N9|CO
  qty, qtyReceived, qtyOpen, amount,
  lines: [{ productId, skuId, color, size, styleNumber, description, qty, qtyOpen, qtyReceived, unitCost, amount }],
}

Dates use AM's `*_internal` (ISO `YYYY-MM-DD`) fields, not the display
`MM/DD/YYYY` ones — the latter break X12 `CCYYMMDD` formatting.
```

## `Item` (ERP product + SKUs → outbound 888/832)

Produced by: `adapters/erp/apparelmagic/lib/parseItem.js` (combines two ERP
endpoints — product header + per-SKU inventory — into one canonical object;
worth checking whether a new ERP adapter needs the same two-call combine or
exposes this as a single endpoint)

```js
{
  productId, styleNumber, description, category, group, origin, content,
  weight, boxSize, packQty, isTaxable, cost, price,
  packageConfig, unitOfMeasure, divisionId, customerCode,  // AM package_config / unit_of_measure / division_id / att1_customer → 888 G3917 / G3919 / G3923 / G3924
  skus: [{ skuId, color, colorName, size, upc, price, cost, weight, active }],
}
```

## Not yet built

`TradingPartner` (retailer/partner identity — currently handled ad hoc via
`sender.isaId`/`sender.name` on Orderful transactions rather than a formal
canonical shape) and `Receipt` (for inbound 944) don't have a parser yet —
add them here once built, following the same pattern.

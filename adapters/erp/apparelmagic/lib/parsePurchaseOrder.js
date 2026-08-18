// Flattens an ApparelMagic purchase order record (GET /api/json/purchase_orders/{id})
// into a canonical PurchaseOrder — incoming stock SCL is expecting, ready to
// map into a 943 (Stock Transfer Shipment Advice) so DCG knows what's arriving.
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parsePurchaseOrder(record) {
  return {
    purchaseOrderId: record.purchase_order_id,
    vendorId: record.vendor_id,
    warehouseId: record.warehouse_id || null,
    // Use AM's *_internal fields — those are ISO YYYY-MM-DD. The non-internal
    // date/date_start/date_due are MM/DD/YYYY, which downstream X12 date
    // formatting (CCYYMMDD via dash-strip) can't convert, producing malformed
    // G62 dates like "09/18/2026". Confirmed against live AM data 2026-08-12.
    date: record.date_internal || record.date || null,
    dateStart: record.date_start_internal || record.date_start || null,
    dateDue: record.date_due_internal || record.date_due || null,
    shipTo: {
      address1: record.shipping_address_override === '1' ? record.shipping_address_1 : record.address_1,
      address2: record.shipping_address_override === '1' ? record.shipping_address_2 : record.address_2,
      city: record.shipping_address_override === '1' ? record.shipping_city : record.city,
      state: record.shipping_address_override === '1' ? record.shipping_state : record.state,
      zip: record.shipping_address_override === '1' ? record.shipping_postal_code : record.postal_code,
      country: record.shipping_address_override === '1' ? record.shipping_country : record.country,
    },
    shipVia: record.ship_via || null,
    trackingNumber: record.tracking_number || null,
    // AM custom fields → DCG 943 mapping (per Mike, 2026-08-12):
    // att1_customer → N9|CH (customer attribute), att2_sales_order → N9|CO
    // (customer sales-order reference). See adapters/edi/x12-dcg/schema-notes.md.
    customerCode: record.att1_customer || null,
    salesOrderRef: record.att2_sales_order || null,
    qty: num(record.qty),
    qtyReceived: num(record.qty_received),
    qtyOpen: num(record.qty_open),
    amount: num(record.amount),
    lines: (record.purchase_order_items || []).map((item) => ({
      productId: item.product_id,
      skuId: item.sku_id,
      color: item.attr_2 || null,
      size: item.size || null,
      styleNumber: item.style_number || null,
      description: item.description || null,
      qty: num(item.qty),
      qtyOpen: num(item.qty_open),
      qtyReceived: num(item.qty_received),
      unitCost: num(item.unit_cost),
      amount: num(item.amount),
    })),
  };
}

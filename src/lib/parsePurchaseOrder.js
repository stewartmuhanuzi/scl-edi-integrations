// Flattens an ApparelMagic purchase order record (GET /api/json/purchase_orders/{id})
// into a canonical PurchaseOrder — incoming stock SCL is expecting, ready to
// map into a 943 (Stock Transfer Shipment Advice) so DCG knows what's arriving.
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parsePurchaseOrder(record) {
  return {
    purchaseOrderId: record.purchase_order_id,
    vendorId: record.vendor_id,
    warehouseId: record.warehouse_id || null,
    date: record.date ?? null,
    dateStart: record.date_start || null,
    dateDue: record.date_due || null,
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

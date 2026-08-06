// Flattens an ApparelMagic pick ticket record (GET /api/json/pick_tickets/{id})
// into a canonical PickTicket, ready to map into a 940 (Warehouse Shipping Order).
// pick_ticket_items only carries a subset of SKU attributes (color code,
// size) and no UPC at all -- the authoritative per-SKU data (full color
// name, UPC) lives on GET /api/json/inventory/, same as parseItem.js.
// Pass a { [sku_id]: inventoryRecord } lookup (skusById) to enrich each
// line; omit it (or leave a sku_id unmatched) and those lines just fall
// back to whatever pick_ticket_items itself provides.
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parsePickTicket(record, skusById = {}) {
  return {
    pickTicketId: record.pick_ticket_id,
    orderId: record.order_id || null,
    customerId: record.customer_id,
    customerPo: record.customer_po || null,
    warehouseId: record.warehouse_id || null,
    date: record.date ?? null,
    dateDue: record.date_due || null,
    shipTo: {
      name: record.ship_to_name || null,
      address1: record.address_1 || null,
      address2: record.address_2 || null,
      city: record.city || null,
      state: record.state || null,
      zip: record.postal_code || null,
      country: record.country || null,
    },
    shipVia: record.ship_via || null,
    trackingNumber: record.tracking_number || null,
    qty: num(record.qty),
    amount: num(record.amount),
    lines: (record.pick_ticket_items || []).map((item) => {
      const sku = skusById[item.sku_id] || {};
      return {
        productId: item.product_id,
        skuId: item.sku_id,
        color: item.attr_2 || sku.attr_2 || null,
        colorName: sku.attr_2_name || null,
        size: item.size || sku.size || null,
        styleNumber: item.style_number || null,
        description: item.description || null,
        upc: sku.upc_display || sku.upc_11 || null,
        qty: num(item.qty),
        unitPrice: num(item.unit_price),
        amount: num(item.amount),
        isTaxable: item.is_taxable === '1',
      };
    }),
  };
}

// Flattens an ApparelMagic pick ticket record (GET /api/json/pick_tickets/{id})
// into a canonical PickTicket, ready to map into a 940 (Warehouse Shipping Order).
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parsePickTicket(record) {
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
    lines: (record.pick_ticket_items || []).map((item) => ({
      productId: item.product_id,
      skuId: item.sku_id,
      color: item.attr_2 || null,
      size: item.size || null,
      styleNumber: item.style_number || null,
      description: item.description || null,
      qty: num(item.qty),
      unitPrice: num(item.unit_price),
      amount: num(item.amount),
      isTaxable: item.is_taxable === '1',
    })),
  };
}

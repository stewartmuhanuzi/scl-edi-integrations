// Flattens an ApparelMagic shipment record (GET /api/json/shipments/{id})
// into a canonical Shipment object, ready to map into an 856 ASN.
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parseShipment(record) {
  const boxes = record.boxes || [];
  return {
    shipmentId: record.id,
    customerId: record.customer_id,
    customerName: record.customer_name ?? null,
    invoiceId: record.invoice_id || null,
    date: record.date ?? null,
    trackingNumber: record.tracking_number || null,
    billOfLading: record.bill_of_lading || null,
    qty: num(record.qty),
    qtyBoxes: num(record.qty_boxes),
    weight: num(record.weight),
    cartons: boxes.map((box) => ({
      boxNumber: box.box_number,
      ucc: box.ucc || null, // SSCC/UCC-128 case code — maps to 856 MAN segment
      qty: num(box.qty),
      weight: num(box.weight),
      items: (box.box_items || []).map((item) => ({
        productId: item.product_id,
        color: item.attr_2 || null,
        size: item.size || null,
        styleNumber: item.style_number || null,
        description: item.description || null,
        qty: num(item.qty),
        weight: num(item.weight),
      })),
    })),
  };
}

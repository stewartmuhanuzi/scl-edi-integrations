// Flattens an ApparelMagic invoice record (GET /api/json/invoices/{id}) into
// a canonical Invoice object, ready to map into an 810.
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parseInvoice(record) {
  return {
    invoiceId: record.invoice_id,
    orderId: record.order_id || null,
    customerId: record.customer_id,
    poNumber: record.customer_po || null,
    invoiceDate: record.date ?? null,
    dueDate: record.date_due || null,
    termsId: record.terms_id || null,
    shipTo: {
      name: record.ship_to_name || null,
      address1: record.address_1 || null,
      address2: record.address_2 || null,
      city: record.city || null,
      state: record.state || null,
      zip: record.postal_code || null,
      country: record.country || null,
    },
    trackingNumber: record.tracking_number || null,
    shipVia: record.ship_via || null,
    totals: {
      subtotal: num(record.amount_subtotal),
      discountPct: num(record.pct_discount),
      discountAmount: num(record.amount_discount),
      taxRate: num(record.tax_rate),
      taxAmount: num(record.amount_tax),
      freightAmount: num(record.amount_freight),
      total: num(record.amount),
    },
    lines: (record.invoice_items || []).map((item) => ({
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

// Builds an ApparelMagic order-create payload (POST /api/json/orders/) from
// a canonical Order. Extracted from the inline Code-node logic in
// clients/scl-footwear/n8n/flows/850-inbound.json — same behavior, now a
// reviewable/reusable function instead of a string embedded in workflow JSON.
//
// customerId/skuId are resolved by the caller (via partner_map/sku_map, or —
// as in the current SCL flow — a single fallback AM customer/SKU while those
// mapping tables aren't seeded yet). AM's order-create POST reads auth from
// the JSON body (time + token), not query params like its GET endpoints.
export function buildAMOrder(order, { customerId, skuId, token }) {
  const items = (order.lines || []).map((line) => {
    const item = { sku_id: String(skuId), qty: String(line.qty), is_taxable: '1' };
    if (line.unitPrice != null) item.unit_price = String(line.unitPrice);
    return item;
  });

  return {
    time: String(Math.floor(Date.now() / 1000)),
    token,
    '0': {
      header: { customer_id: String(customerId), customer_po: order.poNumber },
      items,
    },
  };
}

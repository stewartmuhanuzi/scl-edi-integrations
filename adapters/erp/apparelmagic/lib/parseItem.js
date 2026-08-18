// Combines an ApparelMagic product (GET /api/json/products/{id}) with its
// SKUs (GET /api/json/inventory/?parameters=[{field:'product_id',...}]) into
// a canonical Item — one product header + one line per color/size SKU with
// UPC — ready to map into an 888 or 832 item-master transaction.
const num = (v) => (v == null || v === '' ? null : Number(v));

export function parseItem(product, skus = []) {
  return {
    productId: product.product_id,
    styleNumber: product.style_number,
    description: product.description ?? null,
    category: product.category || null,
    group: product.group || null,
    origin: product.origin || null,
    content: product.content || null,
    weight: num(product.weight),
    boxSize: product.box_size || null,
    packQty: null, // AM doesn't expose a direct "units per case" field on products/; comes from prepacks[] if applicable
    // 888 DCG mapping (per Aaron, 2026-08-11): these product-header fields
    // feed specific G39 sub-elements — package_config→G3917, unit_of_measure
    // →G3919, division_id→G3923, att1_customer(custom)→G3924.
    packageConfig: product.package_config || null,
    unitOfMeasure: product.unit_of_measure || null,
    divisionId: product.division_id || null,
    customerCode: product.att1_customer || null,
    isTaxable: product.is_taxable === '1',
    cost: num(product.cost),
    price: num(product.price),
    skus: skus.map((sku) => ({
      skuId: sku.sku_id,
      color: sku.attr_2 || null,
      colorName: sku.attr_2_name || null,
      size: sku.size || null,
      upc: sku.upc_display || sku.upc_11 || null,
      price: num(sku.price),
      cost: num(sku.cost),
      weight: num(sku.weight),
      active: sku.active === '1',
    })),
  };
}

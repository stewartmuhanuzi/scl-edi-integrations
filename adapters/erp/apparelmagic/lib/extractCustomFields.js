// AM's per-instance-configurable custom attribute fields -- e.g. att1_customer,
// att2_purchase_order on orders/, att1_customer, att2_sales_order on
// purchase_orders/, att2__sales_order (double underscore, an AM-side quirk)
// on pick_tickets/. Confirmed live 2026-08-10: these are genuinely dynamic,
// not a fixed schema -- the field NAME itself encodes whatever label someone
// configured in AM's UI, differs per endpoint, and isn't consistent even
// across endpoints for what's conceptually the same field. Can't be
// hardcoded into individual parsers the way parseItem.js etc. map named
// fields -- this generically captures anything matching the attN pattern so
// it keeps working as SCL adds/renames custom fields in AM over time.
export function extractCustomFields(record) {
  const fields = {};
  for (const [key, value] of Object.entries(record)) {
    if (/^att\d+/i.test(key) && value != null && value !== '') {
      fields[key] = value;
    }
  }
  return fields;
}

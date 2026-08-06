// Shared "Vendor Item Number" construction, used across every DCG X12
// transaction type that references an item (currently 888 and 940) so they
// all agree on the same item-coding scheme -- DCG's Boomi mapping likely
// correlates the same item across document types by this value, so it must
// be identical everywhere it's built. AM has no equivalent field; this is a
// placeholder convention combining style + color + size. Must include color,
// not just style+size -- two SKUs of the same style/size but different
// colors otherwise collide on the same "unique" identifier (caught live
// against real AM data on 2026-08-01, see schema-notes.md). Confirm with
// Chi Cao whether this scheme is acceptable or DCG needs a specific format.
export function vendorItemNumber(styleNumber, color, size) {
  return `${styleNumber ?? ''}${color ?? ''}${size ?? ''}`.toUpperCase().replace(/\s+/g, '');
}

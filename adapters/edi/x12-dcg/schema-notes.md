# DCG X12 schema notes — 888 (Item Maintenance)

Segment structure below is verified **byte-for-byte** against DCG's own real
sample (`clients/scl-footwear/docs/dcg-specs/sample-888.txt`, 1199 lines,
199 items) and field meanings from `vida-mapping-888.txt`. Implemented in
`lib/build888.js` + `lib/envelope.js`.

## Envelope (ISA/GS/ST…SE/GE/IEA)

Confirmed against the real sample:

- Element separator `|`, sub-element separator `>`, segment terminator is a
  bare newline (no `~`).
- `ISA06`/`ISA08` (sender/receiver ID) space-padded to exactly 15 chars.
- `ISA09` is 2-digit `YYMMDD`; `GS04` and `G62` dates are 8-digit `CCYYMMDD`
  — a genuine X12 4010 quirk (dates aren't consistently formatted across
  segments).
- `ISA13`/`IEA02` (interchange control number) zero-padded to 9 digits;
  `GS06`/`GE02` (group control number) is **not** padded.
- `SE01` (number of included segments) counts **ST through SE inclusive**
  — confirmed against the sample: 1193 body segments → `SE01` = `1195`.
- `ISA15` (usage indicator) was `P` (production) in DCG's real sample, since
  it's presumably production data from a live partner (VIDA). Use `T` (test)
  for SCL's initial file, per Mike's "let's test with a few items" framing.

## 888 body segments (once-per-file: N1, G62, G53)

| Segment | Fields (in order) | Notes |
|---|---|---|
| `N1` | entity code `VN`, name, [id qualifier `92`, id] | **Ambiguous**: DCG's real sample is literally `N1\|VN\|DCG` — just 2 elements, name = `DCG` (the *receiver's* own name), not the vendor's. The mapping doc says this should be the vendor's name (`VIDA` in their example). Which value DCG actually expects for SCL is unconfirmed — `build888.js` accepts `vendorName` as a parameter; **confirm the exact expected value with Chi Cao before the real send**. |
| `G62` | date qualifier `7`, effective date (`CCYYMMDD`) | Always "today" in practice — `build888.js` uses a single `date` option (see below). |
| `G53` | maintenance type `001` (change) or `003` (add/full detail) | `build888.js` defaults to `003`; pass `001` for updates once we're tracking item state, not just first sends. |

## 888 per-SKU segments (G39, G69, N9×4-5)

`G39` — 24 elements after the tag, all confirmed against the sample:

| # | Field | Value used by `build888.js` | Notes |
|---|---|---|---|
| 1 | UPC | `sku.upc` | **Real-data gap found 2026-08-01**: every SKU pulled from the live AM test company had a blank UPC (materials/components like zippers and fabric, plus the JEAN1 finished-good test data, none had UPCs assigned). This field is marked mandatory in DCG's spec — confirm with Mike/Chi Cao whether a blank UPC is tolerated (e.g. for non-sellable component items) or whether AM data needs UPCs populated before a real send. |
| 2 | Product ID Qualifier | `VN` (constant) | |
| 3 | Vendor Item Number | `${styleNumber}${color}${size}` | **Assumption** — AM has no equivalent field; VIDA's real values (`DL401426AC4B`) look like an internal style+size+suffix scheme unique to their system. Confirm with Chi Cao whether this scheme is acceptable or DCG needs something specific. **Must include color**, not just style+size — caught live on 2026-08-01: JEAN1 has both black and blue variants at the same sizes (e.g. 28x28), and an earlier style+size-only version produced identical "unique" vendor item numbers for genuinely different SKUs. |
| 4 | Special Handling Code | blank | optional, unused |
| 5 | Unit Weight | `sku.weight ?? item.weight`, formatted `0.000` | |
| 6 | Weight Qualifier | `G` (gross, constant) | matches every row of the real sample |
| 7 | Weight Unit | `L` (pounds, constant) | |
| 8-13 | Height/Width/Length + UOM | `0.000`/`IN` for all three | AM has no box-dimension data; DCG's own real sample is also `0.000` for every single row, so this appears acceptable in practice |
| 14-15 | Volume + UOM | `1.000`/`CI` | **Simplified** — see "What's deliberately NOT replicated" below |
| 16 | (unmapped) | blank | not documented in VIDA's mapping, always blank in the sample |
| 17 | Pack Quantity | `1` | see below |
| 18 | (unmapped) | `1` (constant) | not documented, but always literally `1` in every row of the sample |
| 19 | UOM | `EA` (constant) | see below |
| 20-22 | (unmapped) | blank | not documented, always blank in the sample |
| 23 | Product Attribute Qualifier | `DI` (division/brand, constant) | |
| 24 | Product Attribute | `item.group \|\| item.category` | **Assumption** — canonical `Item` has no explicit "brand" field; using `group` as the closest analog. VIDA's real values are actual brand names (`Chinese Laundry`, `Rebecca Minkoff`). |

`G69` — one element, `item.description` (matches: DCG's sample repeats the
*style-level* description, e.g. `KASEY`, `STANTON`, across every SKU of that
style — not a per-SKU description).

`N9` blocks — one 2-3-element segment per qualifier, order matches the
sample (alphabetical: `BO`, `DV`, `IT`, `IZ`, `VC`):

| Qualifier | Meaning | Value used |
|---|---|---|
| `BO` | color code | `sku.color` |
| `DV` | brand/division code | **Only emitted if `options.divisionCode` is provided.** VIDA's real sample has a numeric code here (`0195`, `3690`, `3695`) that appears to track a vendor/brand identity, not a true "division" — unconfirmed whether SCL needs this at all. Confirm with Chi Cao. |
| `IT` | style number | `item.styleNumber` |
| `IZ` | size | `sku.size` |
| `VC` | color code + full color name | `sku.color`, `sku.colorName` |

## What's deliberately NOT replicated from DCG's sample

VIDA's real sample lists **two G39 rows per style/color** — one at the
"case" level (`G3919` = `CA`, larger weight/volume, a suffixed vendor item
number like `...AC4B`) and one at the "each" level (`G3919` = `EA`, single
unit). This reflects VIDA's case-pack data, which AM doesn't track
(`canonical Item.packQty` is documented as `null` — see
`core/canonical-objects.md`). **`build888.js` emits exactly one `EA`-level
G39 per AM SKU.** This is a deliberate simplification for the first test,
not an oversight — flag to Chi Cao if DCG's Boomi mapping specifically
expects the dual case+each pattern.

## Open questions to confirm with Chi Cao before the real send

1. **N1 vendor name** — what value belongs in N102 for SCL (see ambiguity above).
2. **Vendor Item Number (G3903)** — is `styleNumber+size` acceptable, or does DCG need a specific scheme.
3. **Division/brand code (N9|DV)** — does SCL need this at all; if so, what values.
4. **Case-pack data** — does DCG's mapping require the dual case+each G39 pattern, or is one row per SKU sufficient.
5. **Sender/receiver ISA IDs** — what DCG expects for SCL (not `VIDA`/`DCG` from the sample) — tracked in `dcg-sftp-design.md`.

## Not yet built

`build943.js`, `parse944.js`, `parse945.js` — see
`adapters/edi/x12-dcg/README.md` for build order.

---

# 940 (Warehouse Shipping Order)

Verified against DCG's real sample (`sample-940.txt`) and field meanings
from `vida-mapping-940-945.txt` — a **much messier doc than 888's**: it's
VIDA's actual retailer-integration mapping, so it's full of retailer-specific
fields (Macy's reservation numbers, DSW reward codes) and notes like "we
wouldn't send this anymore" for fields the real sample still sends anyway.
Implemented in `lib/build940.js`, reusing `lib/envelope.js` (identical
delimiter/date/control-number conventions as 888 — verified against this
sample too) and the shared `lib/itemCode.js` vendor-item-number scheme.

**Approach taken:** only implement fields with a clear, real source in
canonical `PickTicket` (`core/canonical-objects.md`). Where the mapping doc
and the real sample disagree, or a field has no canonical source, it's
**omitted rather than guessed** — documented below and inline in the code.

## Envelope

Same conventions as 888 (see above), except:
- `GS01` (functional identifier code) is `OW`, not `QG`.
- `ISA15`/`SE01` etc. — identical mechanics, re-verified against this sample:
  16 body segments in the worked example → `SE01` = `18`.

## Body segments (once-per-file)

| Segment | Fields | Notes |
|---|---|---|
| `W05` | order status `N`, shipment number, customer PO, [blank]×2, transaction type code | Shipment number = `pickTicket.pickTicketId` — this is the **correlation ID that must round-trip on the 945** (`W0602`), per `dcg-integration-notes.md`. Transaction type code defaults to `42` (Customer Order) — **well-supported default**, not a guess: all Customer Order sub-flavors (DS / Direct-to-Store-DC / Mark-for-Store) share code `42` in VIDA's mapping: only Distribution (`10`) and Rework (`13`) differ, and SCL's retail dropship model is clearly a customer-order flavor. |
| `N1\|BT` | customer/retailer name, `92`, customer number | **Gap**: canonical `PickTicket` has `customerId` but no customer **name** — `build940.js` requires `customerName` as a caller-supplied option, same pattern as 888's `vendorName`. Needs a real source (e.g. an AM customer lookup, same pattern as `850-inbound.json`'s "Get AM Customer" node) before this is wired into an n8n flow. |
| `N1\|ST` + `N3` + `N4` | ship-to name/address/city/state/zip/country | Direct match — `pickTicket.shipTo`. |
| `N9\|CO` | M3 Customer Order Number | `pickTicket.orderId`. Only order-level `N9` implemented — see "Deliberately omitted" below. |
| `G62\|10` | EARLIEST_SHIP_DATE | `pickTicket.date`. |
| `G62\|01` | CANCEL_SHIP_DATE | `pickTicket.dateDue`. |
| `W66` | payment method `PP`, `M`, [blank]×2, carrier code | `pickTicket.shipVia` for the carrier code; payment method hardcoded `PP` (prepaid), matching the real sample — no canonical source, confirm with Chi Cao if SCL ever needs collect/third-party. |

## Per-line segments (LX, W01, G69, N9)

| Segment | Fields | Notes |
|---|---|---|
| `LX` | line sequence number | 1-indexed per line, needed back on the 945. |
| `W01` | qty, `EA`, UPC, `VN`, vendor item number, [blank]×2, `EA` | `line.upc` — **resolved 2026-08-02** (was blank): `parsePickTicket.js` now takes a `skusById` lookup from `GET /api/json/inventory/` and enriches each line with real UPC data, same combine pattern as `parseItem.js`/888 (pick_ticket_items alone has no UPC — Mike flagged this: "you might have to pull in Inventory to get at the actual sku data"). Still blank if AM genuinely has no UPC for that SKU. Vendor item number uses the shared `itemCode.js` scheme (style+color+size) — same identifier scheme as 888, so DCG can presumably correlate the same item across both document types. |
| `G69` | item description | `line.description`. |
| `N9\|IS` | style code + description | `line.styleNumber` + `line.description` (reuses the same description as `G69` — the real sample appears to duplicate it too). |
| `N9\|IZ` | size | `line.size`. |
| `N9\|VC` | color code + full color name | `line.color`, `line.colorName` — **resolved 2026-08-02** (was code-only): same Inventory enrichment as `W01`'s UPC fix, canonical `PickTicket.lines` now has `colorName` matching canonical `Item`'s shape. |

## Deliberately omitted (documented gaps, not oversights)

- **`N1\|BF`** (Consumer Billing / "Bill from Address") — the real sample
  sends a separate billing name+address distinct from the ship-to address for
  the same person. Canonical `PickTicket` only has one address (`shipTo`), so
  there's no source for a distinct billing address. Omitted rather than
  duplicating `shipTo` under the wrong label.
- **`N1\|SF`** (Ship-From) — VIDA's mapping doc marks this "we wouldn't send
  it anymore," yet the real sample still includes it with placeholder-looking
  values (`999`/`91`/`999`). Given the doc's own note, defaulted to omitting
  it; revisit if DCG's mapper actually requires it.
- **Order-level `N9`**: `12` (small parcel account), `DP` (dept number),
  `CR` (consumer order #), and undocumented retailer-specific extensions
  seen in the real sample (`F7`, `OH`, `RSN`) with no meaning given anywhere
  in VIDA's mapping doc.
- **Line-level `N9`**: `DV` (brand/division) and `RT` (retail price) — no
  canonical-`PickTicket`-line source (no group/category field, no separate
  retail-vs-unit price field).
- **`G62` qualifier `04`** — present in the real sample with no documented
  meaning in the mapping doc at all.

## Open questions to confirm with Chi Cao before a real send

1. Everything already open for 888 (ISA sender/receiver IDs, vendor item
   number scheme) applies here too, since both reuse the same envelope and
   item-coding conventions.
2. **Customer name/number source** — need a real way to look up the
   retailer's name for `N1\|BT`, not just a hardcoded test value.
3. **`N1\|SF`, order-level `N9` extensions** — does DCG's mapping actually
   require any of the fields listed as "deliberately omitted" above.
4. **The `04`-qualified `G62` date** — what it represents, if DCG's mapper
   expects it.

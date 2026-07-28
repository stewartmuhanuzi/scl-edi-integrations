# DCG Standard 832 (Price/Sales Catalog) — Segment Reference

Source: `DCG_Standard_832_spec_X12 rev 2.pdf` (v004010, rev 2.0, Feb 2026).
This is DCG's own authored spec (not a VIDA hand-me-down) — much simpler and
cleaner than the 888 mapping.

## Structure

**Header** (once per transaction): `ST → BCT → DTM → N1 → N3 → N4`
**Detail** (repeats per item, loop 0300): `LIN → REF → PID → G55 → SLN`
**Summary**: `CTT → SE`

## Key segments

- **BCT** — `BCT01=RC` (Resale Catalog), `BCT10=02` (Add)
- **N1** — `N101=VN` (vendor), `N103=91`, `N104` = your vendor code
- **LIN** (one per style/color/size combo) — `LIN02=UP` + UPC, `LIN04=VN` +
  vendor item, `LIN06=CL` + vendor color, `LIN08=SZ` + vendor size
- **REF** — `REF01=PRT` (product type) or `19` (division)
- **PID** — `PID02=08` description, `73` color description, `74` size
  description
- **G55** — physical characteristics: height/width/length/volume (all with
  UOM), `G5513`=pack qty, `G5514`=size of pack, `G5523`=weight
- **SLN** — subline detail for prepacks: `SLN03=I` (included), qty, UPC/vendor
  item/color/size of the component

## Comparison to VIDA's 888 sample

The 888 (`sample-888.txt`) uses non-standard-for-this-purpose segments
(`G39`, `G69`, repeated `N9` reference blocks) with several fields marked
`??` even in VIDA's own mapping doc (`vida-mapping-888.txt` lines 70-72) —
i.e. even VIDA's team wasn't fully certain of some mappings. The 832 is
simpler (5 segment types vs 888's `G39`+`G69`+`N9`-heavy structure), fully
documented with no ambiguity, and is DCG's own preferred format.

**Recommendation: use 832, not 888**, for item master. Cleaner mapping
surface from Apparel Magic's product fields, no legacy VIDA cruft to
untangle, and it's the format DCG actually wrote the spec for.

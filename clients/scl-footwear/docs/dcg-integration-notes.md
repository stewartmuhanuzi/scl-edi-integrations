# DCG Integration Notes

Working notes from the DCG email thread (Chi Cao, DCG EDI Programmer Analyst)
and the actual specs/samples DCG sent. **All specs and sample files are saved
in [dcg-specs/](dcg-specs/)** — this doc is the synthesized summary;
go to those files for exact field-level detail.

## Contacts

| Name | Role | Email |
|---|---|---|
| Chi Cao | Sr. EDI Programmer Analyst (technical/EDI) | ChiC@dcgusa.com |
| Jenna Serrano | Director of Customer Service | JennaH@dcgfulfillment.com |

## DCG's tech stack (context, not ours to touch)

- **Manhattan** — DCG's WMS, has a test/sandbox environment we'll get to see
  once EDI testing starts.
- **Dell Boomi** — DCG's internal EDI mapping tool. No SCL access needed or
  possible.

## Transport

**X12 flat files over SFTP**, DCG self-hosts. **Current plan (2026-07-29):**
an **AWS Transfer Family SFTP Connector + S3** bridge provides the static IP
DCG whitelists, and we **build/parse the X12 ourselves** — Orderful is not on
this leg. (This reverses the earlier Orderful-hosted-SFTP + Convert plan.)
Full design: **[dcg-sftp-design.md](dcg-sftp-design.md)**.

## What DCG actually sent — and what it tells us

DCG's spec source is **VIDA's existing M3-to-DCG mapping**, reused as our
template (DCG already runs this exact integration for another customer). Two
Excel field-mapping guides plus real production sample files were provided.
**Important: these specs describe VIDA's M3 ERP, which supports order types
SCL likely doesn't need** (see Open Items #1).

### 888 vs 832 (item master) — **decided: 888, per Mike's direction (2026-07-30)**

- `dcg-specs/vida-mapping-888.txt` — VIDA's legacy 888 mapping. Uses
  non-standard segments (`G39`, `G69`, repeated `N9` blocks) and has fields
  even VIDA's own team marked `??` (uncertain) in their doc.
- `dcg-specs/dcg-832-spec-summary.md` — DCG's own authored 832 spec.
  Clean, standard structure: `LIN → REF → PID → G55 → SLN` per item. Fully
  documented, no ambiguity.

**Earlier recommendation (superseded): use 832 over 888** — based purely on
which spec file was cleaner to implement, not on which transaction type is
the right standard fit. Checked against general X12 usage and that framing
doesn't hold up: **888 (Item Maintenance) deliberately excludes pricing**
(item attributes only — dimensions, UPC, description), while **832
(Price/Sales Catalog) is a full catalog including pricing**, meant for
publishing to retailers/distributors. A 3PL warehouse like DCG has no use for
pricing — it needs item attributes for putaway/pick/pack. So 888 is actually
the more correct standard fit for this leg, not the legacy one; the
mapping-quality concern (VIDA cruft, uncertain fields) is real but separate,
and worth raising with Chi Cao as its own question when building `build888.js`
rather than a reason to switch transaction types.

**Decided: proceed with 888**, per Mike's direction — he suggested it as the
first real file test (a few items). Build `adapters/edi/x12-dcg/lib/build888.js`
against `dcg-specs/vida-mapping-888.txt` and `sample-888.txt`, flagging any
`??`-marked/uncertain field to Chi Cao as it comes up rather than blocking on
it upfront.

### The `N9|GM` carton-scan question — **recommend drop it**

Confirmed via the real 943 sample (`sample-943-with-cartons.txt`): a single
5,136-unit line item carried **428 separate `N9|GM` segments** (one SSCC/UCC
code per carton, 12 units/carton — 428 × 12 = 5,136). Each would require us
to generate a real per-carton shipping container code.

The mapping guide confirms this is optional and DCG-specific: *"Case
ID(SSCC)... Not new for ODW warehouse. New for DCG warehouse though"*
(`vida-mapping-943-944.txt` line ~118). Chi Cao's email already offered to
drop it if not needed.

**Recommendation: drop `N9|GM`.** Apparel Magic doesn't track carton-level
packing, so generating real SSCCs isn't feasible without new work on the AM
side. Matches DCG's own suggested default.

### Correlation IDs are already spec'd — confirms our architecture

The specs make the request/response linkage explicit, which validates the
`correlation_id` design in architecture.md §5:

- **940 → 945**: `W0502` (Shipment Number, i.e. "M3 Delivery Number") sent on
  the 940 **must come back** on the 945's `W0602` unchanged.
- **943 → 944**: `W0602` (Order Number, i.e. "Delivery Note Number") sent on
  the 943 **must come back** on the 944's `W1704` unchanged.

So our correlation ID for warehouse docs should literally be this
DCG-round-tripped reference number — not something we invent separately.

## Document-by-document summary

| Doc | Direction | Key header ref | Core line-item fields | Sample file |
|---|---|---|---|---|
| 888/832 | Us → DCG | catalog/vendor ID | UPC, vendor item#, color, size, description, pack qty, dims | `sample-888.txt`, `sample-832-*.edi` |
| 940 | Us → DCG | Shipment Number (→ comes back on 945) | qty, UOM, M3 item#, line#, ship-to address | `sample-940.txt` |
| 943 | Us → DCG | Order Number (→ comes back on 944) | qty, UOM, item#, `N9|GM` cartons (recommend drop) | `sample-943-simple.txt`, `-with-cartons.txt` |
| 944 | DCG → us | Depositor order# (echoes 943's ref) | qty received, item#, condition codes (damaged/short/etc.) | — |
| 945 | DCG → us | Shipment# (echoes 940's ref) | SSCC per carton (**DCG generates this**, not us), qty shipped, tracking, carrier | — |

Note: `N9|GM`/SSCC on the *945* is DCG's own carton code, generated by them
on outbound confirmation — that's unrelated to the 943 question above (where
*we'd* have to generate it). No decision needed there; DCG handles it.

## Retailers routed through DCG

`Ross, TJ Maxx, Citi Trends, Bealls, Shoe Dept, Shoe Show, Shoe Carnival,
Walmart.com (future — going EDI in a few months), Super Shoes`. JC Penney
"in the pipeline." Need `partner_map` entries once per-retailer specifics are
confirmed (Aaron's original ask to Jenna, still open).

## ~~Confirmed blocker: 940/943/888/944/945 can't be created in Orderful yet~~ (no longer applies)

**Resolved by the 2026-07-29 pivot:** we no longer route the DCG leg through
Orderful, so this relationship-gate blocker is moot — we build the X12
ourselves and ship it over AWS SFTP (see
[dcg-sftp-design.md](dcg-sftp-design.md)). 940/943/888 are now unblocked to
build; the only external dependency left is DCG's SFTP credentials. The
original finding is kept below for history.

Tried live (2026-07-28), same technique used to discover the 856/810 schema:
POSTing a `940_WAREHOUSE_SHIPPING_ORDER` transaction to Orderful returns

> `"Cannot post transaction because the 940_WAREHOUSE_SHIPPING_ORDER
> relationship between the sender ISA ID ... and the receiver ISA ID ...
> doesn't exist."`

Tried against both the retail demo partner's ISA and DCG's ISA (`DCG`) —
same error both times. This is a **relationship/business-setup gate**, not a
schema question: Orderful won't accept a transaction type until a Trading
Partnership exists with that type enabled. The DCG partnership is still
"Waiting on partner" (Chi Cao hasn't accepted), so **schema discovery for
940/943/888/944/945 is blocked until that partnership is active** with those
transaction types configured — no amount of guessing/testing gets around
this, unlike the 856/810 case which worked against the existing retail demo
partnership.

**What's unblocked in the meantime:** the ApparelMagic side. Canonical
parsers (`parsePickTicket.js`, `parsePurchaseOrder.js`, `parseItem.js`) and
an n8n workflow (`n8n/flows/am-data-pulls.json`) that pulls + parses AM pick
tickets, purchase orders, and products/inventory are built and ready — only
the Orderful-side builders (`build940.js` etc.) are waiting on DCG.

## Open items

1. **Which "order flavor" applies to SCL?** VIDA's 940/945 mapping has
   multiple order sub-types with different transaction-type codes
   (`W0506`): Customer Order variants (code `42`), Distribution Order (`10`),
   Rework Order (`13`). All three Customer Order sub-flavors (DS,
   Direct-to-Store/DC, Mark-for-Store) share code `42` — only Distribution/
   Rework differ — so `42` is a well-supported default and is what
   `build940.js` uses (built 2026-08-01). SCL's retail dropship model is
   almost certainly a Customer Order flavor, but this is still worth an
   explicit **confirm with Mike/Chi Cao** rather than treating it as settled.
2. ~~**832 decision**~~ — **resolved 2026-07-30: 888**, per Mike's direction (above).
3. **`N9|GM` decision** — recommend dropping it on the 943 (above); confirm
   with Mike so we can tell DCG.
4. ~~**SFTP credentials**~~ — **resolved**: connector tests successfully both
   ends (2026-07-30), so credentials are live in Secrets Manager. Still worth
   confirming DCG's exact folder structure/file-naming convention now that
   the directory is browsable.
5. **944/945 sample files** — not received yet (we have the field mapping
   guide but no real sample `.dat`); ask Chi Cao.
6. **Per-retailer 943/940/945 specifics** — Aaron's original ask to Jenna,
   still open.

## Architecture for the DCG leg

**AWS Transfer Family SFTP Connector + S3** for transport, **self-built X12**
for transformation — no Orderful on this leg. Full design (components, S3
layout, outbound/inbound flows, the `adapters/edi/x12-dcg/` codec, control
numbers, open items): **[dcg-sftp-design.md](dcg-sftp-design.md)**.

## Suggested next build step

Mirrors how `parse850.js` was built against a real Orderful 850, but now
against DCG's own samples in [dcg-specs/](dcg-specs/): write the **940
canonical→X12 generator** first (`adapters/edi/x12-dcg/lib/build940.js` +
`envelope.js`) — it's the smallest/cleanest sample and closes the loop with
what already works (AM → canonical `PickTicket` → 940 X12 → S3 → DCG).
Validate its output byte-against DCG's `sample-940.txt`, then wire the AWS
push. Gated only on the 940 sub-type question (open item #1) and DCG's SFTP
creds (#4) — not on any Orderful partnership.

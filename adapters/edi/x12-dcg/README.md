# x12-dcg adapter

An EDI adapter whose "platform" is **raw X12 flat files over SFTP** rather
than a hosted API like Orderful. It is the DCG warehouse leg's translator:
we build/parse X12 ourselves and move files via an AWS Transfer Family SFTP
Connector. See the client design doc:
[clients/scl-footwear/docs/dcg-sftp-design.md](../../../clients/scl-footwear/docs/dcg-sftp-design.md).

This adapter follows the same contract as `adapters/edi/orderful/` (see
`core/adapter-contract.md`) — auth/transport client, parsers, builders — the
difference is transport is SFTP-via-AWS and transformation is hand-built X12,
so there's an extra `envelope.js` for the ISA/GS/ST framing Orderful's API
handled for us.

## Files

| File | Role | Status |
|---|---|---|
| `lib/envelope.js` | ISA/GS/ST…SE/GE/IEA build, delimiters, control numbers | ✅ built, verified byte-for-byte against `sample-888.txt` and `sample-940.txt` |
| `lib/itemCode.js` | shared "Vendor Item Number" scheme (style+color+size), used by both 888 and 940 | ✅ built, extracted 2026-08-01 to keep 888/940 from drifting on the same identifier |
| `lib/build888.js` | canonical `Item` → 888 Item Maintenance (attributes only, no pricing — correct fit for a 3PL) | ✅ built, tested end-to-end against real DCG SFTP — see `dcg-sftp-design.md` |
| `lib/build940.js` | canonical `PickTicket` → 940 Warehouse Shipping Order | ✅ built, structurally verified against `sample-940.txt`; several fields deliberately omitted (no canonical source) — see `schema-notes.md` |
| `lib/build943.js` | canonical `PurchaseOrder` → 943 Stock Transfer Shipment Advice | not built yet |
| `lib/parse944.js` | 944 Stock Transfer Receipt Advice → canonical `Receipt` | not built yet |
| `lib/parse945.js` | 945 Warehouse Shipping Advice → canonical shipment confirmation | not built yet |
| `schema-notes.md` | segment-level mapping derived from the real DCG samples | ✅ written for 888 and 940; add sections for 943/944/945 as they're built |

## Source of truth for the mapping

DCG's own specs and real sample files live in
[clients/scl-footwear/docs/dcg-specs/](../../../clients/scl-footwear/docs/dcg-specs/),
with the synthesized summary in
[dcg-integration-notes.md](../../../clients/scl-footwear/docs/dcg-integration-notes.md).
Build each generator against the matching `sample-*.txt` and validate output
byte-for-byte, the same live-against-a-real-sample method used for `parse850`.

## Build order

**888 first** (built and proven end-to-end 2026-07-30/08-01) — Mike's
suggested first real file test, a genuine file built, sent via
`888-outbound.json`, and delivered to DCG over the AWS SFTP bridge.

**940 next** (built 2026-08-01, per Mike's explicit go-ahead) — canonical
`PickTicket` → 940 X12. Structurally verified against `sample-940.txt`.
Reuses `envelope.js` (same delimiter/date/control-number conventions,
re-verified against this second sample) and the shared `itemCode.js`. Wired
into `940-outbound.json` (built same day) — one X12 file per pick ticket,
unlike 888 which batches many items into one file. Not yet run against real
DCG. The 940 sub-type question is resolved: all "Customer Order" flavors
share transaction-type code `42` in VIDA's mapping (only Distribution/Rework
differ), so `42` is a well-supported default, not a guess pending
confirmation.

**943 next after that** (per Mike's "Receivers" = canonical `PurchaseOrder`,
already produced by `parsePurchaseOrder.js`), then the inbound parsers
944/945. Gated on: the open questions in `schema-notes.md` being confirmed
with Chi Cao before any live (non-test) send — **not** on any Orderful
trading partnership.

## Note on canonical objects

`Receipt` and the 945 shipment-confirmation shapes aren't in
`core/canonical-objects.md` yet (they were listed as "not yet built"). Define
them there when `parse944`/`parse945` are built, so both the DCG adapter and
the AM writeback agree on the shape.

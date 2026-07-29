---
name: discover-api-schema
description: Reverse-engineer an undocumented or incompletely-documented REST/JSON API's auth scheme or payload schema by POSTing incrementally-filled requests and reading validation errors. Use when integrating a new ERP or EDI vendor whose docs don't publish a full working example, or when extending an existing adapter to a new endpoint or transaction type.
---

# Live-schema-discovery method

The technique that nailed down ApparelMagic's auth quirks and Orderful's
856/810 JSON schema when neither vendor's public docs gave a complete
example. Works for any API that returns structured validation errors instead
of a generic 400/500.

## Method

1. POST (or send) a minimal/empty payload for the target endpoint or
   transaction type.
2. Read the validation error closely — a well-behaved API names the exact
   missing or invalid field.
3. Add that field, re-send, repeat.
4. Once the API stops complaining about structure, the schema is mapped.
   A remaining `INVALID`/guideline-level status is normal and separate —
   retailer- or partner-specific implementation guides layer requirements on
   top of the base schema; that's a later, content-correctness concern, not
   a schema gap. Don't keep iterating trying to chase it away.

## Doing this safely

- Only run against a **TEST stream / sandbox / demo partner** — never a live
  partner or production credentials. Real TEST-stream transactions are
  harmless and need no cleanup (see `adapters/edi/orderful/schema-notes.md`
  for the precedent).
- If the vendor has both GET and POST/PUT variants of the same auth, verify
  each separately — don't assume one scheme applies everywhere (AM's
  `time`+`token` are query params on GET but JSON body fields on POST/PUT,
  discovered this way).

## Where findings go

- ERP adapter: the auth quirks section of `adapters/erp/<name>/README.md`.
- EDI adapter: `adapters/edi/<name>/schema-notes.md` for the message schema,
  `README.md` for auth/transaction-type/pagination basics.

Full worked example to pattern-match against:
`adapters/edi/orderful/schema-notes.md` (856/810 discovery, including which
segment names turned out to be reused across transaction types and which
almost-identical field names were rejected).

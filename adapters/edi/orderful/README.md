# Orderful (Mosaic v3) EDI adapter

## Auth

Header: `orderful-api-key: <token>` — not a Bearer token, a custom header
name. Base: `https://api.orderful.com/v3`.

## Reading transactions

`GET /transactions` is **cursor-paginated**, not `limit`/`offset` — passing
`limit` errors. Filter with `stream=TEST|LIVE`, `transactionType`, etc.

The list response only has metadata; the actual EDI content is a separate
call: `GET /transactions/{id}/message`.

## Creating transactions

`POST /transactions` with:

```json
{
  "stream": "TEST",
  "type": { "name": "856_SHIP_NOTICE_MANIFEST" },
  "sender": { "isaId": "..." },
  "receiver": { "isaId": "..." },
  "message": { "transactionSets": [ ... ] }
}
```

`transactionSetTrailer` is **auto-generated** by Orderful — never send it.

**A relationship must already exist** between sender and receiver ISA IDs
*for that specific transaction type* before a POST is accepted — otherwise
`"...relationship... doesn't exist"`, regardless of message content. This is
a Trading Partnership/business-setup gate, not something schema-level
retries get around. Confirmed: 850/856/810 worked immediately against the
Orderful demo retail partner; 940/943/888 do not, because no Trading
Partnership with those transaction types configured exists yet for this
client (see `clients/scl-footwear/docs/dcg-integration-notes.md`).

## Message schema — full findings in `schema-notes.md`

Confirmed live for 850 (inbound, reading only) and 856/810 (outbound,
create). Key pattern: **segment names are reused across transaction types**
— `N1_loop`, `carrierDetailsRoutingSequenceTransitTime` (TD5),
`dateTimeReference` (DTM), `referenceInformation` (REF) are identical
wherever they appear. Once you've confirmed a segment's shape on one
transaction type, try it unchanged on the next before guessing fresh.

940/943/888/944/945 schemas are **not yet discovered** — blocked on the
Trading Partnership gate above, not a technical blocker. Once a partnership
with those types is active, use the same live-discovery method (see
`../../adapter-contract.md`).

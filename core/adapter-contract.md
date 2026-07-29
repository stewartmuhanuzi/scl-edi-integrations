# Adapter contract

What a new ERP adapter or EDI adapter needs to provide, derived from what
`adapters/erp/apparelmagic/` and `adapters/edi/orderful/` already do. This
isn't an enforced interface (plain JS, no types) — it's the checklist for
building the next one.

See `canonical-objects.md` for the shapes every adapter reads/writes.

## ERP adapter (e.g. `adapters/erp/<new-erp>/`)

**Auth client** (`lib/<erp-name>.js`) — one function per HTTP verb the ERP
needs, handling that ERP's specific auth quirk. Reference:
`apparelmagic.js` — ApparelMagic's auth is `time`+`token` as **query params**
on GET, but as **JSON body fields** on POST/PUT. Confirm this kind of
inconsistency for any new ERP rather than assuming one scheme everywhere.

**Parsers** (`lib/parse*.js`) — one per source entity, ERP response →
canonical object. Pure functions, no I/O. Reference: `parseShipment.js`,
`parseInvoice.js`, `parsePickTicket.js`, `parsePurchaseOrder.js`,
`parseItem.js`.

**Builders** (`lib/build*.js`) — one per target entity the pipeline writes
back, canonical object → ERP payload. Reference: `buildAMOrder.js`.

**`README.md`** — auth quirks, base URL pattern, endpoint list, gotchas
discovered while integrating (e.g. AM's per-SKU UPC living on a *different*
endpoint than the product header).

## EDI adapter (e.g. `adapters/edi/<new-edi-platform>/`)

**Auth client** (`lib/<platform-name>.js`) — list/get/create transaction
calls. Reference: `orderful.js`.

**Parsers** (`lib/parse*.js`) — EDI transaction message → canonical object.
Reference: `parse850.js`.

**Builders** (`lib/build*.js`) — canonical object → EDI transaction message,
one per outbound document type. Reference: `build856.js`, `build810.js`.

**`schema-notes.md`** — if the platform's JSON/message schema isn't fully
documented publicly (Orderful's wasn't, for 856/810), this file is where the
live-discovery findings go. See the technique below.

## The live-schema-discovery method

Used to nail down Orderful's 856/810 schema when the public docs didn't have
a full example. Works for any EDI platform that returns structured
validation errors:

1. POST a minimal/empty payload for the target document type.
2. Read the validation error — it names the exact missing/wrong field.
3. Add that field, re-POST, repeat.
4. Once it stops complaining about structure, you have the schema — a
   remaining `INVALID`/guideline-level status is normal (retailer- or
   partner-specific implementation guides add requirements on top of the
   base schema; that's a separate, later concern).

Full worked example: `adapters/edi/orderful/schema-notes.md`.

## What every adapter should NOT do

- Don't call the other side directly (ERP adapter never calls the EDI
  platform, and vice versa) — only the n8n workflow orchestrates between
  them, via canonical objects.
- Don't write to Supabase — that's the workflow's job (dedupe/log/error),
  not the adapter's.
- Don't hardcode client-specific values (base URLs, ISA IDs, tokens) in the
  adapter code — those belong in the client's `.env` / n8n credentials.

---
name: add-adapter
description: Scaffold a new ERP or EDI-platform adapter under adapters/erp/<name>/ or adapters/edi/<name>/, following this repo's adapter contract. Use when integrating a new ERP (e.g. NetSuite, Fishbowl) or a new EDI platform (e.g. TrueCommerce, SPS Commerce) for any client engagement.
---

# Add a new adapter

Read `core/adapter-contract.md` and `core/canonical-objects.md` first — they
are the source of truth for shape and structure. This skill is the
scaffolding checklist; don't duplicate those docs, follow them.

## 1. Decide ERP or EDI, and pick a lowercase vendor slug

e.g. `netsuite`, `truecommerce`. Target directory:
- ERP: `adapters/erp/<slug>/`
- EDI: `adapters/edi/<slug>/`

## 2. Create the directory and files

Both adapter types use the same shape (`lib/` + docs), but the content
differs:

**ERP adapter** (`adapters/erp/<slug>/`)
- `lib/<slug>.js` — auth client, one function per HTTP verb the ERP needs.
  Confirm the auth quirk empirically (don't assume one scheme for every verb
  — ApparelMagic's auth is query params on GET but JSON body fields on
  POST/PUT). Use the `discover-api-schema` skill if auth/payload shape isn't
  fully documented.
- `lib/parse*.js` — one per source entity, ERP response → canonical object.
  Pure functions, no I/O. (Reference shape: `adapters/erp/apparelmagic/lib/parseShipment.js`.)
- `lib/build*.js` — one per target entity the pipeline writes back, canonical
  object → ERP payload. (Reference: `adapters/erp/apparelmagic/lib/buildAMOrder.js`.)
- `README.md` — auth quirks, base URL pattern, endpoint list, any gotchas
  discovered while integrating.

**EDI adapter** (`adapters/edi/<slug>/`)
- `lib/<slug>.js` — auth client: list/get/create transaction calls.
  (Reference: `adapters/edi/orderful/lib/orderful.js`.)
- `lib/parse*.js` — EDI transaction message → canonical object.
  (Reference: `adapters/edi/orderful/lib/parse850.js`.)
- `lib/build*.js` — canonical object → EDI transaction message, one per
  outbound document type. (Reference: `build856.js`, `build810.js`.)
- `schema-notes.md` — if the platform's JSON/message schema isn't fully
  published, this is where live-discovery findings go (use the
  `discover-api-schema` skill to populate it).
- `README.md` — auth header/scheme, transaction type names, pagination
  style, gotchas.

## 3. Follow every file's import path convention

Adapters import shared helpers from `core/lib/` using a relative path from
their own `lib/` folder, e.g.:

```js
import { requireEnv } from '../../../../core/lib/env.js';
```

## 4. What the adapter must NOT do

- Never call the other side directly — an ERP adapter never calls the EDI
  platform and vice versa. Only the n8n workflow orchestrates between them,
  via canonical objects.
- Never write to Supabase — that's the workflow's job (dedupe/log/error).
- Never hardcode client-specific values (base URLs, ISA IDs, tokens) — those
  belong in the client's `.env` / n8n credentials, not the adapter code.

## 5. Verify

- `node --check` on every new `.js` file.
- If a client will actually use this adapter, wire it into that client's
  `clients/<name>/n8n/flows/*.json` (see the `build-n8n-workflow` skill) and
  update the root `README.md` adapter list.

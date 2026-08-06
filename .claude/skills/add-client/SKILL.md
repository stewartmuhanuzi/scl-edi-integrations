---
name: add-client
description: Scaffold a new clients/<name>/ engagement folder (n8n workflows dir, .env, docs) when onboarding a new client onto this reusable ERP<->EDI integration platform. Use when starting a brand-new client engagement that reuses core/ and existing or new adapters.
---

# Add a new client engagement

This repo's reuse model: **a template duplicated per client**. Reuse `core/`
as-is; reuse matching adapters under `adapters/` if this client uses a
vendor already integrated (e.g. ApparelMagic or Orderful), otherwise
scaffold a new one first with the `add-adapter` skill. Supabase and
credentials stay fully isolated per client (own project, own `.env`) — the
one shared piece is the n8n **account**, organized by a top-level folder per
client (see `core/architecture.md` §3) rather than a separate account per
client.

## 1. Create the directory tree

```
clients/<name>/
  n8n/
    flows/          -- production workflows (see build-n8n-workflow skill)
    tools/          -- manual dev/test utilities
    README.md       -- flow list + credential names used, per the pattern
                        in clients/scl-footwear/n8n/README.md
  .env, .env.example  -- this client's credentials only
  docs/
    architecture.md   -- short, client-specific: which adapters fill which
                          role, this client's document-flow table, any
                          non-standard integration (3PL, custom transport)
    implementation-plan.md
    status.md
```

Model every new doc on the matching `clients/scl-footwear/docs/*.md` file —
don't reinvent the shape.

## 2. `.env` and Supabase

1. Create a new Supabase project for this client.
2. Copy `clients/<name>/.env.example` to `clients/<name>/.env`, fill in the
   pooler connection details and this client's vendor credentials.
3. `npm run migrate -- <name>` — applies `core/supabase/migrations/` (same
   control-plane schema for every client) against this client's own Supabase
   project. `<name>` can be omitted if this is the only folder under
   `clients/`.

## 3. Write the client-specific architecture doc

Keep `core/architecture.md` untouched — it's vendor-agnostic and shared.
`clients/<name>/docs/architecture.md` should be short: a stack table (which
adapter fills ERP/EDI/3PL), the document-flow table for this client's actual
transaction types, and any client-specific open questions. See
`clients/scl-footwear/docs/architecture.md` as the reference shape.

## 4. Create this client's n8n folder and build workflows

In the shared n8n account, create a top-level folder named after this
client, with the standard sub-structure (see `core/architecture.md` §3):
`<3PL name>/`, `Retailer Templates/`, `Retailers/` (empty until a real
retailer exists), `Tools/`. Then use the `build-n8n-workflow` skill to wire
the chosen adapters together into this client's actual `n8n/flows/*`,
importing each into the matching subfolder.

## Explicitly do NOT do (until there's a real second client to validate against)

Don't try to build a genericized/parameterized n8n workflow template.
Client workflow JSON is full of client-specific URLs, ISA IDs, and field
mappings — guessing which parts should become placeholders before a second
real client's requirements exist risks designing the wrong template. Build
this client's workflows fresh, and only extract a template retroactively
once two real examples exist to compare.

## 5. Update the root README

Add this client to the "current clients" section of the root `README.md`
with links to its `docs/implementation-plan.md` and `docs/architecture.md`.

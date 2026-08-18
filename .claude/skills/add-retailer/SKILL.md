---
name: add-retailer
description: Onboard a new retailer trading partner (Ross, TJ Maxx, Citi Trends, ...) within an existing client by copying the retailer-facing 850/856/810 workflow templates into a per-retailer folder and parameterizing them. Use when adding a retailer to a client that already has the pipeline built, not when starting a whole new client (use add-client for that).
---

# Add a new retailer

A retailer is a **trading partner within a client** — same ERP, same EDI
platform, same 3PL, just a different partner sending 850s and receiving
856/810. This client uses the **per-retailer workflow folder** model: each
retailer gets its own copy of the retailer-facing flows. See
`clients/<client>/n8n/retailers/README.md` for the convention this skill
implements.

The whole point of this skill is discipline: a retailer copy must differ from
the template **only** by the config header below, so a shared-pipeline change
can be re-propagated safely instead of turning N copies into N snowflakes.

## 1. Pick a retailer slug and create the folder

Lowercase, hyphenated (`ross`, `tj-maxx`, `citi-trends`). Create:

```
clients/<client>/n8n/retailers/<slug>/
```

## 2. Copy the retailer-facing templates in

Copy — do not move — from the client's shared templates:

```
clients/<client>/n8n/flows/850-inbound.json      -> retailers/<slug>/850-inbound.json
clients/<client>/n8n/flows/856-810-outbound.json -> retailers/<slug>/856-810-outbound.json
```

Do **not** copy DCG/3PL-facing flows (`888-outbound.json`,
`940-outbound.json`, `943-outbound.json`, future 944/945) — one 3PL serves
every retailer, those stay shared in `flows/`.

## 3. Apply the retailer config header (the only allowed diff)

Change **only** these, and nothing else, versus the template:

- **Retailer Orderful ISA ID** — replace the `ODFLRETAILTEST` placeholder:
  `receiver.isaId` in the outbound Build 856/810 nodes; the expected
  `sender.isaId` filter in the inbound flow.
- **Stream** — `TEST` while validating, flip to `LIVE` at go-live.
- **Workflow name prefix** — rename each workflow to `<Client>/<Retailer>:`
  (e.g. `SCL/Ross: 856 ASN + 810 Invoice`) so it sorts under the retailer.
- **Guideline-specific field overrides** — *only if* the retailer's EDI
  implementation guide actually requires a different qualifier or an extra
  segment. Discover these with the `discover-api-schema` method against that
  retailer's Orderful partnership; note each deviation in `retailer.md`.

Record every value you set in `retailers/<slug>/retailer.md` (copy the config
table from `retailers/README.md`). This file is the record of exactly how
this retailer diverges from the template.

## 4. Supabase + Orderful config (not in the JSON)

- **`partner_map` row** — retailer trading partner ↔ ERP customer id ↔
  routing. This is how the shared logic resolves which ERP customer an
  inbound 850 belongs to. Add it to the client's Supabase, don't hardcode it
  in the workflow.
- **Orderful trading partnership** — create/accept the partnership for this
  retailer with 850/856/810 enabled, and select its guideline. A transaction
  type can't be posted until its partnership exists with that type enabled
  (this is the same relationship gate documented for the DCG side).

## 5. Import into n8n

Create a folder for the retailer in n8n, import its two flows into it, and
follow the `build-n8n-workflow` import checklist — **re-select every
credential** after import, import onto blank canvases, etc.

## 6. Verify, then export back

Run the `check-code-quality` skill, run each flow on the TEST stream against
the retailer's real partnership, then export the final JSON back into
`retailers/<slug>/` (the repo copy is the source of truth).

## Keeping copies from drifting (important for this model)

When the shared pipeline logic changes, the fix must reach every retailer:

1. Apply the change to the **templates** in `flows/` first.
2. For each `retailers/<slug>/`, re-copy the template, then re-apply that
   retailer's config header from its `retailer.md`.

Because the only sanctioned per-retailer difference is that documented header,
step 2 is mechanical. A quick `diff` of a retailer copy against the template
should show *only* the header fields — anything else is unintended drift to
reconcile.

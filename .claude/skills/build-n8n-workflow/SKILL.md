---
name: build-n8n-workflow
description: Build, import, and maintain an n8n workflow for this project, following the established flow skeleton and dev conventions (credential re-link, blank-canvas import, naming, tagging, exporting JSON back to the repo). Use when creating a new client workflow, or troubleshooting n8n import/credential issues.
---

# Build an n8n workflow

Full rationale lives in `core/architecture.md` §3 — this is the procedural
checklist. Every workflow in this repo is a JSON file under
`clients/<name>/n8n/flows/` (production logic) or `clients/<name>/n8n/tools/`
(manual dev/test utilities, never scheduled).

## Flow skeleton — every production workflow follows this shape

`trigger → dedupe (idempotency check against Supabase) → fetch source →
parse to canonical → map to target → write/send → log status → on error:
route to an errors table`.

Canonical-object rule: never map ERP format directly to EDI format inline in
a Code node — call the adapter's `parse*.js`/`build*.js` logic (ported into
the Code node, or literally the same logic) so the workflow stays a thin
orchestrator. See `core/canonical-objects.md`.

## Building it

1. **Build with a Manual Trigger first.** Add a Schedule Trigger only once
   the manual-trigger version is proven — n8n allows multiple trigger nodes
   per workflow, so keep both once scheduled.
2. **Sample-data fallback.** If the flow depends on upstream data that may
   not exist yet (e.g. no shipments in a test ERP company), fall back to a
   realistic hardcoded sample so the workflow is runnable and demonstrable
   in isolation — see `856-810-outbound.json`'s "Parse Shipment (or sample)"
   node for the pattern.
3. **Naming**: prefix with `<Client>:` so a client's workflows sort and read
   together (e.g. `SCL: 850 → AM (full pipeline)`).
4. **Tag workflows** by category (`inbound`, `outbound`, `dev-utility`) once
   there are enough per client to need it.

## Importing (do this every time, no exceptions)

1. Import onto a **genuinely blank** new workflow canvas — importing onto an
   already-populated canvas merges nodes instead of replacing them.
2. **Re-select every credential-using node before running anything.**
   Imported nodes can show the correct credential *name* while the link
   isn't actually bound — you'll see "Credentials not found" or
   "Authorization failed" despite it looking selected. Check every
   credential node, not just the first one that errors.
3. Postgres/Supabase credential gotcha: needs SSL = require **and** "Ignore
   SSL Issues" on, or you get a self-signed-cert error.

## Scheduling multiple workflows

Every flow dedupes and logs against the same Supabase tables before doing
anything, so overlapping or out-of-order runs across *different* workflows
are a non-event — don't coordinate timing between them. Give each flow its
own trigger on its own natural cadence (polling every 5–30 min depending on
time-sensitivity); anything that's naturally a reaction to another flow
completing should be called via n8n's Execute Sub-workflow rather than given
its own poll. Non-manual triggers only fire once the workflow is
Published/Active, not merely saved.

## After every meaningful change

**Export the workflow JSON back into `clients/<name>/n8n/flows/` (or
`tools/`) in the repo.** This is the real source of truth — it has already
recovered this project once after an n8n account reset wiped all live
workflows. Update `clients/<name>/n8n/README.md`'s flow list if you added or
renamed a workflow.

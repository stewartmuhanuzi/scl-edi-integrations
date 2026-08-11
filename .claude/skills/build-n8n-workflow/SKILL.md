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
5. **`$('NodeName')` cross-references need a real connected path, not just
   "runs somewhere in the same execution."** A Code node referencing another
   node by name (e.g. `$('Get AM Customer').first()`) only resolves if
   there's an actual chain of connections leading from that node to the
   referencing one. A node wired as a parallel sibling off the same trigger
   is **not** sufficient — n8n will error with "There is no connection back
   to the node '...'" even though both nodes execute in the same run. Wire
   any node you plan to reference by name into the actual sequential chain
   (e.g. `Get AM Products → Get AM Inventory (SKUs) → Combine & Parse Items`)
   rather than as a disconnected parallel fetch. Caught live 2026-08-06 after
   wiring two lookup nodes as parallel branches by mistake — verify with a
   quick reachability check (does the connections graph actually have a path
   from the referenced node to the referencing one?) before calling a
   multi-node-reference workflow done.
6. **A Code node's return shape must match its Mode, or it fails with "A
   'json' property isn't an object."** `Run Once for All Items` wants an
   **array** of items (`return [{ json: {...} }, ...]`, or `return
   records.map(r => ({ json: {...} }))`). `Run Once for Each Item` wants a
   **single bare object**, no array wrapper (`return { json: {...}, binary:
   {...} };`). Mixing these up — e.g. copy-pasting an array-returning
   template into a node you then switch to per-item mode — throws this exact
   error and won't cascade-execute upstream nodes for testing. Caught live
   2026-08-06 in the same session as the connection-graph gotcha above; check
   every Code node's `mode` param against its `return` statement's shape
   before calling a workflow done, especially after copying a node's code as
   a starting point for a differently-moded node.
7. **AWS's JSON-RPC-style API responses (`X-Amz-Target` calls) don't
   auto-parse in an HTTP Request node.** AWS's content-type
   (`application/x-amz-json-1.1`) isn't the standard `application/json` n8n
   auto-detects, so the whole response body lands as a **raw string** under
   a single field named `data` (i.e. `$json.data`), not parsed into
   top-level properties like `$json.OutputFileName`. Confirmed live
   2026-08-06 building the `check-dcg-directory` tool — referencing
   `$('NodeName').item.json.SomeField` directly silently resolves to
   `undefined` with no error at the reference site (the error shows up
   wherever the `undefined` gets used instead, which is confusing to debug
   backwards from). Fix: `JSON.parse($('NodeName').item.json.data).SomeField`
   in every expression that reads one of these AWS API responses — this
   applies to `StartFileTransfer`, `StartDirectoryListing`, and any future
   AWS Transfer Family API call built this way (e.g. `ListFileTransferResults`).

8. **Reading binary data in a Code node needs n8n's own helper, not manual
   `Buffer`/base64 handling on `item.binary.<prop>.data`.** That field only
   contains the raw base64 content when n8n's binary data mode is
   inline/memory. On instances configured for filesystem storage (n8n Cloud
   can be), `item.binary.<prop>.data` is just an internal mode marker/
   reference — confirmed live 2026-08-07 building `check-dcg-directory`: the
   field literally contained the string `"filesystem-v2"`, not the file
   bytes, producing a confusing "not valid JSON" error pointing at that
   marker text. Fix: `const buffer = await
   this.helpers.getBinaryDataBuffer(itemIndex, propertyName);` — this
   resolves correctly regardless of storage mode. This only affects **reading**
   binary data that arrived from an upstream node (e.g. after an S3
   download); it does not affect **creating** binary data from scratch in a
   Code node (e.g. `Buffer.from(x12String).toString('base64')` when building
   a file to upload, as `888-outbound.json`'s "Build 888 X12" node does) —
   that write path is unaffected.

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

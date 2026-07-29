---
name: check-code-quality
description: Run this project's quality checks -- syntax validation, JSON validity, stale path-reference sweep, and adapter-contract boundary violations -- before considering a change complete. Use after editing anything under core/, adapters/, or a client's n8n workflow JSON, or after any multi-file reorganization.
---

# Check code quality

No linter, formatter, or test framework is set up for this repo -- adapters
are deliberately plain JS with no build step (see `core/adapter-contract.md`:
"this isn't an enforced interface"). Quality is enforced by running these
checks manually, the same way verification was done during the
core/adapters/clients reorg. Don't skip a step because it seems obviously
fine -- report which checks passed/failed.

## 1. Syntax validation

Every `.js` file must parse:

```bash
find core adapters clients scripts -name "*.js" -not -path "*/node_modules/*" \
  -print0 | xargs -0 -n1 node --check
```

## 2. JSON validity

Every n8n workflow file (and any other tracked JSON) must parse:

```bash
find clients -name "*.json" -not -path "*/node_modules/*" -print0 \
  | while IFS= read -r -d '' f; do
      node -e "JSON.parse(require('fs').readFileSync('$f'))" \
        || echo "INVALID: $f"
    done
```

## 3. Stale path-reference sweep

After moving or renaming any file, grep every `.md` and `.json` for the old
path fragment until zero hits remain -- this is the exact technique that
caught every leftover reference during the core/adapters/clients reorg:

```bash
grep -rn "<old-path-fragment>" --include="*.md" --include="*.json" .
```

## 4. Adapter-contract boundary check

For every file touched under `adapters/`, confirm none of the following
(see `core/adapter-contract.md`, "What every adapter should NOT do"):

- [ ] **No cross-adapter calls** -- an ERP adapter file never imports from
  `adapters/edi/`, and vice versa:
  ```bash
  grep -rn "adapters/edi" adapters/erp/ ; grep -rn "adapters/erp" adapters/edi/
  ```
- [ ] **No Supabase/Postgres access** -- that's the n8n workflow's job, not
  the adapter's:
  ```bash
  grep -rln "from 'pg'\|require('pg')" adapters/
  ```
- [ ] **No hardcoded client-specific values** -- base URLs, ISA IDs, tokens,
  customer IDs belong in `.env` / n8n credentials, not adapter code:
  ```bash
  grep -rn "https://" adapters/ --include="*.js"
  ```
  A clean result is an empty grep for all three -- if anything comes back,
  that's a contract violation to fix, not a false positive to explain away.

## 5. Canonical-object principle check

For any new or changed `parse*.js` or `build*.js`, confirm it produces or
consumes only the shapes documented in `core/canonical-objects.md`. If a
single function references both ERP-specific field names (e.g. `sku_id`,
`customer_po`) and EDI segment names (e.g. `HL_loop`, `N1_loop`) at once,
that's a canonical-object violation -- ERP and EDI must never map directly to
each other; split the function so each side only knows about the canonical
shape in between.

## 6. n8n workflow conventions (if a flow/tool JSON changed)

Run the checklist in the `build-n8n-workflow` skill: naming prefix present,
a Manual Trigger exists alongside any Schedule Trigger, credentials are
referenced by name only (no inline secrets baked into the JSON).

## When to run this

Before considering any multi-file change complete -- especially right after
using the `add-adapter` or `add-client` skills, or after any repo-wide
reorganization.

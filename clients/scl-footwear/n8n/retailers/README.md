# Per-retailer workflows

Each retailer routed through this client (Ross, TJ Maxx, Citi Trends, …) gets
its own folder here, mirroring its folder in n8n. A retailer folder holds
**that retailer's own copy** of the retailer-facing flows:

```
retailers/
  <retailer-slug>/
    850-inbound.json          -- copy of the template, parameterized for this retailer
    856-810-outbound.json     -- copy of the template, parameterized for this retailer
    retailer.md               -- this retailer's config header (see below)
```

## What is a copy vs. what is shared

- **Retailer-facing flows** (850 in, 856/810 out) are **copied per retailer**,
  because Ross's Orderful trading partnership, ISA ID, and EDI guideline
  differ from TJ Maxx's. The templates they're copied from live one level up
  in [`../flows/`](../flows/) (`850-inbound.json`, `856-810-outbound.json`).
- **DCG / 3PL-facing flows** (`am-data-pulls.json`, and the future
  888/940/943/944/945) stay **shared** in [`../flows/`](../flows/) — there is
  one DCG warehouse for all retailers, so those are not copied per retailer.

## The retailer config header

A per-retailer copy must differ from its template **only** in this small,
enumerable set of fields — everything else stays byte-identical to the
template. Record the exact values in that retailer's `retailer.md`:

| Field | Where it lives | Template placeholder |
|---|---|---|
| Retailer Orderful ISA ID | `receiver.isaId` (outbound), expected `sender.isaId` (inbound) | `ODFLRETAILTEST` |
| Stream | `stream` in the Orderful payload | `TEST` (→ `LIVE` at go-live) |
| ERP customer id | `partner_map` row (Supabase), not the JSON | — |
| Orderful trading partnership + guideline | Orderful UI, per retailer | demo partner |
| Guideline-specific field overrides (qualifiers, required segments) | the relevant Build node, only if the retailer's guide demands it | none |

Keeping the diff this narrow is what makes the copy-per-retailer model safe:
when the shared pipeline logic changes, re-copy the template and re-apply just
these fields, rather than hand-reconciling divergent workflows. See the
`add-retailer` skill for the step-by-step.

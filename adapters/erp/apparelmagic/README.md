# ApparelMagic ERP adapter

## Auth — the quirk that took the longest to find

`time` (unix seconds, fresh per request) + `token` as auth on **every**
request, but the transport differs by verb:

- **GET** — `time`/`token` as **query-string params**. The docs show a
  JSON-body example; it does not work in practice, the app only reads
  `$_GET`. Confirmed live.
- **POST/PUT** — `time`/`token` go in the **JSON body**, alongside the
  payload. Query-string auth alone gets a 401 on writes.

There is **no HTTP Basic Auth wall** — an early misdiagnosis. The
Apache-styled 401 HTML page is actually a PHP response for a missing/invalid
token, not a server-level auth gate. Don't chase Basic Auth if you see that
page; check the token/time first.

Nested query params use PHP bracket notation:
`pagination[page_number]=1&pagination[page_size]=5`,
`parameters[0][field]=sku_id&parameters[0][value]=1054`.

Base URL pattern: `https://<company>.app.apparelmagic.com/api/json/<endpoint>/`

## Endpoints used so far

| Endpoint | Used for |
|---|---|
| `customers/` | Resolving a customer_id for order creation |
| `inventory/` | Per-SKU data — UPC, color, size (not on the product header) |
| `products/` | Product/style header — combine with `inventory/` for a full `Item` |
| `orders/` | Create sales orders (`POST`) |
| `shipments/` | Ship confirmations — has per-carton UCC/SSCC under `boxes[]` |
| `invoices/` | Invoice records |
| `pick_tickets/` | Released-for-fulfillment orders (940 source) |
| `purchase_orders/` | Vendor POs — incoming stock DCG/3PL needs advance notice of (943 source) |

## Gotchas

- UPC lives on **`inventory/`** (the SKU record), not on `products/` (the
  style header) — a new Item canonical object needs both endpoints combined.
  See `lib/parseItem.js`.
- The order-create endpoint (`POST orders/`) errors on: invalid customer, no
  division/warehouse/AR-account/currency default on the customer, invalid
  quantity, invalid SKU. All are pre-conditions on the *customer* record in
  ApparelMagic, not something the payload can fix.
- Test/sandbox: this ERP has no test/live stream separation like an EDI
  platform would. A given instance is either in "testing mode" (banner
  in the UI, safe to write) or production — check before writing.
- **Custom attribute fields (`attN_*`) are genuinely dynamic, not a fixed
  schema.** Confirmed live 2026-08-10, per Mike's request: `orders/` records
  can carry `att1_customer`/`att2_purchase_order`, `purchase_orders/` can
  carry `att1_customer`/`att2_sales_order`, `pick_tickets/` can carry
  `att2__sales_order` (double underscore — an AM-side quirk in how it
  generates the key from a configured label, not a typo here). The field
  *name* itself encodes whatever label someone typed into AM's settings, and
  isn't consistent even across endpoints for the same underlying concept.
  Don't hardcode these into a parser the way named fields are handled
  elsewhere — see `lib/extractCustomFields.js` (generic `attN` pattern
  match) and `clients/scl-footwear/n8n/flows/sync-am-custom-fields.json`.

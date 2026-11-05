---
name: awj-erp
description: Use AWJ ERP (Nibras Al-Tamouh tenant) through the AWJ Public API v1 - read/create partners and products, create DRAFT sales invoices, read partner statements. Never posts, pays or collects.
metadata: {"openclaw":{"requires":{"bins":["curl"],"env":["AWJ_API_KEY","AWJ_API_BASE"]},"primaryEnv":"AWJ_API_KEY"}}
---

# AWJ ERP - 7 supported operations

Use only the env vars `AWJ_API_BASE` (https://nibras-api-production.up.railway.app/api/v1) and `AWJ_API_KEY`.
Never print, echo, log or repeat the key, and never include it in a reply.
Every call: `-H "Authorization: Bearer $AWJ_API_KEY" -H "Accept: application/json" --max-time 20`.
Responses are `{"data": ..., "meta": ...}`; lists are paginated (`per_page` max 100).

| # | Operation | Call | Scope |
|---|---|---|---|
| 1 | List/search products | `GET $AWJ_API_BASE/products?search=<text>&per_page=5` | products:read |
| 2 | Create product | `POST $AWJ_API_BASE/products` | products:write |
| 3 | List/search partners | `GET $AWJ_API_BASE/partners?type=customer&search=<text>&per_page=5` | partners:read |
| 4 | Create partner | `POST $AWJ_API_BASE/partners` | partners:write |
| 5 | List/get invoices | `GET $AWJ_API_BASE/invoices?per_page=5` / `GET .../invoices/<uuid>` | invoices:read |
| 6 | Create DRAFT sales invoice | `POST $AWJ_API_BASE/invoices` | invoices:write |
| 7 | Partner statement | `GET $AWJ_API_BASE/partners/<uuid>/statement?from=YYYY-MM-DD&to=YYYY-MM-DD` | statements:read |

## Write rules (mandatory)

- Every POST needs a header `Idempotency-Key: <stable-unique-string>`. Reuse the SAME key when retrying the same
  intent (response header `Idempotency-Replayed: true` means it was a replay, not a new record). Never invent a new
  key to "retry" a request that already succeeded.
- Before creating a product/partner, search first (by sku / name) and do not create a duplicate.
- Product body: `{"name","sku","sale_price_minor","tax_rate":15}` (sku unique per tenant).
- Partner body: `{"name","type":"customer"}`.
- Invoice body: `{"partner_id","payment_type":"credit","notes":"...","items":[{"product_id","quantity","unit_price_minor","tax_rate":15}]}`.
  Totals are computed by the server; never send totals. The result is always `status: "draft"`.
- Amounts are integers in halalas: 10050 = 100.50 SAR.

## Hard limits

- You can only create DRAFTS. Never try to post, approve, pay, collect, cancel, edit or delete; there is no such
  call. Anything financial/final needs the owner's explicit approval in the AWJ app.
- Report only what the API returned. On 401/403/404/422/429/5xx state the HTTP status and the error code; do not
  retry in a loop and never fabricate data.
- 401 = key missing/expired/revoked, 403 = scope not granted, 422 = validation (read `error.message`).

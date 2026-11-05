---
name: awj-erp
description: Use AWJ ERP (Nibras Al-Tamouh tenant) through the AWJ Public API v1 - read/create partners (customers and suppliers) and products, create DRAFT sales invoices, read customer and supplier statements. Never posts, pays or collects.
metadata: {"openclaw":{"requires":{"bins":["curl"],"env":["AWJ_API_KEY","AWJ_API_BASE"]},"primaryEnv":"AWJ_API_KEY"}}
---

# AWJ ERP - 7 core operations + supplier support

Configuration comes from exactly two variables, both set on the OpenClaw service:
- AWJ_API_BASE: the API root (already includes /api/v1).
- AWJ_API_KEY: the secret key. Reference it only as a shell variable inside the Authorization header.
Never print, echo, log or repeat the key, and never include it in a reply.

Every request carries these headers: `Authorization: Bearer $AWJ_API_KEY`, `Accept: application/json`,
and a 20 second timeout (`--max-time 20`).
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
| 8 | List/search suppliers | `GET $AWJ_API_BASE/partners?type=supplier&search=<text>&per_page=10` | partners:read |
| 9 | Get partner/supplier details | `GET $AWJ_API_BASE/partners/<uuid>` | partners:read |
| 10 | Create supplier | `POST $AWJ_API_BASE/partners` with `"type":"supplier"` | partners:write |
| 11 | Supplier statement | `GET $AWJ_API_BASE/partners/<uuid>/statement?role=supplier&from=YYYY-MM-DD&to=YYYY-MM-DD` | statements:read |

Rows 1-7 are the core operations and are unchanged. Rows 8-11 add supplier support using the same endpoints
(`type=supplier` and `role=supplier` are the only differences). Suppliers are partners whose type is `supplier`
(or `both`).

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

## Supplier rules (mandatory)

- Search before you create, across ALL partner types (no `type` filter):
  `GET $AWJ_API_BASE/partners?search=<name>&per_page=10`, and also by VAT number when one is known. Compare names
  after trimming spaces and ignoring letter case. If a supplier (type `supplier` or `both`) with the same name or
  the same VAT number already exists, reuse it and do NOT create another one.
- If the only match is a customer, do not create a supplier silently. Tell the owner and wait for a decision
  (there is no update call).
- Create body: `{"name":"<name>","type":"supplier"}`. Optional fields only when the owner gave them:
  `name_en`, `vat_number` (exactly 15 characters), `cr_number`, `email`, `phone`, `mobile`, `city`, `address`.
  Never invent or guess a VAT number, CR number, phone or email.
- Use a fixed, repeatable Idempotency-Key for each supplier:
  `basht-supplier-v1-<first 12 hex characters of the SHA-256 of the VAT number, or of the trimmed lower-case name
  when no VAT number is known>`. Retrying the same intent reuses the same key. A different supplier gets a
  different key. Never generate a random key.
- A replay (`Idempotency-Replayed: true`) is success, not a new record. A conflict or validation error means stop
  and report it; do not change the key to push the request through.
- Supplier statement: use `role=supplier` and a date range. If the response is 422 because the statement is too
  long, narrow `from` / `to`. Report debit, credit and balance exactly as returned (amounts in halalas).
- There is no update or delete call for suppliers. If supplier data needs correction, ask the owner to edit it in
  the AWJ app.

## Hard limits

- You can only create DRAFTS. Never try to post, approve, pay, collect, cancel, edit or delete; there is no such
  call. Anything financial/final needs the owner's explicit approval in the AWJ app.
- Report only what the API returned. On 401/403/404/422/429/5xx state the HTTP status and the error code; do not
  retry in a loop and never fabricate data.
- 401 = key missing/expired/revoked, 403 = scope not granted, 422 = validation (read `error.message`).

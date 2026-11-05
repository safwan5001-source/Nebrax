---
name: awj-erp
description: Read AWJ ERP (products, customers) through the AWJ Public API v1 using the AWJ_API_KEY secret. Read-only until the owner enables write scopes.
metadata: {"openclaw":{"requires":{"bins":["curl"],"env":["AWJ_API_KEY","AWJ_API_BASE"]},"primaryEnv":"AWJ_API_KEY"}}
---

# AWJ ERP (read-only stage)

Use only the environment variables `AWJ_API_BASE` (e.g. `https://nibras-api-production.up.railway.app/api/v1`)
and `AWJ_API_KEY`. Never print, echo, log or repeat the key, and never put it in a reply.

## Products (scope products:read)

```bash
curl -sS --max-time 20 -H "Accept: application/json" \
  -H "Authorization: Bearer $AWJ_API_KEY" \
  "$AWJ_API_BASE/products?per_page=5"
# search: ".../products?search=<text>&per_page=5"
```

## Customers (scope partners:read)

```bash
curl -sS --max-time 20 -H "Accept: application/json" \
  -H "Authorization: Bearer $AWJ_API_KEY" \
  "$AWJ_API_BASE/partners?type=customer&search=<text>&per_page=5"
```

## Rules

- Amounts are integers in halalas (minor units): 10050 = 100.50 SAR. Display as SAR.
- Report only what the API returned. If the call fails (401/403/429/5xx or empty), say so with the HTTP status;
  never invent products, customers or numbers.
- 401 = key missing/expired/revoked; 403 = scope not granted. Do not retry in a loop.
- This skill performs GET requests only. Do not create or modify anything in AWJ.

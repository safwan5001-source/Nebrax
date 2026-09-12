# COM-WS-2 — Tenant-scoped Commerce Store Selector

**Status:** implemented on a feature branch, not merged
**Date:** 2026-09-12
**Base:** latest `main` after COM-WS-1

## Decision applied

Reuse the COM-WS-1 Commerce Workspace shell. Do not rebuild destinations,
RBAC, products, customers, inventory, or the public storefront.

The store selector and View Store / عرض المتجر now read a tenant-scoped ERP
admin list. Tenant authority stays on the server (`SetTenant` →
`TenantContext`). The browser never supplies a tenant ID/slug.

Public `GET store/v1/storefront` remains Host-resolved buyer traffic and is
not used here.

`commerce.storefront` stays `coming_soon` and does **not** gate this read.
Gating it would 403 every ERP user.

## API

`GET /api/commerce/workspace/storefronts`

Middleware: `auth:sanctum` + `EnsureUserPrincipal` + `SetTenant` +
`SetBranch` + `EnsureActiveSubscription`.

No commercial entitlement. No new RBAC permission. `self_service` → 403.

```json
{
  "data": {
    "stores": [
      {
        "id": "uuid",
        "name": "المتجر الرئيسي",
        "sales_channel_id": "uuid",
        "is_active": true,
        "preview_url": "https://shop.example.com/"
      }
    ]
  }
}
```

- Current-tenant **active** `Storefront` rows bound to a same-tenant **web**
  `SalesChannel` only.
- `preview_url` is server-built `https://{hostname}/` from an active +
  verified domain (prefer `is_primary`). Otherwise `null`.
- Empty tenant → `{ "data": { "stores": [] } }`, not 404.
- Query `tenant`, `storefront_id`, `hostname`, and Host headers are ignored
  as authority.
- Response never includes `tenant_id`.

## Frontend

`COMMERCE_STORE_ADMIN_LIST_PATH = '/commerce/workspace/storefronts'`

The existing header selector renders returned stores. Selection is in-memory
workspace state only. View Store is an `<a>` only when the selected row has
a sanitized server `preview_url`.

## Tests

- PHP isolation: `tests/Feature/CommerceWorkspaceStorefrontsApiTest.php`
- PR-COM-0 `CommerceModuleBoundaryTest` now allows only
  `api/commerce/workspace/storefronts` and still fails on any other
  commerce-named API route (same exception pattern as COM-2A/COM-3 models).
- Vitest: stores catalog mapping + shell selector / View Store wiring.

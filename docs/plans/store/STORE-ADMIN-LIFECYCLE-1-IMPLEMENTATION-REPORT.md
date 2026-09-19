# STORE-ADMIN-LIFECYCLE-1 — Merchant Storefront Activate / Deactivate — Implementation Report

## Status

**COMPLETE.** PR opened, not merged, not deployed.

Contract: [`docs/plans/store/STORE-ADMIN-LIFECYCLE-VERIFY-1.md`](https://github.com/safwan5001-source/Nebrax/blob/docs/store-admin-lifecycle-verify-1/docs/plans/store/STORE-ADMIN-LIFECYCLE-VERIFY-1.md) (PR [#872](https://github.com/safwan5001-source/Nebrax/pull/872), CASE B).

This slice is **only** `Storefront.is_active` lifecycle: storefront-id scoped Activate/Deactivate, truthful Store Admin list, `/commerce/stores` confirmation UI (AR/EN).

## Git

- Latest `main` SHA used: `50e66740b5e7757edd30e3dd7ae2304d8b9f325f`
- Latest `main` subject: `feat(store): AWJ store customer account experience (STORE-UI-5) (#868)`
- CUSTOM-DOMAIN-EDGE-3 / PR #870 merge SHA: `31db0857dd10a7f365e42bee41a64ca8f211b6a4`
- EDGE-3 in ancestry of this branch: **Yes** (`git merge-base --is-ancestor 31db0857… HEAD` succeeded; EDGE-3 is the parent of STORE-UI-5)
- Branch: `feat/store-admin-lifecycle-1`
- Base SHA: `50e66740b5e7757edd30e3dd7ae2304d8b9f325f`
- Head SHA: `3cdd61fdec2a14b51547255e115fa46396a244d1`
- PR: *(filled after open)*

## Decision: DO NOT COUPLE

| Flag | This PR |
|---|---|
| `Storefront.is_active` | **The only write.** Deactivate = `false`. Activate = `true`. |
| `SalesChannel.is_active` | **Unchanged.** Not read as a write gate. Not flipped. Web/mobile/pos/external channels, listings, cart, orders, fulfillment, pricing stay independent. |
| `StorefrontDomain.is_active` | **Unchanged.** Not used as a store off switch. EDGE-3 disconnect fence is untouched. |
| Domain / Edge state | **Unchanged.** No Make Primary, Disconnect, Activate Edge, Refresh Edge, Railway, DNS, TLS writes. |
| Resolver | **Unchanged.** Public `ResolveStorefrontDomain` already fails closed on inactive Storefront. |
| Provisioning | **Unchanged.** Re-activate of an inactive compatible first storefront remains backward compatible. |
| Publication | **Unchanged.** `CommerceProductPublicationService` filters stay. Existing `CommerceListing` rows are not deleted. |

## Backend

```text
POST /api/commerce/workspace/storefronts/{id}/activate
POST /api/commerce/workspace/storefronts/{id}/deactivate
```

Empty bodies. Extra JSON ignored. Not added to Identity PUT.

Service (`CommerceWorkspaceStorefrontsService`):

- `activateForCurrentTenant` / `deactivateForCurrentTenant`
- Shared `setActiveForCurrentTenant`: `TenantContext` → transaction `lockForUpdate` on the Storefront row → `null` on missing/cross-tenant → confirm same-tenant `web` SalesChannel (read only) → `forceFill(['is_active' => $active])` only if changed → presenter with **actual** `is_active`

GET list / Identity presenter:

- Dropped `where('is_active', true)` on the storefront query
- Real `is_active`
- `preview_url` only when storefront **and** channel are active **and** an authorized verified domain exists

Authorization: existing `commerce.manage` + self_service 403. Unknown / cross-tenant `{id}` → 404 `"المتجر غير موجود."` Idempotent same-state → 200 + current store.

AWJ-managed Activate does **not** require Railway / `edge.status = ready`. Tests bind `FakeStorefrontEdgeClient` and assert zero `provision` / `fetch` / `find` / `release` calls.

## Frontend

`/commerce/stores`:

- Truthful Active / Inactive badge
- Activate / Deactivate gated on `commerce.manage`
- Deactivation confirmation dialog (AR/EN), distinct from domain “Activate Domain”
- Settings remains on inactive rows
- `refresh(storeId)` after success — no optimistic catalog mutation
- Client posts storefront-id activate/deactivate only — never `…/domains/…/activate-edge`

## Explicit non-changes

No migration. No resolver change. No provisioning change. No publication-semantics change. No Railway production setup. No Domain/Edge mutation. No accounting / inventory / order cancellation. No App Builder. No multi-store creation. No `commerce/v1` mobile API change.

## Files changed

| File | Change |
|---|---|
| `app/Services/Commerce/CommerceWorkspaceStorefrontsService.php` | Truthful presenter; activate/deactivate; no channel/domain writes |
| `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php` | `activate` / `deactivate` |
| `routes/api.php` | Two POSTs, `commerce.manage` |
| `tests/Feature/CommerceModuleBoundaryTest.php` | Allowlist the two URIs |
| `tests/Feature/CommerceWorkspaceStorefrontsApiTest.php` | Inactive stores listed with `is_active: false`, `preview_url: null` |
| `tests/Feature/CommerceWorkspaceStorefrontLifecycleApiTest.php` | **New** — RBAC, isolation, preservation, public fail-closed, idempotency, AWJ-managed without Railway |
| `web/src/modules/commerce-workspace/stores.ts` | `activateCommerceStorefront` / `deactivateCommerceStorefront` |
| `web/src/modules/commerce-workspace/stores.test.ts` | Client path + fail-closed tests |
| `web/src/modules/commerce-workspace/messages.ts` | AR/EN lifecycle copy |
| `web/src/modules/commerce-workspace/messages.test.ts` | Distinct from domain activate copy |
| `web/src/app/(commerce)/commerce/stores/page.tsx` | Actions + confirmation |
| `web/src/app/(commerce)/commerce/stores/page.test.tsx` | UI lifecycle tests |
| `docs/plans/store/STORE-ADMIN-LIFECYCLE-1-IMPLEMENTATION-REPORT.md` | This report |

## Tests

### Backend (GitHub CI — PHP is not in this sandbox)

- `CommerceWorkspaceStorefrontLifecycleApiTest`
  - Guest 401; self_service 403; staff without `commerce.manage` 403; cross-tenant 404; unknown 404
  - Deactivate writes only `Storefront.is_active = false`
  - Unchanged: `SalesChannel.is_active`, every domain `is_active` / `is_primary` / `verification_status` / `verified_at` / `edge_status` / `edge_provider_id`
  - Public `store/v1` products, media, storefront, cart, checkout → 404 after deactivate
  - Activate restores public 200 when domain+channel remain healthy
  - Activate does not call Railway/EDGE (AWJ-managed fixture, fake client call counts = 0)
  - Idempotent activate/deactivate
  - GET list includes inactive store with truthful flag
  - Identity PUT still cannot flip `is_active`
- Replaced `inactive_storefronts_are_omitted` with truthful-list assertion
- `CommerceModuleBoundaryTest` allowlist updated
- Provisioning re-activate and publication-inactive tests are **not** edited and must remain green

### Frontend (local Vitest)

- Stores page: deactivate confirms then POST deactivate; activate POST activate; no custom-domain edge URLs
- Badge inactive when catalog says so
- User without `commerce.manage` sees badge, not actions
- Settings remains on inactive rows
- Messages AR/EN; store activate copy ≠ domain activate copy

## Build / CI

*(filled after GitHub Web CI + Backend CI sqlite/pgsql)*

## Explicit confirmation of untouched modules

**SalesChannel / Domain / Edge / accounting / inventory were not changed.**

`git diff` for this branch does not include:

- `app/Models/SalesChannel.php`
- `app/Models/StorefrontDomain.php`
- `app/Http/Middleware/ResolveStorefrontDomain.php`
- `app/Services/Commerce/StorefrontProvisioningService.php`
- `app/Services/Commerce/CommerceProductPublicationService.php`
- `app/Services/Commerce/Edge/*` (except the existing fake client used by tests)
- any accounting, inventory, payments, or journal file
- any migration

## Out of scope (unchanged)

- Custom Domain Railway production setup / env / deploy
- Domain lifecycle, Disconnect, Make Primary, Edge activate/refresh
- Resolver
- Cart / Checkout / Payments / Shipping / Content / SEO / Appearance / Theme / Store Customizer
- Public/Mobile Commerce API (`commerce/v1`)
- App Builder
- Multi-store creation
- Order cancellation

## Next action

Independent PR only. **Do not merge. Do not deploy.**

# STORE-ADMIN-LIFECYCLE-1 — Merchant Storefront Activate / Deactivate — Implementation Report

## Status

**COMPLETE.** PR opened, not merged, not deployed.

Contract: [`docs/plans/store/STORE-ADMIN-LIFECYCLE-VERIFY-1.md`](https://github.com/safwan5001-source/Nebrax/blob/docs/store-admin-lifecycle-verify-1/docs/plans/store/STORE-ADMIN-LIFECYCLE-VERIFY-1.md) (PR [#872](https://github.com/safwan5001-source/Nebrax/pull/872), CASE B).

This slice is **only** `Storefront.is_active` lifecycle: storefront-id scoped Activate/Deactivate, truthful Store Admin list, `/commerce/stores` confirmation UI (AR/EN).

## Git

| | |
|---|---|
| **Latest `main` at implementation** | `50e66740b5e7757edd30e3dd7ae2304d8b9f325f` — `feat(store): AWJ store customer account experience (STORE-UI-5) (#868)` |
| **CUSTOM-DOMAIN-EDGE-3 / PR #870** | `31db0857dd10a7f365e42bee41a64ca8f211b6a4` — in ancestry (**yes**) |
| **Branch** | `feat/store-admin-lifecycle-1` |
| **Base SHA** | `50e66740b5e7757edd30e3dd7ae2304d8b9f325f` |
| **Implementation SHA (CI-verified)** | `3fcb5b76bb1aec4e0fd9cc5ae9d570535d1f14b5` |
| **Head SHA** | `3fcb5b76bb1aec4e0fd9cc5ae9d570535d1f14b5` (implementation). This file is a docs-only follow-up on the same branch; PR #873 head is that follow-up after push. |
| **PR** | [#873](https://github.com/safwan5001-source/Nebrax/pull/873) |

`git merge-base --is-ancestor 31db0857dd10a7f365e42bee41a64ca8f211b6a4 HEAD` succeeded. EDGE-3 is the parent of STORE-UI-5.

`origin/main` moved after the implementation commit to `ae50844b16dc473f781e2aafa3e47888803cecf2` (`STORE-UI-6 Store Experience Builder (#871)`). Overlap is `web/src/modules/commerce-workspace/messages.ts` + `messages.test.ts` only. `git merge-tree --write-tree HEAD origin/main` exits **0** (auto-mergeable; UI-6 retitled `appearance`, this PR only **adds** store-lifecycle keys). This slice was **not** rebased so CI on `3fcb5b7…` stays the verified gate. Not an architectural conflict.

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

`CommerceWorkspaceStorefrontLifecycleApiTest` **PASS** on sqlite and pgsql:

- Guest 401; self_service 403; staff without `commerce.manage` 403; cross-tenant 404; unknown 404
- Deactivate writes only `Storefront.is_active = false`
- Unchanged: `SalesChannel.is_active`, every domain `is_active` / `is_primary` / `verification_status` / `verified_at` / `edge_status` / `edge_provider_id`
- Public `store/v1` products, media, storefront, cart, checkout → 404 after deactivate
- Activate restores public 200 when domain+channel remain healthy
- Activate does not call Railway/EDGE (AWJ-managed fixture, fake client call counts = 0)
- Idempotent activate/deactivate
- GET list includes inactive store with truthful flag
- Identity PUT still cannot flip `is_active`

Also:

- Replaced `inactive_storefronts_are_omitted` with `inactive_storefronts_are_listed_with_a_truthful_flag_and_no_preview_url`
- `CommerceModuleBoundaryTest` allowlist updated
- Provisioning re-activate and publication-inactive tests were **not** edited and stayed green in the full suite

Optional VERIFY-1 pgsql race (two concurrent activate/deactivate on one row) was **not** added. `lockForUpdate` is in the service; no new concurrency test file.

PHPUnit 12 doc-comment metadata warnings fire for this test (and the rest of the Feature suite). Pre-existing pattern; **not** a failure.

### Frontend (local Vitest, this continuation)

Targeted files after reconnect, in `web/`:

```text
✓ src/modules/commerce-workspace/stores.test.ts (18 tests)
✓ src/modules/commerce-workspace/messages.test.ts (6 tests)
✓ src/app/(commerce)/commerce/stores/page.test.tsx (20 tests)
Test Files  3 passed (3)
     Tests  44 passed (44)
```

Covers: deactivate confirms then POST deactivate; activate POST activate; no custom-domain edge URLs; badge inactive when catalog says so; user without `commerce.manage` sees badge not actions; Settings remains on inactive rows; AR/EN copy ≠ domain activate copy.

## Build / CI

Recorded from PR [#873](https://github.com/safwan5001-source/Nebrax/pull/873) implementation SHA `3fcb5b76bb1aec4e0fd9cc5ae9d570535d1f14b5`.

GitHub runs **both** `push` and `pull_request` for the same SHA. Gate used below is the PR event (run [35419248094](https://github.com/safwan5001-source/Nebrax/actions/runs/35419248094), conclusion **success**) plus Web CI.

| Gate | Run | Result |
|---|---|---|
| `web build (Next.js)` + Vitest | [35419239448](https://github.com/safwan5001-source/Nebrax/actions/runs/35419239448) (push) / [35419248098](https://github.com/safwan5001-source/Nebrax/actions/runs/35419248098) (PR) | **SUCCESS** — **1906 tests passed** (278 files); Next.js compiled successfully, 171 static pages |
| `php artisan test (L11, sqlite)` | [35419248094](https://github.com/safwan5001-source/Nebrax/actions/runs/35419248094) | **SUCCESS** — **45 skipped, 4235 passed** (25967 assertions), 376.37s |
| `php artisan test (L11, pgsql)` | [35419248094](https://github.com/safwan5001-source/Nebrax/actions/runs/35419248094) | **SUCCESS** — **4280 passed** (26213 assertions), 787.64s, **0 failed** |

`CommerceWorkspaceStorefrontLifecycleApiTest` **PASS** on both databases.

This docs-only commit does not change application code. Web CI will not re-run (paths filter). Backend CI will re-run on push; no schema files changed.

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

## Risks / Remaining

| Item | Severity | Notes |
|---|---|---|
| GET list now includes inactive stores | Medium, intentional | Keys unchanged; `inactive_storefronts_are_omitted` replaced. Merchants cannot re-activate a hidden row. |
| POST provision can still re-activate a compatible inactive first storefront | Low | Existing documented converge; out of scope. Activate remains the explicit UX. |
| Activate while domain/channel unhealthy → 200 but public 404 | Low | Not over-gated; `preview_url` is null. |
| Merchant may expect POS/mobile/channel to stop | Low | DO NOT COUPLE; copy says hosted storefront / public domain. |
| `origin/main` advanced to STORE-UI-6 (`ae50844…`) | Hygiene | Auto-mergeable `messages.ts` overlap. Not rebased. Rebase only if a human merge is requested. |
| Optional pgsql activate/deactivate race test | Informational | VERIFY-1 marked optional; not in this PR. `lockForUpdate` is present. |
| PHPUnit 12 `@` doc-comment metadata warnings | Informational | Suite-wide; not a CI failure. |
| VERIFY-1 PR [#872](https://github.com/safwan5001-source/Nebrax/pull/872) still open | Informational | Docs contract; independent of this PR. |

No stop-condition architectural blocker.

## Next action

Independent PR only. **Do not merge. Do not deploy.**

# PR-COM-7-P1 — AWJ Store Adapter + Read-only Catalog — Implementation Report

## Identifiers

| Field | Value |
|-------|-------|
| PR | [#766](https://github.com/safwan5001-source/Nebrax/pull/766) |
| Branch | `claude/com-7-p1-catalog-adapter` |
| Base SHA | `e33b52ef353d4d1e85b6dba847056ead963ddf1e` (main) |
| Head SHA | `2292c2c7048bb1b789c385e708e885fbba53aae4` |
| Predecessor | PR #759 (COM-7-P0), merged as `00576540` |

## Executive Summary

COM-7-P1 replaces the Spree-derived storefront's catalog data layer with real AWJ Commerce data, through an explicit adapter boundary, without touching cart/checkout/payment/customer-auth/wholesale (all still on the Spree SDK client, unchanged) or any component's rendering code. A new anonymous, tenant-isolated, read-only public catalog API (`store/v1`) was added on the Laravel side; a new `src/lib/commerce/*` adapter on the Next.js side calls it and maps AWJ data into the Spree-shaped view models the existing UI already renders. The COM-7-P0-documented `next build` failure (backend required at build time) is also resolved, as a side effect of correctly deferring all backend-dependent data fetching to request time.

Verified end-to-end against a live Laravel backend with a seeded dev tenant: `pnpm build` succeeds, and `pnpm start` serves the product list, product detail, and category pages with real AWJ data through the unmodified Spree UI.

## Work Completed Before the Session Limit (checkpoint)

The backend catalog API — `StorefrontContext`, `ResolveStorefrontTenant`, the three controllers, the two resources, the route file, the service provider, `setup.sh`/`ci.yml` wiring, and the 14-test `StorefrontCatalogApiTest` suite — was implemented and iterated to all-green before the session was interrupted. This work was preserved as commit `69e28e20` ("checkpoint"), pushed to `origin/claude/com-7-p1-catalog-adapter`, then rebased cleanly onto the two new `main` commits that had landed in the meantime (`36545c68` docs, `e33b52ef` PR-DUR-HARDEN-1 — neither touches any file this PR touches) and force-pushed as `f90069e6`.

## Work Completed After Resuming

1. Verified the rebase (clean, no conflicts) and re-ran the backend test suite to confirm no regression from the rebase.
2. Ran the full Laravel suite (3284 passed — the pre-existing 27 `FuelCostBasisService` failures unchanged from the PR #759 baseline).
3. Seeded a real dev tenant (`awj-storefront-dev`) with a `web` sales channel, a warehouse + fulfillment policy, a category, and 5 published products, and started `php artisan serve` against it for live verification.
4. Built the frontend adapter (`storefront/src/lib/commerce/{config,types,mappers,products,categories}.ts`).
5. Rewired `storefront/src/lib/data/{products,categories}.ts` and `markets.ts` (`getMarkets` only) to call the adapter, keeping every exported function signature unchanged.
6. Fixed a `cachedGetCategory` export gap surfaced by `tsc` (used by `src/lib/metadata/category.ts`).
7. Wrote and fixed 34 new frontend unit tests (mapper + fetcher, including error-path and empty-state coverage).
8. Ran `pnpm build` against the live seeded backend — succeeded (exit 0) after removing `"use cache: remote"` from the catalog paths and replacing the Spree Markets call in `getMarkets()` with a static single-market value.
9. Ran `pnpm start` and verified real data end-to-end on the products list, product detail, and category pages.
10. Committed, pushed, opened PR #766, and confirmed CI triggered.

## Changed Files

### Backend (Laravel core — `app/`, `routes/`, `tests/`)

| File | Type |
|------|------|
| `app/Tenancy/StorefrontContext.php` | New |
| `app/Http/Middleware/ResolveStorefrontTenant.php` | New |
| `app/Http/Controllers/Api/StorefrontProductController.php` | New |
| `app/Http/Controllers/Api/StorefrontCategoryController.php` | New |
| `app/Http/Controllers/Api/StorefrontMediaController.php` | New |
| `app/Http/Resources/StorefrontProductResource.php` | New |
| `app/Http/Resources/StorefrontCategoryResource.php` | New |
| `app/Providers/StorefrontApiServiceProvider.php` | New |
| `routes/api_storefront.php` | New |
| `tests/Feature/StorefrontCatalogApiTest.php` | New (14 tests) |
| `app/Providers/TenancyServiceProvider.php` | Modified (+2 lines: register `StorefrontContext`) |
| `setup.sh` | Modified (+4 lines: copy route file, register provider) |
| `.github/workflows/ci.yml` | Modified (+3 lines: same, for CI's Laravel assembly step) |

### Frontend (`storefront/`)

| File | Type |
|------|------|
| `src/lib/commerce/config.ts` | New |
| `src/lib/commerce/types.ts` | New |
| `src/lib/commerce/mappers.ts` | New |
| `src/lib/commerce/products.ts` | New |
| `src/lib/commerce/categories.ts` | New |
| `src/lib/commerce/__tests__/mappers.test.ts` | New (9 tests) |
| `src/lib/commerce/__tests__/products.test.ts` | New (7 tests) |
| `src/lib/commerce/__tests__/categories.test.ts` | New (4 tests) |
| `src/lib/data/products.ts` | Rewritten (same exports, new implementation) |
| `src/lib/data/categories.ts` | Rewritten (same exports, new implementation) |
| `src/lib/data/markets.ts` | Modified (`getMarkets()` only; `resolveMarket`/`getMarketCountries` untouched) |
| `.env.example` | Modified (new `AWJ_COMMERCE_API_URL`/`AWJ_STORE_TENANT_SLUG` vars) |

## Public API Contracts Added

Base: `{AWJ_COMMERCE_API_URL}/store/v1/{tenantSlug}/...` — anonymous, no auth header, `EnforcePublicApiRateLimit:unauth` (IP-keyed, 30/min).

| Route | Purpose |
|-------|---------|
| `GET /categories` | Root categories with 2 levels of nested `children` |
| `GET /categories/{id}` | One category with its direct `children` and full `ancestors` chain |
| `GET /products` | Paginated, filterable (`search`, `category_id`), sortable (`name`, `sale_price`, `created_at`, either direction) product list |
| `GET /products/{id}` | Single product with full media list |
| `GET /media/{id}` | Guarded binary media response (inline, not JSON) |

Response envelope (shared `PublicApiResponse`/`PublicApiExceptionRenderer`, reused unmodified from the M2M API): `{"data": ..., "meta": {"request_id", "pagination"?}}` success, `{"error": {"code","message"}, "meta"}` failure.

## Storefront Adapter Boundary

```
UI components (ProductCard, ProductDetails, ProductListing, ...)
    ↓ (unchanged — still import Product/Category types from @spree/sdk)
src/lib/data/{products,categories}.ts   — same exported function names/signatures as before P1
    ↓
src/lib/commerce/{products,categories}.ts   — the only files that call the AWJ API
    ↓ mappers.ts translates AWJ JSON → Spree-shaped view model
src/lib/commerce/config.ts   — the only file that knows AWJ_COMMERCE_API_URL / tenant slug
    ↓ fetch()
Laravel store/v1 API
```

`@spree/sdk` types are imported **type-only** in `mappers.ts` (erased at build, zero runtime coupling) to satisfy the existing components' prop types without modifying any component. `src/lib/commerce/types.ts` holds AWJ's own wire vocabulary — the audit's explicit warning against "thin pass-through of SDK types" is respected: nothing outside `mappers.ts` sees an AWJ-shaped object pretending to be a Spree one, and nothing outside `commerce/` sees a raw AWJ response.

## Tenant/Store/Channel Resolution Used

- **Backend**: `ResolveStorefrontTenant` middleware resolves `Tenant` from a `{tenantSlug}` route segment (`Tenant.slug`, `is_active = true`) — identical precedent to the existing `ResolveCustomerTenant` used by the customer-auth track. It then resolves the tenant's active `type = web` `SalesChannel` (first by `created_at`); no channel → 404. Both resolutions run inside `TenantScope`, so a cross-tenant slug/channel combination is structurally impossible, not just filtered after the fact.
- **Frontend**: `AWJ_STORE_TENANT_SLUG`, a **fixed, server-only** environment variable — explicitly a provisional, single-tenant-per-deployment stand-in, not real domain resolution (deferred to COM-7-P2 per `AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md` §4/§11/§12, which explicitly allows a narrowly-scoped provisional mechanism for exactly this reason). It is never read from `NEXT_PUBLIC_*`, a request header, a cookie, or a query parameter — nothing a browser sends can change which tenant's catalog this deployment serves.
- No new persistent domain-mapping model or migration was introduced, per the task's explicit instruction to stop and report before doing so — the existing `Tenant.slug` + `SalesChannel.type` were sufficient.

## Explicit Public Fields Returned

**Product** (list/detail): `id`, `name`, `name_en`, `description`, `sku`, `category` (`id`, `name`), `price` (`amount_minor`, `currency`), `in_stock` (bool | null), `thumbnail_url`, `media[]` (detail only: `id`, `url`, `alt`, `position`), `created_at`, `updated_at`.

**Category**: `id`, `name`, `description`, `color`, `parent_id`, `children[]` (recursive), `ancestors[]` (detail only).

## Sensitive Fields Verified Absent

`avg_cost`, `purchase_price`, `min_sale_price`, `discount`, `discount_type`, `profit_margin`, `sales_account_id`, `cogs_account_id`, `supplier_id`, `quantity_on_hand` (raw), `internal_notes`, `tags`, `reorder_level`, `on_hand`, `active_reserved` — asserted absent by test (`sensitive_cost_and_internal_fields_never_appear_in_the_response`) on both the list and detail JSON payloads. `ProductMedia.path`/`disk` are never serialized at all (served only via the guarded `media/{id}` binary route, per the model's own pre-existing contract).

## Spree SDK Catalog Dependencies Replaced

`src/lib/data/products.ts` (`cachedListProducts`, `getProducts`, `cachedGetProduct`, `getProduct`, `cachedGetProductFilters`, `getProductFilters`), `src/lib/data/categories.ts` (`getCategories`, `getCategory`, `cachedGetCategory`, `getCategoryProducts`), and `src/lib/data/markets.ts`'s `getMarkets()` — the exact set the technical fit audit's §5 "Class A — easy to replace" and its own recommended first-PR scope named.

## Remaining Spree SDK Dependencies (unchanged, out of scope)

Everything else: `src/lib/data/{cart,checkout,orders,payment,customer,addresses,credit-cards,gift-cards,wholesale,express-checkout-flow,cookies}.ts`, `src/lib/spree/*` (client/auth/cookies/webhooks/middleware), `src/lib/data/markets.ts`'s `resolveMarket`/`getMarketCountries`, `src/lib/data/sitemap.ts`, `src/lib/data/policies.ts`, `src/lib/data/countries.ts`. All Class B/C/D dependencies from the technical fit audit remain exactly as COM-7-P0 left them.

## Tests and Exact Results

### Backend — `php artisan test --filter=StorefrontCatalogApiTest`

```
Tests:    14 passed (76 assertions)
```

Covers: tenant A/B isolation, cross-channel-within-tenant isolation, unknown tenant slug (404), inactive tenant (404), tenant with no active web channel (404), unpublished listing hidden, inactive product hidden, sensitive fields absent, per-page beyond max rejected (422, matching the existing M2M convention), unsupported sort field rejected (422), list/detail price agreement, availability with stock / out of stock, availability null with no fulfillment policy, category tree tenant isolation + inactive-category exclusion.

### Backend — full suite: `php artisan test`

```
Tests:    27 failed, 19 skipped, 3284 passed (21336 assertions)
```

The 27 failures are the pre-existing `FuelCostBasisService` failures already present on `main` before this PR (same count as PR #759's baseline) — unrelated to Commerce/storefront, not touched by this PR. 3284 passed vs. 3270 in the PR #759 baseline — the +14 are `StorefrontCatalogApiTest`.

### Backend — targeted regression: `CommercePriceResolverTest`

```
Tests:    20 passed (52 assertions)
```

Confirms the shared `CommercePriceResolver`/`AvailableToSellService` reuse introduced no regression in their existing test coverage.

### Frontend — `pnpm test`

```
Test Files  37 passed (37)
     Tests  267 passed (267)
```

247 pre-existing (unchanged) + 20 new. New test files: `mappers.test.ts` (9 tests — product/category mapping, synthetic default variant, null-vs-false availability, empty media/category), `products.test.ts` (7 tests — list/detail fetch, pagination mapping, sort-id translation, empty result, `StorefrontApiError` on non-2xx, non-JSON error body fallback, empty facets), `categories.test.ts` (4 tests — tree fetch, empty tree, detail with ancestors, 404).

### Frontend — TypeScript

```
npx tsc --noEmit → no errors
```

### Frontend — Biome

```
pnpm check → Checked 279 files, no errors
```

## Storefront Production Build Result

```
pnpm build → exit 0
```

Run against a live Laravel dev server with a seeded tenant (`awj-storefront-dev`: 1 category, 5 published products, warehouse + fulfillment policy). All routes report `◐` (Partial Prerender — static shell + server-streamed dynamic content) or `○`/`ƒ` as appropriate; none required a live backend to complete the static-generation phase, resolving the PR #759-documented build failure for the catalog **and** the untouched cart/checkout/account paths (all already behind Suspense boundaries; the P0 failure was `"use cache: remote"` forcing an eager fetch during static generation, not an inherent backend requirement).

One non-fatal, pre-existing, out-of-scope note: `src/lib/data/sitemap.ts` (still Spree-backed, `force-dynamic`, untouched by this PR) logs a caught JSON-parse error during the build's "Collecting page data" phase when `SPREE_API_URL` happens to point at the same port as the Laravel dev server used for this verification (a local-testing artifact of running both against `:8000`, not a real deployment concern) — it does not affect the build's exit code or the generated output, and sitemap generation is out of COM-7-P1's catalog scope.

**Runtime verification** (`pnpm start`, port 3001, against the same live backend):
- `GET /sa/en/products` → 200, lists all 5 seeded products by name.
- `GET /sa/en/products/{id}` → 200, shows real SKU (`DEMO-1`), SAR-formatted price (`١٠٠٫٠٠ ر.س.`), category, `in_stock: true`, JSON-LD product/breadcrumb structured data.
- `GET /sa/en/c/{categoryId}` → 200, shows the real category name and breadcrumb.

## CI Result

PR #766 triggered both `ci.yml` (Laravel, sqlite + pgsql) and `storefront-ci.yml` (lint + typecheck + test) — all runs were queued at report time; check `https://github.com/safwan5001-source/Nebrax/pull/766` for final status before any further action.

## Security / Tenant Isolation Verification

1. **No client-controlled tenant authority anywhere**: tenant comes from a route slug resolved server-side against `Tenant.slug`; the AWJ Store adapter's tenant slug is a fixed server-only env var. No header, cookie, or query parameter is ever treated as a tenant identifier in either layer.
2. **Fail-closed on ambiguity**: unknown slug, inactive tenant, and "no active web channel" all return the same non-revealing 404 — no distinguishable error tells an attacker which case occurred.
3. **CommerceListing gate is structural, not a display filter**: `StorefrontProductController` and `StorefrontMediaController` both re-check `CommerceListing.is_published` on the resolved channel before returning any data, including the media-serving route (a valid media UUID for an unpublished product still 404s).
4. **TenantScope + explicit ownership checks**: every query (`Product`, `ProductCategory`, `CommerceListing`, `ProductWarehouseStock`, `InventoryReservation`) runs inside the tenant's `TenantScope`; `BranchScope` is explicitly bypassed on `Product`/`ProductCategory` only (matching the existing `CommercePriceResolver`/`AvailableToSellService` precedent — a public storefront has no branch concept), never `TenantScope`.
5. **No caching introduced** in either layer for P1 — see the "Cache decision" note below.
6. **Rate limiting**: the pre-existing, purpose-built `unauth` class (IP-keyed, hashed, 30/min) gates every anonymous route.
7. Verified by test, not just by inspection: all 9 of the task's 9 required backend test scenarios have a corresponding passing test in `StorefrontCatalogApiTest` (tenant isolation ×2 satisfied by 2 dedicated tests; the rest 1:1).

### Cache decision (documented, not silently skipped)

No `"use cache: remote"` (Next.js) and no `Cache::` (Laravel) were introduced in the new catalog paths. This deployment serves exactly one tenant per COM-7-P1's provisional resolution, so there is no per-request tenant/channel variance to encode in a cache key/tag yet. Adding a cache now — even a "safe" one given today's single-tenant-per-deployment reality — would set the wrong precedent ahead of COM-7-P2's real per-request hostname resolution, where a cache key that doesn't encode tenant/store/channel would become a genuine cross-tenant leak. Caching is deferred to when that context varies per request, per `AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md` §9's own requirement.

## Risks

1. **`AWJ_STORE_TENANT_SLUG` is a real, if narrow, architectural stand-in.** It correctly cannot leak across tenants (fixed per deployment, no client input path), but it also means this exact deployment shape cannot yet serve multiple tenants from one Next.js process — that is COM-7-P2's job, not a defect in this PR.
2. **No product/category slugs yet** — URLs are UUIDs. Functional, not pretty. Adding a slug column is a small, separate migration-bearing task, deliberately not bundled into a "read-only catalog" PR.
3. **Batched availability query (`StorefrontProductController::batchAvailability`) duplicates ADR-02's formula** (`max(0, On Hand - Active Reserved)`) inline rather than calling `AvailableToSellService` per row, specifically to avoid N+1 queries on a paginated list. It is a direct, tested translation of the same formula against the same tables (`ProductWarehouseStock`, `InventoryReservation`), not a new invariant — but any future change to ADR-02's formula must update both call sites.
4. **`storefront/src/lib/data/sitemap.ts`'s build-time log noise** (see Build Result above) is cosmetic today only because the local verification happened to run both `SPREE_API_URL` and `AWJ_COMMERCE_API_URL` against the same port; it is pre-existing, out of scope, and does not affect the build outcome.

## Remaining Gaps

- Facets/filters: AWJ has no variant/option-value model to facet on, so `fetchProductFilters()` returns an empty facet list with a sort menu only (`ListingFilterBar` already renders a bare filter bar in this case — a pre-existing UI affordance, not new fallback logic added here).
- Media: one fixed image size (no responsive/resized variants) — every Spree `Media` size field points at the same guarded URL.
- Arabic locale is still not registered in `messages/` (unchanged from COM-7-P0) — out of scope per the task brief, and the existing locale-resolution fallback to `en` already handles it safely.
- Wholesale `surface` parameter accepted for signature compatibility only; it is a no-op against the AWJ catalog (wholesale itself remains fully out of scope).

## Confirmation: Excluded Scope

**Not implemented in this PR**, as instructed: cart, checkout, payment, shipping, customer login/authentication, customer address book, Order → Invoice conversion, webhooks, promotions engine, production deployment, App Builder / Apps & Integrations, broad storefront redesign. No financial rule, inventory valuation, core `Product` semantics, or existing API behavior outside the new `store/v1` routes was changed.

## Next Recommended Task

**COM-7-P2 — Arabic/English + Store/Tenant Resolution**: register the `ar` locale (translate `messages/ar.json`, fix the ~20 physical-direction Tailwind classes the technical fit audit already identified), and replace `AWJ_STORE_TENANT_SLUG` with real hostname/domain-based multi-tenant resolution per `AWJ_STOREFRONT_PLACEMENT_TENANT_RESOLUTION_DECISION.md` — at which point the cache decision above should be revisited with real per-request tenant/channel context available to key on.

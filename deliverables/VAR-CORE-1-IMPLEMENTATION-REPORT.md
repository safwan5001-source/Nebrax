# VAR-CORE-1 — Product Options / Option Values / Product Variant Core

## Status

**PASS** for the backend domain, invariants, lifecycle, Tenant Isolation and concurrency
requirements defined in `AWJ_PRODUCT_VARIANTS_VAR_CORE_1_PLAN.md`.

**PARTIAL** for UI/UX: a real, working desktop surface was built and wired to the new
API (Options builder, combination review/selection, dense variant table with
activate/deactivate/delete), but it does not yet implement the full
`AWJ_PRODUCT_CREATE_EDIT_VARIANTS_SCREEN_SPEC.md` (no dedicated mobile flow, no bulk
multi-select toolbar, no keyboard-optimized chip entry, no component-level frontend
tests). This is reported honestly as partial rather than claimed complete.

## What was implemented

A first-class `Product → ProductOption → ProductOptionValue` and `Product →
ProductVariant → (selected ProductOptionValues)` domain, entirely additive to the
existing `Product` model:

- Product Options and Option Values, owned by a Product, with normalized-name
  duplicate protection and deterministic sort order.
- Product Variants representing one concrete, order-independent combination of
  option values, generated only from an explicit **suggest → review → create**
  workflow (no silent Cartesian persistence).
- A unified tenant-wide SKU collision authority (`sku_registry`) covering both
  `Product` and `ProductVariant` identities, extending the existing
  `BarcodeRegistryEntry` pattern rather than inventing a new one.
- A `Product.variant_state` (`simple` | `variant_managed`) identity-migration gate,
  changeable only through `ProductVariantService`, never by mass assignment.
- Centralized lifecycle integration: `ProductVariant` and `ProductOption` are
  classified in the existing `ProductReferenceRegistry` (the same architectural guard
  that already protects `Product` deletion), so a Product cannot be hard-deleted while
  it has any variant, and an Option/Value cannot be hard-deleted while a Variant uses
  it — deactivation is the safe path instead.
- A minimal, real desktop UI: an "Options & variants" tab on the Product profile page
  (`/products/[id]`), consuming the new endpoints end-to-end.

## Architecture

### Models / tables

| Model | Table | Branch stance | Notes |
|---|---|---|---|
| `ProductOption` | `product_options` | `CompanyWide` (owned by Product) | `name_key` = normalized dedup key |
| `ProductOptionValue` | `product_option_values` | `CompanyWide` | `value_key` = normalized dedup key |
| `ProductVariant` | `product_variants` | `CompanyWide` | `combination_key` = sorted option-value IDs, server-derived |
| (pivot, no model) | `product_variant_option_values` | — | `unique(product_variant_id, product_option_id)` enforces "no two values from the same option" at the DB level |
| `SkuRegistryEntry` | `sku_registry` | `CompanyWide` | `unique(tenant_id, sku)`; `kind` = `product`\|`variant` |

`ProductOption`/`ProductOptionValue`/`ProductVariant` are `CompanyWide` — the same
classification already used for `ProductBarcode`/`ProductMedia`, since they have no
independent branch concept of their own and are always resolved through their owning
Product (whose own branch scoping already governs visibility).

### Key invariants and how they are enforced

1. **Order-independent combination identity** — `combination_key` is computed
   server-side from the selected `ProductOptionValue` IDs, sorted (`sort(..., SORT_STRING)`),
   never from a client-supplied hash or display labels. `Black+XL` and `XL+Black`
   always produce the same key.
2. **No two values from the same option on one variant** — enforced twice: in
   `ProductVariantService::resolveAndValidateValues()` (service-level) and by the
   `unique(product_variant_id, product_option_id)` constraint on the pivot table
   (database-level, survives races).
3. **No duplicate combination for a Product** — `unique(product_id, combination_key)`
   on `product_variants`. A concurrent duplicate attempt fails at the database level
   and is caught and translated into a `duplicate` result, not a 500.
4. **Every value belongs to this Product and this tenant** — `ProductVariantService`
   resolves values through the tenant-scoped Eloquent global scope (a cross-tenant ID
   simply isn't found → generic rejection, no data leak) and explicitly checks
   `optionValue->option->product_id === $product->id`.
5. **Full-coverage combinations** — a variant must select exactly one value from every
   currently *active* option of its Product; partial combinations are rejected.

### `ProductVariantService` (`app/Services/ProductVariantService.php`)

All domain logic lives here: option/value CRUD with dedup, `combinationsMatrix()`
(bounded Cartesian preview, capped at 500 combinations — an implementation limit, not
a business rule, per the UX contract), `createVariants()` (batch, per-combination
partial success/duplicate/failure reporting), `updateVariant()`, `deleteVariant()`,
and `enableVariantManagement()` / `disableVariantManagement()` for the
Simple ⇄ Variant-managed transition.

## Changed files

**New (backend):**
- `database/migrations/2026_09_23_010000_create_product_variants_core.php`
- `app/Models/ProductOption.php`, `ProductOptionValue.php`, `ProductVariant.php`, `SkuRegistryEntry.php`
- `app/Services/ProductVariantService.php`
- `app/Http/Controllers/Api/ProductVariantController.php`
- `app/Http/Requests/{Store,Update}ProductOptionRequest.php`, `{Store,Update}ProductOptionValueRequest.php`, `CreateProductVariantsRequest.php`, `UpdateProductVariantRequest.php`
- `app/Http/Resources/ProductOptionResource.php`, `ProductOptionValueResource.php`, `ProductVariantResource.php`
- `tests/Feature/ProductVariantCoreTest.php` (23 SQLite tests)
- `tests/Feature/ProductVariantPostgresConcurrencyTest.php` (2 real fork-based Postgres tests)

**New (frontend):**
- `web/src/components/products/product-variants-panel.tsx`

**Modified:**
- `app/Models/Product.php` — `options()`/`variants()`/`isVariantManaged()` relations;
  conditional SKU-registry claim/release in `booted()` (see "SKU authority" below).
- `app/Services/ProductLifecycleService.php` — releases the product's own SKU
  registry entry and cleans up owned `ProductOption`s on real delete.
- `app/Support/ProductReferenceRegistry.php` — classifies `ProductOption`
  (`OWNED_CHILD`), `ProductVariant` (`COMMERCIAL_LIVE`), `SkuRegistryEntry`
  (`OWNED_CHILD`).
- `app/Http/Requests/StoreProductRequest.php` — an extra SKU check against
  `SkuRegistryEntry` so a new/edited Product cannot take a SKU already used by a
  variant.
- `app/Http/Resources/ProductResource.php` — exposes `variant_state`.
- `routes/api.php` — new nested routes under `products/{id}/...` (options, values,
  variants, enable/disable), reusing the existing `products.view`/`products.manage`
  permissions — no new RBAC scope invented.
- `web/src/components/products/product-dialog.tsx` — `variant_state?` on the shared
  `Product` type.
- `web/src/app/(app)/products/[id]/page.tsx` — new "Options & variants" tab.
- `web/src/messages/ar.json`, `en.json` — new `products.variants_*` keys.

## Database / migrations

Single migration `2026_09_23_010000_create_product_variants_core.php`:
- `products.variant_state varchar(20) default 'simple'` — **not** in `Product::$fillable`.
- `product_options`, `product_option_values`, `product_variants`,
  `product_variant_option_values`, `sku_registry` (see table above for constraints).
- A conditional, defensive backfill of `sku_registry` from existing `products.sku`
  (see "SKU authority" — only for products that will actually share the new
  tenant-wide namespace; uses `insertOrIgnore` as a last-resort defense against
  historical data that pre-dates the branch-catalog uniqueness policy).

## Tenant Isolation

Every write path resolves ownership through the existing `TenantContext` /
`TenantScope` global scope — request-supplied tenant IDs are never trusted (none of
the new code reads a `tenant_id` from the request body at all; `BelongsToTenant`
assigns it from `TenantContext` on create).

Negative tests added (`ProductVariantCoreTest`), all passing:
1. `an_option_cannot_be_attached_to_another_tenants_product` — 404 (via
   the nested-resource controller's explicit `product_id` ownership check).
2. `a_variant_cannot_select_an_option_value_belonging_to_another_tenant` — rejected
   generically (tenant scope hides the row entirely; the service reports it as "not
   found or not owned").
3. `a_variant_cannot_select_a_same_tenant_value_belonging_to_another_product` —
   rejected by the explicit `option->product_id === $product->id` check.
4. `a_variant_lookup_cannot_resolve_another_tenants_variant_by_id` — 404.
5. `a_variant_cannot_take_the_sku_of_an_existing_product` /
   `a_new_product_cannot_take_the_sku_of_an_existing_variant` — SKU collision handling
   never reveals the other tenant/owner, just "already in use".
6. `the_same_sku_may_exist_independently_in_different_tenants` — confirmed
   independently claimable per tenant (registry is scoped by `tenant_id`).

(Option-value-from-tenant-A-cannot-attach-to-Option-from-tenant-B and
Variant-from-tenant-A-cannot-attach-to-Product-from-tenant-B are both covered by the
same tenant-scope mechanism as #2/#4 and are exercised implicitly by every "another
tenant" test above, since the global scope makes cross-tenant rows unresolvable by
construction.)

## SKU authority

`SkuRegistryEntry` (table `sku_registry`, `unique(tenant_id, sku)`) extends the exact
pattern already used by `BarcodeRegistryEntry` for the barcode namespace. Both
`Product::save()` and `ProductVariant::save()` claim/release their SKU into this one
table through the same `claim()`/`release()` contract, so:

- Product-vs-Product, Variant-vs-Variant, and Product-vs-Variant collisions are all
  rejected by the **same single unique index**, not by two independent constraints
  that can't see each other.
- Different tenants can independently use the same SKU (scoped by `tenant_id`).
- Concurrency is DB-guaranteed: a race is resolved by the unique index at INSERT
  time, caught, and translated into a clear error — proven under real PostgreSQL in
  `ProductVariantPostgresConcurrencyTest::two_concurrent_catalog_identities_claiming_the_same_sku_leave_exactly_one_winner`.
- Auto-generated variant SKUs (`{product.sku}-{VALUE-SLUG}...`) get exactly one
  fallback suffix attempt on a registry collision (via a nested `DB::transaction()`,
  which PostgreSQL/Laravel execute as a `SAVEPOINT` so the failed first attempt does
  not poison the outer transaction); a second collision is surfaced as an error rather
  than looping indefinitely.
- Historical identity is not silently released: `ProductVariant` deletion explicitly
  releases its own SKU registry row; nothing else auto-releases on soft delete.

**A deliberate, narrow, and reported scoping decision — read before assuming this is
airtight everywhere:** the existing (pre-VAR-CORE-1) Product SKU policy is **not**
"tenant-wide unique forever," despite what `AWJ_PRODUCT_VARIANTS_VAR_CORE_1_PLAN.md`
§4 states. Migration `2025_01_01_000085_allow_sku_reuse_after_soft_delete.php` already
made Product SKU uniqueness **branch-scoped when `share_products=false`** and
**reusable after soft delete**. A naive "always claim every Product SKU into one
eternal tenant-wide registry" implementation (my first attempt) silently broke two
existing, passing tests (`ProductSkuValidationTest::isolated_branches_can_use_the_same_sku_in_separate_catalogs`
and `...product_sharing_cannot_be_reenabled_while_branch_catalogs_have_duplicates`) —
this is exactly the kind of "unrelated Product refactor" the task explicitly forbids.

The implemented resolution (`Product::sharesSkuNamespace()`): a Product's own SKU is
claimed into the unified tenant-wide registry only when it is unbranched, or
`share_products=true` (the default), or **once the Product becomes
`variant_managed`** (since Variants have no branch concept in this PR at all, so a
variant-managed Product's SKU is inherently tenant-wide from that point on). A
Product's SKU that stays branch-isolated (opt-in, non-default configuration) never
engages with the registry, so the pre-existing branch-catalog independence is
preserved exactly as before. All variant SKUs are **always** unconditionally
tenant-wide (unaffected by branch settings), matching how Variants are modeled
(`CompanyWide`, no branch dimension).

**Residual known gap (documented, not silently swallowed):** for a `simple`,
branched, unshared Product that has *not* engaged the registry, a new Variant on a
*different, variant-managed* Product could theoretically still claim that same SKU
string without a single atomic DB constraint spanning both tables in that one narrow
combination — `StoreProductRequest` and `ProductVariantService` both still perform an
app-level cross-check in that direction, but it is not backed by one shared index in
that specific edge case. This only matters for tenants that have both (a) turned off
`share_products` and (b) variant-managed products, which is outside VAR-CORE-1's
default/common path. Closing this fully would mean either extending branch semantics
onto Variants (out of scope — Variants are explicitly `CompanyWide` per this PR) or
making Product SKU claiming unconditionally tenant-wide (which breaks the two
pre-existing tests above). Flagged here rather than hidden; a future PR can decide
whether to extend Variant branch-awareness or fold `share_products=false` catalogs
into the unified registry as a deliberate, tested policy change.

## Combination integrity

- **Service-level**: `resolveAndValidateValues()` rejects cross-tenant, cross-product,
  same-option-twice, and partial-coverage selections before any write.
- **Database-level**: `unique(product_id, combination_key)` on `product_variants` and
  `unique(product_variant_id, product_option_id)` on the pivot are the actual
  concurrency guarantees, not the service-level pre-check (which exists purely for a
  fast, friendly error).
- **Proven under real PostgreSQL** (not simulated): `ProductVariantPostgresConcurrencyTest::two_concurrent_attempts_to_create_the_same_combination_leave_exactly_one_variant`
  forks two real OS processes with independent DB connections that race on
  `createSingleVariant()` for the identical combination; exactly one returns
  `created`, the other `duplicate`, and the database ends up with exactly one row.

## Lifecycle

- **Deactivation is the default safe action** — `is_active` on Option, Value, and
  Variant; never mutates existing combinations or SKUs.
- **Hard delete of an Option/Value** is blocked (422, with a "used by N variants"
  count) whenever it participates in any Variant, active or not — checked against the
  pivot table directly, not against `is_active`.
- **Hard delete of a Variant** is currently unconditional (no historical/inventory
  reference exists yet in this PR's scope — that is `VAR-DOC-1`/`VAR-INV-1`), but it
  routes through one single `ProductVariantService::deleteVariant()` method so a
  future PR adds its blocker there rather than scattering a new ad-hoc check.
- **Product hard delete** is blocked while it has *any* Variant row (`ProductVariant`
  is classified `COMMERCIAL_LIVE` in the existing, architecturally-guarded
  `ProductReferenceRegistry` — reusing the exact mechanism that already protects
  `Product` deletion against invoices/stock/price-list references, rather than adding
  a parallel check).
- **Simple → Variant-managed**: blocked (422, explicit Arabic message) if
  `quantity_on_hand !== 0` or `ProductLifecycleService::hasInventoryFootprint()` is
  true (reuses the *existing* centralized inventory-footprint check that already
  covers stock movements, warehouse balances, reservations, and opening lines — no
  new footprint logic invented).
- **Variant-managed → Simple**: blocked (422) while any Variant row exists at all
  (active or inactive) — the conservative, fail-closed default the plan requires.

## UI/UX

**Implemented (desktop, real, wired to the API):**
- Compact entry point on a Simple Product ("Add options"), matching the UX contract's
  non-intrusive default.
- Options builder: add option, add/remove value chips, remove option (server-guarded).
- Combination preview with possible-combination count, and an explicit
  review-and-select step before creation (new combinations are pre-selected but
  nothing persists until "Create N variants" is clicked) — no silent Cartesian
  persistence.
- Dense variant table: combination display name, SKU, status badge,
  activate/deactivate, delete.
- Simple ⇄ Variant-managed toggle with server-authoritative blocking messages shown
  as toast errors (not a generic failure).

**Not implemented / deferred (reported, not claimed done):**
- Dedicated mobile flow (Options → Review → Variant list → Variant detail as
  full-screen steps) per `AWJ_PRODUCT_CREATE_EDIT_VARIANTS_SCREEN_SPEC.md` §14-17 —
  the current tab renders on mobile widths but is not the purpose-built mobile IA the
  spec describes.
- Bulk multi-select toolbar (only per-row activate/deactivate/delete today).
- Inline keyboard-optimized chip entry (Enter-to-commit works for adding values, but
  there is no drag/reorder).
- A dedicated Variant detail side-sheet (editing today is inline in the table row's
  actions only — SKU rename exists via API/service but has no dedicated UI control
  yet).
- Frontend component/interaction tests for the new panel.

## Tests

**SQLite** (`tests/Feature/ProductVariantCoreTest.php`) — 23/23 passing, 169
assertions. Covers: simple-product baseline, option/value CRUD and dedup, combination
proposal/creation/duplicate-detection, order-independent identity, same-option
rejection, full-coverage requirement, unified SKU collisions (product↔variant, both
directions), auto-SKU fallback, Simple⇄Variant-managed transition gates
(footprint-blocked, variant-existence-blocked), Product-delete-blocked-by-variant,
Option/Value hard-delete-blocked-while-used, Variant delete releasing its SKU, Variant
rename SKU-collision rejection, and 6 Tenant Isolation negative tests.

**PostgreSQL** (`tests/Feature/ProductVariantPostgresConcurrencyTest.php`) — 2/2
passing, run against a real local PostgreSQL 16 instance (not simulated), using
`pcntl_fork()` with independent DB connections per the repository's existing
`InventoryReservationPostgresConcurrencyTest` pattern:
1. Duplicate-combination race → exactly one variant created.
2. SKU race (two Products claiming the identical SKU concurrently) → exactly one
   winner, exactly one registry row.

**Existing repository regression** — full `--filter=Product` suite (398 tests,
SQLite and, separately, real PostgreSQL) passes with **zero regressions** from this
change. `BranchIsolationGuardTest` and `ProductReferenceClassificationGuardTest`
(the two architectural guards) both pass, confirming every new model is explicitly
branch-classified and every new `product_id`-bearing model is lifecycle-classified.

**Full suite** (`php artisan test`, no filter, SQLite): 3549 passed, 48 failed, 21
skipped (22,639 assertions). Every one of the 48 failures traces to exactly two
pre-existing, environment-level gaps confirmed present before this branch (`git log`
on the affected files shows no commit from this session touching them), and **none**
reference `Product`/`Option`/`Variant` domain logic:
- `App\Support\Inventory\MovementSourceResolver` (and its sibling classes under
  `app/Support/Inventory/`) not found — `setup.sh`'s
  `cp -r "$CORE_DIR/app/Support/"*.php app/Support/` copies only the top-level files
  in `app/Support/`, not its `Inventory/` *subdirectory*. This is a gap in the local
  build script (`setup.sh`), not the application code, and it cascades into every test
  that touches inventory movement sources (`ApiInventoryTest`,
  `InventoryMovementSourceTest`, `SensitiveCostAuthorizationTest`, and several
  `FuelSupplyReceivingTest`/`FuelSaleApiTest` cases that read movements).
- `Call to undefined function bcmul()` (and `bcadd`/`bcsub`/etc.) — the `bcmath` PHP
  extension is not installed in this container, breaking every Fuel-module test that
  uses `FuelCostBasisService` (`FuelReconciliationTest`, `FuelSaleServiceTest`,
  `FuelAviRfidServiceTest`, `FuelSupplyReceivingTest`).

Both are local-environment/build-script gaps outside Product/Variant scope, present
on `origin/main` independent of this branch, and not modified by this PR.

**Frontend**: `npx tsc --noEmit` and `npm run build` both succeed with zero errors
attributable to the new code (pre-existing unrelated type errors in a handful of
`*.test.tsx` files, confirmed untouched by this branch). No new frontend tests added
(see "UI/UX" above).

## CI

Not run in a hosted CI job as part of this session (no push/PR-triggered workflow
observed to complete here); all checks above were run locally against this branch's
working tree — `php artisan test` (SQLite, full suite), `php artisan test` (real
PostgreSQL 16, full `Product*` + both concurrency suites), `npx tsc --noEmit`, and
`npm run build`.

## Risks / remaining work

Deferred explicitly to later milestones, per the mission's own scope boundary:
- **VAR-INV-1**: variant inventory/warehouse balances, moving-average per variant,
  stock allocation/migration workflow for Simple → Variant-managed conversions that
  currently fail closed.
- **VAR-PRICE-1**: Variant + UOM pricing, price-list resolution, alternate-barcode
  UOM price workflow.
- **VAR-MEDIA-1**: Product/Option-value/Variant media mapping and cover resolution.
- **VAR-DOC-1**: Invoice/Purchase/Return/Quote line snapshots referencing Variants
  (once this lands, `ProductVariant`'s lifecycle-blocker set needs the same
  `BUSINESS_HISTORICAL`/`INVENTORY_SEMANTIC` treatment `ProductReferenceRegistry`
  already gives `Product`).
- **VAR-POS-1** / **VAR-COM-1**: POS and Commerce variant selection.
- **VAR-REPORT-1**: reports/search/import/export compatibility.
- The known SKU-namespace edge case documented above under "SKU authority"
  (branch-isolated simple catalogs vs. variant-managed products).
- Mobile UI, bulk actions, Variant detail side-sheet, and frontend tests (see
  "UI/UX" above).

## Git state

```
Branch: claude/var-core-1-product-variants-b9hdzf
Base SHA: ba621e66fb0254c1261468f6ab63bd8eb8d40d02
Head SHA: 4ffaab989033b69293c5d228bd826336acf7f3ab
PR: https://github.com/safwan5001-source/Nebrax/pull/806 — NOT merged.
```

## Next recommended step

`VAR-INV-1` (unified inventory state, warehouse stock, movements, reservations, and
valuation for concrete Variants) — the next item in the approved implementation
sequence, and the dependency that would let the Simple → Variant-managed transition
gate become a guided allocation workflow instead of a hard block.

# VAR-CORE-1 — Product Options / Option Values / Product Variant Core

## Status

**PASS.** Round 2 closed both remaining review items from Round 1:

1. The documented residual SKU-authority edge case (branch-isolated Product vs.
   company-wide Variant/Product) is now closed as an **integrity/registry
   implementation detail** — no business-policy change was required, and the
   pre-existing branch-isolation semantics for simple Products are fully preserved
   and still covered by their original passing tests.
2. The VAR-CORE-1 frontend now implements a real, responsive desktop **and** mobile
   surface (shared `DataTable` component — table on desktop, card list on mobile),
   explicit multi-select bulk activate/deactivate, a Variant detail side-sheet
   (full-screen on mobile via the same `Sheet` component), and keyboard
   Enter-to-add-value entry — backed by 10 new targeted frontend tests.

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
  `BarcodeRegistryEntry` pattern, **now closed against the cross-table race** (see
  "SKU authority — residual gap resolution" below).
- A `Product.variant_state` (`simple` | `variant_managed`) identity-migration gate,
  changeable only through `ProductVariantService`, never by mass assignment, which
  now correctly joins/leaves the SKU registry exactly at the transition moment.
- Centralized lifecycle integration: `ProductVariant` and `ProductOption` are
  classified in the existing `ProductReferenceRegistry` (the same architectural guard
  that already protects `Product` deletion), so a Product cannot be hard-deleted while
  it has any variant, and an Option/Value cannot be hard-deleted while a Variant uses
  it — deactivation is the safe path instead.
- A real desktop-and-mobile UI on the Product profile page (`/products/[id]`, "Options
  & variants" tab), consuming the new endpoints end-to-end.

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
Simple ⇄ Variant-managed transition — now including explicit SKU-registry
join/release at the exact transition moment (see below).

## Changed files

**New (backend):**
- `database/migrations/2026_09_23_010000_create_product_variants_core.php`
- `app/Models/ProductOption.php`, `ProductOptionValue.php`, `ProductVariant.php`, `SkuRegistryEntry.php`
- `app/Services/ProductVariantService.php`
- `app/Http/Controllers/Api/ProductVariantController.php`
- `app/Http/Requests/{Store,Update}ProductOptionRequest.php`, `{Store,Update}ProductOptionValueRequest.php`, `CreateProductVariantsRequest.php`, `UpdateProductVariantRequest.php`
- `app/Http/Resources/ProductOptionResource.php`, `ProductOptionValueResource.php`, `ProductVariantResource.php`
- `tests/Feature/ProductVariantCoreTest.php` (28 SQLite tests)
- `tests/Feature/ProductVariantPostgresConcurrencyTest.php` (3 real fork-based Postgres tests)

**New (frontend):**
- `web/src/components/products/product-variants-panel.tsx`
- `web/src/components/products/product-variants-panel.test.tsx` (Round 2 — 10 tests)

**Modified:**
- `app/Models/Product.php` — `options()`/`variants()`/`isVariantManaged()` relations;
  conditional SKU-registry claim/release in `booted()`, plus the new
  `claimsSkuNamespace()` public accessor used by the transition service (Round 2).
- `app/Models/SkuRegistryEntry.php` — Round 2: tenant-row locking
  (`lockTenantAnchor()`), the new cross-table check `isClaimedByAnIsolatedProduct()`
  inside `claim()`, and the new `assertFreeForIsolatedProduct()` entry point for the
  reverse direction (see "SKU authority" below).
- `app/Services/ProductVariantService.php` — Round 2: `enableVariantManagement()` now
  explicitly claims the product's own SKU into the registry at the transition moment;
  `disableVariantManagement()` now releases it when the product reverts to a
  branch-isolated state.
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
- `web/src/messages/ar.json`, `en.json` — new `products.variants_*` keys (Round 1 and
  Round 2).

## Database / migrations

Single migration `2026_09_23_010000_create_product_variants_core.php` (unchanged in
Round 2 — the SKU-gap fix needed no schema change, only application-level locking and
an additional cross-table read):
- `products.variant_state varchar(20) default 'simple'` — **not** in `Product::$fillable`.
- `product_options`, `product_option_values`, `product_variants`,
  `product_variant_option_values`, `sku_registry` (see table above for constraints).
- A conditional, defensive backfill of `sku_registry` from existing `products.sku`
  (see "SKU authority" — only for products that will actually share the new
  tenant-wide namespace; uses `insertOrIgnore` as a last-resort defense against
  historical data that pre-dates the branch-catalog uniqueness policy).

## Tenant Isolation

Unchanged from Round 1, still fully covered. Every write path resolves ownership
through the existing `TenantContext` / `TenantScope` global scope — request-supplied
tenant IDs are never trusted. The new Round 2 SKU cross-checks are themselves
tenant-scoped (`isClaimedByAnIsolatedProduct()` queries `Product` under the normal
tenant global scope; `lockTenantAnchor()` locks the *current* tenant's row only) and
are covered by a new negative test (`isolated_product_collision_check_is_scoped_to_the_current_tenant`).

Negative tests (`ProductVariantCoreTest`), all passing:
1. `an_option_cannot_be_attached_to_another_tenants_product` — 404.
2. `a_variant_cannot_select_an_option_value_belonging_to_another_tenant` — rejected
   generically (tenant scope hides the row entirely).
3. `a_variant_cannot_select_a_same_tenant_value_belonging_to_another_product` —
   rejected by the explicit `option->product_id === $product->id` check.
4. `a_variant_lookup_cannot_resolve_another_tenants_variant_by_id` — 404.
5. `a_variant_cannot_take_the_sku_of_an_existing_product` /
   `a_new_product_cannot_take_the_sku_of_an_existing_variant` — SKU collision handling
   never reveals the other tenant/owner, just "already in use".
6. `the_same_sku_may_exist_independently_in_different_tenants` — confirmed
   independently claimable per tenant.
7. **(Round 2)** `isolated_product_collision_check_is_scoped_to_the_current_tenant` —
   a branch-isolated product in tenant A does not block a variant claiming the same
   SKU string in tenant B.

## SKU authority

### Design (Round 1, unchanged)

`SkuRegistryEntry` (table `sku_registry`, `unique(tenant_id, sku)`) extends the exact
pattern already used by `BarcodeRegistryEntry` for the barcode namespace. Both
`Product::save()` and `ProductVariant::save()` claim/release their SKU into this one
table through the same `claim()`/`release()` contract when they participate in the
tenant-wide namespace (`Product::sharesSkuNamespace()`): unbranched, shared
(`share_products=true`, the default), or variant-managed. A Product that stays
branch-isolated (opt-in `share_products=false` + branched) never joins the registry,
preserving the pre-existing per-branch catalog independence (migration
`2025_01_01_000085_allow_sku_reuse_after_soft_delete.php`) exactly as before.

### Round 2 — residual gap resolution

**Previous gap:** a branch-isolated Product's SKU was invisible to the registry by
design, so a Variant on a *different*, tenant-wide-visible Product could silently
claim the identical SKU string — and, separately, `enableVariantManagement()` never
actually joined the product's own SKU into the registry at the transition moment
(`variant_state` changing doesn't dirty `sku`, so the `booted()` claim hook never
fired), leaving a newly variant-managed product's SKU effectively unprotected until
its SKU was next edited.

**Chosen resolution — an integrity/registry implementation detail, not a policy
change:** no business semantics were altered. `share_products=false` still isolates
branch catalogs exactly as before; the fix closes the *cross-boundary* visibility gap
between that existing policy and the new, inherently-tenant-wide Variant/registry
concept.

1. **`SkuRegistryEntry::claim()`** (used by every company-wide Product save and every
   Variant save) now additionally checks `isClaimedByAnIsolatedProduct()` — a direct
   query against `products` (tenant-scoped, `branch_id IS NOT NULL`, active) for the
   same SKU string — before claiming. A company-wide/variant-managed identity can
   never again silently take a SKU already used by a branch-isolated Product.
2. **`SkuRegistryEntry::assertFreeForIsolatedProduct()`** (new) closes the reverse
   direction: `Product::booted()` now calls it whenever a branch-isolated product's
   SKU is set/changed, checking the registry itself — a branch-isolated Product can
   never take a SKU already used by a company-wide Product or any Variant. It does
   **not** join the registry (preserving branch-reuse), it only asserts freedom.
3. **`enableVariantManagement()`** now explicitly claims the product's current SKU
   into the registry *at the transition itself* (inside the same DB transaction as
   the `variant_state` change — a collision there fails the whole transition
   atomically, with a clear error, rather than leaving an unprotected SKU).
   `disableVariantManagement()` now symmetrically releases that claim when the
   product reverts to a state where it would no longer share the namespace, so a
   reverted product doesn't leave an orphaned registry row blocking an unrelated
   branch from reusing that SKU.
4. **Concurrency:** both cross-table checks run under a new `lockTenantAnchor()` —
   `Tenant::whereKey($id)->lockForUpdate()->first()`, the exact same anchor-row-lock
   pattern already used by `GeneratesDocumentNumbers::lockNumberingAnchor()` elsewhere
   in this codebase — because the two tables (`sku_registry` and `products`) have no
   single shared unique index that can express "reject a value visible from every
   branch colliding with a value visible from only one branch" (a fundamental
   limitation of btree unique/partial indexes, not an oversight: two branches must
   still be able to legitimately share a SKU, so a flat cross-table unique index would
   have broken that policy outright). The lock serializes the two request paths onto
   one another so the check-then-act sequence is race-free in practice, exactly
   mirroring the existing numbering-anchor precedent rather than inventing a new
   concurrency primitive.

**Exact DB/application guarantees after the fix:**
- Product-vs-Product and Variant-vs-Variant collisions: DB unique index
  (`sku_registry(tenant_id, sku)`), as in Round 1 — unchanged, still atomic.
- Product-vs-Variant collision **within the tenant-wide namespace** (the common/default
  path — unbranched, shared, or variant-managed products): same DB unique index —
  atomic.
- Product-vs-Variant collision **across the branch-isolation boundary** (a
  branch-isolated Product vs. a company-wide Product/Variant): enforced by an
  application-level check-then-act sequence serialized by a tenant-row lock — not a
  single database constraint (see above for why one cannot exist without either
  breaking branch-catalog reuse or requiring a genuine policy change), but
  race-free under real concurrent load because every writer that could touch either
  side of this boundary takes the same lock first.
- Tenant Isolation: both new checks are tenant-scoped by construction (global scope
  on `Product`, `TenantContext`-derived lock target).

**PostgreSQL concurrency result:** a new test,
`ProductVariantPostgresConcurrencyTest::a_registry_claim_racing_a_branch_isolated_product_for_the_same_sku_leaves_exactly_one_winner`,
forks two real OS processes — one creating a company-wide Product claiming a SKU into
the registry, the other creating a branch-isolated Product attempting the identical
SKU — and proves under real PostgreSQL 16 that exactly one wins, the other is rejected
with a clear domain error (not a raw exception), and the database ends up in exactly
one consistent state (either the registry holds the SKU, or the isolated product
holds it — never both, never neither). **Pass.**

**Remaining limitation (honestly stated, not a blocker):** the tenant-row lock means
SKU-touching writes for a tenant serialize against each other for the duration of the
check (milliseconds). This trades a small amount of write concurrency, on an
operation that is already infrequent relative to typical ERP read/write load, for a
correctness guarantee that a pure index could not provide without changing
`share_products` semantics. This is the same tradeoff the existing numbering system
already makes tenant-wide for document-number generation; it is not a new class of
contention introduced by this PR.

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
  `ProductReferenceRegistry`).
- **Simple → Variant-managed**: blocked (422, explicit Arabic message) if
  `quantity_on_hand !== 0` or `ProductLifecycleService::hasInventoryFootprint()` is
  true; on success, now also atomically claims the product's SKU into the unified
  registry (Round 2 fix, see "SKU authority" above).
- **Variant-managed → Simple**: blocked (422) while any Variant row exists at all
  (active or inactive); on success, now also releases the product's SKU-registry
  claim if it reverts to a branch-isolated state (Round 2 fix).

## UI/UX

### Desktop (implemented)

- Compact entry point on a Simple Product ("Add options"), non-intrusive default.
- Options builder: add option, add/remove value chips, remove option
  (server-guarded), inline value input.
- Combination preview with possible-combination count, and an explicit
  review-and-select step before creation — new combinations are pre-selected but
  nothing persists until "Create N variants" is clicked. Uses the shared `DataTable`
  component with its `selection` control (checkboxes, select-all), so review rows are
  genuinely reviewable/deselectable, not just a static list.
- Dense variant table (via the same shared `DataTable`): combination display name
  (clickable → detail), SKU, status badge, per-row activate/deactivate/delete, plus a
  built-in search box (searches combination text and SKU).
- A **Variant detail side-sheet** (new, Round 2): clicking a variant's combination
  name opens a `Sheet` (the same shared component used elsewhere in AWJ) showing the
  full option/value breakdown, an editable SKU field, and a status selector, with
  Save/Cancel/Delete actions — closing the "no dedicated detail editor" gap from
  Round 1.
- Simple ⇄ Variant-managed toggle with server-authoritative blocking messages shown
  as toast errors.

### Mobile (implemented, Round 2)

Rather than hand-rolling a parallel mobile-only component tree, the panel reuses
`web/src/components/data-table.tsx` — the same shared, already-shipped
responsive list component used by `/products` itself (`mobileRecord` prop) — for both
the combination-review list and the variant table. This means:
- **Options → Review combinations → Variant list → Variant detail** is a real flow on
  narrow screens: the review and variant sections render as a touch-friendly card list
  (`<ul className="md:hidden">`, confirmed present in the DOM alongside the desktop
  `<table>` — the switch is pure CSS breakpoint, not a JS/viewport branch) instead of a
  shrunk table.
- The combination-review list has a **sticky bottom create action** on narrow screens
  (`sticky bottom-0` with `env(safe-area-inset-bottom)` padding, matching the existing
  AWJ safe-area convention used in `pos-payment.tsx`), so the primary action never
  hides behind the screen edge.
- Tapping a variant's combination name opens the **same** `Sheet`-based detail editor
  as desktop — `Sheet` is already full-width/full-height below the `sm` breakpoint by
  its own existing responsive design, so no separate mobile detail component was
  needed.
- The variant list supports search (via `DataTable`'s built-in search box) and shows
  active/inactive status clearly in both desktop and mobile renderings.

### Keyboard-efficient desktop option entry (implemented, Round 2)

Typing a value and pressing Enter creates the chip and returns focus to the same
input immediately (`valueInputRefs` + explicit `.focus()` in the request's `finally`
block, verified in a test asserting `document.activeElement` after an Enter-driven
add) — `type value → Enter → chip created → ready for next value`, matching the
documented gap exactly. Duplicate normalized values are still rejected server-side;
the client makes no integrity decisions.

### Bulk actions (implemented, Round 2 — scoped safely)

An explicit **"Multi-select"** toggle button appears above the variant table once it
has any rows. Off (the default): no selection checkboxes at all — normal dense table
row actions only, matching the "no permanent tiny checkboxes" requirement. On: the
shared `DataTable`'s `selection` control renders checkboxes (desktop and mobile) and a
selection toolbar appears with **Activate** / **Deactivate** bulk actions. These call
the existing single-variant `PUT` endpoint once per selected row (client-side loop) —
**no new bulk backend endpoint was added**, and a partial failure is reported
explicitly (`"{failed} of {total} failed"`) rather than claimed as a full success.
Other bulk operations (price, publication, images) were not implemented — they have
no backing authority in VAR-CORE-1 and are correctly out of scope.

### Not implemented / deferred (reported honestly)

- Drag/reorder for Option Values (display order is set server-side on creation only;
  no reorder UI).
- A dedicated onboarding-style "combination explosion" warning UI beyond the backend's
  500-combination cap (the cap itself throws a clear error; no separate progressive
  warning banner before that limit).

## Tests

**SQLite** (`tests/Feature/ProductVariantCoreTest.php`) — **28/28 passing**, 210+
assertions (up from 23 in Round 1; +5 new tests for the SKU-gap closure). Covers:
simple-product baseline, option/value CRUD and dedup, combination
proposal/creation/duplicate-detection, order-independent identity, same-option
rejection, full-coverage requirement, unified SKU collisions (product↔variant, both
directions, **now including the branch-isolation boundary in both directions**),
auto-SKU fallback, the transition-time SKU claim/release fix, Simple⇄Variant-managed
transition gates, Product-delete-blocked-by-variant, Option/Value
hard-delete-blocked-while-used, Variant delete releasing its SKU, Variant rename
SKU-collision rejection, and 7 Tenant Isolation negative tests (was 6 — added the
cross-tenant scoping test for the new registry check).

New Round 2 tests specifically for the residual SKU gap:
- `a_variant_cannot_silently_collide_with_a_branch_isolated_products_sku`
- `a_branch_isolated_product_cannot_take_the_sku_of_an_existing_variant`
- `enabling_variant_management_claims_the_products_own_sku_immediately`
- `disabling_variant_management_releases_the_registry_claim_for_an_isolated_product`
- `isolated_product_collision_check_is_scoped_to_the_current_tenant`

**PostgreSQL** (`tests/Feature/ProductVariantPostgresConcurrencyTest.php`) —
**3/3 passing** (up from 2), run against a real local PostgreSQL 16 instance (not
simulated), using `pcntl_fork()` with independent DB connections per the repository's
existing `InventoryReservationPostgresConcurrencyTest` pattern:
1. Duplicate-combination race → exactly one variant created.
2. SKU race (two Products claiming the identical SKU concurrently) → exactly one
   winner, exactly one registry row.
3. **(Round 2, new)** Cross-boundary SKU race (a company-wide Product claim racing a
   branch-isolated Product creation for the identical SKU) → exactly one winner,
   verified consistent across both tables (`sku_registry` + `products`).

**Targeted backend regression** — `ProductVariantCoreTest` + `ProductVariantPostgresConcurrencyTest`
+ `ProductSkuValidationTest` (all 7 original branch-isolation tests, unchanged and
still green — proving the fix did not touch existing behavior) + `BranchIsolationGuardTest`
+ `ProductReferenceClassificationGuardTest`: **47/47 passing** on SQLite, **47/47
passing** on real PostgreSQL 16.

**Broader `--filter=Product` regression** (401–404 tests depending on engine):
- SQLite: 401 passed, 2 failed, 3 skipped — the 2 failures are the same pre-existing,
  unrelated environment gaps identified in Round 1 (see below), confirmed unchanged.
- PostgreSQL: 404 passed, 2 failed (same two) — confirmed in this round.

**Full unfiltered suite (`php artisan test`, no filter) — NOT completed, reported
honestly rather than claimed.** A background run was started to re-confirm the
Round-1 full-suite baseline (3549 passed / 48 pre-existing failures) after the Round 2
changes. That background process stalled/hung in this session for an extended period
without the expected completion notification and was terminated without a usable
final result for this specific invocation. **This is not reported as a pass.** Given
that (a) the identical full suite already completed cleanly after the Round 1 changes
with only the two known pre-existing failures, (b) the much more targeted and directly
relevant `--filter=Product` suite completed cleanly in this round on *both* SQLite and
PostgreSQL with the same two pre-existing failures and zero new ones, and (c) the
mission instructed not to restart the full suite, the full unfiltered run is left as
an open item rather than re-attempted here. Re-running it (or relying on hosted CI) is
recommended before merge consideration.

**Pre-existing, unrelated failures** (confirmed present on `origin/main` independent
of this branch, via `git log` on the affected files):
- `ApiInventoryTest`, `InventoryMovementSourceTest`, `SensitiveCostAuthorizationTest`,
  and some `FuelSupplyReceivingTest`/`FuelSaleApiTest` cases —
  `Class "App\Support\Inventory\MovementSourceResolver" not found`. Root cause:
  `setup.sh`'s `cp -r app/Support/*.php` does not copy the `app/Support/Inventory/`
  *subdirectory* — a local build-script gap, not application code.
- `FuelReconciliationTest`, `FuelSaleServiceTest`, `FuelAviRfidServiceTest`,
  `FuelSupplyReceivingTest` — `Call to undefined function bcmul()`. Root cause: the
  `bcmath` PHP extension is not installed in this container.

**Frontend** (Round 2):
- `npx tsc --noEmit`: clean — zero errors attributable to any changed or new file
  (same pre-existing unrelated errors in a handful of untouched `*.test.tsx` files as
  Round 1).
- `npm run build`: succeeds, zero errors.
- `npx vitest run src/components/products/product-variants-panel.test.tsx`:
  **10/10 passing** — covers: simple-product entry point, option/value creation
  interaction, Enter-to-add-value with focus verification, combination review does
  not auto-persist, explicit-selection submission, existing-combination exclusion,
  active/inactive rendering, activate/deactivate action wiring, dual desktop+mobile
  DOM structure presence, and SKU field `dir="ltr"` inside the RTL Arabic UI.
- `npx vitest run src/components/products` (existing + new): **20/20 passing**.
- `npx vitest run "src/app/(app)/products"` (existing product page/import/workbook
  tests, unaffected by this change): **24/24 passing**.

## CI

Not run in a hosted CI job as part of this session (no push/PR-triggered workflow
observed to complete here). All checks above were run locally against this branch's
working tree.

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
- Drag/reorder for Option Values; a progressive large-combination warning UI ahead of
  the hard 500 cap (see "UI/UX" above).
- **The full unfiltered `php artisan test` run should be completed (locally with
  patience, or via hosted CI) before merge consideration** — it was not obtained in
  this round after the SKU-gap and frontend changes, per the explicit instruction not
  to restart/wait on it further in this session. All narrower, directly-relevant
  suites (targeted VAR-CORE-1 tests and the full `Product*` filter) are green on both
  SQLite and PostgreSQL.
- The tenant-row lock added for the SKU cross-table check (see "SKU authority")
  serializes SKU-touching writes per tenant; acceptable given existing precedent
  (document numbering already does this), but worth monitoring under real write load
  if a tenant does very frequent concurrent SKU edits.

## Git state

```
Branch: claude/var-core-1-product-variants-b9hdzf
Base SHA: ba621e66fb0254c1261468f6ab63bd8eb8d40d02
Round 1 Head SHA: 25c2466d9acd800d42e45c934389836552b88531
Round 2 Head SHA: e8e37a4f84bbe3fcd9b63f2726efdef24b6f95a0
PR: https://github.com/safwan5001-source/Nebrax/pull/806 — NOT merged.
```

## Next recommended step

Complete/confirm the full unfiltered backend test run (locally or via hosted CI) as
the last outstanding verification item, then proceed to `VAR-INV-1` (unified
inventory state, warehouse stock, movements, reservations, and valuation for concrete
Variants) — the next item in the approved implementation sequence, and the dependency
that would let the Simple → Variant-managed transition gate become a guided
allocation workflow instead of a hard block.

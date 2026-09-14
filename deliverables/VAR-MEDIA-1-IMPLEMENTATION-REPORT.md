# VAR-MEDIA-1 Implementation Report

## Status

**PASS.**

## Baseline

- Starting `main` SHA: `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e`
- Confirmed via `git log --oneline -5 origin/main`: `4689f1b` is
  `VAR-PRICE-1: Variant and UOM canonical pricing (#813)` — the exact commit
  given as the confirmed baseline. No re-exploration of VAR-CORE-1/VAR-INV-1/
  VAR-PRICE-1 was performed; work started directly from this SHA.

## Evidence

A focused (not broad) `Explore` pass over exactly the 10 requested surfaces found:

- `ProductMedia`: `tenant_id, product_id, disk, path, original_name, mime_type,
  size, sort_order, uploaded_by`. **No `is_cover`/`is_primary` column exists.**
  "Cover" is a pure query-time convention — "first row by `sort_order`" —
  re-implemented slightly differently in three places (`ProductController::indexMedia`,
  `PosController`'s eager load, `StorefrontProductController`'s eager load ×2),
  with no single canonical accessor anywhere.
- Upload/list/delete logic lives entirely inline in `ProductController`
  (no separate `ProductMediaService` existed before this PR). Uses
  `DocumentStorageService` (the permanent-storage abstraction), disk value
  `'document'`. **Max image count is the literal `8`**, enforced in two places:
  `StoreProductMediaRequest::rules()` (`max:8` on the array) and
  `ProductController::storeMedia()` (`$product->media()->count() + count($files) > 8`).
- Media is served only via a guarded, permission-checked download route
  (`products.view`); `ProductMediaResource` exposes no `disk`/`path`, only an
  opaque `download_url` route. No public/signed-URL exposure exists at the
  Product-catalog layer.
- `ProductOption`/`ProductOptionValue` (VAR-CORE-1): **no "visual"/"display_type"
  concept exists** on either model or migration.
- `ProductReferenceRegistry`: `ProductMedia` is already `OWNED_CHILD` (never
  blocks Product deletion, cleaned up during real deletion). `ProductVariant`
  is `COMMERCIAL_LIVE` (blocks Product deletion until every Variant is removed
  first). `ProductOptionValue` is not registered at all (owned via
  `product_option_id`, not `product_id`) — its lifecycle protection is a
  direct usage-count check inside `ProductVariantService`, not the registry.
- `ProductLifecycleService::delete()`: captures `[disk, path]` for every
  `ProductMedia` row **before** deleting the DB rows inside the transaction,
  then deletes the physical files **after** commit. `ProductOption`/value
  deletion there is unconditional — safe only because Product deletion is
  already blocked while any Variant exists, so by that point no option value
  can be in use.
- `ProductVariantService::deleteOption()`/`deleteOptionValue()` (current,
  pre-existing): a value/option in use by any Variant (checked via a live
  `product_variant_option_values` count) cannot be hard-deleted — confirmed,
  no media-related guard exists there today.
- `ProductVariantService::deleteVariant()` (current, exact state after both
  VAR-INV-1 and VAR-PRICE-1): two sequential guards — inventory footprint
  (`inventoryState()->exists()`) then commercial-live footprint
  (`unitPrices()->exists() || PriceListItem::where(...)->exists()`) — **no
  media guard existed before this milestone.**
- `ProductBarcodeAndMediaTest`: the existing test that locks in today's de
  facto cover convention is `pos_catalog_exposes_the_first_product_image_through_an_authenticated_download_url`
  — it asserts the **first** uploaded image (by `sort_order`) is what
  `pos_image` returns.
- `ProductMedia` is `CompanyWide` (not branch-scoped), tenant isolation via
  the `tenant_id` column plus `BaseModel`'s standard tenant global scope.
- Confirmed: neither `ProductVariant` nor `ProductOptionValue` had any
  `media()`/`images()` relation before this milestone.

No contradiction requiring a business-policy decision was found. The one
genuine architectural gap — no canonical cover authority — is resolved as
documented below without inventing a competing mechanism.

## Architecture

```
Product-level media   -> product_id set, product_option_value_id = NULL, product_variant_id = NULL
Option-Value media     -> product_option_value_id set, product_variant_id = NULL
Exact Variant media    -> product_variant_id set, product_option_value_id = NULL
(never both non-NULL on the same row — enforced fail-closed, see Persistence)
```

**Resolved gallery** (`ProductMediaGalleryService::resolveGallery(Product, ?ProductVariant)`):
1. Product-level media, ordered `sort_order` → `created_at` → `id` (a fully
   deterministic tiebreak chain — the existing ad hoc `->latest()`/`orderByDesc('created_at')`
   variations across call sites are replaced here by one explicit, stable order).
2. If a Variant is given: for each of its selected Option Values, **in the
   Product's own Option order** (`ProductOption.sort_order`, not pivot
   insertion order — resolved in PHP after eager-loading each value's
   `option`), that value's media in the same internal order.
3. If a Variant is given: the Variant's own exact media, same internal order.

A simple Product (`$variant = null`) resolves to exactly step 1 — byte-identical
to the pre-existing Product-only gallery.

**Cover — no new authority invented.** `ProductMediaGalleryService::resolveCover()`
is simply the first item of `resolveGallery()`. This is a direct formalization
of the *existing* convention (every call site already treated "first by
`sort_order`" as the cover) generalized across the new three-tier order, not a
competing mechanism. An explicit per-scope `is_cover` flag (the task's "preferred
conceptual precedence" alternative) was deliberately **not** built: no such
column or set-cover mutation exists anywhere in the current system to extend,
and inventing one — with its own uniqueness/mutation semantics across three
independent scopes — is a materially larger feature than "reuse the existing
mechanism," which the task explicitly prefers when reuse is safe. This choice
is also what makes `an_existing_product_only_gallery_resolves_unchanged` and
the pre-existing `pos_catalog_exposes_the_first_product_image_...` test both
pass with zero behavior change.

**Visual Option Values — no new column, no Setting.** An Option Value
"visually contributes" simply by **having** `ProductMedia` rows attached to it
— exactly the smallest of the two approaches the task itself offers ("media
existence itself marks an Option Value as visually contributing"). `Material`,
`Size`, or any other Option behaves identically to `Color`: if someone attaches
photos to a value, that value's media resolves for every Variant selecting it;
if not, nothing does. No large option-type framework, no tenant Setting.

**Deduplication:** `->unique('id')` on the final resolved collection — defense
in depth only. The three-scope structure is mutually exclusive by construction
(enforced in `ProductMedia::booted()`), so no row can structurally appear
through more than one route; true duplicates are not expected in practice.

**Inactive Variant behavior:** deactivating a Variant (`is_active = false`)
never touches its media — verified by
`deactivating_a_variant_preserves_its_media`. Selling eligibility is a
POS/Commerce-boundary concern (deferred, per scope), not a catalog-media one.

## Persistence

- **Extends `product_media`, no new table** — the task's own preference when
  the existing model's shape is safely extensible, and it is: two new
  nullable FK columns, `product_option_value_id` and `product_variant_id`
  (both `cascadeOnDelete()`), added purely via `ADD COLUMN` (SQLite supports
  this natively — no table rebuild). **No CHECK constraint exists on
  `product_media` today** (confirmed by reading every migration touching it)
  — the specific SQLite regression class the task named (a lost CHECK via
  `Schema::table` rebuild) has nothing to lose here.
- **No new uniqueness constraint** — unlike `InventoryState`/`ProductUnitPrice`
  (exactly one value per identity), media is an *ordered list* per scope;
  many rows per Product/Value/Variant are expected and correct.
- **Mutual exclusivity enforced at the domain layer, not the database.**
  A DB-level `CHECK (product_option_value_id IS NULL OR product_variant_id IS NULL)`
  is not portably addable to SQLite without a full table rebuild (the exact
  regression class the task explicitly warns against — SQLite has no
  `ALTER TABLE ADD CONSTRAINT` at all). `ProductMedia::booted()`'s `saving`
  hook enforces it instead — the same pattern already established by
  `InventoryService::assertIdentityConsistent()` and
  `ProductPricingService::assertIdentityConsistent()` for cross-table identity
  checks that can't be expressed as a single-table constraint either. The same
  hook also validates: an Option Value belongs to an Option belonging to the
  *same* Product; a Variant belongs to the *same* Product; and — since this
  hook runs in `saving`, which fires *before* `BelongsToTenant`'s own
  `creating` listener populates `tenant_id` on a new row — the tenant check
  falls back to the active `TenantContext` exactly as `BelongsToTenant` itself
  would, rather than comparing against a not-yet-set column (a real ordering
  bug caught and fixed during testing, see Tests).
- **Verified on both engines, fresh install:** SQLite via `setup.sh`'s full
  `migrate:fresh` (target migration ran cleanly, all prior migrations intact);
  PostgreSQL 16 verification per the standard protocol (see Tests — Layer 3).
- **`Product::media()` stays scoped to Product-level media only** (a new
  `whereNull` filter added directly to the relation), so **every existing
  consumer** (`ProductController::indexMedia/storeMedia/downloadMedia/destroyMedia`,
  `PosController`'s eager load, `StorefrontProductController`'s eager loads,
  `ProductResource::pos_image`) is automatically and correctly restricted to
  exactly its pre-existing scope with **zero code changes** to any of those
  files — the 8-image cap, the download/delete authorization, and the
  cover convention all keep working unchanged because they all resolve
  through this one relation. A new `Product::allMedia()` (unscoped across all
  three tiers) exists solely for `ProductLifecycleService::delete()`'s full
  cleanup sweep.

## Files changed

**New:**
- `database/migrations/2026_09_28_010000_add_variant_scoping_to_product_media.php`
- `app/Services/ProductMediaGalleryService.php` — `resolveGallery()`, `resolveCover()`
- `app/Services/ProductMediaService.php` — `attachToProduct()`, `attachToOptionValue()`,
  `attachToVariant()` (upload primitive mirroring `ProductController::storeMedia()`'s
  existing logic for the two new scopes), `delete()`, `collectAndQueueDeletion()`/
  `deleteFiles()` (the capture-before-delete-rows / delete-files-after-commit
  primitive reused by every lifecycle cleanup path below)
- `tests/Feature/ProductMediaGalleryTest.php` (19 tests)

**Modified:**
- `app/Models/ProductMedia.php` — `product_option_value_id`/`product_variant_id`
  fillable, `optionValue()`/`variant()` relations, the `saving` identity/exclusivity
  guard described above
- `app/Models/Product.php` — `media()` scoped to Product-level only (behavior-preserving
  for every existing caller), new `allMedia()` for lifecycle cleanup
- `app/Models/ProductOptionValue.php` — `media()` relation
- `app/Models/ProductVariant.php` — `media()` relation
- `app/Services/ProductVariantService.php` — constructor gains `ProductMediaService`;
  `deleteVariant()`/`deleteOptionValue()`/`deleteOption()` each clean up (not
  block on) their owned media rows and files before deleting
- `app/Services/ProductLifecycleService.php` — the existing file-cleanup capture
  and row-deletion now use `allMedia()` instead of `media()`, so Product deletion
  continues to sweep every scope of media it used to sweep (the scoping change
  to `media()` would otherwise have silently stopped cleaning up Option-Value
  media on Product delete — caught before finalizing, see Tests)

**Deliberately not touched:** `ProductController` (no HTTP endpoints added for
the two new scopes — see Risks/Deferred), `StoreProductMediaRequest`,
`routes/api.php`, `PosController`, `StorefrontProductController`,
`ProductResource`, `StorefrontProductResource` — all continue to work exactly
as before, verified by the full `ProductBarcodeAndMediaTest` suite passing
unmodified.

## Backward compatibility

- **Existing Product gallery**: byte-identical behavior — same 8-image cap
  (now provably scoped to Product-level only, since `Product::media()` is the
  single relation every existing consumer already used), same upload/list/
  delete/download endpoints and authorization, same de facto cover convention
  (now formalized, not changed).
- **Existing Product API**: no field became required; `product_variant_id`/
  `product_option_value_id` are optional/additive everywhere they were added.
- **Existing clients**: nothing in the response shape of any existing endpoint
  changed.
- Full `ProductBarcodeAndMediaTest` suite (covering barcode + media, including
  the two media-specific tests: private/deletable images, and the POS
  first-image cover contract) passes **unmodified**.

## Tenant Isolation

`ProductMedia::booted()`'s `saving` guard runs before any row is written:
- mutual exclusivity (never both an Option Value and a Variant on one row);
- an attached Option Value's owning Option must belong to the *same* Product;
- an attached Variant must belong to the *same* Product;
- both checked against the *active tenant context* (not the row's own
  possibly-not-yet-set `tenant_id`), matching `BelongsToTenant`'s own logic.

**Negative tests** (`ProductMediaGalleryTest`): an Option Value belonging to a
different Product is rejected fail-closed
(`an_option_value_from_a_different_product_is_rejected_fail_closed`); same for
a Variant (`a_variant_from_a_different_product_is_rejected_fail_closed`); a raw
cross-tenant Option Value obtained via `withoutGlobalScopes()` (simulating an
ID that slipped past the normal scope) is rejected with the row count asserted
unchanged (`a_cross_tenant_option_value_cannot_be_attached`); same for a
cross-tenant Variant (`a_cross_tenant_variant_cannot_be_attached`); a row that
tries to target both an Option Value and a Variant is rejected regardless of
tenant (`a_media_row_cannot_target_both_an_option_value_and_a_variant`).

## Security

Unchanged. No new download/serving route was added; `ProductMediaResource`
still exposes no `disk`/`path`; the guarded, permission-checked download
route (`products.view`) remains the only way to fetch bytes, and it remains
scoped to Product-level media only (since no controller/route was added for
the two new scopes in this milestone — see Risks/Deferred). No storefront/
public media exposure was touched.

## Lifecycle

- **Product deletion**: unchanged behavior, now provably correct across all
  three scopes (`allMedia()` fix above) rather than accidentally correct
  because no other scope existed yet.
- **Option Value deletion**: still blocked while any Variant uses it (existing
  guard, untouched). When actually deletable, its media (rows + physical
  files) is now cleaned up rather than left to a bare DB cascade that would
  have dropped rows but never freed storage bytes.
- **Option deletion** (bulk-deletes all its values): same fix applied — every
  value's media under the option is captured and cleaned up before the bulk
  delete, since `$option->values()->delete()` is a mass query with no
  per-row Eloquent events.
- **Variant deletion**: media is **cleaned up, not blocking** — the one
  deliberate asymmetry versus the existing inventory/price guards on the same
  method. Rationale: `ProductMedia` is `OWNED_CHILD` at the Product level too
  (disposable/replaceable catalog content, not historical/commercial truth);
  keeping Variant-level media consistent with that existing classification
  was the smallest, most self-consistent choice. Verified: a Variant with a
  real inventory or price footprint still fails closed via the existing
  guards *before* reaching media cleanup, confirming guard order is unchanged
  (`deleting_a_variant_with_a_price_or_inventory_footprint_still_blocks_before_reaching_media_cleanup`).
- **Deactivation**: verified to leave media completely untouched.

## Concurrency

No new race was introduced. Media rows are an ordered list per scope with no
uniqueness invariant to protect (unlike `InventoryState`/`ProductUnitPrice`),
so there is no "duplicate identity" race class here at all — two concurrent
uploads to the same scope simply produce two rows with independently
allocated `sort_order` values (the existing `max('sort_order') + 1` pattern,
unchanged from the pre-existing Product-level upload logic, and not something
this milestone strengthens or weakens). No PostgreSQL-specific concurrency
test was added, per the task's own instruction not to add locks or fake
concurrency tests where no real race exists to prove.

## Tests

**SQLite (targeted, progressive):**
- `ProductMediaGalleryTest`: **19/19 passed**, 34 assertions. One real bug
  found and fixed during this run: the `saving` guard's tenant check compared
  against `$media->tenant_id` directly, which is still `NULL` at `saving` time
  for a brand-new row (Laravel fires `saving` *before* `creating`, and
  `BelongsToTenant`'s own `tenant_id` auto-fill listens on `creating`) — every
  create was failing with a masked "storage failed" message because the
  guard's own exception was being caught by an overly broad `try/catch` in
  `ProductMediaService::store()`. Fixed by (a) resolving the effective tenant
  id from `TenantContext` when the column isn't set yet, matching
  `BelongsToTenant`'s own fallback exactly, and (b) narrowing the `try/catch`
  in `store()` to only the storage-write call, so a genuine identity-guard
  rejection surfaces with its real message instead of a misleading one.
- Regression (`ProductBarcodeAndMediaTest`, `ProductLifecycleTest`,
  `ProductReferenceClassificationGuardTest`, `ProductReferenceRegistryTest`,
  `ProductVariantCoreTest`, `InventoryStateTest`, `ProductUnitPriceTest`,
  `PosCheckoutTest`, `ProductDataExplorerTest`, `ProductExportTest`,
  `BranchIsolationGuardTest`): **174/174 passed**, 1352 assertions — zero
  regressions across inventory/pricing/variant-core/Tenant-Isolation/POS/export
  surfaces this milestone's model-relation changes touch indirectly.
- Broader sweep (`Product|Commerce|Pos|PriceList|UnitTemplate|Workbook|Inventory|Media`
  filter — this pattern also matches method names, which is how it happened
  to catch a class whose own name matches none of these keywords, see below):
  **1413/1422 passed** (8701 assertions), 196 test classes green. 9 failures,
  all pre-existing and unrelated to this milestone's actual diff:
  - 6 are the already-documented, environment-only `bcmath`-extension gap in
    Fuel tests (confirmed again via `php -m | grep bcmath` — not installed in
    this sandbox), including one (`FuelSupplyReceivingApiTest`) not previously
    seen in earlier milestones' narrower sweep filters, same root cause.
  - **5 are a genuine pre-existing regression from VAR-INV-1, discovered here,
    not introduced by VAR-MEDIA-1**: `ReportEffectiveScopeTest`'s inventory-value/export
    test fixtures seed state via raw `Product::whereKey($id)->update(['quantity_on_hand'=>…,'avg_cost'=>…])`
    — a query-builder bulk update that bypasses Eloquent events entirely, so it
    writes to the now-frozen physical columns VAR-INV-1 stopped reading from,
    instead of through `InventoryState`. This exact code already exists
    unmodified on `origin/main` (verified via `git show origin/main:tests/Feature/ReportEffectiveScopeTest.php`)
    — it was never caught by VAR-INV-1's or VAR-PRICE-1's own test sweeps
    because their filter patterns never happened to match this class or its
    method names; it surfaced here only because this sweep's filter
    incidentally matches PHPUnit method names too (several of this class's
    test names literally contain the word "inventory"). **Confirmed
    production code is not affected** — every real write path
    (`InventoryService`) already writes through `InventoryState` correctly
    (`app/Services/Accounting/InventoryService.php:135,184,269`); only this
    one test file's fixture-seeding pattern is stale. Not fixed here —
    genuinely unrelated to VAR-MEDIA-1 (no media relation whatsoever), and
    fixing it belongs with whoever next touches `ReportEffectiveScopeTest` or
    does a VAR-INV-1 regression-coverage follow-up. Flagged here rather than
    silently left for someone else to rediscover.

**PostgreSQL 16** (local `nibras`/`nibras`): fresh `migrate:fresh` succeeded
end-to-end (target migration `2026_09_28_010000_add_variant_scoping_to_product_media`
ran cleanly). Targeted suite (`ProductMediaGalleryTest`, `ProductBarcodeAndMediaTest`,
`ProductLifecycleTest`, `ProductReferenceClassificationGuardTest`,
`ProductReferenceRegistryTest`, `ProductVariantCoreTest`, `InventoryStateTest`,
`ProductUnitPriceTest`, `PosCheckoutTest`, `ProductDataExplorerTest`,
`ProductExportTest`, `BranchIsolationGuardTest`): **193/193 passed**, 1386
assertions. `.env` restored to SQLite afterward with no test process running
concurrently, confirmed clean.

**Not run:** a dedicated PostgreSQL concurrency test (none was needed — see
Concurrency); frontend `tsc`/build (no `web/src` file references anything this
PR renamed, removed, or added an API contract for — no HTTP endpoint or
response-shape change occurred at all).

## Risks / Deferred

- **HTTP/API endpoints for attaching/listing/deleting Option-Value and Variant
  media were intentionally not added.** `ProductController`, `StoreProductMediaRequest`,
  and `routes/api.php` are untouched. `ProductMediaService`/`ProductMediaGalleryService`
  are the callable domain capability a future endpoint (or the appropriate
  Product-create/edit UX follow-up, per §13's own instruction not to build "a
  large media studio" here) can wire up without any further backend redesign
  — mirroring exactly the same scoping decision made in VAR-PRICE-1 for its
  own domain-only pricing layer, which was accepted there.
- **Max-per-scope image cap**: chosen interpretation is "8 per scope,
  independently" (Product gallery keeps its existing 8; each Option Value and
  each Variant gets its own independent 8) rather than a shared/summed pool —
  the smallest interpretation that leaves the existing Product gallery's limit
  completely unchanged while giving the two new scopes a sane, already-approved
  number instead of inventing a new one.
- **Pre-existing, unrelated regression discovered (not fixed here)**:
  `ReportEffectiveScopeTest`'s inventory-value/export fixtures seed
  `quantity_on_hand`/`avg_cost` via a raw query-builder `update()` that
  bypasses `InventoryState` (VAR-INV-1) — see Tests above for the full
  evidence trail. Recommend a small, separate follow-up (in the same spirit
  as VAR-INV-1's own fix to `InventoryOpeningImportTest`/`InventoryOpeningPostingTest`)
  to route these specific fixtures through `InventoryService`/`$product->save()`.
- **VAR-DOC-1, VAR-POS-1, VAR-COM-1, VAR-REPORT-1**: untouched, as instructed
  — no document-line schema change, no POS/Commerce Variant selection or media
  switching, no reporting/export change beyond what was strictly required to
  keep the existing Product-level gallery correctly scoped.

## Git

- Branch: `claude/var-media-1-variant-media`
- Base SHA: `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e`
- Head SHA: `5e254ab12f42cf666ecfc5c747586168d79e4dd5`
- Working tree: clean after commit (verified before push)

## Recommendation

**READY FOR REVIEW.**

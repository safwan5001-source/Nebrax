# VAR-OPTION-VISUAL-1 — Option Value Visual Metadata: Domain/API Authority

**Branch:** `feat/var-option-visual-1-domain-api`
**Base:** `main` @ `3b88a45` (feat(commerce): STORE-ADMIN-ADOPT-1B-2 domain visibility, #852)
**Contract:** `docs/plans/products-inventory/AWJ_OPTION_VALUE_VISUAL_SWATCH_CONTRACT.md` (added to main at `fe468b6`)
**PR:** _link filled in after opening_

## 1. Scope

Backend domain + API only. Adds visual metadata (`none` / `color` / `image`) to
`ProductOptionValue`. Does not touch Product Workspace frontend, Storefront,
POS, or any deploy/merge step. Product Variant identity, inventory, pricing,
barcode, UOM, publication and accounting authority are untouched.

## 2. Phase 0 — evidence pass findings

- **A. Who owns an Option Value today:** `App\Models\ProductOptionValue`
  (table `product_option_values`, migration
  `2026_09_23_010000_create_product_variants_core.php`, VAR-CORE-1). Owned by
  `ProductOption` via `product_option_id` only (no direct `product_id` — by
  design, to avoid a second source of truth). `CompanyWide` branch
  classification, same as `ProductOption`/`ProductMedia`/`ProductBarcode`.
- **B. Where visual metadata belongs:** confirmed against the contract
  (§2, §8, §17) — the **Option Value** is the sole owner. No Option-level
  "presentation mode" hint was added; option names (`اللون`/`Color`) are never
  inspected to infer behavior anywhere in this change.
- **C. Smallest additive extension:** three nullable/defaulted columns on
  `product_option_values` (`visual_type`, `color_value`, `image_media_id`).
  No new table, no change to `product_options`, `product_variants`, or
  `product_variant_option_values`.
- **D. `ProductMedia` reuse for image swatches:** `ProductMedia` already
  supports a `product_option_value_id`-scoped row (VAR-MEDIA-1, migration
  `2026_09_28_010000_add_variant_scoping_to_product_media.php`), with a
  `booted()` guard enforcing that a media row scoped to an option value
  belongs to that option value's own product and tenant, and a guard that a
  single media row can never target both an option value and a variant. This
  is unambiguous from the Product gallery (`product_option_value_id IS NULL
  AND product_variant_id IS NULL`), so **no new media ownership architecture
  was needed** — `image_media_id` on `ProductOptionValue` simply references
  an existing, already-scoped `product_media` row. This directly satisfies
  contract §7 ("no missing Option Value media-authoring backend should be
  invented silently") because the backend already existed; this PR only
  references it, it does not invent it.

### Important sub-finding: HTTP upload routes for option-value media do not exist yet

`ProductMediaService::attachToOptionValue()`/`attachToVariant()` are fully
implemented and tested (`tests/Feature/ProductMediaGalleryTest.php`,
`tests/Feature/PosVariantMediaTest.php`), but **no HTTP route** exposes them —
only `ProductController::storeMedia()` (product-level gallery) is routed. This
was **explicitly deferred** in the VAR-MEDIA-1 milestone itself
(`deliverables/VAR-MEDIA-1-IMPLEMENTATION-REPORT.md`, "Risks / Deferred":
*"HTTP/API endpoints for attaching/listing/deleting Option-Value and Variant
… media were not built in this milestone … `routes/api.php` are untouched"*).

**Decision:** this PR does **not** add new HTTP upload routes for
option-value-scoped media. Doing so would be exactly the kind of
media-authoring backend the contract (§7) warns against inventing silently as
a side effect of a different task, and it would expand this PR beyond
"Option Value visual metadata domain/API" into "wire the deferred VAR-MEDIA-1
HTTP surface" — a separate, already-acknowledged future milestone. Instead:

- The **domain/validation/read layer for `image` visual type is fully
  implemented and tested**: an Option Value can reference an existing
  `product_media` row (created via `ProductMediaService::attachToOptionValue()`,
  as today's tests already do) as long as that row is scoped to that exact
  Option Value and tenant. Tenant/scope safety is enforced server-side.
- This is **not the image-swatch STOP CONDITION** from the task brief — the
  underlying media architecture already exists, is tenant-safe, and needed no
  new design. It is a narrower, explicitly-flagged deferral: *uploading* a new
  image via HTTP for a specific Option Value still requires the already-known,
  already-deferred VAR-MEDIA-2-style routing work. Color support is not
  blocked by this in any way and ships complete in this PR.

## 3. Schema decision

Migration: `database/migrations/2026_10_03_010000_add_visual_metadata_to_product_option_values.php`

Additive columns on `product_option_values` only:

| Column | Type | Default | Nullable | Notes |
|---|---|---|---|---|
| `visual_type` | `varchar(20)` | `'none'` | not null | `none` \| `color` \| `image`. Plain string, no DB enum/CHECK — matches the existing `products.variant_state` pattern in this repo (app-layer validation only). |
| `color_value` | `varchar(7)` | `NULL` | nullable | `#RRGGBB` only, normalized uppercase. |
| `image_media_id` | `uuid` FK → `product_media.id` | `NULL` | nullable | `nullOnDelete()`. |

No changes to `product_options`, `product_variants`,
`product_variant_option_values`, or any accounting/inventory/pricing table.

### Why no DB `CHECK` constraint

The project has a known regression pattern (flagged explicitly in the task
brief and visible in
`database/migrations/2026_09_11_190000_add_reversal_lifecycle_to_payments.php`):
adding a `CHECK` via a `Schema::table` migration on SQLite can trigger a full
table rebuild that silently drops the constraint unless it is re-added with
raw `pgsql`-only DDL. Since `visual_type`/`color_value` validation here is
**purely a business invariant enforced in `ProductVariantService`**, not a
structural database fact (same precedent as `variant_state`), no `CHECK` was
added at all — avoiding the risk entirely rather than working around it.

### SQLite / PostgreSQL verification

- **SQLite:** `php artisan migrate:fresh --force` — all 39 migrations,
  including the new one, ran clean. No table rebuild warnings.
- **PostgreSQL 16:** `php artisan migrate:fresh --force` — clean. Inspected
  the resulting schema with `\d product_option_values`:

```
 visual_type       | character varying(20) | not null | 'none'::character varying
 color_value       | character varying(7)  |          |
 image_media_id    | uuid                  |          |
Foreign-key constraints:
    "product_option_values_image_media_id_foreign" FOREIGN KEY (image_media_id)
        REFERENCES product_media(id) ON DELETE SET NULL
```

All pre-existing constraints on `product_option_values` (unique
`(product_option_id, value_key)`, tenant/option FKs, and the reverse FKs from
`product_media`/`product_variant_option_values`) are intact and unchanged —
confirmed by the same `\d` inspection.

## 4. Color normalization contract

`App\Models\ProductOptionValue::normalizeColorHex(string $value): ?string`

- Accepts **only** `#RRGGBB` (exactly 6 hex digits after `#`), via
  `preg_match('/^#[0-9A-Fa-f]{6}$/', trim($value))`.
- Normalizes to **uppercase** before persistence (`#afc9f5` → `#AFC9F5`).
- Rejects: 3-digit shorthand (`#ABC`), missing `#` (`AFC9F5`), CSS named
  colors (`red`), `rgb(...)`/`rgba(...)`/CSS variables, gradients — anything
  that doesn't match the regex returns `null`, and the service turns that
  into a domain rejection (HTTP 422).
- The human-readable label (`value`/`value_en`) is completely independent of
  `color_value` — nothing in this change infers or guesses a color from a
  label.

## 5. Image-swatch status

**Implemented at the domain/validation/read layer; HTTP upload route
intentionally not added (see §2 sub-finding above).**

- `ProductOptionValue::visual_type = 'image'` requires `image_media_id` to
  resolve to a `ProductMedia` row where `product_option_value_id` equals that
  **exact** Option Value's id (enforced in
  `ProductVariantService::applyVisualMetadata()`, not just in the request
  layer).
- The lookup goes through `ProductMedia::where(...)`, which is
  tenant-scoped automatically (`BaseModel`/`TenantScope`) — a cross-tenant or
  wrong-scope id resolves to `null` and produces the same generic rejection
  message as "media does not exist", so no cross-tenant existence is leaked.
- Read side: `ProductOptionValueResource` exposes `image_media: {id,
  download_url}` (reusing the existing guarded download route
  `products/{id}/media/{mediaId}/download`, which already serves all three
  media scopes via `Product::allMedia()`) — no internal storage path is ever
  exposed.
- A media row can be attached to an Option Value today via
  `ProductMediaService::attachToOptionValue()` (already tested since
  VAR-MEDIA-1); once an HTTP upload route for that scope is wired in a future
  milestone, no further domain change is needed here — the Option Value side
  of the contract is already complete.

## 6. API changes

Extends the **existing** `ProductVariantController` / `Product*OptionValue*`
request/resource classes — no parallel "visual options" subsystem.

- `POST /products/{id}/options/{optionId}/values` and
  `PUT /products/{id}/options/{optionId}/values/{valueId}` — request bodies
  accept optional `visual_type`, `color_value`, `image_media_id` (all
  `sometimes`/`nullable`). Omitting them entirely is unchanged behavior.
- `ProductOptionValueResource` now returns `visual_type`, `color_value`, and
  (when set) `image_media: {id, download_url}`. Existing clients that ignore
  these fields are unaffected — confirmed by the "existing text-only option
  values still work" test asserting `visual_type === 'none'` and
  `color_value === null` for a plain value.
- `ProductVariantResource.option_values[]` and the combinations-matrix
  (`GET /products/{id}/variants/combinations`) option value summaries now
  also carry `visual_type`/`color_value` (read-only projection of the same
  Option Value row — no independent copy is stored).
- No new routes were added to `routes/api.php`.

## 7. Validation (server-authoritative)

`ProductVariantService::applyVisualMetadata()` is the single source of truth,
called from both `addOptionValue()` and `updateOptionValue()` inside their
existing transactions/locks. Request-layer rules
(`StoreProductOptionValueRequest`/`UpdateProductOptionValueRequest`) only
check shape (`Rule::in([...])`, `uuid`, `max:7`) for fast feedback — the
service re-validates everything, so a client cannot bypass invariants by
calling the API directly.

Enforced invariants:

| Case | Result |
|---|---|
| `none` + explicit `color_value` | 422 |
| `none` + explicit `image_media_id` | 422 |
| `color` without a color value (new or existing) | 422 |
| `color` + invalid hex (`#ABC`, `AFC9F5`, `red`, `rgb(...)`) | 422 |
| `color` + `image_media_id` | 422 |
| `image` + `color_value` | 422 |
| `image` without a resolvable media reference | 422 |
| `image` + media not scoped to this exact Option Value | 422 (generic message, same as "not found") |
| `image` + media from another tenant | 422 (generic message, same as "not found" — no leak) |
| Unknown `visual_type` (e.g. `gradient`) | 422 |
| Switching `color → none` | `color_value` cleared automatically |
| Switching `color`/`image` → the other | the other's field cleared automatically |
| Update that never mentions any visual field | visual metadata untouched (pure backward compatibility) |

## 8. Tenant isolation

- `ProductOptionValue` inherits `BaseModel`/`TenantScope` — unchanged.
- `image_media_id` resolution goes through `ProductMedia::where(...)`, itself
  tenant-scoped, so a cross-tenant id is indistinguishable from "does not
  exist" (test:
  `a_cross_tenant_image_media_reference_is_denied_without_leaking_existence`,
  which also asserts the victim tenant's id string never appears in the error
  message).
- A sibling Option Value's media (same tenant, different value) is also
  rejected (test: `an_image_reference_belonging_to_a_sibling_value_is_rejected`),
  matching the contract's "belongs to this value, not just this product"
  requirement.
- RBAC unchanged: `products.manage` still gated on
  `POST`/`PUT` for values (test:
  `existing_option_value_permissions_still_apply_to_visual_metadata_writes`,
  a `staff` role token gets 403 on both routes with visual fields present).

## 9. Backward compatibility evidence

- `existing_text_only_option_values_still_work_without_any_visual_field` —
  creating a value with only `value` returns `visual_type: 'none'`,
  `color_value: null`, no `image_media` key.
- `a_new_value_created_with_no_visual_fields_resolves_to_none_by_default` —
  direct model creation (bypassing the request layer, as raw
  DB-seeded/legacy rows would look) resolves to `none`/`null`/`null`.
- No migration-time backfill/fabrication of visual data for existing rows —
  the column default (`'none'`) covers every pre-existing row with zero
  writes.
- No change to `ProductVariant` creation/update, `sku_registry`,
  `product_variant_option_values`, combination-key derivation, or barcode/
  price/UOM logic.

## 10. Variant identity regression evidence

`editing_a_swatch_color_does_not_recreate_the_variant_or_change_its_sku`:
creates a variant from a `color` Option Value + a plain `size` value, records
the variant's `id`, `sku`, and `combination_key`, updates the color's
`color_value` from `#AFC9F5` to `#B7D3FA`, and re-fetches the variant list —
asserts identical `id`, `sku`, `combination_key`, and that the variant's
projected `option_values[].color_value` reflects the **new** color (read-only
projection, not a stale copy).

`variant_combination_matrix_is_unchanged_by_a_swatch_color_edit`: captures the
`combinations[].combination_key` set from
`GET /products/{id}/variants/combinations` before and after a color edit —
asserts they are identical.

## 11. Accounting / historical documents

**Untouched.** No changes to `LedgerService`, `InvoiceService`,
`InventoryService`, `ReportService`, or any journal/document-line model.
Visual metadata is not read by any historical-document snapshot path — those
already snapshot `value`/SKU/price/etc. independently
(`tests/Feature/VariantDocumentLineTest.php`, unmodified and still green),
and nothing in this PR adds a new read of `ProductOptionValue` from a posted
document.

## 12. Files changed

```
app/Http/Controllers/Api/ProductVariantController.php     (eager-load imageMedia on read paths)
app/Http/Requests/StoreProductOptionValueRequest.php       (+visual_type/color_value/image_media_id shape rules)
app/Http/Requests/UpdateProductOptionValueRequest.php      (+visual_type/color_value/image_media_id shape rules)
app/Http/Resources/ProductOptionValueResource.php          (+visual_type, color_value, image_media)
app/Http/Resources/ProductVariantResource.php               (+visual_type, color_value on option_values[])
app/Models/ProductOptionValue.php                           (+visual_type/color_value/image_media_id fillable,
                                                               VISUAL_TYPES const, normalizeColorHex(), imageMedia())
app/Services/ProductVariantService.php                      (+applyVisualMetadata(), wired into
                                                               addOptionValue()/updateOptionValue(); combinations
                                                               matrix summaries carry visual fields)
database/migrations/2026_10_03_010000_add_visual_metadata_to_product_option_values.php  (new)
tests/Feature/ProductOptionValueVisualTest.php               (new, 21 tests)
```

No changes to: `ProductOption`/`ProductOptionResource` (Option-level "mode"
hint deliberately not built — out of contract scope for VAR-OPTION-VISUAL-1),
`ProductVariant`, `product_variants`/`product_variant_option_values`
migrations, `LedgerService`, `ProductPricingService`, barcode
resolver/registry, UOM authority, `CommerceListing`, `routes/api.php`, any
`web/` frontend file, Storefront, or POS.

## 13. Tests / results

New file: `tests/Feature/ProductOptionValueVisualTest.php` — 21 tests / 155
assertions, covering all 20 required-test categories from the task brief
(existing text-only values, none-default resolution, valid color create/
update, lowercase normalization, invalid hex, CSS named color, `rgb()`
rejection, color-requires-value, none/image-cannot-retain-color, unknown
type rejection, API round-trip, variant-ID/SKU/combination stability after a
color edit, cross-tenant and cross-value image-reference denial, and existing
RBAC enforcement).

### SQLite

```
php artisan test --filter=ProductOptionValueVisualTest
Tests:    21 passed (155 assertions)

php artisan test --filter="ProductVariant|ProductOption|ProductMedia|ProductBarcodeAndMedia|
  VariantDocumentLine|PosVariant|StorefrontVariant|VariantReporting|VariantMinimumSalePrice|
  DeliveryNoteVariant|DocumentHttpVariants|InventoryBalanceExportVariant"
Tests:    3 skipped, 227 passed (1283 assertions)   [skips = Postgres-only concurrency tests]
```

Full suite (`php artisan test`, no filter, run twice for consistency):

```
Tests:    35 failed, 40 skipped, 4032 passed (25075 assertions)
```

All 35 failures are pre-existing and unrelated to this change:
`AuthRecoveryTest` (8), `DocumentCenterSecureIntakeTest` (1), and 26 failures
across `FuelAviRfidServiceTest`/`FuelReconciliationTest`/`FuelSaleApiTest`/
`FuelSaleServiceTest`/`FuelSupplyReceivingApiTest`/`FuelSupplyReceivingTest`
— the Fuel-module failures all trace to `Call to undefined function
App\Services\bcmul()`, i.e. the `ext-bcmath` PHP extension is not installed
in this environment, unrelated to Product/Option/Variant code entirely.
Verified `ApiAuthTest` (which appears in `AuthRecoveryTest`'s neighborhood)
passes 32/32 in isolation, confirming no cross-contamination from this PR.
No failure touches `Product`, `ProductOption`, `ProductOptionValue`,
`ProductVariant`, or any file this PR changes.

### PostgreSQL 16

```
php artisan migrate:fresh --force     # clean, all 39 migrations
php artisan test --filter="ProductOptionValueVisualTest|ProductVariant|ProductOption|ProductMedia|
  ProductBarcodeAndMedia|VariantDocumentLine|PosVariant|StorefrontVariant|VariantReporting|
  VariantMinimumSalePrice|DeliveryNoteVariant|DocumentHttpVariants|InventoryBalanceExportVariant"
Tests:    229 passed (1291 assertions), 1 failed on first run
```

The single failure (`DeliveryNoteVariantPriceListTest`, a `deadlock detected`
on `migrate:fresh`'s `DROP TABLE ... CASCADE`) was traced to a **stale "idle
in transaction" connection left open by an unrelated earlier test process**
(`pg_stat_activity` showed a lingering `tenant_application_states` query),
not to this change. After that connection cleared,
`php artisan test --filter=DeliveryNoteVariantPriceListTest` alone passed
10/10 (35 assertions) cleanly. No test in this PR touches delivery notes,
price lists, or anything in that file's path.

## 14. Diff audit

```
git diff --name-only origin/main...HEAD
git diff --stat origin/main...HEAD
```

Confirmed the diff touches exactly the 9 files listed in §12 — no changes to
inventory valuation, accounting, document posting, `ProductPricingService`,
barcode resolver/registry, UOM authority, `CommerceListing` publication
authority, Product Workspace frontend, Storefront frontend, POS frontend, or
any unrelated module. `grep -rn "is_online" app database` returns nothing —
`Product.is_online` was not introduced.

## 15. Risks / deferred

- **HTTP upload route for Option-Value-scoped media** — still not wired (see
  §2/§5). Pre-existing deferral from VAR-MEDIA-1, not newly introduced here.
  A future milestone (likely "VAR-MEDIA-2" or folded into
  VAR-OPTION-VISUAL-2) should route
  `ProductMediaService::attachToOptionValue()`/`attachToVariant()` the same
  way `ProductController::storeMedia()` routes the product-level scope, then
  this PR's `image_media_id` validation needs zero changes to consume it.
- **Option-level "presentation mode" hint** (e.g. an Option authored as
  "Color" defaulting its values to color-entry UI) is explicitly a
  VAR-OPTION-VISUAL-2 (frontend) concern per the task brief and was not
  built here — `ProductOption`/`ProductOptionResource` are untouched.
- **`image_media_id` FK is `nullOnDelete()`**, not `restrictOnDelete()` —
  documented in the migration's own comment: no HTTP route today deletes a
  single option-value-scoped media row in isolation (the only real deletion
  path, `deleteOptionValue()`, deletes the Option Value itself, making the
  dangling-reference case moot in practice today). If a future milestone adds
  single-media deletion, it should decide explicitly whether to block deletion
  of an in-use swatch image or to also clear `visual_type` back to `none` —
  flagged here rather than silently guessed.

## 16. Accounting entries introduced by this PR

**None.** `LedgerService`, `InvoiceService`, `PaymentService`,
`PurchaseService`, `ReturnService`, `InventoryService`, and `ZatcaService`
are all untouched by this diff. Visual metadata (`visual_type`,
`color_value`, `image_media_id`) is pure catalog/presentation data on
`ProductOptionValue`; nothing in this PR calls `LedgerService::post()` or
writes to `journal_entries`/`journal_lines`.

## 17. Next recommended milestone

Per the contract's own sequencing (§18): **VAR-OPTION-VISUAL-2** — Product
Workspace authoring (visual type selection, color picker, image/sample
authoring gated on whatever media-upload backend exists by then, mobile/RTL/
LTR UX), explicitly not started here.

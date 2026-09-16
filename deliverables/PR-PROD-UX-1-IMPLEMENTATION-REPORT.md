# PR-PROD-UX-1 — Shared Product Workspace Foundation — Implementation Report

## 1. Latest main SHA used

`dc03db7ae95f12e50ab520a6ae08bbebff9b6df8` (matches the given confirmed architecture merge exactly — `main` had not moved).

## 2. Branch

`claude/pr-prod-ux-1-shared-workspace`

## 3. PR number/link

Opened after this report was finalized — see the PR section of the final execution message returned alongside this report.

## 4. Head SHA

Recorded at push time (see PR commit list).

## 5. Phase 0 — Category/Brand findings

**Verdict: SAFE — frontend-only, no schema/migration/compatibility change required.**

Evidence gathered directly from the backend source (`/home/user/Nebrax`, not the synced runtime app):

1. **Product model** (`app/Models/Product.php:36`): both `category`/`brand` (legacy free text) and `category_id`/`brand_id` (FK) are simultaneously present in `$fillable`, and both `productCategory()`/`productBrand()` `belongsTo` relations already exist.
2. **Schema**: `database/migrations/2025_01_01_000003_create_partners_and_products.php` created the original free-text `category`/`brand` string columns; `database/migrations/2025_01_01_000045_create_product_categories_and_brands.php` later added `category_id`/`brand_id` as nullable FKs non-destructively, backfilling them from existing free-text values per tenant. That migration's own header comment states explicitly: the two text columns remain only as a display fallback for unlinked legacy products, are no longer written going forward, and removing them would break existing API consumers for no gain — i.e. they were never meant to be re-populated by new UI.
3. **Validation** (`app/Http/Requests/StoreProductRequest.php`, reused by `UpdateProductRequest`): `category`/`brand` (nullable string) and `category_id`/`brand_id` (nullable uuid) are accepted **simultaneously and fully independently** — neither is derived from the other, no cross-validation.
4. **Controller/service write path** (`ProductController::store()/update()` → `ProductService::create()` / `ProductLifecycleService::update()`): plain mass-assignment (`Product::create($data)` / `$product->fill($data)`). Whichever of the four keys is present in the validated payload gets written to its own column, independently. Submitting only `category_id`/`brand_id` (omitting `category`/`brand` entirely) is fully valid and already exercised today by `ProductDialog`'s edit path.
5. **Category/Brand endpoints**: `GET/POST /product-categories`, `GET/POST /brands` already exist and are already consumed by `ProductDialog`.
6. **Tests**: `tests/Feature/ProductClassificationTest.php` already exercises `POST /api/products` with `category_id`/`brand_id` alone, proving the API fully supports FK-only creation.
7. **Import/compatibility**: `app/Support/ProductImportFields.php` resolves CSV/XLSX `category`/`brand` columns to `category_id`/`brand_id` via a name-based reference resolver — entirely independent of the web form; unaffected by removing the free-text UI input.

**Conclusion**: switching `/products/new` from free-text `category`/`brand` inputs to the same `category_id`/`brand_id` FK `<Select>` pattern `ProductDialog` already uses required zero backend changes — it is the same, already-supported, already-tested API surface. No migration, no destructive conversion, no guessed mapping, no compatibility break. Implemented as described below.

## 6. Exact implementation

### `ProductWorkspace` (new shared component)

`web/src/components/products/product-workspace.tsx` — one component used for both Create and Edit, `mode: 'create' | 'edit'`. Owns exactly the fields that were already field-for-field identical (or trivially reconcilable, in the category/brand case) between the former `/products/new` and `ProductDialog`: basic info (name/name_en/sku/barcode+generate/type/unit template/unit/default sales-purchase unit/**category_id/brand_id FK selects**/supplier (create-only)/description), pricing scalars (purchase/sale price + tax hint/tax rate/min_sale_price/profit_margin/discount+type), accounting accounts (sales/COGS), inventory (track_inventory/initial_quantity **create-mode only**/reorder_level), and additional info (tags/internal_notes/active).

`initial_quantity` is deliberately create-mode-only and never sent on update — this matches `UpdateProductRequest`'s own `initial_quantity => prohibited` rule (confirmed during Phase 0); `ProductDialog`'s prior omission of this field in edit mode was already correct, not a gap.

**Explicitly out of scope, per the approved implementation plan** — left exactly where they were, untouched: `ProductMultiBarcodeTable` (PR-2), `ProductVariantsPanel` (PR-3), Media gallery consolidation (PR-4), `ProductPublicationFields` repositioning (PR-4). Where PR-1 needed these to keep working (they already did, before this PR), they are still mounted — just at their existing call sites, unmodified, reading a `productId` sourced from the shared workspace instead of from a page-local duplicate of the same state.

### First-Save contract (owned entirely by `ProductWorkspace`)

- Create mode: `persistedId` starts `null`. `submit()` with `persistedId === null` calls `POST /products` exactly once, merging an optional `extraCreatePayload` prop (used only by `/products/new`'s pending-barcode mini-list, unchanged from before this PR) into the same request body — so the "exactly one POST" contract holds even though that legacy UI lives outside the shared component.
- On success: `persistedId` is set from the response, the component **stays mounted** (no navigation, no dialog close), the Save button label switches (`t('save')` → `t('save_changes')`, or an explicit `saveLabel` override — see below), and `onCreated(productId)` fires.
- Any subsequent Save (`persistedId !== null`) calls `PUT /products/{persistedId}` — **never** a second `POST /products`, matching item #8 of the required test matrix.
- A failed create leaves `persistedId` null (no false "persisted" transition), surfaces the server's `ApiError` message in a `role="alert"` paragraph, and a retry click correctly re-`POST`s (not `PUT`s), since `persistedId` was never set.

### `/products/new` (thin wrapper)

Became a thin wrapper mounting `<ProductWorkspace mode="create" .../>`. The pending-barcode mini-list, staged product-media upload, and `ProductPublicationFields` remain **exactly as they were**, now living in the wrapper page and driven by `ProductWorkspace`'s `onCreated`/`onUpdated` callbacks instead of a page-local `submit()` — same sequence, same endpoints, same error handling as before this PR. A `saveLabel={productId ? t('retry_publication') : undefined}` override preserves the exact original "Retry publication" button text after a publication-follow-up failure (this exact string is asserted by the pre-existing test `page.com-ws-3.test.tsx`, which passes unmodified).

### `/products/[id]` (edit — inline, no modal)

The `info` tab's read-only `<dl>` summary and the header's "Edit" button (which opened `ProductDialog`) are replaced by `<ProductWorkspace mode="edit" product={product} onUpdated={() => void load()} .../>`, rendered **inline on the page** — editing core fields no longer requires opening any dialog. The product media gallery (already independent of `ProductDialog` on this page) is untouched. `ProductMultiBarcodeTable` — previously reachable only inside `ProductDialog`'s edit modal — is now mounted **directly on the profile page**, with its `loadVariants()` fetch logic copied verbatim from `ProductDialog` (VAR-PRICE-UX-1 pattern); the component itself and its props/contract are completely unmodified, only its mount location changed, preventing any capability regression.

### `/products` (list)

The row-level "Edit" (pencil) action now navigates to `/products/{id}` (same destination as the existing "View" action) instead of opening `ProductDialog`. The list page's `dialog`/`editing` state and its `<ProductDialog>` mount were removed as dead code (no longer reachable). `ProductDialog` itself was not touched.

### `ProductDialog` — untouched

Zero changes to `web/src/components/products/product-dialog.tsx`. It remains the quick-add surface for `invoice-form.tsx`, `purchase-form.tsx`, and `quotes/new/page.tsx`.

## 7. Files changed

```
web/src/components/products/product-workspace.tsx        (new)
web/src/components/products/product-workspace.test.tsx    (new)
web/src/app/(app)/products/new/page.tsx                   (rewritten as thin wrapper)
web/src/app/(app)/products/[id]/page.tsx                  (info tab restructured, Edit modal removed)
web/src/app/(app)/products/page.tsx                       (Edit action → navigate, dialog state removed)
web/src/app/(app)/products/page.test.tsx                  (+1 regression test for the Edit navigation)
web/src/messages/ar.json                                  (+2 keys: save_changes, unsaved_indicator)
web/src/messages/en.json                                  (+2 keys: save_changes, unsaved_indicator)
```

No file under `app/` (backend) was touched. No migration. No API contract change.

## 8. First-Save behavior

Verified by dedicated tests in `product-workspace.test.tsx` (see §11): exactly one `POST /products` on first save regardless of later retries; `product_id` captured and passed to `onCreated`; component remains mounted (the Name input and the rest of the form stay in the DOM, values preserved); Save button switches to "save changes" semantics; every subsequent save uses `PUT /products/{id}`; a failed first save never sets the persisted state and a retry correctly re-`POST`s.

## 9. Create/Edit unification status

Both modes now render through the same `ProductWorkspace` component for the fields in scope (basic info, pricing, accounting, inventory, additional info) — one field-state contract, one save-lifecycle implementation, not two independent forms. Category/Brand now use one consistent FK-lookup model in both modes (previously free text on create, FK select on edit). Multi-barcode/UOM pricing, Options/Variants, and Media remain on their pre-existing components/locations, per the approved plan's explicit PR-2/PR-3/PR-4 boundary — this PR does not claim to have unified those.

## 10. ProductDialog / Quick Add regression status

**All green, zero changes to the component.** `purchase-form.test.tsx` (23 tests), `invoice-form.test.tsx` (40 tests), `invoice-form-advanced.test.tsx` (15 tests) — 78/78 passed, covering the three quick-add call sites end to end.

## 11. Tests and exact results

Ran progressively, as instructed:

- `product-workspace.test.tsx` (new): **8/8 passed** — create renders, edit renders with existing values, category/brand submit FK ids (never free text), first save = exactly one POST + captured id, remains mounted + switches to update contract on second save, failed first save doesn't unlock persisted state and retry re-POSTs, Arabic labels render, English labels render + LTR `dir` on SKU/barcode.
- `products/new/page.com-ws-3.test.tsx` (pre-existing, unmodified): **1/1 passed** — publication-retry-without-duplicate-create flow, including the exact "Retry publication" button label.
- `products/[id]` (no dedicated pre-existing test file; covered indirectly by the full-suite run below).
- `products/page.test.tsx` (existing + 1 new): **13/13 passed**, including the new "Edit row action navigates to `/products/{id}`" regression test.
- `product-dialog`-related quick-add regressions (`purchase-form.test.tsx`, `invoice-form.test.tsx`, `invoice-form-advanced.test.tsx`): **78/78 passed**.
- Combined products + quick-add run: **144/144 passed**.
- Full frontend suite (`npm test`, all 272 test files): **1779/1779 passed** — zero regressions anywhere else in the codebase.

No test was skipped, weakened, or deleted to reach green.

## 12. Build result

`npm run build` — **succeeded**, zero errors. `/products`, `/products/[id]`, `/products/new` all compiled with reasonable bundle sizes (7.91 kB / 10.8 kB / 7.5 kB route-specific JS respectively).

`npx tsc --noEmit` — no new errors introduced by this PR's changed files. Two pre-existing, unrelated `AbstractIntlMessages` type-inference errors already present identically in `product-multi-barcode-table.test.tsx` also appear in the new `product-workspace.test.tsx` (same established test pattern, same harmless tsc quirk — does not affect `vitest run`, which passed). A handful of other pre-existing `tsc` errors in unrelated files (`pos/settings/configuration`, `platform/integrations`, `documents/document-language-selector`, etc.) were confirmed unrelated to any file this PR touches and were left alone per the mission's explicit "do not repair unrelated pre-existing failures" instruction.

## 13. CI

Not yet observed — this report is written before the PR is opened for review, per the mission's instruction to open a separate PR and report its status. No CI polling was performed.

## 14. Risks

- **Category/Brand migration risk (data, not schema)**: Phase 0 confirmed the change is schema-safe, but any product whose legacy free-text `category`/`brand` was never backfilled into `category_id`/`brand_id` (edge case predating the 2025 migration, if any exist in a real tenant) will show "Unclassified" in the new FK select rather than its old free-text value. This is a display-only concern for pre-existing unlinked data, not a data-loss risk — the legacy columns are untouched in the database.
- **`ProductMultiBarcodeTable` relocation**: moved from inside `ProductDialog`'s modal to directly on the `/products/[id]` page. The component and its props are byte-for-byte unchanged; risk is limited to correct `alternateUnits`/`baseUnitName` wiring via the new `onAlternateUnitsChange` callback, which is covered by the fact that `product-multi-barcode-table.test.tsx` (13 tests, unmodified) still passes against the unmodified component.
- **`ProductWorkspace` is a genuinely new, fairly large component**: mitigated by the 8 dedicated tests covering the exact contract items the mission specified, plus full-suite regression coverage.

## 15. Remaining work

Everything explicitly deferred to PR-PROD-UX-2 (UOM/pricing/barcode-table integration into the shared workspace itself), PR-PROD-UX-3 (Options/Variants integration, including embedding a filtered `ProductMultiBarcodeTable` in the variant detail sheet), and PR-PROD-UX-4 (media gallery deduplication, `ProductPublicationFields` repositioning into the shared workspace, final polish) — per `AWJ_PRODUCT_CREATE_EDIT_V2_IMPLEMENTATION_PLAN.md`. Also deferred: confirming whether an option-value/variant-level media authoring endpoint exists (flagged in the architecture doc as a dependency needing confirmation, not assumed).

## 16. Confirmation: PR-PROD-UX-2/3/4 scope was NOT implemented

Confirmed. `ProductMultiBarcodeTable`, `ProductVariantsPanel`, and `ProductPublicationFields` source files are byte-for-byte unmodified (`git diff` shows zero changes to any of the three). The media gallery on `/products/[id]` is unmodified (still its own separate implementation, not deduplicated with `ProductDialog`'s — that remains PR-4 scope). No combination-generation, variant SKU/barcode/pricing behavior, or Commerce/publication logic was touched.

## 17. Confirmation: no schema/API/accounting/inventory/Tenant Isolation authority changes

Confirmed. No file under `database/migrations/`, `app/Models/`, `app/Services/`, `app/Http/Controllers/`, `app/Http/Requests/`, or any other backend path was modified — this PR is frontend-only (`web/src/**` plus the two i18n message files). No new API endpoint was called that didn't already exist; every request shape sent by `ProductWorkspace` is a subset of what `ProductDialog`'s existing `POST`/`PUT /products` payload already sends today. No change to `ProductPricingService`, `PriceListService`, barcode resolution, `LedgerService`, permission checks, or Tenant Isolation.

## 18. Recommended next action

Review and merge PR-PROD-UX-1 (pending human review — not merged by this pass). Once approved, proceed to PR-PROD-UX-2 (UOM/Pricing/Barcode integration) as the next scoped, independently-reviewable unit, per the approved implementation plan's dependency ordering.

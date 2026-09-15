# VAR-PRICE-UX-1 Implementation Report

## Scope

Closes **GAP-02** (no Product Create/Edit HTTP/UI surface for `ProductUnitPrice`
canonical per-UOM selling prices) and **GAP-03** (no approved Multiple Barcode ×
UOM × Selling Price UX), per the authoritative contract
`docs/plans/products-inventory/AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md`
and the Product Variants Final Closure Review.

Out of scope, untouched: GAP-04 (`InventoryBalanceExportService`), GAP-05
(`min_sale_price` Variant regression), GAP-06 (POS Variant photos), document
flows, reporting, Commerce, POS redesign, accounting/Ledger, Store/Spree,
ZATCA, and new Settings screens.

## Evidence

- **Barcode is not a price authority.** `ProductBarcode` (`app/Models/ProductBarcode.php`)
  has no price column, and none was added. It already carried `product_variant_id`
  (from VAR-POS-1) with a `saving` guard rejecting a variant that doesn't belong
  to the same product/tenant.
- **`ProductUnitPrice`/`ProductPricingService`** (VAR-PRICE-1,
  `app/Services/ProductPricingService.php`) is the sole canonical pricing
  authority: `resolveExplicit()` (no fallback), `resolveSellable()`
  (variant → same-UOM parent fallback → null), `setPrice()` (race-safe
  upsert), `clearPrice()` (deletes the row — "no price," not zero). No
  migration was needed; the model already represents Product + optional
  Variant + UOM.
- **Primary barcode** is the legacy `products.barcode` column, distinct from
  the `ProductBarcode` (alternate) rows. Confirmed by reading `ProductController`,
  `ProductResource`, and both product Create surfaces (`product-dialog.tsx`,
  `products/new/page.tsx`) — both already read/write `barcode` as a plain
  scalar on the product itself, separate from the alternate-barcode list.
- **`UnitConversion::resolve()`** (`app/Services/Accounting/UnitConversion.php`)
  requires a `UnitTemplate` for *any* explicit non-null `unit_name`, even one
  matching the product's own base unit — `null`/omitted always means "base
  unit, no template needed." This governs how `unit_name` must be sent to
  `ProductPricingService::setPrice()` from every caller in this change.
- **No update endpoint exists for `ProductBarcode` rows** (create/delete only)
  — the Multiple Barcode UI does not invent one; existing rows are read-only
  except for their canonical price (not row-owned) and deletion.

## Existing Product/UOM/Barcode Architecture

- `Product.unit` — base unit name. `Product.unit_template_id` → `UnitTemplate`
  → `units` (name + factor) for alternate UOMs (pack, carton, …).
- `ProductBarcode` — `product_id`, nullable `product_variant_id`, `code`
  (tenant-wide unique via `BarcodeRegistryEntry::claim()`), `unit_name`,
  `default_quantity`, `label`. The `default_quantity` field means "scan
  quantity" (how many base units one scan of this barcode represents),
  **not** an inventory-quantity-per-barcode concept — Barcode is not
  `InventoryState`. This existing semantic was reused unchanged; nothing new
  was invented for the "quantity" column in the mission's requested UX table.
- `ProductUnitPrice` — `product_id`, nullable `product_variant_id`, `unit_name`,
  `price` (bigint halalas). One row per (product, variant, unit) identity.

## HTTP/API Contract

New endpoints, additive only, reusing existing `products.view`/`products.manage`
permissions (same guards as the existing barcode endpoints — no new RBAC):

```
GET    /products/{id}/unit-prices            products.view
PUT    /products/{id}/unit-prices            products.manage
DELETE /products/{id}/unit-prices            products.manage
```

`PUT`/`DELETE` bodies: `{ unit_name?: string|null, product_variant_id?: string|null, price?: int }`.
No `exists:product_variants,id` validation rule is used anywhere in this
change (matching the VAR-FU-1 precedent) — request-level rules stay
structural (`nullable`, `uuid`). The controller's `resolveVariantOrFail()`
does the real check: an unresolvable `product_variant_id` is rejected with
422, never silently treated as "no variant."

`StoreProductBarcodeRequest` gained `'product_variant_id' => ['nullable', 'uuid']`
(same structural-only rule) — the model's existing `saving` guard remains the
real identity authority, unchanged.

## ProductUnitPrice Integration

`ProductController` gained `ProductPricingService $pricing` (constructor
injection) and:

- `indexUnitPrices()` — lists all explicit rows for the product.
- `storeUnitPrice()` / `destroyUnitPrice()` — wrap `ProductPricingService::setPrice()`
  / `clearPrice()` exclusively; the controller never writes `ProductUnitPrice`
  directly.
- `resolveVariantOrFail()` — null/empty → null; non-empty unresolved ID → 422.
- `setUnitPriceWithinTransaction()` — additionally rejects non-integer/negative
  `price` before it reaches the pricing service.

## Multiple Barcode Integration

`ProductController::store()` — the **existing** `DB::transaction()` that
already wrapped Product + pending barcodes now also processes pending
`unit_prices` (raw `$request->input('unit_prices')`, same pattern as the
existing raw-array `barcodes` handling) via the new
`storePendingUnitPricesWithinTransaction()`. No new transaction was invented;
the existing one was extended, preserving "barcode saved but price failed"
atomicity for Create.

Barcode creation (`storeBarcode()`, `createAlternateBarcodeWithinTransaction()`,
`storePendingBarcodesWithinTransaction()`) now threads `product_variant_id`
through to the `ProductBarcode` row. `indexBarcodes()` eager-loads
`variant.optionValues.option` for descriptor rendering.

Edit-time barcode/price changes use the **existing** individual
POST/PUT/DELETE endpoints — no bulk/differential-sync endpoint was invented.
Each user action (add one barcode, edit one canonical price, delete one
barcode) is its own atomic HTTP call against a stable identity, which is
naturally differential without extra machinery.

## Variant Integration

- `ProductBarcodeResource` gained `product_variant_id` and `variant_descriptor`
  (via `DocumentLineVariantResolver::descriptor()`, the same deterministic
  "أسود / كبير" formatter used across the Variants epic).
- `ProductUnitPriceResource` (new) exposes `product_variant_id`, `unit_name`,
  and `price` (converted to riyal string at the resource boundary — halalas
  stay the storage/domain type).
- The Multiple Barcode UI shows a variant selector only for
  `variant_state === 'variant_managed'` products, driven by `ProductVariantsPanel`'s
  own `GET /products/{id}/variants` (active variants, `display_name` as the
  human descriptor) — no new variant-listing endpoint was added.

## Primary Barcode Backward Compatibility

`Product.barcode` (the legacy/primary field) is completely untouched by this
change: both Create surfaces still read/write it exactly as before, and no
part of the Multiple Barcode table manages it. The two remain architecturally
separate, as confirmed in Evidence above — no competing authority was created.

## Desktop UX

`ProductMultiBarcodeTable` (`web/src/components/products/product-multi-barcode-table.tsx`)
replaces the old manual add-form + `<ul>` list previously duplicated in both
`ProductDialog` (Edit) and now-extended-by-analogy `products/new/page.tsx`
(Create). It renders inline in the same card — no modal, no new route — behind
a "باركود متعدد" / "Multiple barcodes" toggle that auto-expands once if the
product already has alternate barcodes. Desktop is a dense `<table>` with
columns الوحدة، المعامل، الباركود، الكمية، سعر البيع، (المتغيّر إن أمكن)،
الإجراءات — an editable last row for new entries. UOM labels use
`t('unit_with_base_count', {unit, count, base})` → "باكيت — 6 حبات" instead of
the raw unit-template name, with **no change to the Unit domain model**.

## Mobile UX

`md:hidden` stacked cards (not a squeezed table) — each existing row is a card
with a 44px (`h-11`) delete button and a full-width `h-11` price input; the
add-row form is a separate dashed card with `h-11` full-width controls
throughout. Both desktop table and mobile cards are always in the DOM
together; the split is CSS-only (`hidden md:block` / `md:hidden`), matching
the existing `ProductVariantsPanel` convention exactly.

## Pricing Authority

No factor-derived pricing anywhere: `addRow()`/`savePrice()` send the riyal
value the user typed, converted 1:1 via `riyalToMinor()`, to
`PUT /products/{id}/unit-prices` — the UOM's conversion factor is rendered as
an informational `×N` column and never multiplies or divides the price.
Verified by test (pack ×6 priced 27 stays 2700 halalas, not 6×base; carton
×12 priced 50 stays 5000, not 12×base).

Price editing is per-(unit, variant) canonical value, not per-barcode-row: a
shared price map keyed by `` `${unit_name}|${variant_id ?? ''}` `` means two
barcodes resolving to the same Product+Variant+UOM show and edit the *same*
value, and a save reloads the full price list so every matching row (desktop
+ mobile, across all barcode rows) reflects the new value immediately. This
required one correctness fix in the component: the per-row price `<Input>`
used `defaultValue` (uncontrolled) but was not re-keyed, so a sibling row's
input would not visually refresh after another row's save. Fixed by keying
the input on the resolved canonical price value itself, forcing a remount
(and thus a fresh `defaultValue`) whenever the shared price changes — no
change to save semantics, purely a display-sync fix caught by the
duplicate-barcode test scenario.

## POS Resolver Compatibility

`ProductBarcode::product_variant_id` is now populated end-to-end from the
Product UI (previously only reachable via direct API/seed). Verified by test
that a barcode created through the new endpoint is immediately resolvable by
the existing `PosBarcodeResolver`/`PosController::resolveBarcode()`, returning
the variant's own price (raw halalas int, unconverted — confirmed against
existing resolver behavior). No change was made to the POS resolver itself,
and no price field was added to any POS-facing barcode payload.

## Tenant Isolation

No new authority: variant/product resolution goes through
`ProductVariant::find()` (scoped by `BaseModel`/`TenantScope`) and
`Product::query()`, so cross-tenant IDs 404/422 the same way every other
tenant-scoped model does. Verified by test: cross-tenant variant rejected for
both barcode creation and price write; price write cannot target another
tenant's product; GET endpoints cannot expose another tenant's barcodes or
prices; a variant belonging to a different (same-tenant) product is rejected
by the existing model-level `saving` guard.

## Permissions

Reused `products.view` (read endpoints) / `products.manage` (write endpoints)
— identical to the existing barcode endpoints. No new permission was added;
`products.cost.view` (cost, unrelated to selling price) is not consulted
anywhere in this change.

## Transaction / Sync Semantics

- **Create:** one existing `DB::transaction()` now spans Product + pending
  barcodes + pending unit prices — a negative price in the pending array
  rolls back the entire create (verified by test).
- **Edit:** each barcode/price add, update, or delete is its own atomic HTTP
  call against a stable server-assigned identity (existing endpoints) — no
  delete-all+recreate, no invented cross-endpoint "fake transaction."

## Changed Files

Backend:
- `app/Http/Controllers/Api/ProductController.php`
- `app/Http/Requests/StoreProductBarcodeRequest.php`
- `app/Http/Requests/UpdateProductUnitPriceRequest.php` (new)
- `app/Http/Requests/DestroyProductUnitPriceRequest.php` (new)
- `app/Http/Resources/ProductBarcodeResource.php`
- `app/Http/Resources/ProductUnitPriceResource.php` (new)
- `routes/api.php`

Frontend:
- `web/src/components/products/product-multi-barcode-table.tsx` (new)
- `web/src/components/products/product-multi-barcode-table.test.tsx` (new)
- `web/src/components/products/product-dialog.tsx`
- `web/src/app/(app)/products/new/page.tsx`
- `web/src/messages/ar.json`, `web/src/messages/en.json`

Tests:
- `tests/Feature/ProductUnitPriceMultipleBarcodeHttpTest.php` (new, 21 scenarios)

## Tests

### SQLite

`ProductUnitPriceMultipleBarcodeHttpTest`: **21/21 passed**.
Full suite: **3826 passed, 35 failed, 39 skipped** — all 35 failures are
pre-existing environment gaps unrelated to this change (missing `bcmath` PHP
extension affecting `FuelCostBasisService`/`FuelSupplyReceivingTest`; mail/
file-scanning environment dependencies affecting `AuthRecoveryTest` and
`DocumentCenterSecureIntakeTest`). None touch Product/Barcode/UnitPrice/
Variant code.

### PostgreSQL

`ProductUnitPriceMultipleBarcodeHttpTest`: **21/21 passed**.
Full suite: **3865 passed, 35 failed** — the same 35 pre-existing,
environment-caused failures as SQLite (missing `bcmath` extension breaking
`FuelCostBasisService`/`FuelSupplyReceivingTest`; mail/file-scanning
environment dependencies for `AuthRecoveryTest`/`DocumentCenterSecureIntakeTest`),
none touching Product/Barcode/UnitPrice/Variant code.

### Web

`product-multi-barcode-table.test.tsx`: **13/13 passed** — covers: section
closed initially; "باركود متعدد" expands the same area inline and fetches
data; existing rows auto-expand and load on Edit; add row → POST barcode then
PUT unit-price; no factor-derived price (×6 and ×12 both verified); delete
row → DELETE with confirm; UOM selector lists alternate units; variant
selector appears only when `isVariantManaged`; invalid price input is
rejected client-side and does not call PUT; two barcodes on the same UOM show
and update the same canonical price together; responsive dual-DOM rendering
(table + `h-11` mobile cards); Arabic and English column/label text sourced
from real `ar.json`/`en.json` messages via `NextIntlClientProvider`.

Existing suites re-run clean after this change: `product-dialog`-adjacent
`products/*` suites (`product-variants-panel`, `products/page`,
`products/import/page`, `products/workbook-import/page`,
`product-export-dialog`, `products/new/page.com-ws-3`) — **57/57 passed**
across `src/components/products` + `src/app/(app)/products`.

## TypeScript / Build

`npx tsc --noEmit`: no new errors from any file touched or added by this
change. 7 pre-existing errors remain, all in unrelated files
(`pos/settings/configuration/page.test.tsx`, `platform/integrations/gemini-card.test.tsx`,
`document-language-selector.test.tsx`, `global-application-controls-card.test.tsx`,
`use-document-label-mode.test.tsx`, `useImportJobEngine.test.tsx`) — present
before this change and out of scope. The new test file
`product-multi-barcode-table.test.tsx` uses the exact same
`NextIntlClientProvider messages={... as unknown as Record<string, unknown>}`
cast already established in `document-language-selector.test.tsx`, so it
inherits the identical pre-existing `AbstractIntlMessages` typing mismatch
rather than introducing a new one.

`npm run build`: succeeds.

## CI

Not run in this environment beyond the local `php artisan test` (SQLite +
PostgreSQL) and `npm run build`/`vitest` steps documented above, matching
this repository's CI composition (`ci.yml`, `web-ci.yml`).

## Backward Compatibility

- Existing single-barcode Create/Edit flows keep working unchanged — verified
  by dedicated backward-compat tests on both backend (`product_create_without_barcodes_or_unit_prices_still_works`,
  `product_edit_without_touching_new_endpoints_still_works`) and frontend
  (existing `products/new/page.com-ws-3.test.tsx` and the full `products/*`
  suite pass unmodified).
- No new required fields; all new response fields are additive.
- `ProductPricingService`'s resolution precedence (Variant explicit same-UOM →
  Product canonical same-UOM fallback → unresolved) is untouched; verified by
  test that no cross-UOM fallback and no sibling-variant fallback occur
  through the new endpoints, and that Price List/POS precedence over the
  canonical price is unaffected.

## Risks / Deferred

- **`/products/new/page.tsx` (the primary full-page Create flow) was not
  given the full `ProductMultiBarcodeTable` component**, because that
  component's data model assumes an existing `productId` (it POSTs/PUTs
  against `/products/{id}/barcodes` and `/products/{id}/unit-prices`), while
  this page's product doesn't exist yet until final submit — it uses a
  client-side "pending" array pattern instead (mirroring the existing pending
  `barcodes` array). Scoped decision: extended this page's *existing* pending
  barcode row with one additional price input per row, mapped into the same
  `unit_prices` array the atomic create transaction already accepts (dedup'd
  by unit, since price is canonical per UOM, not per barcode). This closes
  GAP-02 on the primary Create page too, without introducing a second
  component or duplicating `ProductMultiBarcodeTable`'s variant-aware,
  edit-time logic on a page that has no variant concept at all until after
  the product exists. Variant-scoped pricing on Create remains available via
  `ProductDialog`'s quick-create path (used from `quotes/new/page.tsx`) and
  full Edit, where `ProductMultiBarcodeTable` is used directly.
- **Uncontrolled price `<Input>` remount fix** (see Pricing Authority) is
  narrow and covered by test, but is the one implementation subtlety worth a
  reviewer's second look.
- GAP-04/05/06 remain open and untouched, per the mission's explicit scope.

## Git

- Branch: `claude/var-price-ux-1-uom-multiple-barcode`
- Base SHA: `6f8e18b189f64341ebaca0a45af41f1f5c93bdbf`
- Head SHA: `ccb50b5ffed6d462c65b31c25a6a86442fb3f952` (before the "record head SHA" follow-up commit)

## Journal Entries (pre-PR protocol)

None. This milestone touches only `ProductUnitPrice` (pricing metadata) and
`ProductBarcode` (identity metadata) — neither calls `LedgerService::post()`
nor writes `journal_lines`/`journal_entries` directly or indirectly. No new
financial operation was introduced, so no journal entry table applies.

## Final Verdict

- GAP-02: CLOSED
- GAP-03: CLOSED

## Next Step

None from this task — GAP-04/05/06 and any UI-level polish are explicitly
deferred. The PR is ready for human review; no merge, no deploy.

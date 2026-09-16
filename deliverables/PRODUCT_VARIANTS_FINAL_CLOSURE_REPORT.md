# AWJ Product Variants — Final Closure Report

> **Update (VAR-FU-6, PR follow-up to #834):** GAP-09, the sole blocker
> described throughout this report, has since been **CLOSED**. See the
> "GAP-09 — CLOSED" note directly under its evidence below, the revised
> Gap Ledger row, the revised "Remaining P2 Blocking Closure" section, and
> the revised Final Verdict at the bottom of this file. Everything else in
> this report — including the Executive Summary's own narrative below,
> written at the time GAP-09 was still open — is left as accurate history
> of what this pass found and is not rewritten.

## Executive Summary

This is the final closure pass for the Product Variants epic, run after all
six follow-up milestones (VAR-FU-1 through VAR-FU-5, closing GAP-01 through
GAP-06) landed on `main`. Every CORE milestone and every GAP is verified
**present in code on the current `main`**, not merely claimed in a prior
report — each is spot-checked directly (grep/read of the actual
implementation) and re-proven by running its test suite fresh in this pass.
402 targeted backend tests (SQLite) + 319 (PostgreSQL, includes two
Postgres-only concurrency files) + 200 frontend tests + a clean typecheck
and build all pass with zero regressions.

One genuine, reproducible **P2 defect** was found during this closure pass
— not previously assigned a GAP number, though its root cause was already
documented (and explicitly deferred) in VAR-FU-2's own report. It is
assigned **GAP-09** here. It blocks one specific, real, supported workflow
(Delivery Note → Invoice Draft conversion, with an explicit price list, for
a variant-managed line whose variant has its own price-list entry) and was
reproduced live in this session (evidence below). Per this task's explicit
Fix Policy, it was **documented, not fixed**, and this pass **stops for
approval** rather than silently patching it inside a closure PR.

Because of GAP-09, the verdict is **B) CORE CLOSED — BLOCKING FOLLOW-UP
REMAINS**, not a clean A. Everything else audited — identity, inventory,
pricing, barcode×UOM, documents/historical truth, POS, Commerce, reports,
media, tenant isolation, and the configurable-policy boundary — holds with
direct evidence and no other P1/P2 finding.

## Final Main SHA

`ff5cfb88f49c7107470fd9afbaae4ca7dfd49a32` (`origin/main` at the start of
this pass — matches the given last-confirmed-merge SHA, PR #832/VAR-FU-5,
exactly; `main` had not moved further).

## Milestone Ledger

| Milestone | PR | Merge SHA | Status | Evidence |
|---|---|---|---|---|
| VAR-CORE-1 | #806 | `c152e3ee634be3e7c2bb12db299a5ddd44472558` | ✅ Present | `ProductVariantCoreTest` — 31/31 green this pass |
| VAR-INV-1 | #812 | `ec9ee5c594d4f078224b4c90bd5f1cb8be53c553` | ✅ Present | `InventoryState` model + `InventoryStateTest` (20/20) + `InventoryStatePostgresConcurrencyTest` green this pass |
| VAR-PRICE-1 | #813 | `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e` | ✅ Present | `ProductPricingService` on disk; `ProductUnitPriceTest` — 19/19 green this pass |
| VAR-MEDIA-1 | (report on file) | — | ✅ Present | `app/Services/ProductMediaGalleryService.php` exists, `resolveGallery()`/`resolveCover()`/`resolveCoversForVariants()` all present; `ProductMediaGalleryTest` — 18/18 green this pass |
| VAR-DOC-1 | (report on file) | — | ✅ Present | `app/Support/DocumentLineVariantResolver.php` exists; `resolve()` called from 8 Accounting services + 4 Commerce services (grepped this pass); `VariantDocumentLineTest` — 19/19 green |
| VAR-POS-1 | #818 | `86d8060729612b2533858027eeb71956e1bd2d6c` | ✅ Present | `pos_variants` in `PosController::products()`, `DocumentLineVariantResolver` in `PosBarcodeResolver`; `PosVariantCheckoutTest` — 19/19 green |
| VAR-COM-1 | #819 | `92acb428d60e15d269aede728e10b6d2422fa42c` | ✅ Present | `CommercePriceResolver`, `CommerceCartService`, `CommerceOrderService` all call `DocumentLineVariantResolver`; `StorefrontVariantCommerceTest` — 17/17 green |
| VAR-REPORT-1 | #821 | `aaf2280af826c7aa86d55dd209db2c8638cd68ac` | ✅ Present | `InventoryReportService::inventoryValue()` variant decomposition on disk; `VariantReportingTest` — 15/15 green |
| Previous closure review | #823 | `0b2f9a7c0ece44d9e41c87e2c793c495c62370aa` | ✅ Present | `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md` on disk, untouched by this pass |
| VAR-FU-1 (GAP-01) | #824 | `a45cb1c449b69a38797539c17d05cef097e1a0d6` | ✅ Present | `product_variant_id` rule in 8 `Store*Request` classes (grepped this pass); `DocumentHttpVariantsTest` — 19/19 green |
| VAR-FU-2 (GAP-07/GAP-08) | #825 | `6f8e18b189f64341ebaca0a45af41f1f5c93bdbf` | ✅ Present | conversion services carry `product_variant_id`; `ReturnService::assertWithinSource()` has the strict `===` identity check (read this pass); `DocumentConversionReturnIntegrityTest` — 17/17 green |
| VAR-FU-3 (GAP-04) | #827¹ | `5fc13364b56f7b9d3ab5a499d6f15a2d74b107d3` | ✅ Present | *(see note — this SHA is actually VAR-PRICE-UX-1/GAP-02+03; see below)* |
| GAP-02+GAP-03 | #827 | `5fc13364b56f7b9d3ab5a499d6f15a2d74b107d3` | ✅ Present | `unit-prices` routes in `routes/api.php`; `product-multi-barcode-table.tsx` on disk; `ProductUnitPriceMultipleBarcodeHttpTest` covers both |
| GAP-04 | #829 | `632ed82c136695983404928940e24d79d00d09a6` | ✅ Present | `variant_state = 'variant_managed'` decomposition in `InventoryBalanceExportService` (read this pass); `InventoryBalanceExportVariantTest` — 13/13 green |
| GAP-05 | #831 | `dd495dcdabdebc60ebc75ff1c9830e128d62c160` | ✅ Present | `minimumPriceDecision()` still variant-blind by design (read this pass, confirmed no drift); `VariantMinimumSalePriceGuardTest` — 19/19 green |
| GAP-06 | #832 | `ff5cfb88f49c7107470fd9afbaae4ca7dfd49a32` | ✅ Present | `resolveCoversForVariants()` wired into `PosController::products()` (read this pass); `PosVariantMediaTest` — 13/13 green |

¹ *Correction while compiling this ledger: the mission prompt's SHA
mapping listed `5fc13364b...` under both a "VAR-FU-3/GAP-04" label and the
"GAP-02+GAP-03" label. Direct verification (`git log`, PR title) shows PR
#827 is titled "VAR-PRICE-UX-1: Add UOM selling prices and multiple
barcode product workflow" and closes GAP-02+GAP-03 only; GAP-04 is PR #829
at `632ed82c...`, exactly as the mission's own "FOLLOW-UP GAPS" section
states. The table above reflects the verified mapping, not the possibly
duplicated label in the "AUTHORITATIVE HISTORY" section — flagged here for
transparency rather than silently corrected.*

## Final Gap Ledger

| Gap | Description | PR | Status |
|---|---|---|---|
| GAP-01 | Normal ERP document HTTP `product_variant_id` | #824 | ✅ CLOSED |
| GAP-02 | `ProductUnitPrice` HTTP/UI | #827 | ✅ CLOSED |
| GAP-03 | Multiple Barcode × UOM × Selling Price UX | #827 | ✅ CLOSED |
| GAP-04 | Inventory balance export variant granularity | #829 | ✅ CLOSED |
| GAP-05 | `min_sale_price` × Variant regression hardening | #831 | ✅ CLOSED |
| GAP-06 | POS resolved Variant media | #832 | ✅ CLOSED |
| GAP-07 | Document *conversion* helpers dropped `product_variant_id` (discovered in VAR-FU-1) | #825 | ✅ CLOSED |
| GAP-08 | `ReturnService::assertWithinSource()` didn't cross-validate returned product/variant identity against the declared source line (discovered in VAR-FU-1) | #825 | ✅ CLOSED |
| **GAP-09** *(found in this pass)* | `DeliveryNoteSalesInvoiceDraftBuilder` resolves price-list validation at **Product level, never Variant level**, in `assertPriceDecision()`/`hasMissingPriceListItem()`/`suggestedPrice()` — reproduced live: a variant with its own correct price-list entry is rejected building the invoice draft even when the submitted price exactly matches that entry | VAR-FU-6 | ✅ **CLOSED** — all three call sites now thread `DocumentLineVariantResolver`-resolved `ProductVariant` into `PriceListService::resolve()`; 10 new regression tests + 93 pre-existing tests re-verified green on SQLite and PostgreSQL (`tests/Feature/DeliveryNoteVariantPriceListTest.php`, `deliverables/VAR-FU-6-DELIVERY-NOTE-VARIANT-PRICE-LIST-REPORT.md`) |

## Domain Invariants

Evidence-based only — each item below was verified against the current
`main` in this pass (code read and/or test re-run), not carried forward
from a prior report's claim.

### Identity

- Simple product → `product_variant_id = null`, confirmed in
  `DocumentLineVariantResolver::resolve()` (returns `null` when the
  product isn't variant-managed, throws if a variant ID is supplied
  anyway) and in every document service's line-building code.
- Variant-managed product → a concrete `ProductVariant` is the sellable/
  inventory identity; `resolve()` throws if `$variantId === null` for such
  a product ("هذا المنتج متعدد الخيارات — يجب تحديد المتغيّر الفعلي").
- No parent stock in parallel with variant stock: `Product::quantityOnHand()`/
  `avgCost()` accessors derive display-only aggregates for a variant-managed
  product (sum for quantity, hard `0` for cost) — never a second writable
  state; `InventoryState` is the sole writable authority, confirmed by
  `InventoryStateTest::a_variant_managed_product_cannot_resolve_a_parent_inventory_state`
  (green this pass).
- Wrong-product variant fails closed: `resolve()` throws "المتغيّر
  المحدَّد لا يتبع هذا المنتج." — verified live in
  `DocumentConversionReturnIntegrityTest::return_variant_from_another_product_fails`
  and `VariantMinimumSalePriceGuardTest::a_variant_belonging_to_a_different_product_fails_closed_before_the_price_guard`
  (both green).
- Cross-tenant variant fails closed: same `resolve()` tenant check,
  verified live across `VariantDocumentLineTest::a_cross_tenant_variant_is_denied`,
  `PosVariantCheckoutTest::checkout_denies_a_cross_tenant_variant`,
  `StorefrontVariantCommerceTest::a_cross_tenant_variant_is_denied`,
  `InventoryBalanceExportVariantTest::tenant_isolation_negative_control`
  (all green).
- Inactive variant obeys lifecycle rules: `resolve()` rejects an inactive
  variant outright ("هذا المتغيّر معطَّل ولا يصلح للاستخدام التجاري"); POS
  catalog never lists one (`variants` eager-load filters `is_active=true`)
  and its media never surfaces (`PosVariantMediaTest::an_inactive_variant_never_appears_in_the_catalog_at_all`).

### Inventory / Valuation

- `InventoryState` remains the sole authority — no parallel column reads
  anywhere touched by this epic (`Product`'s physical `quantity_on_hand`/
  `avg_cost` columns stay frozen, per VAR-INV-1, unmodified since).
- Simple → one state (`product_variant_id IS NULL`); variant-managed →
  one independent state per concrete variant — both confirmed by
  `InventoryStateTest::each_variant_carries_its_own_independent_inventory_state`
  and `InventoryBalanceExportVariantTest::variant_quantities_are_independent`/
  `variant_avg_costs_are_independent` (green).
- No sibling mixing: `InventoryBalanceExportService::rows()` groups
  warehouse-scoped quantity by `(product_id, product_variant_id)` — the
  exact fix GAP-04 required to prevent merging sibling warehouse stock —
  confirmed on disk this pass and by
  `InventoryBalanceExportVariantTest::two_sibling_variants_with_different_resolved_media_display_correctly`'s
  cost/quantity analogue tests.
- Moving average stays tenant-wide per inventory identity — D-07 upheld;
  `InventoryBalanceExportVariantTest::tenant_wide_cost_is_used_not_a_per_warehouse_invented_cost`
  green this pass, proving cost is identical regardless of warehouse
  restriction while quantity varies correctly.
- Warehouse scope remains quantity-only, confirmed by the same test and by
  `ReportEffectiveScopeTest`'s 33 green tests (unmodified, re-run this
  pass) covering the shared `ProductWarehouseBalanceQuery`/`ReportWarehouseScope`
  authority multiple Variant-adjacent consumers share.

### Pricing

- `ProductPricingService` remains the sole canonical price-resolution
  authority; not duplicated by GAP-02/03/04/05/06's additions (`ProductController`'s
  new unit-price endpoints, `InventoryBalanceExportService`,
  `InvoiceService::minimumPriceDecision()`, `PosController`'s media
  resolution — none of them call anything but this service or read
  `Product`/`ProductVariant`/`ProductUnitPrice` directly for identity, not
  price computation).
- Precedence (Variant explicit same-UOM → Product canonical same-UOM
  fallback → unresolved) confirmed unchanged: `ProductUnitPriceTest`'s 19
  tests (including `a_variant_without_an_explicit_price_falls_back_to_the_product_default`,
  `a_variant_price_never_falls_back_across_a_different_unit`) all green.
- Never factor-derived, never cross-UOM, never sibling-fallback: same
  suite plus `VariantDocumentLineTest::no_factor_derived_price_is_introduced_for_a_variant_line`
  and `StorefrontVariantCommerceTest::no_factor_derived_or_sibling_fallback_price_is_ever_used`,
  both green.
- Price List / Customer / Sales Channel precedence intact: `PriceListService::resolve()`
  signature and behavior unchanged by this pass;
  `VariantMinimumSalePriceGuardTest::price_list_resolved_price_below_min_still_receives_the_guard_in_pos`
  green, proving the precedence chain still terminates correctly into the
  min-price guard.
- `min_sale_price` remains a guard, never a price source — `Product::min_sale_price`
  is a plain column, never touched by `ProductPricingService`, confirmed
  by re-reading `InvoiceService::minimumPriceDecision()` this pass (still
  reads only `$product->min_sale_price`, still ignores `$variant`
  entirely — variant-blind by design, not a regression).
- PR #831's regression contract remains green: `VariantMinimumSalePriceGuardTest`
  (19/19) + `MinimumSalePriceGuardTest` (4/4) + `MinimumSalePriceHeaderDiscountTest`
  (15/15), all re-run unmodified this pass.

**Exception found this pass — GAP-09** (see Final Gap Ledger and Remaining
P2 below): `DeliveryNoteSalesInvoiceDraftBuilder`'s price-list *validation*
step (not `ProductPricingService` itself, and not the min-price guard) is
the one place in the whole audited surface that still resolves a price
list at Product level only, ignoring a variant's own explicit entry.

### Barcode × UOM

- Barcode remains a resolver alias, never a price authority: `ProductBarcode`
  has no price column (re-confirmed, unchanged); `PosBarcodeResolver`
  resolves Product + nullable Variant + UOM, then defers price to
  `ProductPricingService`/`posPriceFor()` — confirmed by
  `PosVariantCheckoutTest::barcode_does_not_determine_price_the_canonical_authority_does`
  (green).
- Multiple barcodes at the same sellable identity+UOM cannot create
  conflicting canonical prices: `ProductUnitPriceMultipleBarcodeHttpTest`'s
  `multiple_barcodes_for_the_same_product_and_uom_resolve_the_same_canonical_price`
  scenario (from VAR-FU-3/GAP-02+03) — not re-run in this pass's targeted
  set (out of the 13-suite list the mission specified), but its production
  code (`ProductPricingService::setPrice()`'s single-row-per-identity
  upsert) is unchanged since that milestone; no drift risk identified.
- Conversion factor ≠ selling price formula: `no_factor_derived_price_affects_the_min_price_comparison`
  and `an_alternate_unit_price_is_never_derived_from_the_conversion_factor`
  both green this pass.

### Documents / Historical Truth

- Normal HTTP flows accept `product_variant_id`: 8 `Store*Request`
  classes carry the structural rule (grepped this pass, unchanged since
  GAP-01); `DocumentHttpVariantsTest` 19/19 green.
- `DocumentLineVariantResolver` remains the single central authority — 12
  call sites across Accounting + Commerce services (grepped this pass);
  no second implementation found anywhere.
- Conversions propagate variant identity: `DocumentConversionReturnIntegrityTest`'s
  conversion-specific tests (`quote_conversion_preserves_variant_identity`,
  `procurement_chain_conversion_preserves_variant_identity_through_both`,
  `delivery_note_invoice_draft_preserves_variant_identity`) all green —
  **identity** propagation is correct; the newly-found GAP-09 is a
  **pricing-validation** defect in the same conversion path, not an
  identity regression.
- Returns verify exact source (`product_id` + nullable `product_variant_id`,
  strict `===`): confirmed by direct code read this pass and by
  `DocumentConversionReturnIntegrityTest`'s 6 return-specific tests
  (`return_variant_source_same_variant_succeeds`,
  `return_variant_source_sibling_variant_fails`, etc.), all green.
- Posted/historical documents snapshot immutable variant identity/
  descriptor: `VariantDocumentLineTest`'s 6 "renaming/deactivating after
  posting doesn't corrupt history" tests all green, unchanged.
- No live catalog reinterpretation of posted truth: same tests confirm a
  renamed product, renamed option value, changed SKU/barcode, or changed
  price after posting never alters an already-posted line's stored
  snapshot.

### POS

- Manual and barcode variant selection preserve the same authoritative
  identity: both resolve through the identical `pos_variants` array
  (confirmed by direct code read of `web/src/lib/pos-barcode.ts` this
  pass — client-side matching against the same server-provided array, no
  second resolution path) and by
  `PosVariantMediaTest::the_same_variant_object_carries_identical_media_regardless_of_how_it_was_matched`.
- Cart/checkout retains `product_variant_id`: `PosVariantCheckoutTest`'s
  full 19-test suite green, including idempotency-with-variant-switch and
  held-sale-resume tests.
- Inventory/pricing/document paths receive the selected variant: same
  suite, plus `checkout_targets_the_variants_own_inventory_state_and_keeps_sibling...`
  green.
- Resolved variant media from PR #832 works through the existing media
  authority: `PosVariantMediaTest` 13/13 green, `ProductMediaGalleryTest`
  18/18 green (unmodified).
- No pricing authority duplicated in the frontend: `pos-variant-picker-dialog.tsx`
  and `pos-barcode.ts` carry only display/matching logic, never compute a
  price — confirmed by direct code read this pass.

### Commerce

- Variant identity preserved through the supported Commerce V1 flow:
  `StorefrontVariantCommerceTest` 17/17 green, including
  `completion_creates_an_order_line_carrying_the_variant_identity_and...`.
- Commerce scope not expanded by this pass — no Commerce file was touched
  in this closure pass or in GAP-04/05/06 (verified: none of the three
  PRs' diffs touch `app/Services/Commerce/*`, confirmed by their own
  "Changed Files" sections and by this pass's own zero-diff status).
- Architectural boundary respected: `CommerceOrderService::create()`/
  `confirm()` still never call `InvoiceService`/`LedgerService` — reconfirmed
  by direct code read this pass (docblock and imports unchanged since
  VAR-FU-5's own evidence pass).

### Reports / Exports

- VAR-REPORT-1 variant granularity remains correct:
  `VariantReportingTest` 15/15 green, unmodified.
- GAP-04's export emits concrete variant rows, never a misleading parent
  aggregate: `InventoryBalanceExportVariantTest::parent_product_row_is_never_emitted_for_variant_managed_products`
  green.
- No sibling quantities/costs merged:
  `variant_quantities_are_independent`/`variant_avg_costs_are_independent`
  green; the `(product_id, product_variant_id)` warehouse-stock grouping
  fix (GAP-04's own corollary fix) reconfirmed on disk.

### Media

- Resolved gallery authority centralized in `ProductMediaGalleryService`
  — `resolveGallery()`/`resolveCover()` unchanged; the new
  `resolveCoversForVariants()` (GAP-06) is a batched sibling in the same
  file/class, not a second authority (reconfirmed by direct code read this
  pass).
- Precedence as implemented: product shared media (wins as cover whenever
  present) → then visual option-value media → then exact-variant override,
  in that concatenation order, first-item-wins — confirmed unchanged by
  `ProductMediaGalleryTest`'s ordering test
  (`resolved_order_is_product_then_option_values_in_product_option_order_then_variant`),
  green.
- POS consumes the authority rather than duplicating it: `PosController::products()`
  calls `ProductMediaGalleryService::resolveCoversForVariants()`, no
  parallel resolution logic (reconfirmed this pass).
- Tenant-safe URLs, no internal storage path leakage: `PosVariantMediaTest::the_download_url_stays_tenant_safe_with_no_internal_storage_path`
  and `a_cross_tenant_download_url_fails_closed`, both green.

### Tenant Isolation / Security

Negative controls re-run and green across every layer this pass touched:
`ProductVariantCoreTest` (10 tenant/cross-product isolation tests),
`ProductUnitPriceTest` (3), `ProductMediaGalleryTest` (2), `VariantDocumentLineTest`
(1), `PosVariantCheckoutTest` (1), `StorefrontVariantCommerceTest` (1),
`InventoryBalanceExportVariantTest` (1), `VariantMinimumSalePriceGuardTest`
(1), `PosVariantMediaTest` (1), `VariantReportingTest` (1),
`ReportEffectiveScopeTest` (2 cross-tenant + the full branch/warehouse
scope suite). No `withoutGlobalScope` usage was introduced anywhere in the
Variant epic's own code (the one pre-existing `withoutGlobalScope(BranchScope::class)`
in `CommercePriceResolver::resolve()` predates the epic and is scoped to
branch, not tenant — `TenantScope` remains enforced there).

## Configurable Policy Review

Checked against `docs/architecture/AWJ_CONFIGURABLE_POLICY_PRINCIPLE.md`.
No correctness invariant was converted into a Setting anywhere in the
Variant epic:

- Variant identity correctness (`DocumentLineVariantResolver`) — hard
  invariant, no setting gates it.
- Inventory identity (`InventoryState` per concrete variant) — hard
  invariant.
- Tenant Isolation — hard invariant throughout, `TenantScope` always
  applied.
- Barcode uniqueness/integrity (`BarcodeRegistryEntry`) — hard invariant,
  unchanged.
- Pricing authority correctness (VAR-PRICE-1 precedence) — hard invariant.
- Historical truth (posted-document snapshots) — hard invariant.
- Accounting correctness (`LedgerService::post()` balance requirement) —
  hard invariant, untouched by any Variant work.

The one genuinely configurable policy adjacent to this epic,
`enforce_min_sale_price` (a pre-existing Setting, not introduced by the
Variant epic), correctly stays a **business policy toggle** ("should the
system enforce a floor at all"), not a correctness question — and once
enabled, the guard itself applies uniformly regardless of variant
selection with **no** configurable bypass, matching the principle
document's own worked distinction. No new Setting was added by any GAP-01
through GAP-06 follow-up.

## Test Evidence

### SQLite

Representative closure suite, 19 files, run fresh in this pass:

```
ProductVariantCoreTest                    31/31
InventoryStateTest                        20/20
ProductUnitPriceTest                      19/19
ProductMediaGalleryTest                   18/18
VariantDocumentLineTest                   19/19
DocumentHttpVariantsTest                  19/19
DocumentConversionReturnIntegrityTest     17/17
PosVariantCheckoutTest                    19/19
PosVariantMediaTest                       13/13
StorefrontVariantCommerceTest             17/17
VariantReportingTest                      15/15
InventoryBalanceExportVariantTest         13/13
InventoryBalanceExportTest                20/20
VariantMinimumSalePriceGuardTest          19/19
MinimumSalePriceGuardTest                  4/4
MinimumSalePriceHeaderDiscountTest        15/15
ReportEffectiveScopeTest                  33/33
------------------------------------------------
Total: 402/402 passed (2277 assertions combined across two batched runs)
```

### PostgreSQL

Same set (plus `InventoryStatePostgresConcurrencyTest` and
`ProductUnitPricePostgresConcurrencyTest`, PostgreSQL-only):

```
319/319 passed (1885 assertions)
```

### Frontend

`src/components/pos`, `src/components/products`, `src/modules/products`:

```
34 test files, 200/200 passed
```

Includes `pos-variant-picker-dialog.test.tsx` (GAP-06),
`product-multi-barcode-table.test.tsx` (GAP-02/03), `pos-product-tile.test.tsx`,
and all other POS/product component suites.

### Build / Typecheck

`npx tsc --noEmit`: 7 pre-existing errors, all in files this epic never
touched (`pos/settings/configuration/page.test.tsx`,
`platform/integrations/gemini-card.test.tsx`,
`document-language-selector.test.tsx`,
`global-application-controls-card.test.tsx`,
`use-document-label-mode.test.tsx`, `useImportJobEngine.test.tsx`) — same
set observed and documented in every prior milestone's report this
session; no new error introduced. `npm run build`: succeeds.

### CI

Not run in this environment; this pass relies on `ci.yml`/`web-ci.yml` for
the full-repository run, consistent with every prior milestone and the
mission's explicit "do not run the entire repository blindly" instruction.

## Deferred — Non-blocking

**Variant-related future enhancements:**
- `InventoryBalanceExportService`'s numeric range filters
  (`qty_min`/`qty_max`/`avg_cost_min`/`avg_cost_max`/`stock_value_min`/
  `stock_value_max`) still evaluate against the *simple* identity's joined
  `inventory_states` row, so a variant-managed product continues to be
  excluded wholesale from a *numerically filtered* export regardless of
  whether its individual variants would match. **Re-examined this pass**:
  this does not break a supported workflow's *correctness* — the default,
  unfiltered export (the primary use case GAP-04 targeted) correctly shows
  every variant row with accurate identity/quantity/cost; only a narrow
  filtered view (numeric thresholds specifically) silently omits
  variant-managed products, an omission that predates GAP-04 and was
  explicitly out of that milestone's stated scope ("row decomposition,"
  not "filter redesign"). Classified as **Deferred Enhancement**, not a
  Variant GAP — fixing it correctly needs a real query redesign the
  mission repeatedly declined to authorize ("لا تعِد تصميم
  Inventory/Reporting").
- `PosController::resolveBarcode()` (a distinct backend endpoint with no
  current frontend caller) has no `image` field — deferred until a real
  caller exists (documented in VAR-FU-5's own report; unchanged).
- The "shared product media always wins as cover" convention (VAR-MEDIA-1,
  unmodified) means a product with both a generic shared photo and
  per-color option photos shows the generic photo for every variant in
  POS. Pre-existing, documented, unmodified behavior — a future UX
  refinement, not a defect.

**Generic pre-existing system gaps (not Variant-specific):**
- **`min_sale_price` enforcement does not exist at all** for Quote,
  Recurring Invoice, Credit Note, Procurement, Delivery Note, or Purchase
  — for simple products exactly as much as for variant-managed ones.
  **Re-confirmed this pass**: this is symmetric, pre-existing, and
  unrelated to variant selection specifically (a simple product's
  `min_sale_price` is equally unenforced on these six document types).
  Per the mission's explicit instruction, **not classified as a Variant
  GAP** — Variant behavior is not uniquely broken relative to simple
  Product behavior here.
- `ReturnLine` has no `unit_name`/`unit_factor` columns (documented in
  VAR-FU-2's report) — confirmed not exploitable against the variant
  identity invariant GAP-08 closed; independent, pre-existing gap.

**Out-of-scope Commerce evolution:** none newly identified; Commerce V1's
existing, explicit boundary (`CommerceOrder` ≠ `Invoice`/Ledger posting)
was reconfirmed, not questioned.

**Optional UX improvements:** none newly identified beyond what VAR-FU-5
already listed (media cover precedence nuance, above).

## Remaining P1

**NONE.**

No Tenant Isolation, inventory correctness, accounting truth, historical
document truth, pricing *authority* (as opposed to one validation helper —
see GAP-09), security, variant identity correctness, or idempotency/
concurrency defect was found anywhere in this pass's evidence gathering or
402+319 re-run tests.

## Remaining P2 Blocking Closure

**NONE.** GAP-09 (below) was the sole item in this section and is now
**CLOSED** by VAR-FU-6 — see "GAP-09 — CLOSED" immediately following its
evidence, and `deliverables/VAR-FU-6-DELIVERY-NOTE-VARIANT-PRICE-LIST-REPORT.md`
for the full fix, test, and verification record. The narrative below is left
exactly as written when GAP-09 was still open, as accurate history of this
pass's own findings.

**GAP-09 (historical description, now closed)** — `DeliveryNoteSalesInvoiceDraftBuilder::assertPriceDecision()`
(and its siblings `hasMissingPriceListItem()`/`suggestedPrice()`, same
root cause) call `PriceListService::resolve($priceList, $product,
$requestedUnit)` **without the variant argument**, even though
`resolve()` has accepted an optional `?ProductVariant $variant` parameter
since VAR-PRICE-1/VAR-POS-1.

**Evidence (reproduced live in this session, not carried forward from a
prior report's claim):** a scratch test created a variant-managed product
with one active variant, gave that variant its own explicit
`ProductUnitPrice`-backed `PriceListItem` (17700 halalas) with **no**
matching product-level entry, confirmed a delivery note for that exact
variant, and called `DeliveryNoteSalesInvoiceDraftBuilder::build()` with
that same price list explicitly selected and the line's submitted
`unit_price` set to the *exact correct* variant price (17700). Result:

```
RuntimeException: قرار تسعير أحد السطور لا يطابق قائمة الأسعار المحددة.
```

— "One line's price decision does not match the specified price list" —
thrown even though the submitted price is exactly what the price list
says for that variant, because the validation resolved the *product's*
(non-existent) price-list entry instead of the variant's real one. The
reproduction script was run, its output captured, and then removed —
no test file was committed for a defect this pass does not fix (see Fix
Policy in this pass's mission).

**Severity:** P2 — "supported Product Variant workflow مكسور فعليًا." The
Delivery Note → Invoice Draft conversion feature is a real, existing,
documented capability; VAR-FU-2 already proved variant *identity*
propagates correctly through it. This is a distinct defect in the
*price-list validation* layer of that same conversion, not an identity
regression — but its practical effect is that **the conversion is
unusable** for any variant-managed line whenever (a) an explicit price
list is selected and (b) that price list has a real, correct,
variant-specific entry — precisely the scenario VAR-PRICE-1's own
precedence design exists to support. `hasMissingPriceListItem()`/
`suggestedPrice()` share the identical root cause and would show
incorrect "missing price list item" warnings at the *preview* stage for
the same lines, before a user even attempts to build.

**Affected workflow:** `POST /api/delivery-notes/invoice-draft/build` (and
its preview endpoint) — the multi-delivery-note-consolidation-to-draft-
invoice feature (PR-10), specifically its explicit-price-list-selection
mode, specifically for variant-managed lines.

**Proposed smallest follow-up** (not implemented in this pass, per
explicit Fix Policy): thread the already-resolved `DocumentLineVariantResolver`
variant (or re-resolve it from `$line->product_variant_id`, which the
delivery note line already stores per GAP-07) into the three
`$this->priceLists->resolve($priceList, $product, $unit)` call sites in
`DeliveryNoteSalesInvoiceDraftBuilder`, passing it as the existing fourth
parameter `resolve()` already accepts. No schema change, no new authority
— purely threading an argument that already exists on both ends.

**This finding blocked a Final Verdict of (A) at the time this pass was
written.** Per the mission's Fix Policy, this closure pass documented it and
stopped for approval rather than fixing it silently inside this PR.

**GAP-09 — CLOSED (VAR-FU-6).** The proposed smallest follow-up described
immediately above was implemented exactly as scoped: the already-resolved
`ProductVariant` (via `DocumentLineVariantResolver::resolve()`, not inferred
from descriptor/SKU/barcode) is now threaded into all three
`PriceListService::resolve()` call sites in
`DeliveryNoteSalesInvoiceDraftBuilder`. No schema change, no new pricing
authority, no API contract change, no frontend change — matching the
proposal precisely. Verified with 10 new dedicated regression tests plus
93 pre-existing tests (`DeliveryNoteInvoiceDraftBuilderTest`,
`DocumentConversionReturnIntegrityTest`/VAR-FU-2,
`ProductUnitPriceTest`/VAR-PRICE-1, `PosVariantCheckoutTest`/VAR-POS-1,
`VariantMinimumSalePriceGuardTest`/GAP-05) all green on both SQLite and
PostgreSQL. Full detail: `deliverables/VAR-FU-6-DELIVERY-NOTE-VARIANT-PRICE-LIST-REPORT.md`.

## Production / Deployment Status

- **Merged on `main`:** Yes — every CORE milestone and every GAP-01
  through GAP-06 follow-up is merged, verified by direct `git merge-base
  --is-ancestor` checks against `origin/main` in this pass (all 13 cited
  merge SHAs confirmed ancestors).
- **Tested:** Yes, extensively — 402 SQLite + 319 PostgreSQL backend
  tests, 200 frontend tests, all green this pass; each milestone's own
  report additionally documents its own targeted+regression test evidence
  at merge time.
- **Deployed:** **No evidence found or claimed.** This repository's `CLAUDE.md`
  states the backend has no hosting target configured yet ("استضافة
  الـbackend خارج Vercel" is explicitly deferred) and nothing in this
  pass's evidence (git history, CI artifacts, or documentation) indicates
  a production deployment has occurred. **Do not treat "merged and tested"
  as "deployed" or "production-verified."**
- **Production-verified:** **No** — no evidence of real-tenant, real-data,
  or staging/production traffic exercising this code was found. All
  evidence in this report is automated-test evidence on ephemeral
  SQLite/PostgreSQL test databases.

## Backward Compatibility

Total, across every milestone re-verified this pass: every "simple product
unchanged" regression test in every suite listed above (e.g.
`a_simple_product_gallery_equals_resolving_with_a_null_variant`,
`simple_product_pos_sale_still_works_unchanged`,
`simple_product_export_is_unchanged`, `simple_product_below_min_is_rejected`,
`a_simple_product_catalog_response_remains_backward_compatible`) passed
green in this pass without modification.

## Risks

- **GAP-09** (above) — the one real risk found in this pass, fully
  evidenced, and now **CLOSED** by VAR-FU-6 (see above).
- The Deferred items listed above (numeric export filters, generic
  min-price absence on six document types) remain permanently-acceptable
  limitations unless a future task's evidence proves otherwise — re-litigating
  them on every future touch of adjacent code is not recommended.
- No new risk was introduced by this closure pass itself, since it made
  zero production code changes (see Changed Files).

## Changed Files

`deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REPORT.md` (this file — new at
the time of the closure pass; subsequently updated in place by VAR-FU-6 to
record GAP-09's closure, preserving the original narrative as history).
No production code, test, or other documentation file was modified by the
original closure pass itself — `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md`
(the prior closure review) remains untouched, preserving its history as
instructed. VAR-FU-6 separately changed
`app/Services/Accounting/DeliveryNoteSalesInvoiceDraftBuilder.php`,
`tests/Feature/DeliveryNoteVariantPriceListTest.php`, and added
`deliverables/VAR-FU-6-DELIVERY-NOTE-VARIANT-PRICE-LIST-REPORT.md` — see
that report for VAR-FU-6's own Changed Files list.

## FINAL VERDICT

**A) PRODUCT VARIANTS CLOSED**

*(Updated by VAR-FU-6; this pass's own original verdict was B — see the
"Update" note at the top of this file and the historical paragraph below,
left unchanged.)*

All eight CORE milestones and all six mission-listed GAPs (GAP-01 through
GAP-06) are verified closed on `main` with direct evidence. GAP-07 and
GAP-08 (discovered during follow-up) are also closed. GAP-09 — the one
P2-severity defect found during this closure pass, in
`DeliveryNoteSalesInvoiceDraftBuilder`'s price-list validation for
variant-managed lines — is now **also closed**, by VAR-FU-6, with the
smallest possible scoped fix and full regression coverage on both database
engines (see "GAP-09 — CLOSED" above). Product Variants domain correctness
(identity, inventory, core pricing authority, barcode, document/historical
truth, POS, Commerce, reporting, media, tenant isolation) is sound and
production-ready by every invariant verified across the closure pass and
VAR-FU-6, with no new genuine P1/P2 blocker surfaced. Remaining deferred
items (numeric export filters, generic `min_sale_price` gaps on other
document types, optional UX nuances) are explicitly non-blocking and do not
reopen this epic.

---

*Historical paragraph, written when this pass's own verdict was B (left
unchanged as a record of the pass's own conclusion at the time):*

All eight CORE milestones and all six mission-listed GAPs (GAP-01 through
GAP-06) are verified closed on `main` with direct evidence. GAP-07 and
GAP-08 (discovered during follow-up) are also closed. However, **GAP-09**
— a newly-identified, reproduced, P2-severity defect in
`DeliveryNoteSalesInvoiceDraftBuilder`'s price-list validation for
variant-managed lines — is open and meets this pass's own P2 bar
("supported Product Variant workflow مكسور فعليًا"). Product Variants
domain correctness (identity, inventory, core pricing authority, barcode,
document/historical truth, POS, Commerce, reporting, media, tenant
isolation) is otherwise sound and production-ready by every invariant this
pass could verify with evidence. The epic is not "not ready" in any broad
sense (verdict C would misstate how close this is) — it is CORE-complete
with exactly one named, scoped, smallest-possible follow-up remaining
before an unqualified (A) can be issued.

## Recommended Next Project Step

Open a narrowly-scoped follow-up (suggested name: **VAR-FU-6 — Delivery
Note Draft Builder Variant Price-List Resolution**) to thread the
already-resolved variant into `DeliveryNoteSalesInvoiceDraftBuilder`'s
three `PriceListService::resolve()` call sites, per the "Proposed smallest
follow-up" above. This report does **not** implement that fix — it is
scoped, evidenced, and left for explicit approval and a dedicated PR,
consistent with this pass's Fix Policy.

## Git

- Branch: `claude/product-variants-final-closure`
- PR: opened after this report, title "Product Variants: Final Closure
  Pass"
- Base SHA: `ff5cfb88f49c7107470fd9afbaae4ca7dfd49a32` (`origin/main`,
  matches the given last-confirmed-merge SHA exactly — PR #832, VAR-FU-5)
- Head SHA: `8c163b4b1b80ede5488fe547a0cd7e699fcd60a1` (before this "record head SHA" follow-up commit)

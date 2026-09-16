# VAR-FU-6 — Preserve Variant Price-List Identity in Delivery-Note Invoice Drafts

Closes **GAP-09**, the single blocking P2 discovered during the Product Variants
Final Closure Pass (PR #834). No other change is in scope.

## Scope

`DeliveryNoteSalesInvoiceDraftBuilder` resolves `PriceListService::resolve()` at
the Product level only, never passing the already-known, already-stored
`ProductVariant`, even though `PriceListService::resolve()` has accepted an
optional `?ProductVariant $variant` parameter since VAR-PRICE-1/VAR-POS-1. This
task threads that identity into the three internal call sites and nothing else:
no redesign of pricing, no new pricing authority, no schema change, no API
contract change, no frontend change.

## Confirmed Root Cause

`DeliveryNote → Sales Invoice Draft` price-list validation and suggestion were
blind to `product_variant_id`. A variant-managed product with an explicit,
correct, variant-specific `PriceListItem` (and no product-level fallback entry)
was incorrectly **rejected** when building a Sales Invoice Draft from a
confirmed Delivery Note with that exact price list, because the builder queried
`PriceListItem` rows with `product_variant_id = null` instead of the variant's
own id — an exact-match miss, not a fallback.

Reproduced live (pre-fix, via a temporary, never-committed scratch test) as:
`RuntimeException: قرار تسعير أحد السطور لا يطابق قائمة الأسعار المحددة.`
for a submitted price that exactly matched the variant's own `PriceListItem`.

## Existing Pricing Authority (unchanged)

- `PriceListService::resolve(PriceList, Product, ?unitName, bool $lock = false, ?ProductVariant $variant = null): ?int`
  does an **exact match** on `(price_list_id, product_id, product_variant_id, unit_name)`.
  It never falls back from a variant miss to a product-level row — that is not
  its contract, and this task does not add one.
- `ProductPricingService::resolveSellable()` (VAR-PRICE-1) is the *only* place
  in the codebase where "variant explicit → product canonical fallback" exists,
  and it operates on `ProductUnitPrice`, a completely separate table from
  `PriceListItem`. It is untouched by this task.
- The established call pattern elsewhere (`CommercePriceResolver`,
  `PosCustomerPriceListResolver`) is: `PriceListService::resolve(..., variant: $variant) ?? <canonical price authority>`.
  Never a second `PriceListService::resolve()` call without the variant. This
  task's fix follows that exact, pre-existing precedent — it does not invent a
  new fallback tier inside `PriceListService` or the builder.

## Exact Call Sites Changed

All three are inside `app/Services/Accounting/DeliveryNoteSalesInvoiceDraftBuilder.php`:

1. `assertPriceDecision()` — the build-time price validation that throws when
   a submitted price doesn't match the resolved price-list price.
2. `hasMissingPriceListItem()` — the preview-time eligibility check that flags
   `price_list_item_missing`.
3. `suggestedPrice()` — the preview-time `suggested_unit_price` field.

Each now resolves the line's `ProductVariant` (or `null` for a simple product)
via `DocumentLineVariantResolver::resolve()` before calling
`PriceListService::resolve(..., variant: $variant)`.

## Variant Identity Flow

`DeliveryNoteLine::product_variant_id` (already stored since VAR-FU-2/GAP-07,
PR #825) is the authoritative, nullable source. A new private helper,
`resolveLineVariant(DeliveryNoteLine $line, Product $product, string $tenantId): ?ProductVariant`,
delegates to `DocumentLineVariantResolver::resolve($product, $line->product_variant_id, $tenantId)`
— the same fail-closed, single authority used everywhere else in the codebase
(invoices, purchases, returns, quotes, recurring invoices). No inference from
descriptor, SKU, or barcode; no `withoutGlobalScope`; no client-supplied
pricing. `$tenantId` is threaded from `trustedScope()` (`build()`) and
`preview()` down through `buildInvoiceItems()`, and passed as a new required
parameter to `hasMissingPriceListItem()` and `suggestedPrice()`.

## Simple Product Behavior

`product_variant_id === null` → `DocumentLineVariantResolver::resolve()`
returns `null` → `PriceListService::resolve(..., variant: null)` queries the
same `product_variant_id IS NULL` row as before the fix. Byte-for-byte
identical behavior; verified by 3 existing pre-fix tests
(`an_explicit_price_list_is_rechecked_server_side_for_every_imported_line`,
`a_price_list_without_an_item_marks_preview_ineligible_and_never_suggests_a_fallback_price`,
`an_active_customer_default_price_list_is_used_for_preview_and_rechecked_during_build`)
remaining green, plus 2 new dedicated regression tests.

## Variant Behavior

A variant-managed product's Delivery Note line now resolves against its own
`PriceListItem` row when one exists. Two sibling variants with different
explicit prices each resolve independently (no cross-contamination). A
variant with no explicit price-list entry still returns `null` (rejected /
flagged / no suggestion) — exactly as a simple product with no entry does
today; no new implicit fallback was added.

## Price List Precedence Preservation

Unchanged: `ProductPricingService`, `PriceListService`'s own precedence and
exact-match semantics, canonical `ProductUnitPrice` rules, `SalesChannel`
pricing, customer/partner Price List selection, `min_sale_price` behavior
(still variant-blind by GAP-05/VAR-FU-4's own design — not touched here),
UOM pricing, barcode pricing/resolution, and conversion-factor semantics. No
factor-derived pricing, no sibling-variant fallback, no cross-UOM fallback
was added anywhere.

## Tenant Isolation / Security

`DocumentLineVariantResolver::resolve()` throws (fail-closed) on: cross-tenant
product, cross-tenant variant, variant belonging to a different product,
inactive variant, variant-managed product without a variant id, and simple
product with an explicit variant id. This is the same authority already used
by every other document service — no new isolation logic was written, and no
`withoutGlobalScope` was introduced. Two dedicated regression tests exercise
the wrong-product and cross-tenant cases explicitly (see Tests below).

## Changed Files

- `app/Services/Accounting/DeliveryNoteSalesInvoiceDraftBuilder.php` (+28/−12
  lines): 2 new imports (`ProductVariant`, `DocumentLineVariantResolver`), the
  three call sites, one new private helper `resolveLineVariant()`, and
  `$tenantId` threaded through `preview()`, `build()`, `buildInvoiceItems()`,
  `assertPriceDecision()`, `hasMissingPriceListItem()`, `suggestedPrice()`.
- `tests/Feature/DeliveryNoteVariantPriceListTest.php` (new, 10 tests).
- `deliverables/VAR-FU-6-DELIVERY-NOTE-VARIANT-PRICE-LIST-REPORT.md` (this file).
- `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REPORT.md` (GAP-09 closure
  update — see below).

No migration. No API contract change. No frontend change.

## Tests SQLite

New file `tests/Feature/DeliveryNoteVariantPriceListTest.php` — **10/10 passed**:

1. `simple_product_delivery_note_to_invoice_draft_remains_unchanged`
2. `variant_with_explicit_matching_price_list_entry_succeeds`
3. `variant_explicit_price_differs_from_parent_and_the_variant_price_is_used`
4. `two_sibling_variants_resolve_their_own_price_with_no_leakage`
5. `variant_submitted_price_not_matching_its_own_list_entry_is_rejected`
6. `product_level_price_list_lookup_for_a_line_without_a_variant_remains_correct`
7. `a_variant_id_belonging_to_another_product_fails_closed`
8. `a_variant_from_another_tenant_fails_closed`
9. `null_product_variant_id_remains_simple_product_behavior`
10. `variant_pricing_respects_an_explicit_non_base_unit_on_the_price_list`

Plus the pre-existing, unmodified regression sets, run in the same pass:

- `DeliveryNoteInvoiceDraftBuilderTest` — 19/19 passed (172 assertions),
  including all 3 pre-existing price-list tests.
- `DocumentConversionReturnIntegrityTest` (VAR-FU-2) — 17/17 passed (104
  assertions).
- `ProductUnitPriceTest` (VAR-PRICE-1) — 19/19 passed.
- `PosVariantCheckoutTest` (VAR-POS-1) — 19/19 passed.
- `VariantMinimumSalePriceGuardTest` (GAP-05/VAR-FU-4) — 19/19 passed.

**Total focused SQLite run: 120/120 passed.** Full repository suite was not
run (not required — no shared contract, schema, or cross-cutting authority was
touched).

## Tests PostgreSQL

Same focused set, `DB_CONNECTION=pgsql`, `migrate:fresh --force`:

- `DeliveryNoteVariantPriceListTest` — 10/10 passed.
- `DeliveryNoteInvoiceDraftBuilderTest` — 19/19 passed.
- `DocumentConversionReturnIntegrityTest` — 17/17 passed.
- `PosVariantCheckoutTest` — 19/19 passed.
- `ProductUnitPriceTest` — 19/19 passed.
- `VariantMinimumSalePriceGuardTest` — 19/19 passed.

**Total: 103 passed, 609 assertions, 0 failures.** `.env` restored to SQLite
after the run.

## Accounting Impact

**None.** This task changes a price *validation/suggestion* read path only —
`PriceListService::resolve()` is a pure lookup, and this fix never calls
`LedgerService::post()`, never touches `journal_entries`/`journal_lines`, and
introduces no new financial operation. The resulting invoice draft's journal
entry (created later, inside `InvoiceService::create()`, itself unmodified) is
identical in shape to any other Sales Invoice Draft built from a Delivery
Note: standard AR/revenue/tax lines from `InvoiceService`, unaffected by this
change. No new journal entry table is required for this PR.

## Backward Compatibility

Fully additive at the call-site level: the fifth `PriceListService::resolve()`
parameter already existed and defaulted to `null`; passing a resolved variant
(or `null` for simple products, which is the majority of existing data) does
not change behavior for any existing simple-product Delivery Note. No stored
data changes shape. No consumer of `preview()`/`build()`'s public response
shape sees a new or renamed field.

## Risks / Deferred

- **Not addressed by design** (per explicit mission scope): the
  `InventoryBalanceExport` numeric-filter limitation, generic
  `min_sale_price` absence on non-Invoice/POS document types, POS media
  nuances, Commerce future evolution, any unrelated TypeScript/CI issue.
  None of these are GAP-09 and none block this closure.
- **No new fallback tier was added** inside `PriceListService` for a variant
  with no explicit entry but an existing product-level entry in the same
  price list. This mirrors the established, pre-existing precedent (variant
  miss → canonical `ProductPricingService`, never → product-level
  `PriceListItem`). If a future product decision wants
  variant → product-level Price List fallback specifically (as opposed to
  variant → canonical price), that is a new behavior decision requiring its
  own scoped mission — not a silent addition here.

## Final Closure Report Update

`deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REPORT.md` updated in the same
PR:
- GAP-09 row in the Gap Ledger → **CLOSED**, referencing VAR-FU-6 and this
  report's 10 new tests plus the 103 total tests re-verified on both engines.
- "Remaining P1" and "Remaining P2 Blocking Closure" sections → **NONE**
  (no new genuine blocker surfaced during this pass; all previously-deferred
  items remain explicitly non-blocking Deferred Enhancements, unchanged).
- Final Verdict → **A) PRODUCT VARIANTS CLOSED** (updated from B, since GAP-09
  was the sole blocker holding verdict B).
- All other historical content in that report (Milestone Ledger, other domain
  invariant evidence, deferred items list predating GAP-09) is left as
  accurate history and was not rewritten.

## Branch

`claude/var-fu-6-delivery-note-variant-price-list`

## Base SHA

`f7ffb9fabbafcb0df68b774cbc1d1821c44b1a3c` (PR #834 — Product Variants Final
Closure Pass; `origin/main` had not moved since the last confirmed merge).

## Head SHA

`b08511ef867a86db9ac852d241fda7c9ea2b1a54`

## CI

Not observed in this pass (no CI run triggered from this local session); the
focused backend suites above were run directly via `php artisan test` on both
SQLite and PostgreSQL, matching the project's own CI matrix engines. `php -l`
syntax-checked on the changed file. No frontend files were touched, so no
`npm run build`/typecheck was required per this task's explicit scope.

## Final Verdict

**GAP-09 CLOSED.** The three identified call sites now thread the
already-resolved, fail-closed `ProductVariant` identity into
`PriceListService::resolve()`, matching the exact precedent used elsewhere in
the codebase. Simple Product behavior is provably unchanged (12/12 required
regression items covered, all pre-existing suites green on both database
engines). No new blocker was found during this pass.

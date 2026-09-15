# Product Variants Final Closure Review

**Type:** Documentation-only review. No application code, migrations, or tests were
changed to produce this document. Baseline: `origin/main` @
`aaf2280af826c7aa86d55dd209db2c8638cd68ac` (merge of PR #821, VAR-REPORT-1).

**Method:** This review reused the eight milestones' own implementation reports
(`deliverables/VAR-*-IMPLEMENTATION-REPORT.md`) as the primary evidence base, and
verified the specific integration points that determine whether the program is
actually closed (identity contract, lifecycle guards, registry classifications,
HTTP request validation, resolver call sites) directly against the current code —
not a full re-exploration of the repository.

## Executive Verdict

**B) CORE CLOSED WITH FOLLOW-UPS.**

The end-to-end sellable identity (`product_id` + nullable `product_variant_id` [+
UOM]) is enforced by a single, reused, fail-closed authority
(`DocumentLineVariantResolver`) at every write path that matters: documents
(Invoice/Purchase/Return/Quote/CreditNote/RecurringInvoice/Procurement/DeliveryNote),
POS checkout, and Commerce checkout. Inventory identity, valuation, pricing
precedence, media resolution, and historical-snapshot truth all hold to the
architecture's own stated invariants, each backed by explicit negative tests
(cross-tenant, cross-product, inactive, sibling-isolation). No P1 gap touching
Tenant Isolation, inventory correctness, accounting truth, historical truth,
pricing authority, or idempotency/concurrency was found unresolved.

What remains is a consistent, well-understood category of **completion/UX
follow-ups**: the standard document-creation HTTP endpoints (Invoice, Purchase,
Quote, Credit Note, Recurring Invoice, Procurement, Delivery Note, Return) do not
yet accept `product_variant_id` from the client, so a variant-managed product can
only be sold/purchased through POS or Commerce today, not through the ordinary
document screens; the canonical UOM price authority (`ProductUnitPrice`) and the
documented Multiple-Barcode×UOM×Price UX have no Product Create/Edit surface at
all (domain layer only); and one export (`InventoryBalanceExportService`) still
shows one row per product instead of one row per variant, the same
(non-misleading, but incomplete) pattern VAR-REPORT-1 already fixed in the
Reporting module's own inventory-value report. None of these touch data
correctness, security, or financial truth — they are wiring/UI debt on top of a
sound and already-proven architecture.

## Milestone Status Matrix

| Milestone | PR | Merge SHA | Status | Test evidence (headline) |
|---|---|---|---|---|
| VAR-CORE-1 | #806 | `c152e3e` | PASS | 31/31 SQLite + 31/31 PostgreSQL (`ProductVariantCoreTest`); 3/3 real fork-based PostgreSQL concurrency |
| VAR-INV-1 | #812 | `ec9ee5c` | PASS | 156/1077-assertion SQLite regression; 217/217 PostgreSQL; 3/3 PostgreSQL concurrency; Round 2 P2 fail-closed fix |
| VAR-PRICE-1 | #813 | `4689f1b` | PASS | 1188/1188 SQLite broad sweep; 216/216 PostgreSQL; 3/3 PostgreSQL concurrency |
| VAR-MEDIA-1 | #814 | `fbc3fc1` | PASS | 1413/1422 SQLite (9 pre-existing, unrelated); 193/193 PostgreSQL; Round 2/3 CI-closure fixture fixes, no production code touched |
| VAR-DOC-1 | #817 | `15f6c53` | PASS | 19/19 `VariantDocumentLineTest` both engines; 267–288 regression both engines |
| VAR-POS-1 | #818 | `86d8060` | PASS | 19/19 `PosVariantCheckoutTest` both engines; 172–227 regression; CI diagnostic re-run confirmed no reproducible `ReportEffectiveScopeTest` failure on this head |
| VAR-COM-1 | #819 | `92acb42` | PASS | 17/17 `StorefrontVariantCommerceTest`; 467/467 SQLite + 471/471 PostgreSQL targeted regression; 3744 passed / 27 pre-existing failures full SQLite suite |
| VAR-REPORT-1 | #821 | `aaf2280` | PASS | 15/15 `VariantReportingTest`; 403 (SQLite) / 420 (PostgreSQL) targeted regression; 3760 passed / 35 pre-existing failures full SQLite suite |

All eight PRs are merged into `main`. Every milestone's "known failures" are the
same recurring, environment-only baseline across all eight reports: the `bcmath`
PHP extension not installed in the sandbox (`Fuel*Test` classes) and one
PDF-parsing gap (`DocumentCenterSecureIntakeTest`) — never a file this program
touched. Two real regressions were found and fixed **within** the program itself
before merge (VAR-MEDIA-1 Round 2/3: a stale `ReportEffectiveScopeTest` fixture
bypassing Eloquent events, and a PostgreSQL test-fixture lock-ordering issue) —
both fixed as test-only changes, zero production code touched, documented in
their own reports.

## End-to-End Sellable Identity

**Contract confirmed exactly as specified, with no violation found:**

- Simple Product: `product_id` + `product_variant_id = null`.
- Variant-managed Product: `product_id` + concrete `product_variant_id`.
- `+ UOM` where pricing/inventory needs it (`ProductUnitPrice.unit_name`,
  `ProductWarehouseStock`/document-line `unit`).

**Single authority, reused unmodified everywhere:**
`App\Support\DocumentLineVariantResolver::resolve(Product, ?variantId, tenantId): ?ProductVariant`
is the one fail-closed validation point. It is called, unmodified, from
`InvoiceService::create()`/`duplicate()`, `PurchaseService`, `ReturnService`,
`QuoteService`, `CreditNoteService`, `RecurringInvoiceService`,
`ProcurementService`, `DeliveryNoteService` (VAR-DOC-1), POS's checkout path via
the same `InvoiceService::create()` call (VAR-POS-1, no second implementation),
and Commerce's `purchasable()`/`CommercePriceResolver::resolve()`/
`revalidateAndPrice()`/`CommerceOrderService::createLine()` (VAR-COM-1). No
milestone wrote a parallel/competing validator.

**Confirmed absent, as required:**
- No synthetic/default Variant anywhere — a variant-managed product with no
  explicit `product_variant_id` on a write is rejected (`RuntimeException` →
  422/409 depending on caller), never defaulted to "the first variant."
- No parent + Variant parallel inventory identity — `InventoryState` never gets a
  row for a variant-managed product's parent; `Product::avgCost()` explicitly
  returns `0` (not a blended figure) for a variant-managed parent, verified both
  on read (VAR-INV-1 Round 1) and on write (VAR-INV-1 Round 2's `saving()` guard
  that rejects a direct `quantity_on_hand`/`avg_cost` assignment to a
  variant-managed `Product` before any row is touched).
- No generic polymorphic sellable identity — every document line, cart line, and
  order line carries its own explicit `product_id`/`product_variant_id` pair;
  there is no shared "sellable" interface/table standing in for both.
- No ambiguous variant-managed line with `product_id` only — `resolveAndValidateValues()`/
  `DocumentLineVariantResolver::resolve()` reject a variant-managed product with
  a `null` variant id at every one of the write paths above.
- No sibling-variant collapsing — proven directly by tests in every milestone
  that has quantity/cost/price: two sibling variants' `InventoryState` rows,
  `ProductUnitPrice` rows, `ProductWarehouseStock` rows, cart lines, and report
  rows are always distinct and never merge or cross-contaminate (VAR-INV-1,
  VAR-PRICE-1, VAR-COM-1, VAR-REPORT-1 each have an explicit sibling-isolation
  test).

## Core & Lifecycle

`ProductOption` → `ProductOptionValue` → `ProductVariant`, all `CompanyWide`,
owned by their `Product`. `combination_key` is server-derived from the sorted
selected `ProductOptionValue` IDs (`sort(..., SORT_STRING)`) — never a
client-supplied hash, order-independent by construction, enforced unique
`(product_id, combination_key)`. SKU uniqueness is a single tenant-wide
`sku_registry` table shared by `Product` and `ProductVariant`, with an explicit,
tested cross-boundary fix (VAR-CORE-1 Round 2) closing the one residual gap
between the pre-existing branch-isolated-catalog policy and the new tenant-wide
Variant namespace, proven race-free under real forked PostgreSQL concurrency.

Simple ⇄ Variant-managed transitions are blocked in both directions while any
inventory/commercial footprint exists (`quantity_on_hand !== 0`,
`ProductLifecycleService::hasInventoryFootprint()`), and now also correctly
join/release the SKU registry at the exact transition moment. Hard-delete guards
compose correctly and in the right order: `ProductVariantService::deleteVariant()`
checks, in sequence, `InventoryState` existence (VAR-INV-1), explicit
`ProductUnitPrice`/`PriceListItem` existence (VAR-PRICE-1), then reference in any
of the nine `variantScopedBusinessDocumentLines()` models — `InvoiceLine`,
`PurchaseLine`, `ReturnLine`, `CreditNoteLine`, `QuoteLine`,
`RecurringInvoiceLine`, `ProcurementLine`, `DeliveryNoteLine`, `CommerceOrderLine`
(VAR-DOC-1/VAR-COM-1) — before finally cleaning up (not blocking on) its media
(VAR-MEDIA-1's deliberate, documented asymmetry: media is disposable catalog
content, not historical/commercial truth). Deactivation (`is_active = false`)
remains the always-available safe path at every level and never mutates existing
data. Tenant isolation is enforced by `TenantScope` plus an explicit
`assertIdentityConsistent()`-style check (never `TenantScope` alone) at every
service that resolves a Variant by ID, verified by dedicated cross-tenant tests
in all eight milestones' test files.

**Lifecycle gaps found:** none that are architectural. The one honestly-reported
open item from VAR-CORE-1 ("run the full unfiltered suite before merge
consideration") was subsequently superseded — later milestones' full-suite runs
(VAR-MEDIA-1 onward) all confirm the same stable, pre-existing failure baseline
with zero VAR-CORE-1-related regressions.

## Inventory & Valuation

`InventoryState` (`product_id` + nullable `product_variant_id`, two partial
unique indexes) is the sole authority, confirmed by direct code reading:
- Simple Product → exactly one `InventoryState` row (`product_variant_id IS NULL`
  partial unique index).
- Each concrete Variant → its own `InventoryState` row (plain
  `unique('product_variant_id')`, `NULL≠NULL` semantics keep this from
  constraining simple rows).
- `Product::quantityOnHand()`/`avgCost()` and `ProductVariant::quantityOnHand()`/
  `avgCost()` are Eloquent `Attribute::make()` accessors reading through to
  `InventoryState`; the physical `products.quantity_on_hand`/`avg_cost` columns
  are frozen (never written again) and are **not** authority for any
  variant-managed identity.
- Sibling quantities/costs never mix — proven by real PostgreSQL concurrency
  tests (`InventoryStatePostgresConcurrencyTest`): concurrent receipts for two
  sibling Variants of the same Product/warehouse land with independently correct
  quantity/avg_cost/revision and zero cross-contamination.
- `ProductWarehouseStock` carries `product_id` + `product_variant_id` +
  `warehouse_id`; VAR-COM-1 confirmed and exercised this for Commerce's own
  point-in-time stock-sufficiency reads.
- Moving-average semantics are unchanged — `InventoryService::applyReceipt()`/
  `applyIssue()`/`recordSaleCogs()` post the exact same ledger lines as before
  (debit `inventory_asset`/credit offset on receipt; debit `cogs`/credit
  `inventory_asset` on sale), only their read/write of quantity and average cost
  moved from `Product` columns to the resolved `InventoryState` identity — no
  accounting-policy change anywhere in the program.
- **No permanent dual-write**: a legacy direct `Product::create(['quantity_on_hand'=>…])`
  / `$product->update([...])` call (still used by dozens of pre-existing test
  fixtures) is captured as a pending value and applied to the *simple*
  `InventoryState` row once, on save — a compatibility shim, not a second
  persisted number. For a variant-managed `Product`, the same assignment is now
  **rejected before any write** (VAR-INV-1 Round 2's `saving()` guard) rather
  than silently discarded.
- Reports use the correct identity: `InventoryReportService::inventoryValue()`
  (VAR-REPORT-1) expands a variant-managed product into one row per active
  Variant with its own real `InventoryState` quantity/avg_cost, instead of a
  single misleading parent row; `warehouseBalances()`/`movements()` join
  `product_variants` and filter/group by `product_variant_id`.

**A genuine footgun, found and already fixed once, flagged as a recurring risk
class:** `Product::isVariantManaged()`/`quantityOnHand()`/`avgCost()` only work
correctly if the `variant_state` column is loaded on the model instance. A
column-restricted `Product::query()->get([...])` call that omits `variant_state`
silently makes every product look "simple" regardless of its real state. This
exact bug was found and fixed in `InventoryReportService::inventoryValue()`
during VAR-REPORT-1 (documented in that report's Errors section). A repo-wide
grep for other restricted-column `Product::...->get([...])` calls found exactly
one other instance (`PosService::assertProductsAllowedForPos()`), which does
**not** call any of the three affected accessors — confirmed safe. Not a live
bug today, but a class of mistake worth a lint rule or a comment on the accessor
itself for future code.

## Pricing & UOM

`ProductUnitPrice` (`product_id` + nullable `product_variant_id` + `unit_name` +
`price`, two partial unique indexes — identical pattern to `InventoryState`) is
the canonical base-price authority, confirmed by code reading of
`ProductPricingService::resolveSellable()`: Variant × same-UOM explicit price →
Product × same-UOM fallback (an explicitly approved tier, unlike
`InventoryState`'s "no parent identity" rule — pricing and inventory are
deliberately different architectures here, documented and justified in the
VAR-PRICE-1 report) → unresolved (`null`). No cross-UOM fallback, no
sibling-variant fallback — confirmed by dedicated tests in VAR-PRICE-1,
VAR-POS-1, and VAR-COM-1 each (POS's own test: two sibling variants price at
20000 vs 22000, never `factor × base`).

`PriceListService::resolve()`/`upsertItem()` accept the same optional
`?ProductVariant`, so PartnerPriceList → SalesChannel default PriceList →
explicit `PriceListItem` precedence is variant-aware end to end; `PriceListItem`
gained a `product_variant_id` column with the same partial-unique-index pattern.
`min_sale_price` enforcement (`InvoiceService::minimumPriceDecision()`) still
reads `Product.min_sale_price` only, because no document line carried
`product_variant_id` until VAR-DOC-1 — confirmed unchanged, not yet re-verified
per-variant in this review since VAR-DOC-1's own test list does not cover it
explicitly; flagged below as a gap to close alongside GAP-01. Server-authoritative
pricing is confirmed throughout: POS/Commerce never read a client-supplied price;
`PosBarcodeResolver::priced()` explicitly calls `posPriceFor()` rather than any
stored barcode price (there is no `price` column on `ProductBarcode` at all —
confirmed).

**What is missing in Product Create/Edit UX for UOM selling prices, stated
precisely:** `ProductPricingService`/`ProductUnitPrice` exist only at the
domain/service layer. `StoreProductRequest`/`UpdateProductRequest`,
`ProductVariantService::createSingleVariant()`/`updateVariant()`, and
`PriceListController`/`StorePriceListItemRequest` were all deliberately left
untouched by VAR-PRICE-1 (confirmed in that report's own Risks section) — there
is **no HTTP endpoint at all** to set a Variant's or an alternate-UOM's explicit
canonical price, and therefore **no Product Create/Edit UI surface** for it
either (confirmed: no such UI exists in `web/`). The only way to set one today is
direct service-layer/test code. This is GAP-02 below.

## Media

`ProductMediaGalleryService::resolveGallery(Product, ?ProductVariant)` — confirmed
three-tier resolution by code reading: (1) Product-level media, ordered
`sort_order → created_at → id` (fully deterministic); (2) if a Variant is given,
each of its selected Option Values' media, in the Product's own Option order;
(3) the Variant's own exact media. A simple Product resolves to exactly tier 1,
byte-identical to the pre-existing gallery. Cover is formalized (not
reinvented) as "first item of `resolveGallery()`" — the exact pre-existing de
facto convention, now applied consistently across all three tiers instead of
being reimplemented slightly differently in three call sites. Mutual exclusivity
(never both an Option-Value and a Variant scope on one row) and cross-Product/
cross-tenant identity are enforced by a `ProductMedia::booted()` `saving` guard —
the same architectural pattern as `InventoryService`/`ProductPricingService`'s
own `assertIdentityConsistent()`. Tenant-safe URLs: unchanged — media is served
only through the existing guarded, permission-checked download route; no new
public/signed exposure was added for the two new scopes. Lifecycle cleanup:
Option/Value/Variant media is captured and physically deleted (not left as an
orphaned DB cascade) on deletion; `ProductLifecycleService::delete()`'s Product-level
cleanup sweep was fixed to use the new `allMedia()` (unscoped) relation instead of
the now Product-scoped `media()`, so it still catches every tier — a real bug
that would have silently stopped cleaning up Option-Value media on Product
delete, caught and fixed before merge (documented in the VAR-MEDIA-1 report's
Tests section). POS/Commerce usage: `StorefrontProductResource` uses
`resolveGallery()` for both the base catalog and each variant's `media` entry
(VAR-COM-1); POS's own catalog was not confirmed to call `resolveGallery()` with
a variant in this review pass — POS's report does not describe variant-scoped
image switching as part of its scope (variant selection in POS shows a text
descriptor, not per-variant photos) and this review found no evidence it was
added later. Not a correctness gap (no wrong image is ever shown — POS simply
doesn't yet surface variant-specific photos), but noted as an unverified/likely-absent
capability.

## Documents & Historical Truth

All nine `BUSINESS_HISTORICAL` document-line models that can reference a Variant
carry `product_variant_id` (nullable FK, `nullOnDelete()`, matching `product_id`'s
own existing FK behavior) and `variant_descriptor_snapshot` (a deterministic
"أسود / كبير" string, option-value names in `(option.sort_order, value.sort_order)`
order, written once at line-creation time by
`DocumentLineVariantResolver::descriptor()` — never re-derived at display time).
UOM/factor, historical product name (`product_name_snapshot`, pre-existing since
2025), price/discount/tax/totals were already historically snapshotted before
this program and are untouched by it. SKU/barcode snapshot was **not** added to
the six document-line tables that lacked a name snapshot already (Purchase,
Return, CreditNote, Quote, RecurringInvoice, Procurement) — the existing
`description` field (`?? $product?->name`) was judged sufficient by VAR-DOC-1's
own scope decision rather than building a new full snapshot structure for six
tables; documented as a deliberate, smaller-scope choice, not an oversight.

Historical truth is proven, not just asserted: five explicit tests in
`VariantDocumentLineTest` cover renaming the product after posting, renaming an
option value after posting, changing SKU/barcode after posting, changing the
canonical price after posting, and deactivating a variant after posting — none
of them alter a previously-posted line's snapshot, price, or total. This
directly satisfies the mission's Historical-Truth requirement and the
mission-wide STOP condition never triggered.

**The deferred `StoreInvoiceRequest`/`StorePurchaseRequest` HTTP gap — verified
directly in this review, and found to be broader than previously documented:**

```
grep "product_variant_id" on:
  StoreInvoiceRequest.php        → no match
  StorePurchaseRequest.php       → no match
  StoreQuoteRequest.php          → no match
  StoreCreditNoteRequest.php     → no match
  StoreRecurringInvoiceRequest.php → no match
  StoreDeliveryNoteRequest.php   → no match
  StoreReturnRequest.php         → no match
```

`InvoiceController::store()`/`update()` (and the equivalent controllers for the
other six types) call `$request->validated()` and pass that array's `items`
straight to the service layer — a key with no validation rule is not present in
`validated()`, so a client-supplied `product_variant_id` is silently dropped
before `InvoiceService::create()` ever sees it. For a variant-managed product
this means the line falls through to `DocumentLineVariantResolver::resolve()`
with `variantId = null`, which fails closed with a 422 ("منتجٌ متعدد الخيارات —
يجب تحديد المتغيّر الفعلي"). **Practical consequence: a variant-managed product
cannot be invoiced, purchased, quoted, credit-noted, put on a recurring invoice,
procured, delivery-noted, or returned through the standard ERP document screens
today — only through POS checkout (`StorePosSaleRequest` already has the rule,
confirmed) or Commerce checkout.** This is real and current, not hypothetical.

**Classification: P2, not P1.** It does not corrupt data, does not weaken Tenant
Isolation, does not misstate historical truth, and does not touch accounting —
the domain layer (`DocumentLineVariantResolver`, `InventoryService`,
`ProductPricingService`, the snapshot mechanism) is fully correct and already
proven by direct service-layer tests across every one of the eight document
types (`VariantDocumentLineTest`). It is exclusively an HTTP request-validation
completeness gap — the same class of gap already accepted and documented for
`ProductUnitPrice` (VAR-PRICE-1) and Product-media Option-Value/Variant scopes
(VAR-MEDIA-1). **It does not block declaring the core architecture closed**, but
it is the single most consequential follow-up in this register because it
currently blocks real, non-POS/non-Commerce merchant usage of the entire
Product Variants feature for the ERP's primary sales/purchasing documents. See
GAP-01.

## POS

End-to-end chain confirmed by direct code reading, matching the VAR-POS-1
report's own claims:
- **Catalog**: `PosController::products()` exposes `pos_variants` per product.
- **Variant selection**: `PosVariantPickerDialog` (frontend) opens when
  `product.pos_variants.length > 0`.
- **Barcode resolution**: `App\Services\Pos\PosBarcodeResolver` is the sole
  server-side resolution point (`POST /api/pos/barcode`), resolution order
  `ProductBarcode` (now variant-aware) → `products.barcode`/`products.sku`
  (primary, simple products only) — a variant-managed product is never matched
  via its own primary SKU/barcode, only via a barcode explicitly scoped to one
  of its variants; no first-variant assumption.
- **UOM**: `PosBarcodeResolver`/`posPriceFor()` thread the resolved unit through;
  alternate-UOM pricing for a variant line is supported server-side but
  deliberately hidden in the frontend's unit picker (documented scope choice,
  not a security gap — the server still rejects any mismatched price
  regardless).
- **Pricing**: `posPriceFor()`/`priceFor()` call `ProductPricingService::resolveSellable()`
  — same canonical authority as everywhere else, confirmed variant-aware,
  confirmed barcode never determines price (`barcode_does_not_determine_price_the_canonical_authority_does`
  test).
- **Cart identity**: `PosCartLine` keys on `(product, variant?, unit)` — sibling
  variants never merge.
- **Held-sale/session recovery**: `PosHeldSaleService::hold()` was fixed (it
  previously silently dropped any key not explicitly listed) to persist
  `product_variant_id` through the held-sale JSON payload and back on resume.
- **Checkout**: `PosService::checkout()` calls `InvoiceService::create()`/`post()`
  directly, byte-identical to a non-POS invoice — the variant validation/snapshot
  path is the exact same one document-line resolution runs everywhere else, no
  second implementation.
- **Idempotency checksum**: a real gap was found and fixed within VAR-POS-1
  itself — `checkoutRequestChecksum()` previously ignored `product_variant_id`,
  so replaying the same idempotency key with a *different* variant would have
  been silently treated as "the same request" instead of a conflict. Fixed;
  proven by two tests (same key + same variant twice → one invoice, one stock
  deduction; same key + different variant → `409`, no silent double-deduction).
- **Document line / InventoryState deduction**: confirmed variant-scoped, proven
  by a real end-to-end test through `/api/pos/checkout` that selling
  black/large deducts only its own `InventoryState`, leaving the white/small
  sibling's quantity and avg_cost completely untouched.
- **Fail-closed for inactive/wrong/cross-tenant Variant**: confirmed by direct
  negative tests against the real HTTP endpoints (`/api/pos/checkout`,
  `/api/pos/barcode`) — wrong product/variant pairing, cross-tenant variant,
  variant-managed product with no variant, simple product with an explicit
  variant, deactivated variant, and a price that doesn't match the resolved
  variant's own authority (e.g. a sibling's price) — all rejected with 422/409,
  none leak whether the mismatch is "not found" vs. "belongs to another tenant."

**No gap found in POS's own scope.** The unit-picker-hidden-for-variant-lines and
practical-barcode-scan-remains-client-side items are both explicitly documented,
deliberate, non-security-affecting scope decisions in the VAR-POS-1 report itself
and were not found to be misrepresented.

## Commerce

Confirmed by direct code reading, matching the VAR-COM-1 report:
- **Storefront catalog**: `StorefrontProductResource` exposes
  `is_variant_managed`/`options`/`variants` additively; `show()` builds the full
  active-variant list with descriptor, price (via `CommercePriceResolver`,
  variant-aware), stock (via variant-scoped `AvailableToSellService`), and media
  (via `resolveGallery()`).
- **Variant selection / canonical price**: `CommercePriceResolver::resolve()`
  gained an additive `?string $variantId` parameter; internally
  `DocumentLineVariantResolver::resolve()` validates first, then the same
  `ProductPricingService::resolveSellable()` authority POS uses.
- **Cart identity**: `CommerceCartItem` line identity became
  `(cart_id, product_id, product_variant_id, unit_key)` via two partial unique
  indexes — sibling variants produce distinct lines, confirmed by test.
- **Checkout revalidation**: `revalidateAndPrice()` — the single existing
  re-validation point checkout completion already ran — gained one more check in
  the same sequence (`DocumentLineVariantResolver::resolve()`), mapped to the
  existing `'unavailable'`/`review_required` failure path; no new failure-reason
  enum, no second judgment built from scratch.
- **`CommerceOrderLine`**: gained `product_variant_id` +
  `variant_descriptor_snapshot`, written once at line-creation time; added to
  `variantScopedBusinessDocumentLines()` (closing the gap VAR-DOC-1 explicitly
  left for this milestone) so `deleteVariant()`'s existing generic guard now also
  blocks a hard delete of a variant referenced by a confirmed Commerce order.
- **Variant inventory reservation/availability**: `product_warehouse_stock`
  (already variant-aware since VAR-INV-1) and a new `product_variant_id` column
  on `inventory_reservations` — proven by a real test that a Variant A shortage
  never blocks a separate checkout for sibling Variant B.
- **Publication authority**: confirmed unchanged and product-level —
  `CommerceListing.is_published` per `(product_id, sales_channel_id)`; no
  `Product.is_online`/`ProductVariant.is_online` exists or was added; a
  variant-managed product's variants inherit the parent's listing, exactly as
  the mission requires.

**CommerceBoundary respected, not treated as a bug per instruction:** Commerce V1
checkout creates a `CommerceOrder`/`CommerceOrderLine`, never an `Invoice`, and
never touches `InventoryState` directly — this was confirmed to be the
pre-existing, deliberate architecture (ADR-01) and not something this review's
mission asks to be reinterpreted as a defect. No `LedgerService`/`PaymentService`/
`ZatcaService` call was added or is expected here.

**No public storefront frontend exists in this repository** — confirmed:
`web/src/app/(commerce)/commerce/*` is merchant-admin configuration only. The
mission's storefront UI requirements (variant picker, gallery, cart display) are
answered by the tested API contract (`GET /store/v1/products/{id}`,
`POST /store/v1/cart/items`), not by any `web/` file, because the actual
consumer-facing storefront is a separately-hosted application outside this
repository (confirmed architecturally by `RequireStorefrontMutationGateway`'s
signed-gateway design, which only makes sense if the storefront is a separate
app). Not a gap in this program's scope — flagged for awareness only, since a
reviewer unfamiliar with the architecture could otherwise mistake "no frontend
changed" for an omission.

## Reporting

Confirmed by direct code reading (this review's author also implemented
VAR-REPORT-1 in this same session, so this section is verified against the live
diff, not just the report's own narrative):
- **Sales/Purchases**: `byProduct()` in both `SalesReportService` and
  `PurchaseReportService` groups by `(product_id, product_variant_id)`; Sales
  additionally now prefers `invoice_lines.product_name_snapshot`/
  `variant_descriptor_snapshot` over the live `products.name` join it previously
  used — a real historical-truth fix (a renamed product no longer silently
  changes a past report's label).
- **Inventory**: `inventoryValue()` expands a variant-managed product into one
  row per active Variant (its own real `InventoryState` quantity/avg_cost)
  instead of one misleading parent row with `avg_cost = 0`;
  `warehouseBalances()`/`movements()` join `product_variants` for
  descriptor/SKU and add a `product_variant_id` filter.
- **Warehouse**: confirmed variant-aware via the same `inventoryValue()`/
  `warehouseBalances()` changes above, and independently via VAR-COM-1's
  `product_warehouse_stock` extension.
- **Dashboard**: `salesBreakdown('product')` switched from the generic
  live-name grouping (`byLineDimension()`) to the same snapshot-aware,
  variant-distinct grouping as Sales' own `byProduct()`.
- **POS/Commerce reporting**: no dedicated POS-only or Commerce-only report
  endpoint exists; POS sales flow through the same `Invoice`/`invoice_lines`
  tables Sales reporting already covers, so POS transactions are covered
  transitively. Commerce reporting was confirmed genuinely unbuilt (no
  `CommerceOrder`/`CommerceOrderLine` report/list/dashboard endpoint of any
  kind exists) — correctly left unbuilt by VAR-REPORT-1's own scope ("make
  existing reports variant-aware," not "build new reports").

**Sibling variants do not merge incorrectly** in any of the above — each has a
dedicated regression test proving distinct quantity/amount rows per variant.
**Historical reports use snapshots; live inventory uses live identity** —
confirmed as the deliberate, correct split (Sales/Purchase report on posted
document lines with their own snapshot fields; Inventory-value/warehouse report
on live `InventoryState`, which is itself the correct live authority, not a
historical-truth violation since it is reporting current stock, not
reinterpreting a past transaction).

**`InventoryBalanceExportService` — re-verified directly in this review, not
just cited from VAR-REPORT-1's own Risks section:** confirmed by code reading
that it reads `$product->quantity_on_hand`/`avg_cost` through the Eloquent
accessor (not a raw column), with `variant_state` present in its base query's
column selection (`InventoryBalanceFilters::baseQuery()` selects
`'products.*'`) — so it is **not** subject to the `variant_state`-omission
footgun, and it does **not** show a wrong number (a variant-managed product's
`avg_cost` correctly reads `0`, matching the architecture's own "never invent a
blended cost" rule, and `quantity_on_hand` correctly reads the real
cross-variant sum). Its actual gap is completeness, not correctness: it still
exports **one row per product** instead of one row per variant, so a
variant-managed product's per-variant cost/quantity breakdown — available in
`InventoryReportService::inventoryValue()`'s already-fixed Reporting-module
counterpart — is not visible in this export. Confirmed still unfixed on current
`main`. See GAP-04.

## Multiple Barcode × UOM × Selling Price

Read in full: `docs/plans/products-inventory/AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md`.
Contract: **Barcode = resolver alias → Product + optional Variant + UOM →
canonical pricing authority. Barcode is never the price authority.**

**Backend today:**
- `ProductBarcode` model: has `product_variant_id` (added VAR-POS-1), `unit_name`,
  **no `price` column** — correctly matches the contract's "barcode is not price
  authority" rule at the schema level.
- `App\Services\Pos\PosBarcodeResolver` (VAR-POS-1): correctly implements
  `Barcode → Product + optional Variant + UOM → Pricing Authority` for POS
  specifically — confirmed by code reading, resolves via `ProductBarcode` then
  falls back to `products.barcode`/`products.sku`, then calls `posPriceFor()`
  (never reads a stored barcode price).
- **The generic alternate-barcode CRUD HTTP endpoint does not support this
  contract yet — verified directly:** `POST/DELETE products/{id}/barcodes`
  (`ProductController::storeBarcode()`/`destroyBarcode()`,
  `StoreProductBarcodeRequest`) accepts only `code`/`unit_name`/
  `default_quantity`/`label` — **no `product_variant_id` field at all**, and
  `createAlternateBarcodeWithinTransaction()` never sets one on the created row.
  A variant-scoped alternate barcode is reachable only through direct
  Eloquent/service-layer code (as VAR-POS-1's own tests do), never through the
  generic Product-management HTTP API. This is narrower than but related to
  GAP-01: even Commerce and reporting aside, the plain "add a barcode to this
  product" screen cannot scope a barcode to a specific variant today.
- Price for a UOM/barcode row is `ProductUnitPrice` (VAR-PRICE-1) — see Pricing
  section above: **no HTTP CRUD endpoint exists for it at all.**

**POS today:** fully consumes the contract correctly (see POS section above) —
scans resolve identity+UOM via `PosBarcodeResolver`, price is always obtained
through `posPriceFor()`, never derived from a factor or read from the barcode.

**Product Create/Edit UX today:** **nothing implemented.** Confirmed by
repository-wide search — no "Multiple barcodes"/"باركود متعدد" string, no
inline multi-barcode table component, anywhere in `web/`. The Product
Create/Edit screen still exposes at most the existing single-barcode field and
the pre-existing (non-inline, separate) barcode list endpoints; there is no
progressive-disclosure table for Unit/Factor/Barcode/Quantity/Selling-price as
the contract specifies, on desktop or mobile.

**What's missing, precisely, as one coherent follow-up (GAP-03):**
1. Extend `StoreProductBarcodeRequest`/`storeBarcode()` to accept an optional
   `product_variant_id` (mirroring the same identity-consistency check pattern
   already used everywhere else in the program), so a barcode can be explicitly
   scoped to a Variant through the real HTTP API, not just in tests.
2. Add an HTTP CRUD surface for `ProductUnitPrice` (GAP-02, the same domain
   capability this screen needs to show/edit "Selling price" per row) —
   naturally the same endpoint work as GAP-01/GAP-02, since the mission's own
   contract explicitly combines barcode+UOM+price editing in one inline table.
3. Build the Product Create/Edit inline "Multiple barcodes" table itself
   (desktop dense table + mobile stacked-card equivalent, per the contract's
   §11/§12), wired to the two capabilities above — nothing to invent
   architecturally, both authorities already exist and are tested at the
   domain layer.

This is **one follow-up milestone** (or one PR), not three independent ones —
the contract document itself already scopes it this way (§17: "Product
Create/Edit implementation must provide progressive-disclosure UI + persistence
wiring to existing authorities").

## Security / Tenant Isolation

Evidence-based check (existing tests re-read and cross-referenced against
current code; no suite re-run, per the mission's own instruction that a
full/broad re-run is unnecessary when existing evidence is sufficient):

| Boundary | Confirmed enforced by | Evidence |
|---|---|---|
| Variant/Product tenant match | `TenantScope` + explicit `assertIdentityConsistent()`-style checks in every service | Dedicated cross-tenant test in all 8 milestone test files (counts confirmed: 1–4 tests each) |
| Option/Value tenant match | `ProductVariantService::resolveAndValidateValues()` | `a_variant_cannot_select_an_option_value_belonging_to_another_tenant` |
| InventoryState | `InventoryService::assertIdentityConsistent()` | `a_guessed_cross_tenant_variant_id_cannot_be_used_to_receive_stock_for_this_tenants_product` |
| ProductWarehouseStock | Same `InventoryState` identity path + `TenantScope` | Covered transitively by the above + VAR-COM-1's own stock tests |
| Pricing (`ProductUnitPrice`) | `ProductPricingService::assertIdentityConsistent()` | `a_cross_tenant_variant_is_rejected`, row-count-unchanged assertion |
| PriceList | `PriceListService::assertIdentityConsistent()` | `a_price_list_item_mismatched_variant_is_rejected_fail_closed` |
| Media | `ProductMedia::booted()` `saving` guard, tenant resolved from `TenantContext` (not the row's own not-yet-set column) | `a_cross_tenant_variant_cannot_be_attached` |
| Documents | `DocumentLineVariantResolver::resolve()`, tenant from the document header, never client input | `a_cross_tenant_variant_is_denied` |
| POS | `PosBarcodeResolver` (`TenantContext` only, no client ID), `assertTenantOwnedAll()` in checkout/hold/exchange | Direct HTTP-level negative tests against `/api/pos/checkout`, `/api/pos/barcode` |
| Commerce | Same `DocumentLineVariantResolver` + `TenantScope`-backed models | `a_cross_tenant_variant_is_denied_and_leaks_nothing` (Storefront) |
| Reports | `ReportBranchScope`/`ReportWarehouseScope` (pre-existing, unmodified) + variant filters additive on top | `a_cross_tenant_variant_filter_is_denied_and_leaks_nothing` (`VariantReportingTest`) |

No mismatch reveals whether a rejected ID is "not found" vs. "belongs to another
tenant" anywhere this review checked — every fail-closed path uses a generic
rejection message, consistent with the rest of the codebase's existing
convention. **No unresolved cross-tenant leakage risk was found.** The one
class of latent risk flagged in this review (the `variant_state`-column-omission
footgun, Inventory & Valuation section above) is a correctness/display risk if
repeated elsewhere, not a security/isolation risk — it was checked
specifically and found to have exactly one other occurrence in the codebase,
confirmed safe.

## Deferred Gap Register

Every gap below is drawn from an actual, verified statement in one of the eight
milestone reports and/or direct code verification in this review — no
duplicate names for the same underlying gap.

### GAP-01 — Variant identity not accepted by the 8 non-POS/non-Commerce document-creation HTTP endpoints

- **Description**: `StoreInvoiceRequest`, `StorePurchaseRequest`,
  `StoreQuoteRequest`, `StoreCreditNoteRequest`, `StoreRecurringInvoiceRequest`,
  `StoreProcurementRequest`/equivalent, `StoreDeliveryNoteRequest`,
  `StoreReturnRequest` have no `items.*.product_variant_id` validation rule, so
  it is stripped by `$request->validated()` before reaching the service layer. A
  variant-managed product line submitted through any of these HTTP endpoints
  fails closed with a domain 422 (correct, safe), but this means these document
  types **cannot practically be created for a variant-managed product through
  the normal ERP screens today.**
- **Evidence**: `grep -n "product_variant_id"` on all 8 request classes → zero
  matches (verified directly in this review); `InvoiceController::store()` uses
  `$request->validated()`; `StorePosSaleRequest` (POS's own request) already has
  the equivalent rule, confirming the pattern to replicate.
- **Severity**: **P2.** Functional-completeness gap, not correctness/security/
  historical-truth/accounting/isolation. Domain layer already proven correct via
  `VariantDocumentLineTest` (19 tests, all 8 document types, direct service-layer
  calls).
- **Area**: Documents (Invoice/Purchase/Quote/CreditNote/RecurringInvoice/
  Procurement/DeliveryNote/Return).
- **Blocks core closure?** NO.
- **Recommended follow-up**: Add `'items.*.product_variant_id' => ['nullable', 'uuid']`
  to all 8 request classes and thread it through each controller's item-building
  step to the already-correct service methods — no service-layer change needed.
- **Dependencies**: none — all downstream authorities (`DocumentLineVariantResolver`,
  `InventoryService`, `ProductPricingService`, snapshot writing) already exist
  and are tested.

### GAP-02 — No HTTP/UI surface for `ProductUnitPrice` (canonical Variant/UOM price)

- **Description**: `ProductPricingService::setPrice()`/`clearPrice()` exist only
  at the domain layer. No controller, route, or Product Create/Edit UI lets a
  merchant set a Variant's or an alternate-UOM's explicit canonical price.
- **Evidence**: VAR-PRICE-1 report, Risks section, explicit: "HTTP/API layer for
  unit-price and Variant-price CRUD was intentionally not added."
- **Severity**: P2/P3 (UX completion, not correctness — the pricing precedence
  and fallback logic are already correct and tested).
- **Area**: Pricing / Product Create-Edit UX.
- **Blocks core closure?** NO.
- **Recommended follow-up**: bundle with GAP-03 (same screen, same contract
  document explicitly combines them).
- **Dependencies**: none new.

### GAP-03 — Multiple Barcode × UOM × Selling Price UX not implemented

- **Description**: The approved contract
  (`AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md`) has zero UI
  implementation in Product Create/Edit, and the underlying barcode-CRUD HTTP
  endpoint (`storeBarcode()`) does not even accept `product_variant_id` — a
  variant-scoped alternate barcode can only be created through direct
  service/Eloquent code today, not the real API.
- **Evidence**: repo-wide search for "Multiple barcodes"/"باركود متعدد" → no
  matches in `web/`; `StoreProductBarcodeRequest` fields confirmed (`code`,
  `unit_name`, `default_quantity`, `label` — no `product_variant_id`);
  `createAlternateBarcodeWithinTransaction()` confirmed to never set
  `product_variant_id` on the created row.
- **Severity**: P2/P3 — real merchant-onboarding friction (bulk pack/carton
  barcode entry has no fast path), not a correctness or security gap (the
  underlying `PosBarcodeResolver`/pricing authority are already correct).
- **Area**: Product Create/Edit UX, barcode/pricing HTTP API.
- **Blocks core closure?** NO.
- **Recommended follow-up**: one combined follow-up milestone covering (a)
  `product_variant_id` on the barcode-CRUD endpoint, (b) GAP-02's
  `ProductUnitPrice` HTTP surface, (c) the inline desktop/mobile table UI —
  exactly as the contract document's own §17 scopes it.
- **Dependencies**: none new; subsumes GAP-02.

### GAP-04 — `InventoryBalanceExportService` not variant-decomposed

- **Description**: Exports one row per product (using the correct, honest
  aggregate `quantity_on_hand` and the correct, honest `avg_cost = 0` for a
  variant-managed product) instead of one row per variant with its own real
  cost — the same pattern `InventoryReportService::inventoryValue()` already
  fixed in the Reporting module.
- **Evidence**: verified directly in this review — `InventoryBalanceExportService`
  reads `$product->quantity_on_hand`/`avg_cost` through the Eloquent accessor
  (not a raw column, and `variant_state` is present in its query's column
  selection, so it is not subject to the omission footgun); confirmed still one
  row per product on current `main`.
- **Severity**: P2 — data completeness, not correctness (the numbers shown are
  never wrong or misleading, just less granular than the twin Reporting-module
  export).
- **Area**: Inventory Workspace export (a separate subsystem from
  `app/Services/Reporting/`, sharing `ProductWarehouseBalanceQuery` with two
  other non-reporting consumers).
- **Blocks core closure?** NO.
- **Recommended follow-up**: apply the same per-variant row-expansion pattern
  `InventoryReportService::inventoryValue()` already uses, to
  `InventoryBalanceExportService`/`InventoryBalanceFilters`.
- **Dependencies**: none new.

### GAP-05 — `min_sale_price` enforcement not re-verified per-variant

- **Description**: `InvoiceService::minimumPriceDecision()` reads
  `Product.min_sale_price` only. VAR-PRICE-1 confirmed this was unchanged
  because no document line carried `product_variant_id` at the time it was
  written; VAR-DOC-1 then added `product_variant_id` to `InvoiceLine`, but
  neither VAR-DOC-1's nor VAR-POS-1's nor VAR-COM-1's test lists include an
  explicit test proving a Variant-specific minimum-price override/enforcement
  path (if the business intends one to exist — `ProductVariant` has no
  `min_sale_price` column of its own today, so enforcement is necessarily still
  at the parent-Product level by construction, which may be entirely correct
  and intentional, just not explicitly confirmed by a dedicated test in this
  program).
- **Evidence**: absence — no test named or described in any of the 8 reports
  exercises `min_sale_price` together with a Variant line.
- **Severity**: P3 (unverified, not confirmed broken — the parent-level column
  is the only one that exists, so there is no code path that could read the
  wrong value; this is a coverage gap, not a known defect).
- **Area**: Pricing / Documents.
- **Blocks core closure?** NO.
- **Recommended follow-up**: add one explicit regression test confirming
  `min_sale_price` still enforces correctly (at the parent level, by design)
  for a variant-managed product's invoice line, to close the coverage gap with
  evidence rather than leaving it implicit.
- **Dependencies**: none.

### GAP-06 — POS per-variant media not confirmed wired

- **Description**: `resolveGallery()` (VAR-MEDIA-1) is confirmed used by
  Commerce's `StorefrontProductResource`, but this review found no confirmation
  that POS's own catalog/variant-picker surfaces variant-specific photos (POS
  shows a text descriptor for variant selection, per VAR-POS-1's own report).
- **Evidence**: absence — VAR-POS-1's report does not describe image/gallery
  handling as part of its scope; no `resolveGallery(...)` call site was found
  in `PosController` during this review's spot checks.
- **Severity**: P3 — not a correctness gap (no wrong image is shown; POS simply
  doesn't yet use per-variant photos), pure UX completeness.
- **Area**: POS / Media.
- **Blocks core closure?** NO.
- **Recommended follow-up**: low priority; consider alongside any future POS UI
  work, not urgent.
- **Dependencies**: none.

## Test & CI Evidence

Summarized from each milestone's own report (not re-run in this review):

| Milestone | Targeted new tests | Targeted regression | Full-suite baseline (SQLite) | PostgreSQL |
|---|---|---|---|---|
| VAR-CORE-1 | 31/31 (`ProductVariantCoreTest`) | 47/47 (Product* filter, 401–404 tests) | Not completed this round (documented honestly); prior full run clean | 47/47 + 3/3 fork concurrency |
| VAR-INV-1 | 14→20/20 (`InventoryStateTest`) | 156/1077-assertion targeted sweep | 1201/1201 (`Pos|Commerce|Storefront|ProductImport|ProductExport|Product` filter) minus known bcmath gap | 217/217 + 3/3 concurrency |
| VAR-PRICE-1 | 19/19 (`ProductUnitPriceTest`) | 132/132 | 1188/1188 broad sweep | 216/216 + 3/3 concurrency |
| VAR-MEDIA-1 | 19/19 (`ProductMediaGalleryTest`) | 174/174 | 3685 passed / 27 failed (env-only) | 193/193 |
| VAR-DOC-1 | 19/19 (`VariantDocumentLineTest`) | 267/269 (SQLite), 288/288 (PostgreSQL) | Not run this round (targeted sufficient) | 288/288 |
| VAR-POS-1 | 19/19 (`PosVariantCheckoutTest`) | 172/172 (SQLite), 227/227 (PostgreSQL) | 3727 passed / 27 failed (env-only), 39 skipped | Incomplete run, but targeted+regression fully green |
| VAR-COM-1 | 17/17 (`StorefrontVariantCommerceTest`) | 467/467 (SQLite), 471/471 (PostgreSQL) | 3744 passed / 27 failed (env-only) | Migrations clean; targeted set is the primary evidence |
| VAR-REPORT-1 | 15/15 (`VariantReportingTest`) | 403/403 (SQLite), 420/420 (PostgreSQL) | 3760 passed / 35 failed (env-only) | 420/420 |

**Known failures unrelated to this program, confirmed recurring across every
milestone**: `bcmath` PHP extension not installed in the sandbox (`FuelAviRfidServiceTest`,
`FuelReconciliationTest`, `FuelSaleApiTest`, `FuelSaleServiceTest`,
`FuelSupplyReceivingTest`, `FuelSupplyReceivingApiTest`) and one PDF-parsing
environment gap (`DocumentCenterSecureIntakeTest`). Two of these were later
joined temporarily by a real, already-fixed regression in
`ReportEffectiveScopeTest`'s own test fixtures (not production code) —
VAR-MEDIA-1 Round 2 fixed the SQLite-side fixture bug (bulk `Model::update()`
bypassing Eloquent events), and VAR-MEDIA-1 Round 3 fixed an unrelated
PostgreSQL-only test-fixture lock-ordering issue in two Import-job concurrency
tests — both documented, test-only, zero production code touched. VAR-POS-1's
own report additionally documents a direct diagnostic re-run that could not
reproduce a separately-reported `ReportEffectiveScopeTest` PostgreSQL CI
failure at that exact head — confirmed as not real (or not a regression this
program caused) by comparing against actual GitHub Actions run logs.

**CI status**: all eight PRs are merged into `main` (confirmed via `git log`
merge SHAs above). This review did not find evidence of an outstanding red CI
run blocking any of the eight PRs at merge time.

## Final Classification

**B) CORE CLOSED WITH FOLLOW-UPS.**

The architecture is sound across every dimension this review checked: sellable
identity, inventory/valuation identity, pricing precedence, media resolution,
historical-document truth, POS, Commerce, reporting, and tenant isolation. No
unresolved P1 issue touching Tenant Isolation, inventory correctness, accounting
truth, historical truth, pricing authority, or idempotency/concurrency was
found — each of those areas has direct, passing, negative-path test coverage in
the milestone that introduced it, re-verified against current code in this
review rather than taken on faith from the reports' own narrative.

What remains is real, but categorically different: HTTP/UI completion gaps that
block certain *usage paths* (non-POS/non-Commerce document creation for a
variant-managed product; setting a Variant/UOM's explicit price or barcode
through the Product screen) without corrupting data, weakening security, or
misrepresenting financial/historical truth anywhere the underlying domain layer
is actually reachable today (POS, Commerce, and the tested service layer).

## Recommended Follow-up Order

Ordered by (a) how many real usage paths are currently blocked, (b) shared
implementation surface, (c) evidence strength:

1. **GAP-01** — Add `product_variant_id` to the 8 non-POS/non-Commerce
   document-creation HTTP requests. Highest priority: this is the one gap that
   currently prevents the ERP's primary sales/purchasing screens from handling
   variant-managed products at all. Small, mechanical, no new architecture.
2. **GAP-02 + GAP-03 (combined)** — Product Create/Edit: `ProductUnitPrice` HTTP
   CRUD + variant-scoped barcode CRUD + the documented inline Multiple-Barcode
   table UI. Second priority: blocks merchant onboarding/catalog completeness
   for variant products, but POS/Commerce already work without it via the
   service layer's existing correctness.
3. **GAP-04** — `InventoryBalanceExportService` per-variant row expansion.
   Lower priority: a data-completeness gap in one export, not a blocked
   workflow; mirrors an already-solved pattern elsewhere in the codebase.
4. **GAP-05** — Add one explicit `min_sale_price` + Variant regression test.
   Lowest priority: coverage-only, no known or suspected defect.
5. **GAP-06** — POS per-variant photo display, if/when POS UI work is
   otherwise planned. Not urgent, no correctness impact.

No follow-up in this list requires re-opening or redesigning any of the eight
milestones' architecture. None was started or implemented as part of this
review.

## Git

- Branch: `claude/product-variants-final-closure-review`
- Base SHA: `aaf2280af826c7aa86d55dd209db2c8638cd68ac`
- This is a documentation-only change: one new file
  (`deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md`). No application
  code, migration, or test file was touched.

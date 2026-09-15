# VAR-REPORT-1 Implementation Report

## Architecture Evidence

Phase 0 evidence pass (delegated research, verified against source) covered every
reporting path in `app/Services/Reporting/*` plus the report controllers/requests,
`ReportBranchScope`/`ReportWarehouseScope` (the actual "effective scope"
implementation — there is no class literally named `ReportEffectiveScope`; that's
the documented invariant `tests/Feature/ReportEffectiveScopeTest.php` covers),
and `ProductWarehouseBalanceQuery`. Full raw-SQL audit in a dedicated section below.

Confirmed schema (VAR-CORE-1 → VAR-COM-1), all already present before this task:
`invoice_lines`/`purchase_lines`/`return_lines`/`credit_note_lines`/`quote_lines`/
`recurring_invoice_lines`/`procurement_lines`/`delivery_note_lines` all carry
`product_variant_id` + `variant_descriptor_snapshot` (VAR-DOC-1, one migration,
identical column names across all eight); `stock_movements` carries
`product_variant_id` only (no descriptor snapshot column); `inventory_states`
and `product_warehouse_stock` carry `product_variant_id` (VAR-INV-1);
`commerce_order_lines` carries `product_variant_id` + `variant_descriptor_snapshot`
(VAR-COM-1). **None of this was read by any reporting code before this task** —
every report query grouped/filtered/joined by `product_id` alone.

**Real, pre-existing gap found and documented (not fixed — outside VAR-REPORT-1's
scope, belongs to VAR-DOC-1)**: `StoreInvoiceRequest`/`StorePurchaseRequest` never
received an `items.*.product_variant_id` validation rule when VAR-DOC-1 wired
variant support into `InvoiceService`/`PurchaseService`. Both controllers call
`$request->validated()` before handing `items` to the service, so a
`product_variant_id` sent via the real HTTP invoice/purchase-creation endpoints
is **silently dropped today** — only the direct service-layer call path (as
`VariantDocumentLineTest` already does) can create a variant document line. This
does not affect reporting (reports only *read* posted lines), but it means this
task's own tests seed data the same way `VariantDocumentLineTest` does — direct
`InvoiceService::create()`/`PurchaseService::create()` calls, never
`POST /api/invoices` with a variant item. **Flagged as a follow-up for whoever
owns VAR-DOC-1/Invoice-Purchase HTTP surface — not addressed here.**

No STOP-condition finding: no report re-interprets a *posted* document's
financial truth using live data in a way that would change historical amounts.
The one real "live label on a historical row" pattern found
(`SalesReportService`/`DashboardService` joining live `products.name`) is
exactly the historical-truth defect this task's own mission section instructs
fixing — not a separate blocker requiring approval.

## Coverage Matrix

| Report / Query | Current source (before) | Product identity (before) | Historical vs live | Variant gap | Scope (tenant/branch/warehouse) | Action taken |
|---|---|---|---|---|---|---|
| `SalesReportService::byProduct()` | `invoice_lines` ⋈ `products` | `product_id` only | live `products.name` join | siblings merged, live label | `ReportBranchScope` via header filter | Variant grouping + snapshot label + `product_variant_id` filter |
| `PurchaseReportService::byProduct()` | `purchase_lines` ⋈ `products` | `product_id` only | `description` (already historical) + live fallback | siblings merged | `ReportBranchScope` | Same pattern; label from `description`/`variant_descriptor_snapshot` |
| `DashboardService::byLineDimension('product')` | `invoice_lines` ⋈ `products` | `product_id` only | live `products.name` join | siblings merged, live label | header branch filter | New `byProductDimension()`; `category` dimension untouched |
| `InventoryReportService::inventoryValue()` | `Product` (accessor-backed) | product-level only | live (current snapshot report, by design) | variant-managed row misleadingly shows `avg_cost=0` w/ real quantity | `ReportWarehouseScope` | Per-active-variant row expansion; simple product unchanged |
| `InventoryReportService::warehouseBalances()` | `ProductWarehouseBalanceQuery` | `product_id` only (column existed, unread) | live (current snapshot) | siblings merged into one qty | `ReportBranchScope` ∩ `ReportWarehouseScope` | Added `product_variant_id` select/filter + variant label join |
| `InventoryReportService::movements()` | `stock_movements` ⋈ `products` | `product_id` only (column existed, unread) | historical event; no snapshot column exists on this table | siblings merged, no variant shown | `ReportBranchScope`/`ReportWarehouseScope` | Added `product_variant_id` select/filter; label via live `product_variants` join (documented, no snapshot column to prefer) |
| POS reporting | none dedicated — sales flow through `SalesReportService` | — | — | covered transitively by the Sales fix | — | No POS-specific code; X/Z session report has no product breakdown |
| Commerce reporting (`CommerceOrder`/`CommerceOrderLine`) | **none exists** | — | — | greenfield | — | **Not built** — building a new endpoint is out of scope ("not a redesign/new-feature task"); documented in Risks |
| `InventoryBalanceExportService` | `InventoryBalanceFilters::query()` (Inventory Workspace, not Reports) | `product_id` only | live | not fixed | `ReportWarehouseScope` | **Deferred** — different subsystem than the 5 report families in scope, see Risks |
| `CustomerReportService`/`ClassificationAnalyticsReportService` | partner/document headers | no product dimension at all | n/a | n/a | `ReportBranchScope` | No change — confirmed no product identity touched |

## Historical Truth

`SalesReportService::byProduct()` now builds its label from
`MAX(invoice_lines.product_name_snapshot)` and
`MAX(invoice_lines.variant_descriptor_snapshot)` — the exact per-line historical
snapshot VAR-DOC-1 already writes once at posting time and never rewrites —
falling back to the live `products.name` only for rows created before the
snapshot column existed (nullable, no backfill migration, so old rows must keep
their previous live-name behavior; this is not a regression, it's the same
behavior every row had before this task). `DashboardService::byProductDimension()`
follows the identical pattern. `PurchaseReportService::byProduct()` uses
`purchase_lines.description` (already the historical name-snapshot field by
design since before this task — `PurchaseService::createLine()` sets
`$item['description'] ?? $product?->name` once at line creation and never rereads
it) plus `variant_descriptor_snapshot`.

Verified by test: renaming a variant-managed product after posting an invoice
does not change the sales report's label (`variant_rename_does_not_rewrite_the_
historical_sales_label`), and deactivating the variant afterward doesn't break
or hide the historical row (`deactivating_a_variant_does_not_break_the_
historical_sales_report`).

`InventoryReportService::movements()` is the one place a **live** join
(`product_variants`) supplies the variant descriptor — because
`stock_movements` has no `variant_descriptor_snapshot` column at all (confirmed
in Phase 0; VAR-DOC-1 only added the FK, not a descriptor snapshot, to this
table). This is not a historical-truth violation: there is no snapshot to
prefer over the live value, and the movement's own financial facts (quantity,
unit_cost, total_cost, balance_quantity) are read exactly as recorded, untouched
by this task. Adding a snapshot column to `stock_movements` would be a new
migration outside this task's "smallest necessary" scope and is noted as a
possible follow-up in Risks.

## Sales

`SalesReportService::byProduct()`: grouping key is now `(product_id,
product_variant_id)` instead of `product_id` alone — two sibling variants
(`أسود/كبير` vs `أسود/صغير`) produce two distinct rows, each with its own
`quantity`/`amount`, never merged. A simple product's row is byte-identical to
before (same `key`, same grouping, same label source with the historical-label
fix applied uniformly). Added `product_variant_id` (nullable UUID) as an
additive filter parameter, alongside the existing `product_id` filter — filtering
by `product_id` alone still returns *all* of that product's variants (matches
mission: "Parent Product filter can include its Variants where intended").
Quantities/amounts were already computed per-line via `SUM()`, so no double-
counting or cost-mixing risk existed once grouping included the variant
dimension — discounts/tax/returns/cost were not touched, matching the report's
existing contract (invoice-level fields stay on the invoice header, never
distributed to product rows, unchanged from before this task).

## Purchases

Identical treatment, `PurchaseReportService::byProduct()`. Verified sibling
variant purchase quantities/amounts stay independent (test:
`sibling_variants_remain_distinct_rows_in_the_purchase_report`). No change to
`purchase_lines`' pre-existing "description as historical name" design — this
task only added `product_variant_id` to the label composition, per the
existing pattern.

## Inventory / Valuation

**The most sensitive change in this task.** `InventoryReportService::inventoryValue()`
(view=`value`): before this task, a variant-managed product showed exactly one
row sourced from `Product::quantity_on_hand`/`avg_cost` — Eloquent accessors
that, since VAR-INV-1, already correctly sum quantity across all variant
`InventoryState` rows but **explicitly return `avg_cost = 0`** for a
variant-managed product (VAR-INV-1's own documented design: *"لا يُخترع 0
صراحةً لأن الأب ليس هويّة تقييمٍ موازية"*). That's not wrong per VAR-INV-1's
contract, but displaying **quantity > 0 with avg_cost = 0 and stock_value = 0**
in an *inventory value* report is exactly the "misleading parent avg_cost" this
task's own brief warns against — a user could read it as "this stock is worth
nothing."

The mission explicitly permits an alternative: *"اعرض per-Variant بدلاً منه"*.
Implemented: a variant-managed product no longer emits a single blended parent
row — it expands into **one row per active variant**, each with its own real
`quantity`/`avg_cost`/`stock_value` read from that variant's own
`InventoryState` (via `ProductVariant::quantity_on_hand`/`avg_cost` accessors,
VAR-INV-1's own per-variant authority — no new query logic, no blending). A
simple product's row is untouched — same single row, same accessor calls, same
shape. Warehouse-scoped quantity (`ReportWarehouseScope` restricted user) now
groups `ProductWarehouseStock` by `(product_id, product_variant_id)` instead of
`product_id` alone — the old grouping silently merged all of a product's
variant rows into one number even though it was *labeled* as the (blended,
zero-cost) parent; the new one attributes each variant's scoped quantity to its
own row correctly. Added an additive `product_variant_id` filter.

**No blended/weighted average cost was invented anywhere** — every `avg_cost`
value comes directly from one `InventoryState` row (simple or variant), never
computed across multiple identities.

`warehouseBalances()` (view=`warehouses`): `product_warehouse_stock.
product_variant_id` (present on the table since VAR-INV-1 but never selected)
is now selected, filterable, and used to look up each variant's descriptor via
a `leftJoin('product_variants', ...)` **added locally to this method's own
query chain** — `ProductWarehouseBalanceQuery::baseQuery()`/`applyScope()`
themselves were **not modified**, since they're shared with two non-reporting
consumers (`InventoryWorkspaceQuery`, `InventoryWorkspaceFilters`) outside this
task's scope; touching their shared contract risked an unrelated regression
for zero benefit (this report was the only caller needing the extra join).

`movements()` (view=`movements`): `stock_movements.product_variant_id`
selected/filterable, descriptor via a live `product_variants` join (see
Historical Truth section for why live is correct here — no snapshot column
exists to prefer).

## Warehouse

Scope enforcement (`ReportBranchScope`/`ReportWarehouseScope`) was **not
touched** — confirmed via the full, unmodified `ReportEffectiveScopeTest` suite
(34 tests) staying green throughout. Variant identity was added strictly
*inside* the already-scoped query result set (selected columns, filters,
labels) — never as an additional access-control dimension, matching the
mission's explicit instruction not to invent variant-level access policy.
Sibling variant stock never merges in `warehouseBalances()` (test:
`warehouse_stock_distinguishes_sibling_variants`).

## POS Reporting

No dedicated POS analytics/report endpoint exists (confirmed in Phase 0 — the
frontend `pos/report` page is the session cash X/Z reconciliation screen, no
product-line breakdown). Since POS sales become ordinary `Invoice`/`InvoiceLine`
rows (VAR-POS-1's own design — POS delegates entirely to `InvoiceService`), the
`SalesReportService::byProduct()` fix above already covers POS-originated
sales transitively. No POS checkout code, barcode scanning, or POS-specific
report was touched, per explicit OUT OF SCOPE.

## Commerce Reporting

**Confirmed greenfield — no admin/merchant `CommerceOrder`/`CommerceOrderLine`
reporting endpoint exists anywhere in the codebase today** (Phase 0: every
`CommerceOrder::query()`/`::where()` usage found is transactional — checkout,
order creation, reservation — never a report/list/dashboard controller). The
mission's Commerce Reporting section is conditional: *"إذا Commerce reporting
موجود: اجعله Variant-aware"*. That condition is not met, so **no new endpoint
was built** — creating one from scratch would be a new feature, not "making
existing reporting variant-aware," and squarely matches this task's own
"ليست مهمة لإعادة تصميم Reporting module" instruction plus the explicit
OUT-OF-SCOPE bar on unrelated redesign/new features. Documented here as a
confirmed gap for a future, explicitly-scoped task (not VAR-REPORT-1).

## Filters

Added `product_variant_id` (`['nullable', 'uuid']`, matching the existing
`product_id` rule shape exactly) to `SalesReportRequest`, `PurchaseReportRequest`,
`InventoryReportRequest`. Never made required. A simple-product report request
with no variant filter behaves exactly as before. Cross-product/cross-tenant
variant filters return **empty results, not an error and not a leak** — no
special-case code was needed for this: the filter is a plain `WHERE
product_variant_id = ?` against already-tenant-scoped tables, so a variant
belonging to another product or another tenant simply matches zero rows
(verified by test, not by trusting the mechanism blindly).

## Display

Every fixed report follows the same convention already established by
VAR-POS-1/VAR-COM-1: `"{اسم المنتج} — {وصف المتغيّر}"` (e.g. `"قميص — أسود /
كبير"`) when a line/row carries a variant, plain product name otherwise — no
new UI pattern invented. Historical reports (Sales/Purchase/Dashboard) use the
line's own snapshot; the live inventory value/warehouse/movements reports use
the live `ProductVariant`/`product_variants` descriptor (there is no
"historical" version of current stock — it's a live snapshot report by
definition, as its existing `scope.snapshot = true` flag already documented
before this task).

## Export

Confirmed (Phase 0): the five analytical report families this task touches
(Sales/Purchase/Inventory/Customer/Classification) have **no separate backend
CSV/PDF export code path** — their exports are built client-side in `web/`
directly from the same JSON the report screens already consume (documented
precedent in `tests/Feature/ReportEffectiveScopeTest.php`'s own comment: *"every
report's client-side CSV/PDF export renders from the exact same JSON the table
uses"*). Making the report JSON variant-aware (this task) is therefore both
necessary and **sufficient** for those exports — no additional export code
needed or touched. `InventoryBalanceExportService` (a genuinely separate
backend export, tied to the Inventory *Workspace* screen, not the Reports
module) was deliberately **not** touched — see Risks.

## Tenant / Branch / Warehouse Isolation

Negative controls implemented and verified:
- Cross-tenant variant filter on the sales report → empty result, no error, no
  leak (`a_cross_tenant_variant_filter_is_denied_and_leaks_nothing`).
- Cross-product variant filter (variant of B while filtering product A) →
  empty result (`a_cross_product_variant_filter_returns_empty_safely`).
- Full, unmodified `ReportEffectiveScopeTest` (34 tests covering branch/
  warehouse restriction, forbidden explicit branch/warehouse fallback,
  cross-tenant branch/warehouse id, unrestricted-owner behavior, export scope)
  stayed 100% green — proof this task changed nothing about how
  `ReportBranchScope`/`ReportWarehouseScope` resolve access.
- No `withoutGlobalScope` call was added anywhere in this task; every existing
  one (audited below) was left exactly as it was.

## Raw SQL Audit

Full inventory of every `withoutGlobalScope`/`DB::table`/`DB::raw`/`whereRaw`/
`selectRaw`/`join`/`leftJoin` in `app/Services/Reporting/*` and the report
controllers (from Phase 0's exhaustive grep), with disposition:

- **`SalesReportService`**: existing `leftJoin('products', ...)`/`selectRaw`
  in `byProduct()` — **modified** (variant grouping/label). All other
  `selectRaw`/`join`/`leftJoin` calls (`byPeriod`, `byCustomer`,
  `byClassification`, `bySalesperson`, `profitByPeriod`, `paymentsByPeriod`,
  `invoiceTotals`) — **untouched**, no product identity involved.
- **`PurchaseReportService`**: `byProduct()`'s join/selectRaw — **modified**,
  same pattern. `applyPurchaseFilters()`'s `withoutGlobalScope(BranchScope::class)`
  (Purchase base query, pre-existing deliberate "no active-branch narrowing")
  — **untouched**. All other views — **untouched**.
- **`InventoryReportService`**: `trackedProducts()`'s
  `withoutGlobalScope(BranchScope::class)` — **untouched** (deliberate,
  documented: catalog identity query, quantity narrowing happens elsewhere).
  `inventoryValue()`'s `ProductWarehouseStock::selectRaw` — **modified** (now
  groups by variant too). `warehouseBalances()` — **modified** (added
  `product_variant_id` select + local `product_variants` join, shared
  `ProductWarehouseBalanceQuery` left untouched). `movements()` — **modified**
  (added `product_variant_id` select/filter + local `product_variants` join).
  `operations()`/`stocktakes()` — **untouched**, no product-identity grouping
  in either (operations groups by permit, not product; stocktakes' one
  `product_id` filter is a `whereNotNull`/join-condition gate, not a
  product-identity display column — left as-is, out of scope since it doesn't
  merge or mislabel anything today).
- **`CustomerReportService`**/**`ClassificationAnalyticsReportService`**: every
  `withoutGlobalScope`/`join`/`selectRaw` confirmed **product-identity-free**
  (customer/partner/classification dimensions only) — **untouched**, no
  changes needed.
- **`DashboardService`**: `byLineDimension()`'s product-path replaced by the
  new `byProductDimension()` — **modified**; `category` dimension still uses
  `byLineDimension()` — **untouched**. `byDay()`/`byHeaderDimension()` —
  **untouched**.
- **`ProductWarehouseBalanceQuery`**: **not modified** — shared with
  non-reporting consumers; its `inventory_states` join
  (`whereNull('inventory_states.product_variant_id')`, simple-identity-only,
  pre-existing) was read and confirmed correct for its own documented purpose
  but left exactly as-is.
- **`InventoryBalanceExportService`**: its own `ProductWarehouseStock::selectRaw`
  (product-only grouping, same gap pattern as `inventoryValue()` had) —
  **confirmed but not fixed** — see Risks (different subsystem, not fed by
  `app/Services/Reporting/`).

No raw query was changed "because it existed" — every edit above ties directly
to a product/variant identity gap the mission explicitly asked to close.

## Backward Compatibility

Verified by test and by the full pre-existing report/dashboard/scope suite
staying green (59 tests before this task's changes, then 403 in the full
targeted regression after — zero failures, zero behavior changes for any
simple-product scenario):
- `simple_product_sales_report_is_unaffected`, `simple_product_inventory_
  value_row_is_unchanged` — explicit backward-compat tests.
- No response key was renamed or removed anywhere. `product_id`,
  `product_variant_id`, `variant_descriptor` are strictly additive new keys
  (`null` for every existing simple-product row shape).
- `product_variant_id` is nowhere required — every filter is `nullable`.
- `DashboardController::salesBreakdown()`'s response gained two new keys
  (`product_id`, `product_variant_id`, both `null` for `day`/`category`/
  `branch`/`salesperson` dimensions) — additive only.

## Web / UI

Reports frontend (`web/src/components/reports/*`) exists and is real ERP
admin tooling (distinct from VAR-COM-1's finding of no public storefront —
this module is genuinely part of `web/`). Scoped, minimal action taken:
`SalesRow`/`PurchaseRow`/`InventoryRow` TypeScript interfaces gained the three
additive optional fields (`product_id`, `product_variant_id`,
`variant_descriptor`) so the frontend type-checks against the now-richer API
response. **No table/column rendering change was made** — the existing
`label` field already carries the composed `"Product — Descriptor"` string
from the backend, so the existing results table (`report-results-table.tsx`,
untouched) already displays sibling variants as distinct, correctly-labeled
rows with **zero frontend code change required** for the core "don't merge
siblings" requirement. A dedicated variant *filter input* (letting a user
pick a specific variant in the filter panel, mirroring the existing
`product_id` dropdown) was **not** built in this pass — flagged in Risks as a
deferred, purely additive UI enhancement; the backend filter parameter is
fully functional today for any caller (API client, future frontend PR) that
sends it. `npx tsc --noEmit` — zero new errors. `npm run build` — succeeded
completely.

## Changed Files

**Backend:**
- `app/Services/Reporting/SalesReportService.php` — `byProduct()` variant
  grouping/label; `applyInvoiceFilters()` gains `product_variant_id` filter.
- `app/Services/Reporting/PurchaseReportService.php` — same pattern.
- `app/Services/Reporting/DashboardService.php` — new `byProductDimension()`;
  `category` untouched.
- `app/Services/Reporting/InventoryReportService.php` — `inventoryValue()`
  per-variant row expansion; `warehouseBalances()`/`movements()` variant
  select/filter/label; `trackedProducts()`'s product `get()` column list
  gained `variant_state` (needed for `isVariantManaged()` to read correctly
  off a column-restricted query — a real bug caught during testing).
- `app/Http/Controllers/Api/DashboardController.php` — `salesBreakdown()`
  response includes `product_id`/`product_variant_id` (additive, `null` for
  non-product dimensions).
- `app/Http/Requests/SalesReportRequest.php`,
  `PurchaseReportRequest.php`, `InventoryReportRequest.php` — additive
  `product_variant_id` filter validation.

**Frontend:**
- `web/src/components/reports/sales-reports-workspace.tsx`,
  `purchases-reports-workspace.tsx`, `inventory-reports-workspace.tsx` —
  additive TypeScript fields on the row interfaces only.

**Tests (new):** `tests/Feature/VariantReportingTest.php` (15 tests).

## Tests

**New:** `php artisan test --filter=VariantReportingTest` — **15/15 passed**
on SQLite, covering: simple-product backward compatibility, sibling-variant
distinctness in sales/purchase/dashboard reports, product-filter-includes-
variants, variant-filter-returns-only-that-variant, cross-product and
cross-tenant variant filter safety, historical label stability under rename/
deactivation, per-variant inventory value rows (no misleading parent
avg_cost=0), variant-scoped warehouse balances, variant-tagged stock
movements.

**Regression (targeted):**
`--filter="SalesReport|PurchaseReport|InventoryReport|Dashboard|
ReportEffectiveScope|VariantReporting|VariantDocumentLine|ProductVariantCore|
InventoryState|PosVariantCheckout|Storefront|CommerceCart|CommerceCheckout|
CommerceOrder"` — **403 passed, 17 skipped** (known PostgreSQL-only
concurrency tests), **zero failures**, on SQLite.

**Regression (targeted) on PostgreSQL:** same filter — **420 passed, zero
failures** (the 17 SQLite-skipped concurrency tests run for real here).

**Full suite (SQLite, untargeted):** **3760 passed, 35 failed, 39 skipped**
(23786 assertions, 529.16s). All 35 failures are pre-existing environment
gaps, none touching reporting/variant/commerce/POS code:
- `FuelSupplyReceivingTest`/`FuelSupplyReceivingApiTest`/`FuelSaleServiceTest`/
  `FuelSaleApiTest`/`FuelReconciliationTest`/`FuelAviRfidServiceTest` (27
  failures) — `Call to undefined function App\Services\bcmul()`, a missing
  PHP `bcmath` extension in this test environment, unrelated to this task.
- `AuthRecoveryTest` (7 failures) — `Class "App\Mail\AuthActionMail" not
  found`; confirmed during this task's own test authoring (see Errors in the
  prior session) that `setup.sh` does not copy `app/Mail/` into the test
  harness — a pre-existing environment/setup gap, not caused by these changes.
- `DocumentCenterSecureIntakeTest` (1 failure) — pre-existing PDF-handling
  gap, unrelated to reporting.

Zero failures in `SalesReport*`, `PurchaseReport*`, `InventoryReport*`,
`Dashboard*`, `VariantReporting*`, `VariantDocumentLine*`,
`ProductVariantCore*`, `InventoryState*`, `PosVariantCheckout*`,
`Storefront*`, `CommerceCart*`, `CommerceCheckout*`, `CommerceOrder*`.

## Build / CI

Backend + minimal frontend change set. `php -l` clean on every changed PHP
file. `npx tsc --noEmit` clean on touched frontend files. `npm run build`
succeeded. Full untargeted SQLite suite run to confirm zero regressions
beyond the targeted filter above — 35 pre-existing failures, all outside
this task's scope (see Tests above). Targeted regression filter also run on
PostgreSQL (`migrate:fresh --force` against `nibras_test`) — 420 passed,
zero failures.

## Risks / Deferred

- **`InventoryBalanceExportService`/`InventoryBalanceFilters` not made
  variant-aware** — confirmed to have the identical "one row per product,
  variant rows invisible" gap `inventoryValue()` had, but it's fed by a
  different subsystem (the Inventory *Workspace* screen's own query builder,
  shared with non-reporting consumers, not `app/Services/Reporting/`).
  Fixing it correctly would mean reworking `InventoryBalanceFilters::query()`
  and this export's whole per-product batch-paging loop into per-variant
  rows — a larger, separate change outside "make existing Reports
  variant-aware." Flagged as a clear, scoped follow-up.
- **Commerce reporting remains entirely unbuilt** (see Commerce Reporting
  section) — no `CommerceOrder`/`CommerceOrderLine` report/list/dashboard
  endpoint exists at all; building one is a new feature, not in this task's
  scope.
- **No variant filter *input* added to the report frontend** — the backend
  filter parameter (`product_variant_id`) is fully functional and tested; the
  UI to pick a specific variant in the filter panel was not built (additive,
  deferred, not a correctness gap).
- **`stock_movements` has no `variant_descriptor_snapshot` column** — the
  movements report's variant label is therefore live, not historical-snapshot
  (documented, not a violation since no snapshot exists to prefer). Adding
  one would be a new migration outside this task's "smallest necessary" scope.
- **Pre-existing gap, not fixed here (belongs to VAR-DOC-1)**:
  `StoreInvoiceRequest`/`StorePurchaseRequest` never accept
  `items.*.product_variant_id` over HTTP — only the direct service-layer path
  can create a variant invoice/purchase line today. Does not affect reporting
  correctness (reports only read already-posted data), but blocks a fully
  realistic end-to-end HTTP test and, more importantly, blocks real merchants
  from invoicing/purchasing a variant through the actual API. Flagged clearly
  as an independent follow-up outside this task's scope, per the mission's
  own instruction not to silently expand scope for a pre-existing gap that
  isn't itself caused by this task's changes.
## Git

- Branch: `claude/var-report-1-variant-reporting`
- PR: VAR-REPORT-1: Variant-aware reporting and analytics
- Base SHA: `92acb428d60e15d269aede728e10b6d2422fa42c`
- Head SHA: `ce31c96` (سيُحدَّث بعد أي دفعة تالية تحمل هذا التحديث نفسه)

## Next Step

**Product Variants Final Closure Review** فقط. لا تبدأ أي milestone آخر حتى
تصل موافقة صفوان الصريحة.

# VAR-FU-3 Inventory Balance Export Report

## Scope

Closes **GAP-04 only** from the Product Variants Final Closure Review:
`InventoryBalanceExportService` exported one row per product (aggregate
quantity, honest `avg_cost = 0` for variant-managed products) instead of one
row per concrete `ProductVariant`, unlike the already-fixed twin pattern in
`InventoryReportService::inventoryValue()` (VAR-REPORT-1). No other module,
no accounting change, no Inventory/Reporting redesign. GAP-05 and GAP-06
untouched.

## Evidence

- `deliverables/PRODUCT_VARIANTS_FINAL_CLOSURE_REVIEW.md` §GAP-04 (lines
  665–685): confirms the gap is real, P2 (data completeness, not
  correctness — the pre-fix numbers were never wrong, just less granular),
  and names the exact fix pattern to copy.
- `app/Services/Reporting/InventoryReportService.php::inventoryValue()`
  (VAR-REPORT-1, lines 116–209): the authoritative reference semantics —
  variant-managed product → no parent row, one row per active
  `ProductVariant`, quantity/`avg_cost` from that variant's own
  `InventoryState` via the `ProductVariant::quantity_on_hand`/`avg_cost`
  accessors; warehouse-scoped quantity grouped by
  `(product_id, product_variant_id)`, never by `product_id` alone.
- `app/Models/Product.php::quantityOnHand()`/`avgCost()` (VAR-INV-1): for a
  variant-managed product, `quantity_on_hand` is a derived **sum across all
  variants** (display-only), and `avg_cost` is hard-coded **0** — the parent
  is explicitly not a valuation identity. Confirms the pre-fix export's
  numbers, while honest, could never represent per-variant cost.
- `app/Models/ProductVariant.php::quantityOnHand()`/`avgCost()`: read
  through the variant's own `InventoryState` (`hasOne`) — the correct
  per-identity authority.
- `app/Support/ProductWarehouseBalanceQuery.php`,
  `app/Support/InventoryBalanceFilters.php`: confirm the D-07 decision this
  task must not touch — cost is tenant-wide per inventory identity; only
  quantity is warehouse-scoped.
- `app/Http/Controllers/Api/InventoryController.php::export()`,
  `app/Http/Requests/ExportInventoryBalancesRequest.php`: the export's full
  request contract — confirms `warehouse_id` is **not** a validated filter
  key on this endpoint; the effective warehouse scope is driven exclusively
  by the authenticated user's `allowedWarehouseIds()` via
  `ReportWarehouseScope::resolve()`, same mechanism proven by
  `tests/Feature/ReportEffectiveScopeTest.php`'s existing `export …` test
  group (33 tests, all still green after this change).
- `tests/Feature/InventoryBalanceExportTest.php`: the export's existing
  regression suite — locks the exact 7-column header set with an
  `assertSame` on the full array, which is why the additive columns had to
  be appended at the end and that one assertion updated (not a redesign).

## Pre-fix Gap

`InventoryBalanceExportService::row()` read `$product->sku`, `$product->avg_cost`,
and the caller's `$product->quantity_on_hand`/warehouse-scoped sum directly
off the `Product` row — one row per product unconditionally. For a
variant-managed product this meant: one honest-but-coarse row showing the
summed quantity across all variants and `avg_cost = 0`, with no way for the
recipient to tell "تيشيرت / أسود / S" apart from "تيشيرت / أسود / M" or know
either variant's real cost.

## Inventory Identity Authority

Unchanged law, now correctly followed by this export too:

- **Simple product** → `Product` + `product_variant_id = null` → exactly one
  `InventoryState` row → exactly one export row.
- **Variant-managed product** → each active `ProductVariant` → its own
  independent `InventoryState` row → its own independent export row. The
  parent product **never** emits a row of its own once `variant_state =
  variant_managed`, and sibling variants' quantities/costs are never summed
  or averaged into one figure.

No parallel authority was introduced — every number in a variant row comes
from `ProductVariant::quantity_on_hand`/`avg_cost` (which read
`InventoryState` directly), exactly as `InventoryReportService::inventoryValue()`
already does.

## Export Semantics

This export represents **current inventory state** (live `InventoryState`,
live `Product`/`ProductVariant` descriptors) — it has no as-of/historical
snapshot semantics today, and none were invented. This matches the pre-fix
behavior exactly (the code never read from `journal_lines` or a point-in-time
ledger); only the row-level identity resolution changed.

Column contract (CSV/XLSX), **additive only**, existing 7 columns unchanged
in order/meaning/header text:

| # | Key | ar | en | Type | Change |
|---|-----|----|----|------|--------|
| 1 | `sku` | رمز الصنف | SKU | text | Now `variant.sku ?? product.sku` for a variant row (was always `product.sku`) |
| 2 | `barcode` | الباركود | Barcode | text | Unchanged — always `product.barcode` (primary barcode is not variant-scoped) |
| 3 | `name` | اسم الصنف | Product name | text | Unchanged — always `product.name`, never suffixed |
| 4 | `unit` | الوحدة | Unit | text | Unchanged |
| 5 | `quantity` | الكمية | Quantity | number | Now per-identity (variant's own or product's own) |
| 6 | `avg_cost` | متوسط التكلفة | Average cost | number | Now per-identity — **never 0-by-convention for a variant row** |
| 7 | `stock_value` | قيمة المخزون | Inventory value | number | `quantity × that row's own avg_cost` |
| 8 | `product_id` | معرّف الصنف | Product ID | text | **New**, additive |
| 9 | `product_variant_id` | معرّف المتغيّر | Variant ID | text | **New**, additive — empty for a simple-product row |
| 10 | `variant_descriptor` | وصف المتغيّر | Variant | text | **New**, additive — `DocumentLineVariantResolver::descriptor()`, e.g. "أسود / كبير"; empty for a simple-product row |

`sku` and `barcode` were the only pre-existing columns evaluated for
"least-breaking way to add a variant column" per the mission; `name` was
deliberately left untouched (never suffixed) so existing consumers parsing
that column see byte-identical content to before — the two new ID columns
plus `variant_descriptor` are what let a recipient distinguish sibling
variants **without depending on `name` alone**, as required.

## ProductUnitPrice Integration

Not applicable — this export never touched pricing and still doesn't; `sale_price`/`ProductUnitPrice` are out of scope for GAP-04.

## Variant-managed Product Semantics

`rows()` now branches per product in each page:

- **Variant-managed**: for every active `ProductVariant` of that product
  (batch-fetched, eager-loading `inventoryState` to avoid N+1 across a
  500-product chunk), compute its own quantity (unscoped: `variant.quantity_on_hand`;
  warehouse-scoped: grouped sum keyed by `(product_id, product_variant_id)`),
  apply `include_zero` per variant row, and `yield` one row via `row($product, $variant, …)`.
  The loop then `continue`s — **no fallthrough row for the parent**.
- **Simple**: byte-identical to before — same accessor, same warehouse-scoped
  lookup key (now `''` instead of a bare `product_id` key, since the
  warehouse-quantity grouping is now `(product_id, product_variant_id)` to
  avoid merging sibling variants' warehouse stock into one bucket, a bug that
  would otherwise have been introduced by this very change).

## Warehouse / Cost Semantics

D-07 preserved exactly: quantity is warehouse-scoped (via
`ReportWarehouseScope::resolve()` → `allowedWarehouseIds()` intersection,
unchanged mechanism), cost stays tenant-wide per inventory identity — a
variant's `avg_cost` is identical whether the request is unrestricted or
restricted to any single warehouse; only its `quantity` column changes.
Verified by test with two siblings stocked in two different warehouses at
two different unit costs each.

One necessary fix, in scope because it is a direct, mechanical consequence
of decomposing rows by identity: the `product_warehouse_stock` aggregation
in `rows()` grouped only by `product_id` before this change, which would
have **summed two sibling variants' warehouse quantities into a single
bucket** the moment they were split into separate rows — exactly the
"دمج بين sibling variants" the mission forbids. Fixed by grouping
`(product_id, product_variant_id)` together, mirroring
`InventoryReportService::inventoryValue()`'s existing pattern.

A second necessary fix: the SQL-level zero-quantity exclusion
(`COALESCE(inventory_states.quantity_on_hand, 0) != 0`, used only for the
unscoped `include_zero=false` case) joins the *simple* identity
(`product_variant_id IS NULL`) — for a variant-managed product that join is
always `NULL`, so this WHERE clause would have silently excluded **every**
variant-managed product from any zero-excluding export, regardless of its
variants' real stock. Fixed by letting `variant_state = 'variant_managed'`
rows through this WHERE unconditionally and moving zero-exclusion for
variant rows into `rows()`, evaluated per concrete variant identity.

Both fixes are required for the row-decomposition itself to be correct, not
scope creep — without them, the "closed" gap would have re-opened a new bug.

## Tenant / Branch Isolation

No new authority, no `withoutGlobalScope`, no raw filters added.
Variant/product resolution stays entirely inside the existing
`InventoryBalanceFilters::query()` (already `BaseModel`/`TenantScope`-scoped)
and `ProductVariant::query()` (same tenant scoping). Effective warehouse
scope is still `ReportWarehouseScope::resolve()` intersected with
`auth()->user()->allowedWarehouseIds()` — unchanged. Verified by test:
tenant isolation (a second tenant's export is empty), and a
warehouse-restricted user's export reflects only their allowed warehouse's
quantity even when they explicitly request a forbidden warehouse ID (falls
back to their allowed set, never leaks the forbidden one — pre-existing
`ReportWarehouseScope` behavior, confirmed unaffected).

`estimatedRowCount()` (the `MAX_ROWS` safety check) was updated because row
count is no longer 1:1 with product count — left unaddressed, a
variant-heavy catalog just under the product-count cap could silently
produce far more than `MAX_ROWS` actual rows. Now computed as
(products − variant-managed products) + (active variants of those
variant-managed products): two lightweight COUNT queries, once per export
request, never per row.

## Changed Files

- `app/Services/InventoryBalanceExportService.php` — variant decomposition,
  3 additive columns, warehouse-aggregation grouping fix, zero-exclusion
  fix, row-count safety-check fix, updated class docblock.
- `tests/Feature/InventoryBalanceExportTest.php` — updated the two
  full-header `assertSame` assertions to include the 3 new columns; added
  two assertions that a simple-product row's new variant columns are empty.
- `tests/Feature/InventoryBalanceExportVariantTest.php` (new) — 13 targeted
  scenarios covering all 15 required test areas from the mission (some
  combined where one test naturally proves two invariants together — see
  Tests below).

No migration. No route change. No permission change. No frontend change (the
export is a raw file download; no UI parses or renders individual columns
today).

## Tests

New file `tests/Feature/InventoryBalanceExportVariantTest.php`, 13 tests
mapped to the mission's 15 required scenarios:

1. Simple product unchanged → `simple_product_export_is_unchanged`
2. Sibling rows → `variant_managed_product_exports_a_separate_row_per_sibling_variant`
3. Correct `product_variant_id` per row → `each_row_carries_its_own_product_variant_id`
4. Correct descriptor/SKU → `descriptor_and_sku_are_populated_per_variant`
5. Quantity independence → `variant_quantities_are_independent`
6. `avg_cost` independence → `variant_avg_costs_are_independent`
7. value = qty × that variant's avg_cost → `inventory_value_equals_quantity_times_that_variants_avg_cost` (also sums both rows and asserts no cross-contamination)
8. No misleading parent row → `parent_product_row_is_never_emitted_for_variant_managed_products`
9. Warehouse-scoped quantity → `warehouse_scoped_quantities_reflect_only_that_warehouse`
10. Tenant-wide cost, not per-warehouse → `tenant_wide_cost_is_used_not_a_per_warehouse_invented_cost`
11. Zero-stock behavior → `zero_stock_variant_behavior_matches_the_include_zero_flag`
12. Tenant isolation → `tenant_isolation_negative_control`
13/14. Branch/warehouse isolation → `warehouse_restricted_user_never_sees_quantity_from_a_forbidden_warehouse` (this export's only branch/warehouse isolation mechanism is the user's `allowedWarehouseIds()`, so both are the same test)
15. Totals = sum of concrete line values → folded into scenario 7's sum assertion (this export emits no separate totals row/field in the file itself — none existed pre-fix either — so this proves the same invariant on the actual output instead of a non-existent totals field)

Also verified: an explicit `warehouse_id` query parameter for tests 9–10 was
initially attempted before discovering (via evidence) that
`ExportInventoryBalancesRequest`/`InventoryBalanceFilters::rules()` never
validated that key — the effective warehouse scope for this endpoint has
always come solely from the authenticated user's `allowedWarehouseIds()`.
Tests were corrected to use warehouse-restricted users instead of a
query-string filter, matching the endpoint's actual, pre-existing contract.

### SQLite

```
InventoryBalanceExportVariantTest   13/13 passed (76 assertions)
InventoryBalanceExportTest          20/20 passed (111 assertions) — existing suite, unmodified behavior + 2 updated assertions
VariantReportingTest                15/15 passed (113 assertions) — VAR-REPORT-1 suite, untouched code path
InventoryStateTest                  19/19 passed
ReportEffectiveScopeTest            33/33 passed — includes the pre-existing export warehouse-scope regression group
```

### PostgreSQL

Same five files, same results:

```
InventoryBalanceExportVariantTest + InventoryBalanceExportTest + VariantReportingTest
+ ReportEffectiveScopeTest + InventoryStateTest = 102/102 passed (822 assertions)
```

Full `php artisan test` was not run locally for this task, per the mission's
explicit instruction ("لا تشغّل full suite محليًا بلا سبب. دع CI يغطي
الأوسع.") — the targeted set above covers every file this change reads or
writes, plus its two closest sibling regression suites.

## CI

Not run in this environment; relies on the repository's `ci.yml` (SQLite +
PostgreSQL) to cover the broader suite per the mission's instruction.

## Risks / Deferred

- **Numeric range filters unchanged for variant-managed products.**
  `InventoryBalanceFilters::apply()`'s `qty_min`/`qty_max`/`avg_cost_min`/
  `avg_cost_max`/`stock_value_min`/`stock_value_max` filters are SQL WHERE
  clauses against the *simple* identity's joined `inventory_states` row —
  for a variant-managed product that join is always `NULL`/0, so these
  filters continue to exclude variant-managed products from a *filtered*
  export exactly as they did before this change (this predates GAP-04 and
  is not itself part of it — GAP-04 is about row *decomposition*, not
  numeric filtering). Making these filters evaluate per-variant would be a
  genuine query redesign (a correlated subquery or a second WHERE
  strategy), which the mission explicitly asked not to attempt
  ("لا تعِد تصميم Inventory/Reporting"). Documented here rather than
  silently left inconsistent; a real gap if someone later needs numeric
  export filters to work correctly for variant-managed catalogs, but out of
  this task's scope.
- **`estimatedRowCount()` adds up to two lightweight COUNT queries per
  export request** (only when at least one variant-managed product matches
  the base filter) — negligible for the `MAX_ROWS=50000` ceiling's request
  frequency, but worth noting as a small, deliberate cost of keeping the
  safety check honest after row-count stopped being 1:1 with product count.
- **`descriptor()`/variant fetch inside `rows()` is not further optimized
  beyond eager-loading `inventoryState`** (e.g. `optionValues` used by
  `DocumentLineVariantResolver::descriptor()` is still lazy per variant) —
  matches `InventoryReportService::inventoryValue()`'s own established
  pattern exactly, so this stays consistent with the reference
  implementation rather than diverging to a locally-optimized version.
- GAP-05 (`min_sale_price` + Variant regression) and GAP-06 (POS Variant
  photos) remain open, untouched, per explicit instruction.

## Git

- Branch: `claude/var-fu-3-inventory-balance-export`
- PR: opened after this report, title "VAR-FU-3: Make inventory balance
  export variant-aware"
- Base SHA: `5fc13364b56f7b9d3ab5a499d6f15a2d74b107d3` (`origin/main`, matches
  the last confirmed merge — PR #827, VAR-PRICE-UX-1)
- Head SHA: *(recorded after the commit below)*

## Journal Entries (pre-PR protocol)

None. This task is a read/export path only — `InventoryBalanceExportService`
performs no writes to `products`, `product_warehouse_stock`,
`inventory_states`, or `stock_movements`, and never calls
`LedgerService::post()`. No new financial operation was introduced, so no
journal entry table applies. (Confirmed by the existing, unmodified,
still-passing `export_writes_no_stock_movement_no_inventory_change_no_journal`
test.)

## Final Verdict

GAP-04: **CLOSED**

## Next Step

GAP-05 only after approval.

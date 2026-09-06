# AWJ Implementation Report — PR-INV-1

**Date:** 2026-09-06
**Status:** DONE — PR opened, no merge/deploy
**Branch:** `claude/phase-1-pr-inv-1`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/668
**Base SHA:** `cfb9576` (main, after PR-SEC-INV-1 / #666 merged)
**Head SHA:** `580baeb`

## 1. Summary

Implements `docs/plans/products-inventory/phase-1-hardening/PR-INV-1-cost-authorization.md` only — the second Phase 1 hardening gate of the Products & Inventory program. No other program task was started.

`products.view_cost` existed as a defined permission but was not centrally enforced anywhere. Every confirmed audit surface (`docs/audits/AWJ_PRODUCTS_INVENTORY_AUDIT_2026-09-05.md` §19) granted sensitive cost data through `products.view`/`products.manage` alone — permissions `accountant` and `staff` hold by default without `products.view_cost`. This PR centralizes the classification and enforcement.

**Follow-up (same PR, before closing):** on request, verified `/api/reports/inventory` (`InventoryReportController`/`InventoryReportService`) — a surface not named in the audit's confirmed list — and found it had an identical live gap: `reports.view` alone exposed `avg_cost`, `stock_value`, `unit_cost`, `total_cost`, `in_cost`/`out_cost`, and `difference_value` across all five report views. Wired to the same `SensitiveCostPolicy` (no parallel policy), with dedicated tests. See §2, §3, §5, §9, and §12 for the updated scope and evidence; §13's earlier flagged risk is now resolved.

## 2. Scope implemented

New `App\Support\SensitiveCostPolicy` is the single source of truth for:
- **Classification**: `purchase_price`, `avg_cost`, `profit_margin` (Product); `unit_cost`, `total_cost` (movement). `sale_price` is explicitly never classified as cost.
- **Authorization**: `authorized(?User $user)` wraps `Rbac::allows($user->role, 'products.view_cost')`.
- **Query blocking**: `queryBlocked()` rejects cost-derived filter/sort keys before the query runs (closes an inference channel a value-redaction-only approach would leave open).
- **Write blocking**: `productWriteBlocked()` compares submitted `purchase_price`/`profit_margin` against the existing record (or column defaults on create) — only an actual attempted change is blocked, not an unchanged resubmission.
- **Import blocking**: `importMappingBlocked()` rejects a `purchase_price` column mapping.
- **Redaction**: `redactRow()` (export rows and, since the follow-up, report rows/totals — blanks values, keeps headers/keys) and `redactActivityDiff()` (activity history — removes the whole field entry, old and new, not just the value).

Wired into every confirmed surface from the audit, plus the follow-up surface:

| Surface | Change |
|---|---|
| Product list/show | `ProductResource` defaults cost-field hiding to the central policy when POS hasn't already set its own flag |
| Product Activity history | `ProductActivityResource` redacts sensitive `diff` entries entirely |
| Product export (catalog + round-trip) | `ProductExportService` blanks `purchase_price`/`avg_cost` values, keeps headers (round-trip contract intact) |
| Inventory list/valuation | `InventoryController::index` nulls `avg_cost`/`stock_value`/`total_value` |
| Inventory export | `InventoryBalanceExportService` blanks `avg_cost`/`stock_value` values |
| Stock Movement unit/total cost | `InventoryController::movements` nulls `unit_cost`/`total_cost` |
| Cost/value filters and sorting | `ProductController::index/export` and `InventoryController::export` reject (`403`) before querying |
| Product create/update writes | `ProductController::store/update` reject unauthorized `purchase_price`/`profit_margin` changes |
| Product Import apply | `ProductImportService::preview/apply` reauthorize the live mapping, never trusting a stale preview permission |
| POS convergence | `PosController` now calls `SensitiveCostPolicy::authorized()` instead of a separate direct `Rbac::allows()` check |
| **Inventory analytical report** (follow-up) | `InventoryReportController::toDisplay()` nulls `avg_cost`/`stock_value`/`unit_cost`/`total_cost`/`in_cost`/`out_cost`/`difference_value` across all 5 views (`value`, `warehouses`, `movements`, `operations`, `stocktakes`), in both row data and totals |

## 3. Files changed

| File | Change | Why |
|---|---|---|
| `app/Support/SensitiveCostPolicy.php` (new) | Central classification + authorization/redaction/write-block/query-block helpers | One backend-owned policy reusable everywhere per the contract — avoids scattered independent sensitive-field lists |
| `app/Http/Resources/ProductResource.php` | Default cost-field hiding to the central policy when no POS flag is set | Closed "everyone with `products.view` sees cost" in the generic ERP resource |
| `app/Http/Resources/ProductActivityResource.php` | Redact sensitive field entries (old+new) from `diff` | Raw dirty diff disclosed prior/new cost values unconditionally |
| `app/Http/Controllers/Api/ProductController.php` | Filter/sort guard on `index`/`export`; write guard on `store`/`update`; live authorization passed into import `preview`/`apply` and `export` | Reject-at-the-door for cost-derived query/write attempts |
| `app/Http/Controllers/Api/InventoryController.php` | Redact valuation/movement cost fields; filter/sort guard on `export` | Inventory list/valuation/movements/export had no cost gate at all |
| `app/Http/Controllers/Api/PosController.php` | Converge on `SensitiveCostPolicy::authorized()` | Contract: "POS existing local gate must converge on, not bypass, the central policy" |
| `app/Services/ProductExportService.php` | Blank `purchase_price`/`avg_cost` for unauthorized exports (both templates) | Safe export columns instead of blocking the whole export |
| `app/Services/InventoryBalanceExportService.php` | Blank `avg_cost`/`stock_value` for unauthorized exports | Same pattern for inventory export |
| `app/Services/ProductImportService.php` | `assertCostMappingAuthorized()` called in `preview`/`apply` | Reauthorizes the actual mapped fields live; rejects `purchase_price` mapping without `products.view_cost` |
| `app/Http/Controllers/Api/InventoryReportController.php` (follow-up) | `toDisplay()` redacts `INVENTORY_REPORT_FIELDS` via `SensitiveCostPolicy::redactRow()` before halalas→riyal conversion | `reports.view` alone exposed cost/value data across all 5 report views — same policy, no parallel list |
| `app/Support/SensitiveCostPolicy.php` (follow-up addition) | Added `INVENTORY_REPORT_FIELDS` constant | Extends the single classification source rather than creating a second one |
| `tests/Feature/SensitiveCostAuthorizationTest.php` (new, extended by follow-up) | 30 tests covering the full contract test matrix + the report follow-up | Regression coverage for every confirmed surface plus the report surface |

## 4. Schema / migrations / API contract

None. No migration, no new endpoint. Behavior changes for callers lacking `products.view_cost`:
- Sensitive fields become `null`/omitted in read responses and export cell values (export headers unchanged).
- Cost-derived filter/sort query params on `GET /products`, `GET /products/export`, `GET /inventory/export` now return `403` instead of silently applying.
- `POST`/`PUT /products` return `403` if the payload would actually change `purchase_price`/`profit_margin`.
- `POST /products/import/preview` and `/apply` return `422` (existing import-domain error convention via `RuntimeException` → `ApiController::domain()` — not a new status code) if the column mapping includes `purchase_price`.
- (Follow-up) `GET /reports/inventory` (any `view`) returns `avg_cost`/`stock_value`/`unit_cost`/`total_cost`/`in_cost`/`out_cost`/`difference_value` as `null` instead of a number, in both `data` rows and `totals`, for callers lacking `products.view_cost`. No filter/sort params exist on this endpoint, so no query-rejection behavior was added — this was a pure redaction fix.

## 5. Security / Tenant / Branch / Warehouse evidence

All claims below are backed by passing tests in `tests/Feature/SensitiveCostAuthorizationTest.php` (run output in §9), cross-checked against unmodified existing suites:

- **Read redaction**: `an_unauthorized_role_never_sees_cost_fields_in_the_list_or_show_response`, `inventory_valuation_hides_avg_cost_and_stock_value_for_unauthorized_users`, `movement_cost_fields_are_hidden_for_unauthorized_users` — each paired with an `an_authorized_role_*` counterpart confirming unchanged data for owner/admin and any role explicitly granted `products.view_cost`.
- **History redaction, selectively**: `activity_diff_redacts_cost_fields_for_unauthorized_users_without_dropping_other_history` confirms non-cost diff entries (e.g. `name`) remain visible while sensitive keys are removed entirely (both old and new values).
- **Export redaction**: `catalog_export_blanks_cost_columns_for_unauthorized_users_but_keeps_headers`, `round_trip_export_blanks_purchase_price_for_unauthorized_users`, `inventory_export_blanks_avg_cost_and_stock_value_for_unauthorized_users` — headers verified present, values verified blank.
- **Inference-channel closure**: `product_cost_filters_and_sorts_are_rejected_for_unauthorized_users`, `inventory_cost_filters_and_sorts_are_rejected_for_unauthorized_users` — reject before the query runs; matching assertions confirm non-cost filters/sorts (`sale_price_gte`, `sort=name`) are unaffected.
- **Write authorization**: `creating_a_product_with_a_nonzero_purchase_price_is_rejected_for_unauthorized_users` (zero rows written on rejection), `updating_a_product_without_touching_purchase_price_succeeds_for_unauthorized_users` (resubmitting the unchanged value is never blocked), `updating_a_product_to_change_purchase_price_is_rejected_for_unauthorized_users` (DB value unchanged after rejection).
- **Import re-authorization**: `importing_a_file_mapped_to_purchase_price_is_rejected_at_preview_and_apply_for_unauthorized_users` (zero products created), `importing_a_file_that_does_not_map_purchase_price_succeeds_for_unauthorized_users` (non-cost import unaffected).
- **Stale-permission handling** (contract: "never trust a preview/session created under older permissions"): `revoking_view_cost_between_preview_and_apply_blocks_the_apply` and `granting_view_cost_between_preview_and_apply_allows_the_apply` — a custom role's permissions are changed between the two calls; the live-read `Rbac::resolve()` (no caching, pre-existing pattern) means `apply()` always reflects the current grant, not what held at `preview()` time.
- **Tenant isolation preserved**: `cost_authorization_does_not_weaken_tenant_isolation` — cross-tenant UUID access still `404`s, untouched by this change.
- **POS regression check**: `PosProductCostVisibilityTest` (pre-existing, unmodified) — full pass after swapping `Rbac::allows(...)` for `SensitiveCostPolicy::authorized(...)` in `PosController`; POS cost visibility is provably no weaker than before.
- **Role-permission plumbing verified**: `RoleTest` (unmodified) full pass — confirms the custom-role grant/revoke mechanics used by the stale-permission tests above are themselves sound.
- **Follow-up — inventory report redaction, per view**: `the_value_view_hides_avg_cost_and_stock_value_for_unauthorized_users`, `the_movements_view_hides_unit_and_total_cost_for_unauthorized_users`, `the_operations_view_hides_total_cost_for_unauthorized_users`, `the_stocktakes_view_hides_difference_value_for_unauthorized_users` — each asserts the sensitive field is `null` in both the row and `totals` for `staff`, while paired assertions confirm the owner token sees real values and non-cost fields (`quantity`, `quantity_difference`) stay visible for both.
- **Follow-up — unaffected view confirmed unaffected**: `the_warehouses_view_is_unaffected_because_it_never_carried_cost` — this view never exposed `stock_value` by design (quantity-only report); confirms the fix didn't need to (and doesn't) touch it.
- **Follow-up — access not blocked, only data redacted**: `an_authorized_role_may_still_use_the_report_without_products_view_cost_being_required_for_access` — `reports.view` alone still opens every view; `products.view_cost` only affects which fields are populated, per the user's explicit "don't break `reports.view`" instruction.
- **Follow-up — tenant isolation preserved**: `the_inventory_report_still_enforces_tenant_isolation` — a second tenant's `reports.view` user sees an empty `data` array for the first tenant's products, confirming the existing tenant-scoped query (`Product::withoutGlobalScope(BranchScope::class)` still under `TenantScope`) is untouched by the redaction change.

## 6. Accounting / Inventory reconciliation

Not applicable — this PR is authorization/redaction-only. No costing algorithm, moving-average logic, or GL posting is touched. `StocktakeTest`, `StockPermitTest`, `InventoryTest`, `InventoryBalanceExportTest` all pass unmodified (§9), confirming no valuation-path regression.

## 7. UOM / historical semantics

N/A — no UOM logic touched. Product Activity history retains every non-cost field entry unchanged; only sensitive-field entries are removed from `diff`.

## 8. Concurrency / idempotency

N/A — no new locking or transaction logic introduced. Permission checks read `Rbac::resolve()` fresh per request (the codebase's existing no-cache pattern for all permission checks), so there is no new race window beyond what already existed for any other permission-gated action.

## 9. Tests

| Command / suite | Result | Notes |
|---|---|---|
| `php artisan test --filter=SensitiveCostAuthorizationTest` | **30 passed** (234 assertions) | New PR-INV-1 contract test matrix (§5), including the 7 follow-up tests for `/api/reports/inventory` |
| `php artisan test --filter="InventoryReportTest\|SensitiveCostAuthorizationTest\|ProductExportTest\|InventoryBalanceExportTest\|InventoryTest\|StocktakeTest\|StockPermitTest\|RoleTest"` (follow-up regression run) | **130 passed** (763 assertions) | `InventoryReportTest` (unmodified, owner-token based) + posting-path suites unaffected by the report redaction |
| `php artisan test --filter="ProductExportTest\|ProductImportV2Test\|ProductImportTest\|InventoryBalanceExportTest\|InventoryReportTest\|InventoryTest\|ProductDataExplorerTest\|ProductLifecycleTest\|PosProductCostVisibilityTest\|PublicApiReadResourcesTest\|PublicApiProductWriteTest\|ApiInventoryTest\|RoleTest\|PartnerProductTest\|UpdateGuardsTest"` | **196 passed** (1115 assertions) | Every existing suite touching Product/Inventory cost, POS cost visibility, the separate public API, and role management — zero regressions |
| `php artisan test` (full suite, SQLite, after the follow-up) | **2408 passed, 1 skipped, 25 failed** | All 25 failures pre-existing and unrelated — identical set/count to the `PR-SEC-INV-1` baseline and to this PR's own pre-follow-up run: 24 `Fuel*` tests failing on `Call to undefined function App\Services\bcmul()` (missing `ext-bcmath` in this sandbox) + 1 `DocumentCenterSecureIntakeTest` PDF-fixture issue. Passed count rose from 2401 to 2408 (the 7 new report tests); this PR introduces zero regressions. |

## 10. Build / Lint / Typecheck

No `web/` (Next.js) files changed. `vendor/bin/pint --test` on touched files reports only pre-existing style deviations — verified identical via `git stash` against the pre-edit versions of each file (same pattern documented in the `PR-SEC-INV-1` report). This repository's CI (`ci.yml`) does not gate on Pint.

## 11. CI

Not polled from this session before opening the PR. `ci.yml` runs `php artisan test` on a SQLite + PostgreSQL matrix; this report's local validation covers SQLite only. All new/changed query logic uses portable Eloquent methods (`whereIn`, `filled()`, plain equality) with no DB-specific SQL, so no PostgreSQL-specific divergence is expected but was not directly observed.

## 12. Deviations from approved plan

None from the original contract. Scope matches it exactly:
- One centralized policy class (`SensitiveCostPolicy`), reused across every surface — not controller-specific ad hoc checks.
- Applied to the audit's confirmed surfaces (§19 of the audit): Product resource/activity/export, Inventory valuation/export/movements, cost/value filter+sort, Product writes, Product Import apply, POS convergence.
- No costing algorithm, moving average, GL, sale-price permission, or role-taxonomy change.
- The separate developer/public API (`/api/v1/products`, `PublicProductController`) is **not** named in the audit's confirmed surface list, never exposed cost fields to begin with, and was left untouched.

**One explicit, requested addition after the initial implementation**: `/api/reports/inventory` was not in the audit's original confirmed surface list, but was explicitly brought into this PR's scope by direct instruction (rather than being silently expanded on this agent's own initiative) after the initial PR was opened, once the same class of gap was suspected there. Fixed using the same `SensitiveCostPolicy` — no parallel policy, no accounting/costing/API-shape change beyond nulling the sensitive fields, `reports.view` and tenant isolation both re-verified intact.

## 13. Risks / remaining work

- ~~`/api/reports/inventory` cost exposure~~ — **resolved in this PR** (see Summary follow-up and §2/§3/§5/§9 above).
- PostgreSQL leg of CI was not run locally in this session; only SQLite was validated directly (same caveat as `PR-SEC-INV-1`).

## 14. Merge / deploy status

Neither merge nor deploy was performed. The PR (`#668`) is open for review; no auto-merge is configured. Awaiting review per the program's transition gate before `PR-PRICE-1` proceeds.

## 15. Next step

Review of this report and the PR diff (#668), including the `/api/reports/inventory` follow-up commit. On approval, proceed to `PR-PRICE-1` — minimum sale price after all economically applicable discounts — per `docs/plans/products-inventory/prompts/PHASE1_IMPLEMENTATION_PROMPTS.md`. Do not start `PR-PRICE-1` before this review, per program governance.

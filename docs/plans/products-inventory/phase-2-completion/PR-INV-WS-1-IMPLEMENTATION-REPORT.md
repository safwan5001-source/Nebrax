# PR-INV-WS-1 — Inventory Workspace Foundation

**Date:** 2026-09-11
**Status:** Implemented on dedicated branch. Not merged. Not deployed.
**Branch:** `feat/pr-inv-ws-1-inventory-workspace-foundation`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/762
**Base SHA:** `e33b52ef353d4d1e85b6dba847056ead963ddf1e` (`main`)
**Previous Head:** `0f5c421bfe24122aa030d74267ca3e0ebdd6b725`
**Head SHA:** (this documentation commit)

## 1. Executive summary

PR-INV-WS-1 is the first production-safe Inventory Workspace: a read-only Product × Warehouse table on `/inventory`, fed by `GET /api/inventory?view=workspace`. It does not add a second inventory engine, does not post stock or GL, and does not change valuation.

Warehouse-balance query and scoping live in one shared read-side foundation (`app/Support/ProductWarehouseBalanceQuery.php`) used by both Inventory Report warehouse view and Inventory Workspace.

Legacy `GET /api/inventory` (no `view`) remains the product-level report used by the existing export contract.

## 2. What was implemented

- `InventoryWorkspaceFilters` + `InventoryWorkspaceQuery` over `product_warehouse_stock.quantity`.
- `InventoryController::workspace()` dispatched from `index()` when `view=workspace`.
- Server-side search, warehouse, branch, category, stock-state filters, sort, and pagination.
- Cost/value redaction via `SensitiveCostPolicy` / `products.view_cost`.
- `/inventory` page loads the workspace query (no client-side full-set filter).
- Warehouse and branch columns, stock-state badge, product + movements drill-in.
- Loading / empty / error states. Mobile record layout using the existing DataTable pattern.
- Frontend query helper always sends `view=workspace`.
- Shared `ProductWarehouseBalanceQuery` for Product × Warehouse balance semantics.
- Report warehouse view retains its historical explicit `warehouse_id` AND-filter.
- Focused backend `InventoryWorkspaceTest` and frontend page/query tests on this branch.

## 3. What was intentionally not implemented

Serial/lot/expiry, reservations/available, stock requests, replenishment automation, movement-source drilldown architecture, import/accounting/valuation/schema changes, Design System V2, warehouse-grain export.

## 4. Changed files

- `app/Http/Controllers/Api/InventoryController.php`
- `app/Services/InventoryWorkspaceQuery.php`
- `app/Support/InventoryWorkspaceFilters.php`
- `app/Support/ProductWarehouseBalanceQuery.php`
- `app/Services/Reporting/InventoryReportService.php`
- `tests/Feature/InventoryWorkspaceTest.php`
- `web/src/modules/inventory/workspace-query.ts`
- `web/src/modules/inventory/workspace-query.test.ts`
- `web/src/app/(app)/inventory/page.tsx`
- `web/src/app/(app)/inventory/page.test.tsx`
- `docs/plans/products-inventory/phase-2-completion/INVENTORY-WORKSPACE.md`
- `docs/plans/products-inventory/phase-2-completion/PR-INV-WS-1-IMPLEMENTATION-REPORT.md`

Demo `mock-data.ts` still returns the product-level `/inventory` payload. Authenticated API is the production contract.

## 5. API / schema

- Schema/migrations: None
- New behavior: `GET /api/inventory?view=workspace`
- Unchanged: `GET /api/inventory` (no view), export, movements
- Report warehouse view: explicit `warehouse_id` AND effective scope remains the established report contract

## 6. Permissions

Same gates as inventory read: `products.view` + `inventory.core`. Cost fields require `products.view_cost`.

## 7. Tenant / branch / warehouse

TenantScope on `ProductWarehouseStock`. Effective warehouse scope via `ReportWarehouseScope`. Effective branch scope via `ReportBranchScope` on `warehouses.branch_id`. Covered by `InventoryWorkspaceTest`.

## 8. Accounting / stock / valuation impact

NONE / NONE / NONE.

## 9. Tests

Backend `InventoryWorkspaceTest` covers authorized listing, pagination, filters, tenant isolation, branch scope, warehouse scope, cost hidden without permission, cost visible with permission, unauthorized cost sort 403, no stock/journal/avg-cost mutation, and Workspace ↔ warehouse-report quantity parity under unrestricted and restricted effective scope.

Frontend tests cover `view=workspace` request, warehouse row rendering, cost hidden/shown, error/empty states, and export button.

Exact CI results must be read from PR #762 checks on this Head. Do not treat PHP/web as green until observed.

## 10. NOTE / DEFERRED DECISION — explicit forbidden warehouse_id

Explicit forbidden `warehouse_id` behavior differs between the existing Inventory Report warehouse view and Inventory Workspace for a warehouse-restricted user:

- **Inventory Report warehouse view:** explicit forbidden `warehouse_id` is ANDed with the user's effective warehouse scope, therefore the result is `[]`.
- **Inventory Workspace:** currently applies the user's effective warehouse scope but does not apply the explicitly requested forbidden `warehouse_id` as an additional AND-filter; therefore the forbidden warehouse is never exposed, but the response may contain the user's allowed warehouses instead.

**Security assessment:**

- No forbidden warehouse data is exposed by either behavior.
- Tenant Isolation / Warehouse Isolation remains preserved.
- This is a response-semantics consistency question, not currently proven to be an authorization leak.

**Decision:** DEFERRED.

Do not change production behavior in PR #762.
Do not unify either behavior without an explicit AWJ product/API semantics decision.

A future decision should determine the canonical behavior for an explicitly requested resource/filter outside the user's effective scope:

- A) empty result
- B) validation/authorization error
- C) silently constrain to allowed scope

Do not select A/B/C in this PR.

## 11. Merge / deploy

Neither merge nor deploy was performed.

## 12. Recommended next step

Safwan review of PR #762 after CI on the latest Head. After merge: warehouse-grain export or movement-source drilldown — not Serial/Lot or Reservations. Unifying explicit-out-of-scope filter semantics is a separate product/API decision.

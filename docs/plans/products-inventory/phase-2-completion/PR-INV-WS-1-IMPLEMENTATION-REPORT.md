# PR-INV-WS-1 — Inventory Workspace Foundation

**Date:** 2026-09-11
**Status:** Implemented on a dedicated branch. Not merged. Not deployed.
**Branch:** `feat/pr-inv-ws-1-inventory-workspace-foundation`
**PR:** https://github.com/safwan5001-source/Nebrax/pull/762
**Base SHA:** `e33b52ef353d4d1e85b6dba847056ead963ddf1e` (`main`)
**Head SHA:** `41c952fac0d9fc70c5401b389d655543b19b8e48` (additional UI/test commits may follow on the same branch)

## 1. Executive summary

PR-INV-WS-1 adds the first production-safe Inventory Workspace foundation: a read-only Product×Warehouse query over existing `product_warehouse_stock` rows. It does not add a second inventory engine, does not post stock or GL, and does not change valuation.

`GET /api/inventory` remains the product-level report when `view` is omitted. `GET /api/inventory?view=workspace` returns the paginated warehouse workspace.

## 2. What was implemented

- `InventoryWorkspaceFilters` and `InventoryWorkspaceQuery`
- `InventoryController::workspace()` dispatched from `index()` when `view=workspace`
- Server-side search, warehouse, branch, category, stock-state filters and pagination
- Cost/value redaction via `SensitiveCostPolicy` / `products.view_cost`
- Frontend workspace query contract (`web/src/modules/inventory/workspace-query.ts`)

## 3. What was intentionally not implemented

Serial/lot/expiry, reservations/available, stock requests, replenishment automation, movement-source drilldown architecture, import/accounting/valuation/schema changes, Design System V2, warehouse-grain export.

## 4. API / schema

- Schema/migrations: None
- New behavior: `GET /api/inventory?view=workspace`
- Unchanged: `GET /api/inventory` (no view), export, movements

## 5. Permissions

Same gates as inventory read: `products.view` + `inventory.core`. Cost fields require `products.view_cost`.

## 6. Tenant / branch / warehouse

TenantScope on `ProductWarehouseStock`. Effective warehouse scope via `ReportWarehouseScope`. Effective branch scope via `ReportBranchScope` on `warehouses.branch_id`.

## 7. Accounting / stock / valuation impact

NONE / NONE / NONE.

## 8. Tests / CI

Focused backend suite `InventoryWorkspaceTest` and frontend page tests were written locally. Record exact CI results from PR #762 checks; do not treat as green until observed.

## 9. Merge / deploy

Neither merge nor deploy was performed.

## 10. Recommended next step

Safwan review of PR #762. After merge: warehouse-grain export or movement-source drilldown — not Serial/Lot or Reservations.

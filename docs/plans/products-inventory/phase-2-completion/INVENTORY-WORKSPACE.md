# Warehouse Inventory Workspace

**Status:** IN PROGRESS — PR-INV-WS-1 foundation merged to `main` via PR #762 on 2026-09-12 (merge commit `748fc1201f9b76589f18426779a64d1bd081c421`). Movement-source drilldown, reservations, and replenishment remain planned.

## Goal
Turn the existing inventory balance/reporting foundation into the daily warehouse-aware operational workspace without creating a second inventory core.

## Prerequisites
PR-SEC-INV-1, PR-INV-1 and correctness hardening for the stock transactions whose data is surfaced. Warehouse quantity remains ProductWarehouseStock truth; avg cost remains global per Product.

## Primary grain
Product × Warehouse. Global Product aggregate may be a summary, never a substitute for warehouse truth.

## Server-side contract
Search/filter/sort/pagination execute server-side and are designed for 20k–50k operational scale. Stable deterministic ordering required. Cost/value filters and sorts require central cost permission, not merely hidden columns.

## Core columns
Product identity, SKU/barcode summary, category/unit, warehouse, on-hand base quantity, stock state. Avg cost/stock value only with `products.view_cost`. Future Reserved/Available columns are added only after Reservations establishes canonical semantics.

## Stock states
In Stock / Low / Out / Negative. Initial Low may use explicit reorder settings only when those exist; do not invent thresholds from arbitrary quantity. Negative remains visible even if negative stock is normally disabled because corrections/history may produce exceptional states.

## Actions
Safe drilldown to Product, warehouse balance, and movement source. Operational actions respect branch/warehouse access and permissions. No inline mutation that bypasses Stock Permit/Stocktake/Opening domain workflows.

## Security
TenantScope mandatory. Same-tenant branch/warehouse filtering must apply to rows and direct drilldowns. Cost redaction applies to response, export and query inference.

## UX
Dense accounting-grade DataTable, fast filters, sticky context, clear warehouse selector, RTL/LTR, keyboard-friendly. Avoid dashboard-card inflation. Mobile may use record layout but must preserve operational facts.

## Acceptance
Warehouse totals reconcile to Product aggregate; displayed stock is server-authoritative; unauthorized branches/warehouses/costs cannot be inferred; pagination/filter/export agree; movement drilldown never changes stock/GL.

## PR-INV-WS-1 foundation (merged)

Merged to `main` via PR #762 on 2026-09-12. Final PR Head: `802f9b73bcff85cf2582e62dab2085f50b1f974d`; merge commit: `748fc1201f9b76589f18426779a64d1bd081c421`. CI and Web CI were green before merge.

Read-only workspace query: `GET /api/inventory?view=workspace`.

- Grain: Product × Warehouse from `product_warehouse_stock.quantity`.
- Global `products.quantity_on_hand` remains the product-level report/export contract.
- Avg cost remains the global Product moving average.
- Stock states: `in_stock` / `low` (only when `products.reorder_level > 0`) / `out` / `negative`.
- Cost columns and cost sorts require `products.view_cost` via `SensitiveCostPolicy`.
- Shared read-side Product × Warehouse foundation: `app/Support/ProductWarehouseBalanceQuery.php` (used by Inventory Report warehouse view and Inventory Workspace).
- Deferred beyond PR-INV-WS-1: serial/lot/expiry, reservations, stock requests, replenishment, movement-source drilldown, valuation/posting changes.

## Sidebar navigation

The merged Inventory Workspace at `/inventory` is reachable from the existing Inventory sidebar leaf (`stockBalances`, `appKey: inventory.core`).

User-facing label:

- Arabic: مساحة عمل المخزون
- English: Inventory Workspace

This is a label/IA change only. The route, `inventory.core` visibility, and RBAC behavior are unchanged. No second `/inventory` sidebar item was added.

The deferred forbidden `warehouse_id` decision below is unchanged.

## NOTE / DEFERRED DECISION — explicit forbidden warehouse_id

Explicit forbidden `warehouse_id` behavior differs between the existing Inventory Report warehouse view and Inventory Workspace for a warehouse-restricted user:

- **Inventory Report warehouse view:** explicit forbidden `warehouse_id` is ANDed with the user's effective warehouse scope, therefore the result is `[]`.
- **Inventory Workspace:** currently applies the user's effective warehouse scope but does not apply the explicitly requested forbidden `warehouse_id` as an additional AND-filter; therefore the forbidden warehouse is never exposed, but the response may contain the user's allowed warehouses instead.

**Security assessment:**

- No forbidden warehouse data is exposed by either behavior.
- Tenant Isolation / Warehouse Isolation remains preserved.
- This is a response-semantics consistency question, not currently proven to be an authorization leak.

**Decision:** DEFERRED.

PR #762 did not change this production behavior.
Do not unify either behavior without an explicit AWJ product/API semantics decision.

A future decision should determine the canonical behavior for an explicitly requested resource/filter outside the user's effective scope:

- A) empty result
- B) validation/authorization error
- C) silently constrain to allowed scope

Do not select A/B/C without an explicit AWJ product/API semantics decision.

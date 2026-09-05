# Warehouse Inventory Workspace

**Status:** PLANNED

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
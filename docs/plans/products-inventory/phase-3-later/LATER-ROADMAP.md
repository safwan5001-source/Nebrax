# Phase 3 — Later Products & Inventory Roadmap

**Status:** DEFERRED / no implementation authorization

## Media portability
Product media remains separate from tabular Product master data. Future portability uses manifest/package with stable Product identity mapping, validation, resumable upload and explicit missing-file diagnostics. Do not embed large binary media into ordinary workbook cells.

## Quantity-tier pricing
Future commercial pricing may add quantity breaks, but remains explicit money policy per UOM/customer/price-list context. UOM factor is never a price multiplier. PR-PRICE-1 minimum-price invariant applies to final effective economics after any tier/discount policy.

## Intelligent replenishment
Only after trustworthy Low Stock/Reservations/demand data. Start with recommendations/explanations; automatic purchasing requires separate approval, controls, auditability and idempotency.

## Bundles/Kits
Later domain. Must decide whether bundle is commercial-only composition or stock-bearing assembly. Never decrement components and bundle stock simultaneously without an explicit inventory model. Lifecycle/UOM/reference registry applies to component Product refs.

## Manufacturing/BOM
Explicitly deferred. It requires a separate audit/design for raw materials, WIP, finished goods, costing, variance, production orders and accounting. Do not smuggle BOM/manufacturing semantics into Bundles or Stock Permits.

## Deferred-feature gate
Before activation, perform a focused current-state audit and create a new scoped implementation plan. This file records direction only.
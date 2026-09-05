# Low Stock & Replenishment

**Status:** PLANNED

## Goal
Turn trustworthy warehouse inventory into actionable replenishment signals without premature automatic purchasing.

## Prerequisites
Warehouse Inventory Workspace. Reservations semantics must be considered before choosing the replenishment basis.

## Per-warehouse planning data
Reorder point, target/max quantity as appropriate, preferred supplier, lead time and optional safety-stock policy. Values are Product×Warehouse operational settings, not global Product assumptions when warehouses differ.

## Signal
Low Stock Center classifies actionable shortages using an explicitly documented basis. Before Reservations, On Hand may be used. After Reservations, decide whether signal uses Available; do not silently change semantics.

## Suggested quantity
Deterministic formula based on target/reorder policy and current basis. Never create a Purchase Order automatically in initial scope.

## Transfer before purchase
Where another authorized warehouse has surplus, suggest internal transfer before external purchase. Suggestion must account for source availability and branch/warehouse access; it is advisory until a user creates the appropriate request/permit.

## Supplier context
Preferred supplier and lead time support recommendation/explanation only. Purchase pricing/cost data remains permission-protected.

## UX
One dense actionable center: warehouse, Product, current basis quantity, reorder point, shortage/suggested quantity, supplier/lead time, available internal transfer candidate, action. No decorative dashboard duplication.

## Acceptance
Signals are reproducible, warehouse-specific, permission-safe, do not move stock/GL, do not auto-create purchasing commitments, and explain which quantity basis/formula produced the recommendation.
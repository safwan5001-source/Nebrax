# Phase 2 — Dependencies & Gates

## Execution order is dependency-driven

1. Multiple UOM/Barcode completion after UOM/lifecycle/Stock Permit hardening.
2. Durable Imports after stable UOM/barcode workbook + cost/lifecycle policies.
3. Inventory Workspace after security/cost and stock-correctness gates.
4. Serial/Lot/Expiry after UOM/lifecycle/stocktake correctness and warehouse identity.
5. Reservations/Availability after stocktake concurrency and stable warehouse/tracking policy.
6. Stock Requests after Stock Permit authorization/UOM; reservation linkage optional and separately decided.
7. Low Stock/Replenishment after Inventory Workspace; quantity basis revisited when Reservations lands.
8. Movement Source Drilldown can begin with Workspace but must consume central source/security/cost contracts.

## Cross-phase release gate

A Phase-2 feature is not implementation-ready until it has its own scoped PR decomposition, API/schema decisions, migration strategy, tests, failure semantics and Claude Code handoff generated against then-current `main`.

## Program invariants

No feature may introduce a second stock truth, second cost permission system, factor-derived pricing, per-warehouse average cost, branch-as-tenant security, Product Catalog stock effects, or silent stale-snapshot behavior.

## Decisions requiring owner approval

- soft-deleted/deactivated barcode reuse policy if not settled in PR-UOM-1;
- Weighted Barcode;
- Product Variants/Attributes;
- reservation-overcommit policy;
- reservation linkage to Stock Requests;
- expiry override policy when detailed tracking is designed;
- any change from global moving-average valuation;
- any automatic purchasing/replenishment action.
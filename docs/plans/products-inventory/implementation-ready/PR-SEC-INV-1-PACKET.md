# Implementation-Ready Packet — PR-SEC-INV-1

**State:** PREPARATION-READY — implementation not authorized.
**Baseline:** `70501735051f7cd4632417b38b835e8057b1bd8d`
**Architecture contract:** `../phase-1-hardening/PR-SEC-INV-1.md`

## FROM — verified current behavior
- Stocktake index is access-scoped; store validates Warehouse access.
- Stocktake direct `show/count/post/destroy` resolves tenant-visible record by UUID without reasserting operational Warehouse/Branch access.
- Stock Permit index is access-scoped; store validates source and target Warehouses.
- Stock Permit direct `show/post/destroy` does not reassert access to the record's source/target Warehouse.
- Existing `ApiController` primitives already know allowed branches/warehouses and can fail closed.
- TenantScope remains the first cross-tenant boundary and must not be weakened.

## TO — invariant
A restricted same-tenant user cannot read, count, post, mutate or delete Stocktake/StockPermit records outside authorized Warehouse/Branch scope even with a known UUID.

Stocktake direct actions authorize its stored `warehouse_id`.
Stock Permit direct actions authorize source `warehouse_id` and, for transfer, non-null `target_warehouse_id`; access to only one transfer endpoint is insufficient.

## Implementation shape
Prefer a narrow reusable controller/helper composition around existing Warehouse authorization. Do not introduce a new global scope/policy architecture unless current code proves the existing primitive cannot express the rule.

## Expected changes
Likely: `ApiController.php` only if helper is useful; `StocktakeController.php`; `StockPermitController.php`; dedicated Feature authorization tests.

Inspect-only unless evidence requires otherwise: models, Stocktake/StockPermit domain services, User access helpers, BranchContext, routes/middleware, existing posting tests.

Forbidden: accounting/UOM behavior changes, BranchScoped conversion, DeliveryNote/InventoryOpening changes, migrations/schema, permission taxonomy redesign.

## Proof matrix
1. allowed Stocktake Warehouse succeeds through normal show/count/post/destroy behavior.
2. disallowed Stocktake Warehouse denied for all direct actions.
3. branch allowed but Warehouse denied still denies.
4. Stock Permit receipt/issue source allowed succeeds normally.
5. Stock Permit source denied blocks show/post/destroy.
6. transfer source allowed + target denied blocks.
7. transfer source denied + target allowed blocks.
8. transfer both allowed succeeds normally.
9. central/no-branch Warehouse follows Warehouse permission; null branch alone is not denial.
10. list `branch=all` semantics remain limited to user's allowed branches.
11. cross-tenant UUID remains inaccessible through TenantScope.
12. denied mutation/post creates no line/state/StockMovement/ProductWarehouseStock/JournalEntry effect.
13. existing double-post and inventory posting protections remain green.

## Stop conditions
Stop rather than expand if Warehouse semantics conflict with existing User helpers, a direct action intentionally supports an unrepresented cross-Warehouse rule, failure semantics require project-wide authorization redesign, or another domain has a similar gap. Record adjacent findings separately.

## Handoff rule
When Safwan explicitly authorizes execution later: Claude Code starts from then-current main, reconciles drift, implements only this packet, runs targeted security tests then relevant backend tests, and returns the mandatory MD Implementation Report. No merge/deploy without explicit approval.
# Implementation-Ready Packet — PR-INV-1

**State:** GROUNDED — final surface census remains before execution handoff; implementation not authorized.
**Baseline:** `70501735051f7cd4632417b38b835e8057b1bd8d`
**Architecture contract:** `../phase-1-hardening/PR-INV-1-cost-authorization.md`

## FROM — verified current code
- Product resource cost hiding is POS-specific rather than one central ERP cost policy.
- Inventory balance responses expose average cost and stock value; movement responses expose unit/total cost.
- Product list filtering/sorting can infer purchase price.
- Inventory filtering/sorting can infer average cost/stock value.
- Product write validation treats purchase price as an ordinary mutable field; central sensitive-cost write authorization is absent at this boundary.
- Product import/export and inventory export are part of the approved cost-surface census and must consume the same policy.

## TO — invariant
One backend-owned classification governs sensitive Product/Inventory cost across read, write, filter, sort, import, export, history and POS convergence.

Sensitive minimum set: `purchase_price`, `avg_cost`, `profit_margin`, derived stock value/aggregate inventory value, StockMovement `unit_cost`, StockMovement `total_cost`.

`sale_price` is not sensitive cost.

Read/export/filter/sort requires `products.view_cost`. Unauthorized classified filters/sorts fail deterministically rather than silently leaking through result ordering/counts. Ordinary non-cost Product mutation remains `products.manage`; a mutation that actually writes purchase cost requires both `products.manage` and `products.view_cost`.

Import apply must reauthorize at execution time; preview cannot be trusted after permission revocation. Activity/history redacts both old and new classified values. POS tenant visibility setting is an additional restriction, never a replacement for central permission.

## Expected change areas
Central support/policy helper; ProductResource; InventoryController; Product/Inventory filters; Product create/update authorization; Product import inspect/preview/apply; Product/Inventory exports; Product activity/history redaction; POS cost gate delegation; targeted Feature security tests.

Forbidden: costing algorithm changes, moving-average redesign, GL/posting changes, sale-price permission changes, role taxonomy redesign, generic export rewrite.

## Proof matrix
1. unauthorized Product list/show cannot read classified cost.
2. authorized Product callers retain existing cost fields/format.
3. unauthorized activity cannot infer old/new classified values.
4. unauthorized Product exports/round-trip cannot expose classified cost.
5. unauthorized Inventory balance has no avg cost/stock value/aggregate value leak.
6. unauthorized movements have no unit/total cost leak.
7. classified Product filters/sorts denied without permission.
8. classified Inventory filters/sorts denied without permission.
9. products.manage alone can change non-cost fields but not purchase cost.
10. products.manage + products.view_cost can write purchase cost.
11. import inspect/preview/apply obey current permission; apply fails closed after revocation.
12. export modes/selected IDs/CSV/XLSX cannot bypass policy.
13. POS requires central permission plus its existing visibility setting where applicable.
14. owner/admin wildcard and explicit grant continue to work.
15. Tenant Isolation remains green.

## Stop conditions
Stop if centralization requires changing role semantics, unrelated public API behavior, accounting algorithms, or broad export architecture. Newly discovered cost surfaces are added to the census before implementation scope expands.

## Handoff rule
Claude Code only after explicit owner authorization and drift reconciliation against then-current main. Targeted security tests first, then relevant backend suite. Mandatory final MD Implementation Report. No merge/deploy.
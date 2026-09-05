# Implementation-Ready Packet — PR-INV-2 Purchase Returns Hardening

**State:** GROUNDED — implementation not authorized.
**Baseline:** `70501735051f7cd4632417b38b835e8057b1bd8d`
**Architecture contract:** `../phase-1-hardening/PR-INV-2-purchase-returns.md`

## FROM — verified current code
- `PurchaseLine` snapshots `unit_name` and `unit_factor` and uses the shared unit-conversion concern.
- `ReturnLine` stores quantity/price/tax/source line but has no equivalent UOM/factor snapshot.
- Sales-return inventory handling already has explicit historical source-line base-quantity conversion logic.
- `postPurchaseReturn()` currently classifies tracked-line Inventory GL credit using the commercial return line subtotal less discount.
- The same purchase-return posting then calls `InventoryService::applyIssue()` with `ReturnLine.quantity` directly and passes `ReturnLine.unit_price` as cost.

This creates two separate P1 risks: commercial quantity may not equal base inventory quantity, and the Inventory GL amount may not equal the actual inventory subledger valuation removed by `applyIssue()`/moving-average rules.

## TO — invariants
### Quantity
A source-linked purchase return removes the exact historical base quantity represented by the returned commercial quantity using the immutable source `PurchaseLine` conversion snapshot. It must not derive conversion from the Product's current UOM template.

A free purchase return with no trustworthy source must follow one explicit existing contract; if current API cannot represent UOM safely, do not invent a factor. Preserve base-quantity semantics or raise a scoped decision.

### Valuation
For tracked inventory, purchase-return posting must satisfy in minor units:

`Δ Inventory GL account 1140 = Δ Inventory Subledger value`

The GL credit must be derived from the same authoritative valuation actually removed from inventory, not independently from supplier refund/commercial unit price. Any commercial difference belongs to the appropriate existing purchase-return/expense/variance accounting treatment; do not force inventory to supplier refund value merely to balance the entry.

## Transaction/concurrency contract
Posting remains one transaction. Preserve ReturnDocument row lock/double-post guard. Availability enforcement is Warehouse-aware. Inventory valuation and GL derivation must be deterministic under the existing InventoryService locking/moving-average contract; no per-Warehouse costing redesign.

## Required cases
1. base-UOM purchase return quantity/valuation reconciles.
2. alternate-UOM source purchase: partial return converts with historical `unit_factor`.
3. Product UOM template changed/deleted after purchase: return still uses source snapshot.
4. return commercial unit price differs from current average cost: Inventory GL follows actual subledger removal while document/vendor economics remain balanced.
5. line discount/tax do not contaminate inventory valuation.
6. multiple tracked + nontracked lines reconcile inventory/expense/tax/payable/cash totals.
7. insufficient Warehouse stock fails atomically with no GL/state/stock partial write.
8. double/concurrent post remains protected.
9. cross-tenant/source-line mismatch remains denied.
10. after posting, measured 1140 delta equals measured inventory subledger value delta exactly in halalas.

## Expected change areas
`ReturnService` purchase-return path; possibly ReturnLine schema/model only if immutable return-side snapshot is proven necessary beyond source snapshot; source validation/conversion helper; targeted accounting/inventory Feature tests.

Inspect first: `PurchaseLine`, `HasUnitConversion`, `InventoryService::applyIssue`, ReturnDocument/ReturnLine migrations, purchase posting valuation, existing return tests.

Forbidden: global costing redesign, per-Warehouse average cost, sales-return redesign, purchase document redesign, unrelated UOM UX.

## Stop conditions
Stop if `InventoryService::applyIssue()` does not expose/allow reliable authoritative issued value without changing broad accounting contracts, or if free purchase-return UOM semantics are ambiguous. Raise the narrow design issue before implementation expansion.

## Handoff rule
Claude Code later must instrument/assert both stock quantity and monetary deltas in tests, not merely inspect journal lines. Mandatory MD Implementation Report. No merge/deploy.
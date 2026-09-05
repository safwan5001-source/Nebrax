# PR-INV-3 — Stock Permit UOM / Base Quantity

**Priority:** P1  
**Status:** PLANNED

## Confirmed problem

`StockPermitLine.quantity` is currently consumed directly as stock quantity. Lines do not preserve historical `unit_name`/`unit_factor`. Commercial input such as 1 carton can therefore be treated as 1 base piece.

## Invariant

All InventoryService movement quantities are base quantities. A Stock Permit may accept a commercial UOM, but it must validate that UOM against the Product semantics and persist an immutable conversion snapshot/base quantity before stock movement.

## Data contract

Plan the clean pre-production schema needed to preserve at least:
- entered/commercial quantity;
- `unit_name` snapshot;
- `unit_factor` snapshot;
- authoritative base quantity.

Exact naming should align with established Invoice/Purchase line conventions after implementation inspection. Existing demo data may be reset/migrated simply; do not preserve an inferior ambiguous meaning.

## Type behavior

### Receipt
Entered quantity converts to base quantity. User-entered receipt cost semantics must be explicit: determine whether current `unit_cost` is per entered UOM or per base unit from existing UI/API contract before modifying; do not guess. Whatever contract is retained, InventoryService receives base quantity and correctly normalized inventory value/cost.

### Issue
Convert to base quantity; availability is checked in source warehouse using base quantity. Valuation remains current global avg cost at posting.

### Transfer
Convert once to base quantity; issue source and receipt target use exactly the same base quantity and carrying cost. Same-branch transfer remains no-GL; cross-branch 1140↔1140 branch reclassification remains balanced.

## Historical behavior

After permit creation/posting, later UnitTemplate mutation must not reinterpret the permit. Posted permit display/audit uses snapshots.

## Compatibility

Existing clients sending only quantity/base unit should continue to behave as factor 1 through an explicit default/base-unit path, not an unknown-unit fallback.

## Tests

Receipt/issue/transfer × base and alternative UOM; warehouse availability in base qty; cost normalization/line total; same-branch vs cross-branch transfer; template changed after permit creation; unknown/stale unit fails closed; double-post; rollback; GL/subledger equality for financial permit types.

## Out of scope

Stock Requests, multi-UOM stocktake, Serial/Lot/Expiry, new costing model, general UOM-template mutation policy (PR-UOM-1).
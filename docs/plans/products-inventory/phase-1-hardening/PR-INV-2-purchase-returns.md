# PR-INV-2 — Purchase Returns: UOM + Carrying Value Reconciliation

**Priority:** P1  
**Status:** PLANNED

## Confirmed problems

1. Purchase-return quantity can lack the historical UOM/base-quantity semantics needed to return an original alternative-unit purchase safely.
2. Supplier credit/commercial return value can differ from current inventory carrying value; inventory issue and GL 1140 must use carrying value consistently rather than forcing commercial value into stock valuation.

These must ship together because both affect the same financial stock exit.

## Invariants

- return stock quantity is immutable base quantity derived from the original purchase semantics;
- cannot return more base quantity than eligible received/not-already-returned quantity under the existing return policy;
- stock issue uses inventory carrying value under current global moving-average architecture;
- `Δ Inventory GL 1140 = Δ Inventory Subledger` exactly in minor units;
- supplier credit/tax/commercial economics remain represented correctly even when different from carrying value;
- posting is atomic and double-post safe;
- warehouse negative-stock policy remains enforced.

## Historical UOM contract

Prefer authoritative original PurchaseLine historical `unit_name`/`unit_factor`/base quantity semantics. A future change to UnitTemplate must not reinterpret an old purchase or its return. Return lines must persist enough immutable information to explain quantity later.

## Valuation contract

Separate:
- commercial return value / supplier liability / recoverable tax effects;
- inventory carrying value removed from subledger and 1140;
- any required difference account treatment according to existing purchase-return accounting architecture.

Do not modify global moving-average costing model in this PR.

## Concurrency

Revalidate remaining returnable base quantity and stock availability inside the posting transaction. Concurrent returns must not both consume the same remaining eligible quantity. Preserve/strengthen document lock/idempotency behavior.

## Tests

- original base unit return;
- original alt UOM factor 24: return 1 carton removes 24 base units;
- UnitTemplate changed after original purchase does not alter historical return conversion;
- partial returns then remaining quantity;
- concurrent/duplicate return attempt;
- insufficient warehouse stock under negative-stock-disabled policy;
- commercial value = carrying value;
- commercial value > carrying value;
- commercial value < carrying value;
- tax-bearing purchase return;
- exact proof that movement/subledger delta equals 1140 delta;
- rollback leaves no partial stock/GL/document mutation.

## Out of scope

No new costing method, no per-warehouse average cost, no broad Purchase UX redesign, no Serial/Lot selection yet.
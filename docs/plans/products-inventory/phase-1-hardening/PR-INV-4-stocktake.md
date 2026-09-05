# PR-INV-4 — Stocktake Snapshot / Concurrent Movement Reconciliation

**Priority:** P1  
**Status:** PLANNED

## Confirmed problem

Stocktake open snapshots `system_quantity`; count stores physical `counted_quantity`; post currently applies `counted - opening snapshot` to whatever balance exists at posting. Concurrent stock movement between snapshot/count/post can therefore make the final stock mathematically wrong.

Example: snapshot 100, physical count 98, sale 10 before post → current 90. Applying stale -2 yields 88 although the count evidence did not establish 88.

Document `lockForUpdate()` prevents double-post but does not prove inventory state remained compatible with the snapshot.

## Required correctness contract

Silent stale-snapshot posting is forbidden. Implementation must select and document one explicit safe policy after inspecting existing operational constraints:

A. movement freeze/cutoff for counted warehouse/products during the relevant window; or
B. optimistic inventory version/reconciliation: detect movements/state change since snapshot and require refresh/reconciliation before posting; or
C. an equivalently safe design that mathematically reconciles counted physical state with intervening known movements.

Default preference for AWJ is minimal operational disruption: detect/reconcile rather than broad warehouse freeze, unless implementation evidence shows freeze is materially safer/simpler. The implementer must not choose a policy silently; report the chosen policy and rationale.

## Invariants

- physical count evidence is not applied as a stale delta;
- posting remains atomic with stock movements + one variance journal;
- variance value uses current approved carrying-cost semantics;
- `Δ1140 = Δsubledger` for the actual correction posted;
- uncounted lines remain no-effect;
- no negative counted quantity;
- base quantity remains truth; multi-UOM count UX deferred.

## Concurrency cases

Sale, purchase receipt, Stock Permit issue/receipt/transfer, another stocktake/correction affecting same Product×Warehouse, and retry/double-post. Lock/version ordering must avoid deadlock-prone inconsistent ordering where practical.

## Tests

- no intervening movement → current behavior mathematically preserved;
- sale after snapshot;
- receipt after snapshot;
- transfer in/out after snapshot;
- multiple movements;
- only unrelated Product/Warehouse movement should not unnecessarily block scoped count;
- stale state produces explicit conflict/reconciliation behavior and no stock/GL mutation;
- retry after resolution succeeds once;
- double-post remains blocked;
- journal/subledger exact equality and rollback.

## Out of scope

Multi-UOM counting UX, Serial/Lot count identity, reservations, broad inventory locking framework unless strictly required by selected policy.
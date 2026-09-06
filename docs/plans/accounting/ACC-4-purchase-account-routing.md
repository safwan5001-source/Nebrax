# ACC-4 — Purchase & Purchase Return Account Routing

**Status:** PREPARED / BLOCKED BY `GATE-ACC-RET-1`  
**Dependency:** ACC-2 + GATE-ACC-RET-1 approved implementation contract.  
**Risk:** High accounting correctness.  
**Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Objective
Adopt semantic Account Routing in Purchase and Purchase Return posting only after the Supplier Refund/Purchase Return settlement contract is resolved. Preserve purchase valuation, VAT, supplier dimensions, stock movements and historical journals.

## Purchase roles
- `accounts_payable` -> legacy 2110
- `inventory_asset` -> legacy 1140
- `purchase_expense` -> legacy 5150
- `tax_input` -> legacy 1150
- `document_adjustment` -> legacy 5170

Purchase shipping/discount do not receive separate roles in V1 because current accounting folds them into inventory/expense cost basis.

## Purchase posting invariants
- tracked inventory debit uses `inventory_asset`.
- non-inventory debit uses `purchase_expense`.
- input VAT debit uses `tax_input`.
- header adjustment uses shared `document_adjustment`, preserving sign.
- total supplier credit uses `accounts_payable`.
- payment remains separate; do not change PaymentService settlement semantics here.
- valuation, quantities, branch/cost-center/Partner dimensions unchanged.

## Purchase Return target invariants
Only after GATE-ACC-RET-1 cutover contract:
- Purchase Return posts commercial reversal through `accounts_payable`, never direct generic cash.
- tracked return credits `inventory_asset`.
- non-inventory return credits `purchase_expense`.
- reversed VAT credits `tax_input`.
- actual money from supplier is separate Supplier Refund settlement.

No dedicated `purchase_returns` semantic account is approved in V1.

## Fail closed / history
Explicit invalid mapping blocks transaction atomically. Unmapped remains legacy-equivalent. Existing posted Purchase/Purchase Return journals remain frozen. Reversals use original concrete journal accounts.

## Out of scope
No Supplier Refund implementation unless separately authorized under gate; no cash/bank roles; no fiscal/lock work; no valuation redesign; no branch-specific mappings; no historical rewrite; no LedgerService change; no merge/deploy.

## Required tests
- unmapped Purchase exact legacy equivalence.
- each mapped role changes account only, not amount/direction.
- positive/negative `document_adjustment` direction preserved.
- VAT unchanged.
- tracked/nontracked split unchanged.
- supplier Partner dimension unchanged.
- stock/valuation unchanged.
- invalid mapping rolls back all effects.
- tenant isolation.
- historical journals/reversals frozen.
- post-gate Purchase Return never creates direct cash movement.
- Supplier Refund separation verified by integration contract where implemented.
- SQLite/PostgreSQL relevant suites.

## Stop condition
This task MUST NOT execute while `GATE-ACC-RET-1` remains unresolved. Do not preserve the old direct-1110 cash return merely to make ACC-4 pass.
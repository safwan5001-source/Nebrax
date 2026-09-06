# GATE-ACC-RET-1 — Purchase Return & Supplier Refund Financial Contract

**Status:** ARCHITECTURE CONTRACT RESOLVED — IMPLEMENTATION STILL REQUIRES EXPLICIT APPROVAL  
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`  
**Audited baseline:** `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`  
**Risk:** High financial/accounting + settlement integrity.  
**Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Confirmed repository evidence
- `ReturnDocument` is branch-scoped, numbered, draft -> posted, stores partner/original/journal references and legacy `payment_type`; no Supplier Refund relation exists.
- `Payment` is branch-scoped, numbered, draft -> posted; `direction` is business semantic: `received` = customer receipt/AR and `paid` = supplier payment/AP.
- `PaymentAllocation` is for Payment allocations to Invoice/Purchase; do not repurpose it for supplier-return credits.
- `PaymentService::post()` uses row locks and revalidation for concurrency-safe settlement. Reuse this pattern conceptually.
- `LedgerService::reverse()` locks original journal, reverses original concrete accounts/dimensions, marks original reversed and prevents double reversal.
- `GeneratesDocumentNumbers` is the numbering source of truth and derives branch/company scope from the model.

## Target principle
`Purchase != Supplier Payment` and `Purchase Return != Supplier Refund`.

## Purchase Return target
For new Purchase Returns after cutover:
- Dr `accounts_payable`.
- Cr `inventory_asset` for tracked goods.
- Cr `purchase_expense` for non-inventory basis.
- Cr `tax_input` for reversed input VAT.

No direct Cash/Bank movement occurs inside Purchase Return posting.

## Supplier Refund target
When supplier actually returns money:
- Dr selected `CashBankAccount.account_id`.
- Cr `accounts_payable`.
- Supplier Partner dimension required.
- CashBankAccount deposit/policy validation required.
- Posting through LedgerService.

## Dedicated SupplierRefund domain — DECIDED
Do not add a third Payment direction and do not abuse `received`. Create a dedicated branch-scoped financial document/service.

### Lifecycle
V1: `draft -> posted -> reversed`. Posted/reversed documents immutable; correction by reversal.

### Numbering
Use `GeneratesDocumentNumbers`. Register a dedicated prefix through existing numbering catalog/convention; suggested semantic prefix `SRF`, but implementation must first verify no collision on current main.

### Required data concepts
UUID, tenant_id, branch_id, number, supplier partner_id, refund_date, integer minor-unit amount, payment method snapshot/reference per CashBank conventions, selected CashBankAccount/concrete destination reference as required by service contract, reference, notes, status, journal_entry_id, created_by, lifecycle timestamps where repository convention supports them, normal timestamps. No fake FX fields.

## Settlement allocation model — DECIDED: dedicated Return allocations
Use a dedicated `SupplierRefundAllocation`, not PaymentAllocation.

Target allocation fields: tenant_id, supplier_refund_id, purchase_return_id (ReturnDocument constrained to purchase type), amount minor units, timestamps.

### Allocation invariants
- target is posted Purchase Return (`type=purchase`);
- same supplier partner;
- amount > 0;
- V1 sum allocations = SupplierRefund amount;
- cannot exceed refundable balance of any return;
- posting locks SupplierRefund and target returns in deterministic order before final balance check;
- concurrency cannot double-refund.

V1 does not allow free-standing unallocated supplier cash receipts. A future on-account supplier receipt needs its own explicit contract.

## Refundable amount source of truth
Do not reuse Purchase `paid_amount` and do not mutate Payment allocations.

`refundable = return.total - SUM(allocations belonging to posted, non-reversed SupplierRefunds)`.

Calculate from allocations in V1 rather than introducing a mutable balance cache. Any future snapshot is a cache, not source of truth.

## CashBankAccount boundary
Supplier Refund uses existing CashBankAccount domain for active account, linked Account, deposit permission, branch policy, method/account compatibility and currency constraints. No generic cash/bank Accounting Role.

## Account Routing interaction
After ACC-2:
- Purchase Return: AP + inventory_asset/purchase_expense/tax_input.
- Supplier Refund: AP counterparty role.
- cash/bank side: CashBankAccount resolver.
Explicit invalid AP mapping fails closed.

## Posting transaction / concurrency
1. DB transaction.
2. lock SupplierRefund; recheck draft.
3. lock target ReturnDocuments in deterministic ID order.
4. revalidate posted/type/partner/refundable balances.
5. resolve CashBank destination + AP.
6. LedgerService post.
7. mark posted/store journal/lifecycle metadata.
8. atomic commit.

No partial allocation/GL effect survives failure.

## Idempotency
V1 uses row-lock + lifecycle recheck to prevent concurrent double-post of the same document, matching current Payment/Ledger financial patterns. Do not invent a generic idempotency framework here. A future retry-prone public API can add a dedicated request-idempotency contract using AWJ's existing public/POS patterns.

## Reversal
- lock SupplierRefund and verify posted/not already reversed;
- call LedgerService::reverse() on stored original journal;
- mark SupplierRefund reversed;
- its allocations stop counting against refundable balance atomically;
- keep allocation rows for history;
- never re-resolve current account mappings for reversal.

## Historical compatibility / cutover — DECIDED
- Historical posted returns, including old direct-cash 1110 entries, remain untouched.
- Keep ReturnDocument.payment_type/data readable; no destructive migration.
- New Purchase Returns after cutover always create AP commercial reversal.
- New API request with `payment_type=cash` is rejected with explicit deprecation/validation error; never silently reinterpret it.
- `payment_type=credit` may be temporarily accepted for old clients but becomes redundant/deprecated.
- New UI removes cash/credit selection and explains supplier credit; actual money receipt is separate Supplier Refund.
- No automatic SupplierRefund backfill for historical cash returns.

## Authorization
Supplier Refund is operational finance, not Accounting Settings. Never use `accounting_settings.manage`. At implementation baseline, inspect actual financial-document RBAC convention. If no stronger dedicated post/reverse convention exists, use narrowly scoped `supplier_refunds.view` / `supplier_refunds.manage`; if current main has stronger conventions, follow them.

## UI contract
Purchase Return: no new cash/credit switch; communicate supplier credit/AP and remaining refundable amount.

Supplier Refund: separate dense AWJ workflow with supplier, eligible posted Purchase Returns, allocations, Cash/Bank destination, payment method where required, date/reference/notes, remaining refundable balance, post confirmation and immutable posted/reversed history.

## Migration strategy
Additive only: create supplier_refunds and supplier_refund_allocations plus required indexes/FKs/lifecycle fields. Retain ReturnDocument.payment_type. Never rewrite old returns or journals.

## Mandatory tests
1. new Purchase Return AP reversal, no cash movement.
2. tracked/non-tracked/VAT amounts unchanged.
3. old cash returns unchanged/readable.
4. new `payment_type=cash` rejected.
5. Supplier Refund Dr CashBank / Cr AP.
6. mapped AP works; invalid explicit AP mapping fails closed.
7. wrong-tenant/inactive CashBank rejected.
8. deposit-not-allowed rejected.
9. method/account compatibility enforced.
10. allocation only to posted purchase returns.
11. supplier mismatch rejected.
12. allocation sum equals refund amount.
13. over-refund rejected.
14. concurrent refunds cannot exceed one return balance.
15. concurrent double-post creates one journal.
16. failed post leaves no partial GL/settlement state.
17. reversal uses original concrete accounts.
18. reversal restores refundable balance while retaining allocation history.
19. mapping change after posting does not affect reversal.
20. branch + tenant isolation.
21. numbering uses GeneratesDocumentNumbers and is concurrency-safe.
22. authorization tests.
23. SQLite + PostgreSQL financial suites.
24. UI/API no longer presents direct-cash Purchase Return as valid new workflow.

## Gate resolution
Resolved: dedicated domain, lifecycle, allocation model, numbering mechanism, CashBank boundary, concurrency model, reversal, API cutover, migration/history and UI separation.

Implementation-baseline checks still required immediately before coding: current-main RBAC naming, prefix collision, migration conventions and any code changes since audited baseline. These are not unresolved accounting architecture.

## Prohibited shortcuts
No Payment(received) hack; no third Payment direction without separate redesign; no generic cash role; no new hardcoded 1110 return; no history rewrite; no allocation deletion on reversal; no silent legacy cash reinterpretation; no implementation/merge/deploy without explicit Safwan approval.

## Next step
Prepare a separate prerequisite implementation task **ACC-RET-1 — Purchase Return Cutover + Supplier Refund Foundation**. ACC-4 remains ordered after that prerequisite; do not hide the feature inside ACC-4.
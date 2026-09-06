# ACC-RET-1 — Purchase Return Cutover + Supplier Refund Foundation

**Status:** PREPARED — execute only after ACC-2 is available and explicit Safwan approval  
**Dependency:** ACC-2 semantic resolver + resolved `GATE-ACC-RET-1`.  
**Blocks:** ACC-4.  
**Risk:** High financial settlement.  
**Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Objective
Remove the unsafe direct-cash path from new Purchase Returns and introduce the dedicated Supplier Refund settlement domain exactly as resolved in GATE-ACC-RET-1.

## Required implementation
### A. Purchase Return cutover
- new Purchase Return always posts commercial reversal through `accounts_payable`.
- remove direct cash movement for new purchase returns.
- reject new API payload `payment_type=cash` with explicit validation/deprecation error.
- remove cash/credit selector from new Purchase Return UI.
- preserve old `payment_type` data and historical posted journals unchanged.

### B. SupplierRefund model/service
Branch-scoped BaseModel using GeneratesDocumentNumbers; lifecycle draft/posted/reversed; immutable after posting; amount in minor units; supplier, CashBank destination/payment-method snapshot, date/reference/notes, journal reference and actor/lifecycle metadata following current conventions.

### C. SupplierRefundAllocation
Dedicated allocations to posted purchase ReturnDocuments. Do not reuse PaymentAllocation or Purchase.paid_amount.

V1 requires fully allocated refund: allocation sum equals refund amount. No unallocated/on-account Supplier Refund.

### D. Posting
Inside one DB transaction: lock refund, lock target returns deterministically, revalidate refundable balances, resolve CashBank destination and AP semantic role, LedgerService post Dr CashBank / Cr AP, mark posted.

### E. Reversal
Use LedgerService::reverse(original journal), mark refund reversed, preserve allocation rows but exclude reversed refund allocations from refundable calculation.

### F. API/UI/RBAC
Dedicated Supplier Refund endpoints/workspace/actions. Use actual current-main financial RBAC convention; never Accounting Settings permission. Dense RTL-first AWJ UI.

## Baseline checks before coding
- compare execution branch with latest main.
- verify `SRF` or chosen prefix has no collision and register through DocumentNumberingCatalog.
- verify migration naming/FK conventions.
- verify current RBAC naming for financial documents.
- verify CashBankAccountService method needed for deposit resolution.
- verify ReturnService/API/UI have not materially changed since audit.

If materially changed, STOP and report rather than force this plan.

## Explicitly out of scope
No generic Payment redesign; no third Payment direction; no generic cash role; no free-standing supplier receipt; no purchase account-routing adoption beyond what this cutover needs; no fiscal/lock work; no historical backfill/rewrite; no merge/deploy.

## Required tests
Use the full 24-point mandatory matrix in `GATE-ACC-RET-1-purchase-return-supplier-refund.md`, including concurrency, tenant/branch isolation, CashBank authorization, AP mapping fail-closed, historical compatibility, reversal, numbering and SQLite/PostgreSQL.

## Acceptance criteria
- no new Purchase Return can post directly to cash/bank.
- Supplier Refund is explicit, allocated, auditable and concurrency-safe.
- no over-refund.
- reversals preserve original concrete accounts and allocation history.
- old returns remain untouched.
- no Payment semantic abuse.
- all targeted financial tests green.
- no merge/deploy.

## Implementation report
Return MD report with exact changed files/schema/API/UI, before/after accounting examples, cutover compatibility behavior, tests/results SQLite/PostgreSQL, concurrency evidence, tenant/branch isolation, CashBank permission evidence, reversal/history evidence, Branch/PR/Base SHA/Head SHA, risks/remaining and explicit no merge/no deploy.
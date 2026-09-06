# GATE-ACC-RET-1 — Purchase Return & Supplier Refund Financial Contract

**Status:** DESIGN GATE — MUST PASS BEFORE ACC-4  
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`  
**Risk:** High financial/accounting + settlement integrity.  
**Implementation:** NOT AUTHORIZED by this design document alone.

## Problem
Current Purchase posting establishes Accounts Payable and delegates settlement to PaymentService. Current Purchase Return, however, accepts `payment_type=cash|credit`; cash return directly debits legacy 1110 without selecting a CashBankAccount or applying its deposit policy. Current PaymentService cannot safely model supplier refund by flipping `direction`: `received` means customer receipt/AR and `paid` means supplier payment/AP, with allocation/payment-status side effects.

## Target principle
`Purchase != Supplier Payment` and `Purchase Return != Supplier Refund`.

A purchase return reverses the supplier commercial liability/cost. Actual money received back from supplier is a separate settlement event.

## Target Purchase Return accounting
For future new returns after an explicit cutover:
- Dr `accounts_payable` for the supplier credit created by the return.
- Cr `inventory_asset` for returned tracked inventory cost.
- Cr `purchase_expense` for returned non-inventory expense basis.
- Cr `tax_input` for reversed input VAT.

No direct cash/bank movement belongs inside the Purchase Return posting itself.

## Target Supplier Refund accounting
When supplier actually sends/refunds money:
- Dr selected `CashBankAccount.account_id`.
- Cr `accounts_payable`.
- Partner/supplier dimension required.
- CashBankAccount deposit permission/policy required.
- Ledger posting through LedgerService.

## Dedicated domain
Preferred architecture: a dedicated `SupplierRefund` document/service rather than mutating `Payment.direction` semantics.

Required conceptual fields:
- tenant/company scope;
- supplier/partner;
- document number/reference/date;
- amount in halalas/current single-currency contract;
- CashBankAccount/payment method or equivalent settlement selection;
- status/draft-posted-reversed semantics following AWJ financial document conventions;
- optional allocation/link to one or more purchase returns / supplier credit balance if repository architecture supports this cleanly;
- journal entry reference;
- idempotency/concurrency controls appropriate to money movement;
- created_by / posted_by where conventions exist.

Exact schema must be validated against execution-baseline conventions before implementation.

## Allocation contract to design before code
Do not overload Purchase `paid_amount` with supplier-refund inflow.

Choose and document one explicit settlement model before implementation:
A. supplier account balance is authoritative and refund optionally references Purchase Return(s), or
B. dedicated refund allocations against Purchase Return credit documents.

Whichever is chosen must prevent over-refund and duplicate settlement under concurrency and remain auditable.

## Historical/backward compatibility
- Existing posted purchase returns, including historical direct-cash entries to 1110, remain frozen.
- Do not rewrite/reclassify historical journal lines automatically.
- Do not delete `payment_type` from old records in a destructive migration.
- Future UI/API after cutover must stop creating new direct-cash Purchase Return postings.
- Old API clients require an explicit compatibility/cutover policy: reject deprecated `cash` for new returns with actionable error, or version the endpoint. Do not silently reinterpret old `cash` payload as AP-only without a documented API contract.

## CashBankAccount contract
Supplier Refund must resolve selected cash/bank through the existing CashBankAccount domain. Do not create a generic semantic `cash_account` role. Enforce active account, linked Account validity, deposit permission, branch scope/policy and currency constraints already provided by that subsystem.

## Reversal
Reversing Supplier Refund must reverse the original concrete journal, not resolve current Account Routing again. Reversal must also restore settlement/allocation state atomically.

## Account Routing interaction
After ACC-2:
- Purchase Return consumes `accounts_payable`, `inventory_asset`, `purchase_expense`, `tax_input`.
- Supplier Refund consumes `accounts_payable` on counterparty side.
- Cash/bank side remains CashBankAccount-resolved.

## UI contract
Purchase Return UI:
- no misleading “cash vs credit” switch for the commercial return after cutover;
- clearly creates supplier credit / reduces payable;
- show resulting supplier credit/balance state.

Supplier Refund UI:
- separate action/document: “استرداد من المورد / Supplier Refund”;
- select supplier, amount, Cash/Bank destination and payment method if required;
- optionally allocate to eligible purchase-return credits;
- show remaining refundable/credit amount;
- confirmation before posting;
- no fake direct cash shortcut.

## Authorization
Define dedicated permissions consistent with repository RBAC before implementation, likely separate view/manage/post/reverse semantics if financial-document conventions already distinguish them. Do not reuse Accounting Settings manage permission for operational supplier refunds.

## Mandatory tests for implementation gate
1. Purchase Return posts AP reversal and no cash movement.
2. tracked/non-tracked/input VAT reversal amounts unchanged.
3. Supplier Refund Dr selected CashBank / Cr AP.
4. wrong-tenant CashBank rejected.
5. inactive CashBank/account rejected.
6. deposit-not-allowed rejected.
7. supplier/partner dimensions correct.
8. no over-refund/duplicate allocation under concurrency.
9. idempotent retry does not double-post money.
10. reversal uses original concrete accounts.
11. mapping change after posting does not affect historical refund/reversal.
12. historical old cash Purchase Returns remain unchanged/readable.
13. deprecated/new API contract prevents silent semantic reinterpretation.
14. tenant isolation throughout.
15. SQLite/PostgreSQL financial tests.
16. authorization tests.

## Gate exit criteria
Before ACC-4 implementation task is considered READY, an implementation design must explicitly settle:
- SupplierRefund schema/document lifecycle;
- allocation model A or B (or another explicitly justified model);
- numbering/reference convention;
- RBAC;
- API compatibility/cutover for old `payment_type=cash`;
- over-refund and concurrency strategy;
- reversal behavior;
- UI flow;
- migration/backward compatibility.

## Prohibited shortcuts
- no `Payment(direction=received)` supplier refund hack;
- no generic cash semantic role;
- no continued direct hardcoded 1110 for new Purchase Returns;
- no historical rewrite;
- no hidden settlement side effect in Purchase Return;
- no implementation/merge/deploy without explicit Safwan approval.

## Next planning action
Before execution, perform a narrow repository audit of financial document numbering, reversal/status/idempotency patterns and supplier balance/return relationships, then update this gate with exact implementation contracts.
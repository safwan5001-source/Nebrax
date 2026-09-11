# PAY-V2-1 — AWJ Payment Methods V2 Verification Report

**Status:** Repository verification / planning evidence only. No production implementation, merge, deploy, accounting-rule change, VAT/ZATCA change, or gateway/fee implementation is authorized by this report.

**Date:** 2026-09-11
**Baseline main SHA:** `36545c6862b42b2fd43d9e2798c3a8db9a4117c1`
**Reference:** `docs/plans/payments/AWJ_PAYMENT_METHODS_V2_DAFTRA_REFERENCE.md`

## 1. Executive conclusion

The current AWJ payment-method foundation is materially sound and suitable as the base for Payment Methods V2. Repository inspection did not confirm a current P0/P1 tenant-isolation or posting defect in the central PaymentMethod → Payment → CashBankAccount/Ledger path.

The verified implementation already provides a tenant-scoped/company-wide payment-method master, active/default behavior, cash/bank settlement destinations, historical payment-method-name snapshots, POS payment-method restrictions and split tenders, actor propagation to the cash/bank authorization boundary, and ledger posting through the accounting engine.

The main remaining work is not to replace this foundation. It is to close explicit regression-test gaps, retire/bridge legacy `cash|bank` document fields where appropriate, define a proper reversal lifecycle for ordinary posted receipt/payment vouchers, and then add channel policy for Store/customer channels before gateway integration.

Important project assumption: existing/current AWJ business data and transactions are experimental and are not a preservation constraint. This does **not** relax tenant isolation, accounting correctness, security, API safety, or production migration correctness.

## 2. Verified current foundation

### 2.1 PaymentMethod master

`PaymentMethod` extends `BaseModel` and implements `CompanyWide`. It contains:

- tenant identity through the base tenancy model;
- Arabic name and optional English name;
- `settlement_type` = `cash|bank`;
- `cash_bank_account_id`;
- instructions;
- `available_online`;
- active/default flags;
- relationship to historical `Payment` rows.

The model explicitly describes payment methods as operational master data without independent fee/accounting impact.

### 2.2 API permissions and reference isolation

Payment-method routes separate read and management permissions: reading uses the payments-view permission while create/update/default/delete operations use the payments-management permission.

`PaymentController::assertReferences()` validates server-side references for partner, invoice, purchase, cash account, payment method, collector, and allocations. `payment_method_id` is checked through the tenant-owned reference boundary before the service is called.

Result: no confirmed cross-tenant PaymentMethod ID acceptance path was found in the inspected payment API. A dedicated negative regression test is still recommended so this invariant cannot silently regress.

### 2.3 Payment setup and historical snapshot

`PaymentService::resolvePaymentSetup()` behaves as follows:

- if no `payment_method_id` exists, it preserves the legacy `method` / `cash_account_id` contract;
- if a method ID is supplied, AWJ loads the server-side `PaymentMethod` record;
- inactive/nonexistent methods are rejected;
- settlement type comes from the stored method, not a caller-provided label;
- the cash/bank destination is resolved through `CashBankAccountService`;
- `payment_method_id` and `payment_method_name` are stored on the voucher.

This snapshot means a later rename/disable of the master method does not reinterpret the historical voucher name.

### 2.4 Cash/bank authorization and actor propagation

The financial authorization boundary is `CashBankAccountService::assertAllowed()` at posting time. Verified service paths now propagate the authenticated actor into posting, including ordinary payment posting, invoice automatic settlement, purchase automatic settlement, POS checkout, and fuel collection regression coverage.

This closes the previously documented actor-propagation class of defects for the inspected paths.

### 2.5 Ledger boundary

`PaymentService` posts balanced entries through `LedgerService`; it does not directly write journal lines. Accounts receivable/payable are resolved through semantic account roles, while the cash/bank side remains owned by `CashBankAccountService`.

This separation should remain mandatory in all V2 work.

### 2.6 POS behavior

POS already has explicit payment-method availability semantics:

- all active methods;
- only selected methods;
- no methods.

It also supports a default method and split tender using multiple `{payment_method_id, amount}` items. Existing legacy POS settings are normalized to preserve established behavior.

V2 must extend this foundation rather than build a second POS payment model.

## 3. Refund and reversal evidence

`SupplierRefundService` is the strongest existing reference for a safe financial reversal lifecycle:

- draft creation/update;
- allocation validation;
- row locking and revalidation at post time;
- cash/bank ACL check at the financial boundary;
- posting only through `LedgerService`;
- posted → reversed lifecycle;
- reversal through `LedgerService::reverse()` using the original stored journal entry rather than re-resolving current account configuration.

This is the preferred architectural precedent for any ordinary Payment voucher reversal design.

## 4. Confirmed gaps / decisions

### PAY-GAP-1 — Direct cross-tenant PaymentMethod regression coverage

**Classification:** Test hardening, P1-before-production assurance; no confirmed exploit/bug.

The inspected implementation has tenant-aware model/reference enforcement, but PAY-V2 should add focused negative API/service tests proving that another tenant's `payment_method_id` cannot be used for create/update/default/payment posting and cannot leak through lookup/list behavior.

### PAY-GAP-2 — Ordinary posted Payment reversal lifecycle

**Classification:** Functional/accounting gap, P1-before-production; not an emergency against experimental data.

The ordinary `PaymentController` supports list/create/show/update/duplicate/delete-draft/post, and refuses deletion of posted vouchers. No ordinary receipt/payment reversal endpoint/service path was found in the inspected repository searches.

Before production use, posted receipt/payment vouchers should have a controlled reversal path. It should follow the SupplierRefund precedent: preserve the original voucher, create a reversing journal entry from the original stored entry, maintain audit metadata/status, and correctly unwind allocation/payment-status effects without deleting history.

This requires focused accounting tests before implementation approval.

### PAY-GAP-3 — Legacy purchase `payment_method = cash|bank`

**Classification:** Architecture/contract debt, P2 until the V2 implementation boundary requires it.

`Purchase` still stores `paid_on_post` plus a legacy string `payment_method` with default `cash`. Its migration documents the original purpose as selecting cash vs bank for automatic settlement at purchase posting.

Because current AWJ data is experimental, historical experimental values do not justify preserving this field forever. However, code/API transition safety still matters. V2 should deliberately migrate/bridge the contract to the central `payment_method_id` model rather than silently deleting the legacy field in an unrelated change.

### PAY-GAP-4 — `available_online` is stored but not yet an enforced commerce policy

**Classification:** Expected missing foundation, P2 / PAY-V2 channel work.

Repository evidence and the existing Store architecture audit indicate that `available_online` exists in the model/controller/UI but is not yet a complete online-payment enforcement layer. AWJ also does not yet have coded PaymentIntent/authorization/capture/refund gateway infrastructure.

Do not treat `available_online` alone as sufficient Store security or gateway authorization.

### PAY-DECISION-1 — Is a method's cash/bank destination mandatory or only the default?

Current `PaymentService` allows a request-supplied `cash_account_id` to override the method's configured destination, provided the resulting cash/bank account is valid for the settlement type and passes the later authorization boundary.

Recommended policy:

- Back office: allow an authorized operator to choose another allowed destination where the workflow explicitly exposes that choice.
- POS/Store/Gateway: resolve the destination from server-side channel/method/gateway policy; never trust a customer/client-supplied destination account.

This is a policy decision, not a confirmed defect in current back-office behavior.

## 5. Daftra reference alignment

The useful Daftra pattern remains consistent with the verified AWJ direction:

- one centrally managed payment-method master;
- active/default behavior;
- online/customer availability;
- default treasury/bank destination;
- POS-specific enablement/default behavior;
- split payment;
- separate gateway capability;
- payment fees as a separate accounting/tax concern.

AWJ should use this as a reference, not clone it. In particular, merchant provider fees, customer surcharges, tax on fees, refunds, reversals, partial payments, split tenders, and ZATCA impact must be designed explicitly before fee implementation.

## 6. Recommended implementation sequence after verification

1. **PAY-V2-1A — Focused regression hardening:** add direct PaymentMethod tenant-isolation/API/default/snapshot/POS restriction tests. No schema or accounting changes.
2. **PAY-V2-1B — Payment reversal design + implementation:** docs/tests first; implement posted receipt/payment reversal using the original journal entry and correct allocation rollback. Keep scope financial and narrow.
3. **PAY-V2-2 — Channel availability foundation:** minimum server-enforced policy needed for AWJ Store/customer channels while preserving POS semantics.
4. **PAY-V2-3 — Gateway foundation:** PaymentIntent/provider configuration, secret boundary, idempotency/webhooks, authorization/capture/refund lifecycle.
5. **PAY-V2-4/5 — Fees:** accounting specification and approval first, implementation second.

Legacy purchase `payment_method` migration should be attached to the smallest implementation phase that actually needs central method IDs in purchase auto-settlement; do not perform a broad unrelated refactor.

## 7. Test requirements for implementation PRs

The verification pass itself did not execute the test suite; findings are repository-evidence based. Implementation PRs must run focused tests first, then the required broader CI.

Minimum focused coverage should include:

- cross-tenant PaymentMethod IDs rejected;
- inactive method rejected;
- default-method invariant;
- cash/bank type mismatch rejected;
- CashBankAccount ACL with authenticated actor;
- historical method-name snapshot unchanged after master rename/disable;
- POS all/only/none restrictions and split tender;
- reversal is single-use/idempotency-safe;
- reversal uses original journal accounts;
- reversal restores invoice/purchase allocation/payment status correctly;
- concurrent/double reversal rejected;
- branch/tenant isolation on reversal.

Financial/security/tenant-isolation tests must not be weakened to make implementation pass.

## 8. Final PAY-V2-1 status

**Verification result: PASS WITH FOLLOW-UP WORK.**

No confirmed current P0/P1 security or tenant-isolation defect was found in the inspected PaymentMethod → Payment posting foundation. The ordinary Payment reversal lifecycle is the most important pre-production accounting capability gap. Direct tenant-isolation regression coverage is the most important verification-hardening gap. Channel/gateway/fee work should not begin by replacing the current central payment-method master.

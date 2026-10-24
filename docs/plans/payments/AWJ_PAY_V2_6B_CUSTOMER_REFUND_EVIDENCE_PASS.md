# PAY-V2-6B — Customer Refund Foundation Repository Evidence Pass

Status: EVIDENCE PASS / IMPLEMENTATION CONTRACT — documentation only.

## Purpose

Record the repository evidence discovered after PAY-V2-6A and define the safe implementation boundary for a future Customer Refund Foundation. This document does not implement runtime code, schema, journals, routes, POS changes, VAT/ZATCA changes, or gateway integration.

## Evidence from current AWJ architecture

### 1. Sales return is currently both commercial correction and, for `payment_type=cash`, cash-side accounting

`ReturnService` is the canonical sales/purchase return engine. For sales returns it reverses sales and output VAT, handles inventory/COGS, and credits either cash (`1110`) or accounts receivable (`1130`) according to `payment_type`.

This is existing historical behavior and must remain backward compatible unless separately migrated. It is not a safe template for post-settlement gateway refunds because PAY-V2-5 intentionally separated gateway collection, clearing, settlement and provider fees.

### 2. Purchase returns already establish the separation pattern

ACC-RET-1 explicitly separates a purchase return from actual money received from the supplier. A purchase return adjusts the supplier commercial balance; `SupplierRefund` is a separate financial document allocated to posted purchase returns.

`SupplierRefundService` owns the money movement, uses `CashBankAccountService` for the destination/ACL and `LedgerService` for journals. Its lifecycle is draft → posted → reversed.

This is the nearest approved architectural precedent for Customer Refund Foundation, but its accounting direction must not be copied blindly.

### 3. No independent Customer Refund domain exists today

Repository search found no canonical `CustomerRefund` model/service equivalent to `SupplierRefund`. Therefore gateway refund implementation must not invent one inside a gateway service, controller, provider adapter, middleware, POS helper, or duplicated return path.

### 4. POS return is not an independent customer-refund domain

`PosReturnService` validates the POS source/session, derives return lines from immutable invoice snapshots, applies idempotency/policy checks, then delegates creation/posting to `ReturnService`.

For cash returns, POS additionally enforces:
- refund amount > 0;
- under `original cash only`, cumulative cash refunds cannot exceed posted cash received on the source invoice;
- posted sales returns and exchange cash refunds reduce the remaining cash-refund allowance;
- cash refund cannot exceed the session's expected drawer balance.

These are valuable eligibility/policy concepts, but POS currently remains coupled to `ReturnDocument.payment_type=cash`; it is not the canonical foundation for gateway refunds.

### 5. POS session architecture supports separation of financial movement

`PosSessionService` documents that collection, disbursement and transfer financial movements remain in their dedicated modules. This supports introducing a dedicated Customer Refund financial document rather than adding gateway-refund accounting into POS session logic.

## Accounting boundary established by the evidence

A safe future flow is:

1. A posted commercial/tax correction (for example a posted sales return/credit note) remains authoritative for reducing the sale/customer balance and for any VAT/ZATCA/inventory effects.
2. Customer Refund is a separate financial fact that pays an already-established refundable customer balance.
3. Gateway Refund Integration is a later provider/payment-rail layer that fulfills or reconciles that Customer Refund through gateway clearing/bank/provider evidence.

Customer Refund must not itself decide that a sale should be cancelled, create a tax correction, alter VAT, alter ZATCA artifacts, or return inventory.

## PAY-V2-6B — proposed narrow implementation contract

The implementation may introduce an additive Customer Refund aggregate modeled after the separation principles of `SupplierRefund`, subject to the following hard constraints.

### Source eligibility

- A Customer Refund must reference an approved posted customer-side commercial correction that establishes refundable customer balance.
- Do not refund merely because an original invoice/payment exists.
- Cumulative posted customer refunds allocated to a source correction must never exceed that source's refundable amount.
- Partial and multiple refunds are allowed only within the cumulative cap.
- Amounts use integer minor units.
- Concurrent create/post paths must lock/recheck the cap.

### Financial destination/source

- Actual money movement must use existing canonical Cash/Bank access and ACL mechanisms where applicable.
- Journals must go only through `LedgerService`.
- No direct `journal_lines` persistence.
- Do not invent a generic refund expense, contra-revenue, VAT, suspense or clearing account.
- The debit-side customer-balance account must be derived from the approved commercial correction/accounting path. If repository evidence at implementation time does not make that account unambiguous, STOP and report the blocker before posting logic is added.

### Lifecycle and immutability

Minimum intended lifecycle: `draft → posted → reversed`, following existing financial-document conventions where valid.

- posted financial facts are immutable;
- reversal is additive through the approved Ledger reversal mechanism;
- source allocations remain auditable;
- reversal must restore available refundable balance correctly;
- period locks apply to posting and reversal.

### Tenant, branch, actor and RBAC

- active `TenantContext` is mandatory;
- source correction, partner/customer, cash/bank account, refund and journal must be same tenant;
- cross-tenant references fail closed;
- no `withoutGlobalScope(TenantScope::class)` workaround;
- branch attribution follows existing source/cash-bank/Ledger evidence; do not invent company-wide or branch behavior;
- propagate actor into existing CashBank ACL/accounting guards;
- reuse existing RBAC semantics where an exact canonical permission exists; do not create new permissions casually.

### Idempotency

If an external/idempotency reference is exposed in this foundation, uniqueness must be tenant-scoped and conflicting replay must fail. A duplicate retry must never create a second posted refund/journal.

## Explicit non-goals for PAY-V2-6B

- gateway provider API/SDK calls;
- gateway refund events or settlement offsets;
- provider fee refund/retention/new refund fee;
- chargebacks/disputes;
- automatic credit-note/sales-return creation;
- invoice VAT/ZATCA mutation;
- POS migration to the new foundation;
- Store checkout/PaymentIntent integration;
- surcharge/refund-fee charged to customer;
- generic account-routing redesign;
- unrelated refactoring.

Those remain later work. Gateway-specific integration belongs to PAY-V2-6C only after Customer Refund Foundation is proven.

## Required tests before PAY-V2-6B can be merge-ready

Focused tests must cover at minimum:

- authorized same-tenant create/post;
- cross-tenant source/customer/cash-bank denial;
- posted source requirement;
- cumulative full/partial cap;
- concurrent/double-post protection;
- allocation auditability;
- period-lock rejection;
- CashBank ACL denial/allow path where applicable;
- exact journal lines for the proven canonical customer-balance account;
- reversal and restored refundable balance;
- source commercial document remains unchanged by the financial refund;
- no VAT/ZATCA/inventory side effects;
- SQLite and PostgreSQL CI.

## Architecture/tool stop rule

Tool limitations must never determine implementation location. If the selected coding tool cannot safely edit the canonical model/service/migration/test files, it must STOP and report the limitation. It must not move logic into a provider, controller, middleware, helper, alternate route, duplicated service, or manual scope workaround merely to finish the task or make CI green.

Before completion, explicitly answer: **Did any tool limitation influence where or how the implementation was placed?** If yes, the implementation is not ready.

## Evidence-pass conclusion

PASS for designing a dedicated Customer Refund Foundation.

NOT YET authorization for gateway refund integration.

PAY-V2-6B should establish the customer-money-refund domain first. PAY-V2-6C can then integrate gateway/provider refund evidence without mutating historical Payment/settlement records or collapsing commercial/tax correction into provider events.

Before coding PAY-V2-6B, perform one final narrow implementation-time check of the exact customer-balance account produced by the chosen posted sales-return/credit-note source. If that destination is not unambiguous, stop rather than invent accounting policy.

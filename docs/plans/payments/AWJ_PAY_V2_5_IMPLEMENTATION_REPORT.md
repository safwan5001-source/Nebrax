# PAY-V2-5 — Gateway merchant fees & settlement accounting — Implementation Report

## Executive summary

Implements the minimum correct PAY-V2-5 foundation required by `AWJ_PAY_V2_4_FEES_ACCOUNTING_DESIGN.md`.

**Invariant honored:** customer payment ≠ provider settlement.

A gateway collection of 1,000 posts `Dr gateway_clearing 1,000 / Cr AR 1,000` and leaves `Invoice.paid_amount` at 1,000. A later settlement of 975 + 25 fee posts `Dr bank 975 / Dr provider_fee_expense 25 / Cr gateway_clearing 1,000`. The customer document is never rewritten to the net bank amount.

Status: **IMPLEMENTED ON PR — NOT MERGED — NOT DEPLOYED**

## Identifiers

| Field | Value |
|---|---|
| Branch | `feat/pay-v2-5-gateway-fees-settlement` |
| PR | [#774](https://github.com/safwan5001-source/Nebrax/pull/774) |
| Base SHA | `f9a3febd6363897bc8481d1f02b1c93dbb1dba87` (main / PAY-V2-4 merge) |
| Head SHA | `31f8eb81f4a8ac9a9a382a2bd3db3cb469856afb` |
| Draft / merge / deploy | Open PR. Not merged. Not deployed. |

## What was implemented

1. Semantic roles `gateway_clearing` (legacy 1170) and `provider_fee_expense` (legacy 5510) in `AccountingRoles`, domain `payments`.
2. Default CoA leaves 1170 under current assets (11) and 5510 under the existing Payment Fees group (55).
3. Additive backfill for existing tenants + role mappings.
4. Nullable `payments.payment_gateway_id`.
5. Settlement aggregate + items (batch and partial).
6. `PaymentService::post()` debits clearing **only** when a same-tenant gateway is linked; cash/bank payments are unchanged.
7. `PaymentGatewaySettlementService` posts through `LedgerService` after integer reconciliation.
8. Focused reversal guard: existing `PaymentReversalService` still reverses unsettled gateway collections; settled collections are refused so a fee refund is not invented.

## Files changed

- `app/Support/AccountingRoles.php`
- `app/Services/Accounting/ChartOfAccountsSeeder.php`
- `database/migrations/2026_09_21_010000_add_gateway_clearing_and_provider_fee_accounts.php`
- `database/migrations/2026_09_21_020000_add_payment_gateway_id_to_payments.php`
- `database/migrations/2026_09_21_030000_create_payment_gateway_settlements_tables.php`
- `app/Models/Payment.php`
- `app/Models/PaymentGatewaySettlement.php`
- `app/Models/PaymentGatewaySettlementItem.php`
- `app/Services/Accounting/PaymentService.php`
- `app/Services/Accounting/PaymentGatewaySettlementService.php`
- `app/Services/Accounting/PaymentReversalService.php`
- `tests/Feature/PaymentGatewaySettlementAccountingTest.php`
- `docs/plans/payments/AWJ_PAY_V2_5_IMPLEMENTATION_REPORT.md`

Unchanged by design: `routes/api.php`, POS, Store checkout, PaymentIntent, webhooks, ZATCA, invoice tax totals, CashBankAccount ACL implementation, LedgerService internals.

## Migrations / schema

Additive only.

- `payments.payment_gateway_id` nullable FK → `payment_gateways`, `nullOnDelete`.
- `payment_gateway_settlements`: tenant + gateway + cash-bank destination + provider ref + integer money columns + routing snapshots (`gateway_provider`, `gateway_name`, `clearing_account_id`, `fee_expense_account_id`, `bank_account_id`) + `journal_entry_id`. Unique `(tenant_id, payment_gateway_id, provider_settlement_ref)`.
- `payment_gateway_settlement_items`: settlement + payment + optional `provider_event_ref` + `gross_amount`. Unique `(settlement_id, payment_id)`.
- No secrets are stored on settlements.

## Accounting entries actually implemented

### Customer collection (received + `payment_gateway_id`)

```
Dr gateway_clearing / provider receivable     GROSS
Cr accounts_receivable                        GROSS
```

Invoice `paid_amount` increases by GROSS. Cash/bank is not debited.

### Customer collection (no gateway) — unchanged

```
Dr cash or bank (CashBankAccount)             GROSS
Cr accounts_receivable                        GROSS
```

### Provider settlement

```
Dr bank / CashBankAccount                     NET
Dr provider_fee_expense                       FEE_EX_TAX [+ explicit deductions]
Cr gateway_clearing                           GROSS
```

Credits, when explicit and reconciling, reduce fee expense rather than inventing a new role.

Reconciliation (integer minor units only):

```
gross = net + fee_ex_tax + fee_tax + deductions - credits
```

Mismatch fails before `LedgerService::post()`.

## Account-routing approach

- No hard-coded account UUIDs.
- Clearing and fee expense: `AccountRoleResolver` (`gateway_clearing`, `provider_fee_expense`).
- Final bank: `CashBankAccount` resolved under TenantScope + `CashBankAccountService::assertAllowed(..., 'deposit', $actor)`.
- AR still `accounts_receivable` via the existing PaymentService path.
- All journal lines go through `LedgerService`. No direct `journal_lines` writes.

## Tenant Isolation enforcement

- Active `TenantContext` required on settlement models and service.
- Forged `tenant_id` overwritten / rejected on model `saving`.
- Gateway, payment, cash-bank, and role-resolved accounts are loaded through TenantScope (`whereKey`).
- Cross-tenant gateway / payment / bank references fail closed.
- No `withoutGlobalScope(TenantScope::class)`.
- Settlements are `CompanyWide` (institution-level financial event), not a branch master.

## Idempotency / concurrency

- Unique provider settlement reference per tenant+gateway.
- `lockForUpdate` on gateway, existing settlement-by-ref, and matched payments.
- Replay of the same reference with the same amounts returns the posted row and does not create a second journal.
- Different amounts on the same reference are rejected.
- Payment posting still locks the payment row (existing pattern).

## Refund / reversal behavior

- Existing `PaymentReversalService` + `LedgerService::reverse()` remain the only payment-reversal path.
- Unsettled gateway collection: reversal is allowed and reverses the stored clearing/AR lines. No fee expense is created or reversed.
- Settled gateway collection: reversal is refused. Customer refund ≠ provider-fee refund. A dedicated gateway refund/chargeback policy is deferred.
- Posted settlement rows are immutable.

## Fee-tax behavior and deferred parts

- `provider_fee_tax > 0` is rejected with an explicit message.
- No 15% (or any) VAT rate is hard-coded.
- `tax_input` exists in the catalog, but PAY-V2-4 requires evidence + recoverability policy before posting fee tax. That policy is not present, so tax posting is deferred rather than invented.
- Provider fee tax never touches the original sales invoice VAT/ZATCA document.

Intentionally deferred:

- customer surcharge;
- provider fee-tax / input-VAT posting;
- dedicated accounts for non-fee provider deductions/credits (currently only accepted when they still reconcile; booked against fee expense as explicit settlement components);
- gateway refund / chargeback / fee-refundability subsystem;
- webhook receiver, SDK, checkout, PaymentIntent;
- FX/multi-currency settlement;
- HTTP settlement API / `routes/api.php`;
- estimated (non-authoritative) fee recognition at collection time.

## Focused tests

`tests/Feature/PaymentGatewaySettlementAccountingTest.php`

- gross customer payment preserved;
- gateway clearing vs ordinary cash path;
- settlement bank + fee + clearing close-out;
- invoice paid_amount / tax unchanged by settlement;
- reconciliation mismatch rejected;
- fee tax rejected;
- floating-point amounts rejected;
- batch settlement;
- partial settlement;
- split-tender isolation;
- idempotent provider reference;
- immutable posted settlement;
- unsettled reversal does not invent a fee refund;
- settled reversal refused;
- period lock honored;
- forged tenant_id rejected;
- cross-tenant gateway / payment / bank rejected;
- missing TenantContext rejected;
- payment create cannot link another tenant's gateway.

Local focused run was **not** executed in this sandbox (no application PHPUnit environment here). CI on PR #774 is the verification path.

## SQLite CI / PostgreSQL CI

Queued / in progress on PR #774 at report time (`php artisan test (L11, sqlite)` and `php artisan test (L11, pgsql)`). Do not treat this report as CI-green until both jobs are inspected.

## Architecture / tool-limitations audit

Question: *Did any tool limitation influence where or how this change was implemented?*

**No.** Canonical placements:

| Concern | Location |
|---|---|
| Role catalog | `AccountingRoles` |
| Default CoA | `ChartOfAccountsSeeder` |
| Existing-tenant backfill | additive migration + explicit mappings |
| Collection posting | `PaymentService::post()` |
| Settlement posting | `app/Services/Accounting/PaymentGatewaySettlementService` (same service layer as PaymentService) |
| Reversal | `PaymentReversalService` guard only |
| Bank ACL | existing `CashBankAccountService` |
| Journals | `LedgerService` |

Not used as workarounds: Provider, Controller, Middleware, helper dump, duplicate engine, alternate route registration, `routes/api.php`.

## Risks / blockers

1. CI has not been confirmed green in this report.
2. Explicit non-fee deductions/credits currently share the fee-expense account when they reconcile. If Safwan wants a separate deduction role, that is a follow-up — not invented here as a broad routing subsystem.
3. Settled payment reversal is blocked; operations that need a customer refund after settlement require a later approved refund design.
4. Collection still stores `cash_account_id` (intended eventual bank / method setup) but does not post to it when a gateway is linked.
5. Earlier branch commits stripped some comments from `Payment.php` / `ChartOfAccountsSeeder`; behavior is intact.

## Recommended next step

1. Wait for SQLite + PostgreSQL CI on [#774](https://github.com/safwan5001-source/Nebrax/pull/774).
2. If CI fails, fix only the failing PAY-V2-5 surface; do not expand scope.
3. Owner review of accounting placement and the deferred fee-tax decision.
4. **Do not merge. Do not deploy.**

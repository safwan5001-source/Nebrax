# PAY-V2-5 — Gateway merchant fees & settlement accounting — Implementation Report

## Executive summary

Implements the minimum correct PAY-V2-5 foundation required by `AWJ_PAY_V2_4_FEES_ACCOUNTING_DESIGN.md`.

**Invariant honored:** customer payment ≠ provider settlement.

A gateway collection of 1,000 posts `Dr gateway_clearing 1,000 / Cr AR 1,000` and leaves `Invoice.paid_amount` at 1,000. A later fee-only settlement of 975 + 25 fee posts `Dr bank 975 / Dr provider_fee_expense 25 / Cr gateway_clearing 1,000`. The customer document is never rewritten to the net bank amount.

**P1 accounting correction:** unsupported provider deductions/credits are **rejected before any settlement row or journal is persisted**. They are not classified as `provider_fee_expense`. Only `provider_fee_ex_tax` may debit the fee-expense role.

Status: **IMPLEMENTED ON PR — NOT MERGED — NOT DEPLOYED**

## Identifiers

| Field | Value |
|---|---|
| Branch | `feat/pay-v2-5-gateway-fees-settlement` |
| PR | [#774](https://github.com/safwan5001-source/Nebrax/pull/774) |
| Base SHA | `f9a3febd6363897bc8481d1f02b1c93dbb1dba87` (main / PAY-V2-4 merge) |
| Previous green CI Head | `f8a2e18b626a14c2c146763bb6791634e0fc7515` (pre-P1 docs-only HEAD; deductions still booked as fees in that snapshot) |
| P1 accounting fix | `59291bc3daacdce801b321e1f3e60999493cf8f2` |
| Focused deduction/credit tests | `fcf8d56a806a539cfb0f2df509185414cc3f0f13` |
| Comment restoration | `87863b4c` / `d96fc764` / `d2f3c338` |
| Head SHA | recorded after this report commit |
| Draft / merge / deploy | Open PR. Not merged. Not deployed. |

## P1 correction (this pass)

Accounting review found that an earlier `settlementLines()` path treated:

```
provider_fee_expense debit = provider_fee_ex_tax + provider_deductions
provider_fee_expense credit = provider_credits
```

That violated PAY-V2-4: unknown/non-fee provider deductions or credits must never be silently classified as merchant gateway fees.

Current minimum-scope behavior:

1. `provider_fee_ex_tax` may post to `provider_fee_expense`.
2. `provider_deductions > 0` fails closed. No new generic deduction account or routing subsystem was invented.
3. `provider_credits > 0` fails closed for the same reason.
4. Schema still stores `provider_deductions` / `provider_credits` for future work, but unsupported values never produce journal lines.
5. Focused tests prove rejection happens before any `payment_gateway_settlements` row or `JournalEntry` is persisted.
6. Fee-only settlements (`net + fee_ex_tax = gross`, deductions=0, credits=0, fee_tax=0) are unchanged.

Guard location: `PaymentGatewaySettlementService::assertUnsupportedAdjustmentsAreZero()` runs **before** `DB::transaction()`. `settlementLines()` now accepts only bank net + `provider_fee_ex_tax` + clearing credit.

## What was implemented

1. Semantic roles `gateway_clearing` (legacy 1170) and `provider_fee_expense` (legacy 5510) in `AccountingRoles`, domain `payments`.
2. Default CoA leaves 1170 under current assets (11) and 5510 under the existing Payment Fees group (55).
3. Additive backfill for existing tenants + role mappings.
4. Nullable `payments.payment_gateway_id`.
5. Settlement aggregate + items (batch and partial).
6. `PaymentService::post()` debits clearing **only** when a same-tenant gateway is linked; cash/bank payments are unchanged.
7. `PaymentGatewaySettlementService` posts through `LedgerService` after integer reconciliation **and** after the deductions/credits fail-closed guard.
8. Focused reversal guard: existing `PaymentReversalService` still reverses unsettled gateway collections; settled collections are refused so a fee refund is not invented.

## Files changed in this P1 correction

Accounting behavior:

- `app/Services/Accounting/PaymentGatewaySettlementService.php` — reject deductions/credits before transaction; fee-only `settlementLines()`.
- `tests/Feature/PaymentGatewaySettlementAccountingTest.php` — `unsupported_provider_deductions_are_rejected_before_any_settlement_or_journal`, `unsupported_provider_credits_are_rejected_before_any_settlement_or_journal`.

Comment restoration only (no behavior change):

- `app/Models/Payment.php` — original class/relation comments restored; additive `paymentGateway()` relation comment only.
- `app/Services/Accounting/ChartOfAccountsSeeder.php` — original file/tree comments restored; additive 1170/5510 rows only.
- `app/Services/Accounting/PaymentService.php` — original class/method comments restored; PAY-V2-5 clearing note kept next to the existing ACC-3 documentation.
- `app/Services/Accounting/PaymentReversalService.php` — original class/method comments restored; additive settlement guard + PAY-V2-5 note only.

Docs:

- `docs/plans/payments/AWJ_PAY_V2_5_IMPLEMENTATION_REPORT.md` — no longer states that deductions/credits are booked against fee expense.

Unchanged by design: `routes/api.php`, POS, Store checkout, PaymentIntent, webhooks, ZATCA, invoice tax totals, CashBankAccount ACL implementation, LedgerService internals, gross customer payment, clearing accounting, fee-only accounting, fee-tax rejection, Tenant Isolation, idempotency, reversal guard.

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

### Provider settlement — fee-only (authorized PAY-V2-5 path)

```
Dr bank / CashBankAccount                     NET
Dr provider_fee_expense                       FEE_EX_TAX
Cr gateway_clearing                           GROSS
```

`FEE_EX_TAX` is only `provider_fee_ex_tax`. Deductions and credits are not added to or subtracted from this account.

### Provider settlement — unsupported adjustments

```
provider_deductions > 0  → DomainException, zero rows, zero journals
provider_credits    > 0  → DomainException, zero rows, zero journals
provider_fee_tax    > 0  → DomainException (deferred tax policy)
```

Reconciliation equation remains available for future work:

```
gross = net + fee_ex_tax + fee_tax + deductions - credits
```

On the authorized path, `fee_tax = deductions = credits = 0`, so the live equation is `gross = net + fee_ex_tax`. Mismatch still fails before `LedgerService::post()`.

## Account-routing approach

- No hard-coded account UUIDs.
- Clearing and fee expense: `AccountRoleResolver` (`gateway_clearing`, `provider_fee_expense`).
- Final bank: `CashBankAccount` resolved under TenantScope + `CashBankAccountService::assertAllowed(..., 'deposit', $actor)`.
- AR still `accounts_receivable` via the existing PaymentService path.
- All journal lines go through `LedgerService`. No direct `journal_lines` writes.
- No new generic deduction/credit role was invented.

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
- dedicated accounts / roles for non-fee provider deductions and credits;
- gateway refund / chargeback / fee-refundability subsystem;
- webhook receiver, SDK, checkout, PaymentIntent;
- FX/multi-currency settlement;
- HTTP settlement API / `routes/api.php`;
- estimated (non-authoritative) fee recognition at collection time.

## Focused tests

`tests/Feature/PaymentGatewaySettlementAccountingTest.php`

- gross customer payment preserved;
- gateway clearing vs ordinary cash path;
- settlement bank + fee + clearing close-out (fee-only);
- invoice paid_amount / tax unchanged by settlement;
- reconciliation mismatch rejected;
- fee tax rejected;
- **unsupported deductions rejected before settlement/journal;**
- **unsupported credits rejected before settlement/journal;**
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

Local focused PHPUnit was not executed in this sandbox (no application PHPUnit environment here). Verification is GitHub Actions `php artisan test` on PR #774.

## SQLite CI / PostgreSQL CI

- Last **completed success** on this branch: run [4732](https://github.com/safwan5001-source/Nebrax/actions/runs/34657623815) at Head `f8a2e18b` (pre-P1 accounting fix).
- P1 code + tests were pushed in `59291bc3` / `fcf8d56a`. Subsequent comment-restore commits queued new CI on Head `d2f3c338`.
- This report commit retriggers SQLite + PostgreSQL. Exact job conclusions for the new Head are recorded after the Actions run completes; do not treat an older green run as proof of the P1 HEAD.

## Architecture / tool-limitations audit

Question: *Did any tool limitation influence where or how this change was implemented?*

**No.** Canonical placements:

| Concern | Location |
|---|---|
| Role catalog | `AccountingRoles` |
| Default CoA | `ChartOfAccountsSeeder` |
| Existing-tenant backfill | additive migration + explicit mappings |
| Collection posting | `PaymentService::post()` |
| Settlement posting | `app/Services/Accounting/PaymentGatewaySettlementService` |
| Deductions/credits fail-closed | same service, before transaction |
| Reversal | `PaymentReversalService` guard only |
| Bank ACL | existing `CashBankAccountService` |
| Journals | `LedgerService` |

Not used as workarounds: Provider, Controller, Middleware, helper dump, duplicate engine, alternate route registration, `routes/api.php`.

## Risks / blockers

1. CI for the P1 HEAD must be inspected after this commit; older green runs predate the fail-closed guard.
2. Non-fee provider deductions/credits remain unsupported until an approved existing role exists. That is intentional.
3. Settled payment reversal is blocked; operations that need a customer refund after settlement require a later approved refund design.
4. Collection still stores `cash_account_id` (intended eventual bank / method setup) but does not post to it when a gateway is linked.

## Confirmations required by the P1 review

- Unsupported deductions fail closed before any settlement/journal: **yes** (`assertUnsupportedAdjustmentsAreZero`, test `unsupported_provider_deductions_are_rejected_before_any_settlement_or_journal`).
- Unsupported credits fail closed before any settlement/journal: **yes** (same guard, test `unsupported_provider_credits_are_rejected_before_any_settlement_or_journal`).
- Fee-only settlement behavior preserved: **yes** (`settlement_posts_bank_fee_and_clears_gateway_receivable_without_changing_invoice`).
- Unrelated comment deletions restored: **yes** in `Payment.php`, `ChartOfAccountsSeeder.php`, `PaymentService.php`, `PaymentReversalService.php`. Additive PAY-V2-5 comments/guards remain.
- Report no longer states that deductions/credits are booked against fee expense: **yes**.

## Recommended next step

1. Confirm SQLite + PostgreSQL CI on this HEAD of [#774](https://github.com/safwan5001-source/Nebrax/pull/774).
2. Owner review of the fail-closed deductions/credits decision.
3. **Do not merge. Do not deploy.**

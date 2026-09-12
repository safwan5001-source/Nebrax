# PAY-V2-6B — Customer Refund Foundation — Implementation Report

Status: **IMPLEMENTED ON PR — NOT MERGED — NOT DEPLOYED**

Read first (on unmerged [PR #778](https://github.com/safwan5001-source/Nebrax/pull/778), SHA `e4b8ae3fa063d3cbcf06f27b95b8c62a11707d21`, not on `main`):

- `docs/plans/payments/AWJ_PAY_V2_6A_GATEWAY_REFUND_ACCOUNTING_DESIGN.md`
- `docs/plans/payments/AWJ_PAY_V2_6B_CUSTOMER_REFUND_EVIDENCE_PASS.md`

## Identifiers

| Field | Value |
|---|---|
| Branch | `feat/pay-v2-6b-customer-refund-foundation` |
| PR | recorded after open |
| Base SHA | `50b11b88761682597a418f1c2d465fce2a45e4f8` (`main` / PR-INV-MOV-1 #773) |
| Implementation SHA | `a128e7bf3fc1e74e58d29481a7052469c476f468` |
| Head SHA | PR head of `feat/pay-v2-6b-customer-refund-foundation` after push |
| Draft / merge / deploy | Open PR. **Not merged. Not deployed.** |

---

## Pre-implementation accounting evidence

Inspected on `main` (`50b11b8`) before any runtime code was written.

### 1. What account is credited when the commercial document creates customer credit?

**Posted sales return (`payment_type=credit`)** — `ReturnService::postSalesReturn()`:

```
Dr 4110 sales revenue                         subtotal
Dr 2120 output VAT                            tax
Cr 1130 accounts receivable                   total    partner: customer
```

Evidence: `app/Services/Accounting/ReturnService.php` (`ACC_RECEIVABLE = '1130'`, lines 65–68 and 420–433). Cash sales returns credit hardcoded `1110` instead and attach no partner — they already moved cash.

**Posted sales credit note (`refund_type=credit`)** — `CreditNoteService::salesLines()`:

```
Dr 4110 sales revenue                         subtotal
Dr 2120 output VAT                            tax
Cr 1130 accounts receivable                   total    partner: customer
```

Evidence: `app/Services/Accounting/CreditNoteService.php` (`ACC_RECEIVABLE = '1130'`, lines 23–31 and 178–197). Cash credit notes credit `1110`.

### 2. Is AR (`accounts_receivable`) the canonical customer-balance destination?

**Yes.** Invoice posting and customer collection already resolve `AccountRoleResolver('accounts_receivable')`, whose legacy code is `1130`:

- `InvoiceService` — credit sales debit the resolved AR role (comment: default 1130).
- `PaymentService` direction=`received` — `Cr accounts_receivable` (resolved) + partner.
- `AccountingRoles::accounts_receivable` — `legacy_code => '1130'`, domain `receivables`.

Sales returns / credit notes still **hard-code 1130** rather than the role. That is existing debt, not a second customer-balance account. The customer-balance destination is unambiguously AR / `accounts_receivable`. The new money-out path uses the role (required: no hard-coded account IDs).

### 3. Is there already a customer-refund allocation/domain that must be reused?

**No.** Repository search found no `CustomerRefund` model/service. `payment_allocations` are invoice/purchase allocations. `supplier_refund_allocations` are purchase-return allocations. POS cash returns go through `ReturnDocument.payment_type=cash` and are not a refund aggregate.

### 4. Is `Payment(direction=paid)` intended for customer refunds?

**No.** `PaymentService::post()` for `direction=paid` is:

```
Dr accounts_payable (resolved)                amount    partner: supplier
Cr Cash/Bank (withdraw ACL)                   amount
```

That is a supplier disbursement. Reusing it would post the wrong side of the balance sheet and the wrong partner dimension. Customer Refund is a dedicated document, matching Supplier Refund's separation from Payment.

### 5. How can sales-return / credit-note balances be measured for refund eligibility?

Same formula as Supplier Refund:

```
refundable = source.total − SUM(allocations of posted, non-reversed CustomerRefunds)
```

Not `Invoice.paid_amount`. Not a stored running balance. Cash commercial documents (`payment_type=cash` / `refund_type=cash`) already credited cash — they are ineligible. Draft sources are ineligible. Purchase returns / purchase credit notes are ineligible.

### 6. Is branch attribution unambiguous?

**Yes.** Nearest approved pattern is `SupplierRefund`: `BelongsToBranch` (tagged, no global BranchScope) + journal `branch_id` taken from the refund document, not the active branch at post time. Allocations are `CompanyWide` and follow the header. Controller lists use `scopeToActiveBranch()`; show/post/reverse use `assertRecordAccessible()`.

### HARD STOP rule

The debit destination is proven: **the customer-balance account that the commercial credit already credited** — AR / `accounts_receivable`. It is not a refund expense, contra-revenue, VAT, or invented liability.

**Accounting Gate: PASSED.** Implementation proceeded.

---

## Exact journal behavior implemented

Customer Refund through cash/bank, posted on the **approved refund accounting date** (never silently backdated to invoice / return / original payment date):

```
Dr accounts_receivable (AccountRoleResolver)   amount    partner: customer    REFUND
Cr Cash/Bank (CashBankAccount.account_id)      amount                         REFUND
```

- Cash destination: `CashBankAccountService::resolveForPayment()` then `assertAllowed(..., 'withdraw', $actor)` — money leaves our treasury.
- AR: `AccountRoleResolver::resolve('accounts_receivable')` — fail-closed if unmapped / inactive / group / missing.
- Journals only through `LedgerService::post()`. Reversal through `LedgerService::reverse()` on the **stored original accounts**, never re-resolved.
- Period lock is the existing `AccountingDateGuard` inside `LedgerService::post()` / `reverse()`.
- `source_type = CustomerRefund`, `source_id = refund.id`.
- No `Payment` row is created. Historical Payment / settlement / invoice / return / credit-note / VAT / ZATCA rows are not mutated.

Reversal:

```
Dr Cash/Bank                                   amount
Cr accounts_receivable                         amount    partner: customer
```

on the original concrete accounts. Allocation rows remain as history; they stop consuming refundable balance because the sum only reads `status=posted`.

---

## What was implemented

Additive Customer Refund financial domain modeled on ACC-RET-1 Supplier Refund.

Invariant: **commercial/tax correction ≠ customer money refund ≠ gateway/provider adjustment.**

Lifecycle: `draft → posted → reversed`. Posted history is immutable. Reversal is additive via Ledger.

V1: fully allocated to eligible posted commercial corrections of the same customer. No unallocated “on-account” refund (that contract is not approved).

Eligible sources:

- posted sales return, `payment_type=credit`
- posted sales credit note, `refund_type=credit`

Ineligible: cash commercial documents, drafts, purchase documents, other customer, other tenant.

Concurrency: one DB transaction; `CustomerRefund::lockForUpdate()`; sources locked in deterministic order (all sales-return ids ascending, then all credit-note ids ascending); live recheck of refundable balance inside the locks.

Numbering: shared `GeneratesDocumentNumbers` layer, prefix `CRF`, yearly, branch-scoped like `SRF`. Prefix scanned against `DocumentNumberingCatalog` — no collision.

RBAC: new `customer_refunds.view` / `customer_refunds.manage`, independent of `returns.*` and `payments.*`. owner/admin via `*`. Not auto-granted to accountant/staff. Same convention as `supplier_refunds.*`.

UI: nearest ACC-RET-1 Supplier Refund workspace (list + create dialog with server-computed eligible sources + detail post/reverse). Not a redesign.

POS, Store, gateway, VAT, ZATCA, invoices, `PosReturnService`, cash-drawer policy, Payment reversal, and settlement were not changed.

---

## Changed files

### New

| File | Why |
|---|---|
| `database/migrations/2026_09_12_010000_create_customer_refund_tables.php` | Additive `customer_refunds` + `customer_refund_allocations`. No existing table mutated. |
| `app/Models/CustomerRefund.php` | `BelongsToBranch` + `GeneratesDocumentNumbers` + `ResolvesBranchReferences`. |
| `app/Models/CustomerRefundAllocation.php` | `CompanyWide` polymorphic allocation (`source_type`/`source_id`). |
| `app/Services/Accounting/CustomerRefundService.php` | Canonical create/update/delete/post/reverse, eligibility, refundable balance. |
| `app/Http/Controllers/Api/CustomerRefundController.php` | Thin REST surface. Domain exceptions → 422. Actor passed into `post()`. |
| `app/Http/Requests/StoreCustomerRefundRequest.php` | Integer minor-unit amounts; allocations required. |
| `app/Http/Resources/CustomerRefundResource.php` | Riyal display; source kind mapped back from morph class. |
| `tests/Feature/CustomerRefundTest.php` | 41 focused tests covering the required matrix. |
| `web/src/app/(app)/customer-refunds/page.tsx` | List + status filter. |
| `web/src/app/(app)/customer-refunds/[id]/page.tsx` | Detail + post/reverse. |
| `web/src/components/customer-refunds/create-customer-refund-dialog.tsx` | Fully allocated create; amounts from the server. |
| `docs/plans/payments/AWJ_PAY_V2_6B_IMPLEMENTATION_REPORT.md` | This report. |

### Edited (narrow)

| File | Why |
|---|---|
| `app/Support/Rbac.php` | `customer_refunds.view` / `customer_refunds.manage` next to `supplier_refunds.*`. |
| `app/Support/DocumentNumberingCatalog.php` | `customer_refund` entity, prefix `CRF`, yearly. |
| `app/Services/Accounting/FiscalCloseService.php` | Posted customer refunds without a journal block fiscal close. |
| `routes/api.php` | 8 routes after supplier-refunds. |
| `web/src/components/layout/sidebar.tsx` | Sales-group leaf gated on `customer_refunds.view`. |
| `web/src/messages/ar.json`, `en.json` | `nav.customerRefunds` + `customerRefunds` section. Trees match. |

Unchanged by design: `ReturnService`, `CreditNoteService`, `PosReturnService`, `PaymentService`, `PaymentReversalService`, `PaymentGatewaySettlementService`, `LedgerService` internals, `CashBankAccountService` internals, `AccountRoleResolver`, VAT/ZATCA, invoices, Store, POS session/drawer, provider SDKs.

CI assemble allowlist: all new PHP files live in already-copied directories (`app/Models`, `app/Services/Accounting`, `app/Http/{Controllers/Api,Requests,Resources}`, `database/migrations`, `tests/Feature`). No new `app/` subdirectory. No `ci.yml` / `deploy/assemble.sh` change.

---

## Schema

`customer_refunds`: uuid PK, `tenant_id` (cascade), `branch_id` (nullable, nullOnDelete), `number`, `partner_id` (restrictOnDelete), `refund_date`, `amount` bigint (halalas), `method` (cash|bank), `payment_method_id` + `payment_method_name` snapshot, `cash_account_id` → `accounts` (restrictOnDelete, same convention as `payments.cash_account_id`), `reference`, `notes`, `status` (draft|posted|reversed), `journal_entry_id`, `reversal_entry_id`, `posted_at`, `reversed_at`, `created_by`, timestamps.

Unique `(tenant_id, branch_id, number)` + partial unique index `customer_refunds_unbranched_number_unique` for `branch_id IS NULL` (PostgreSQL NULL-distinct unique; same pattern as `supplier_refunds`). Indexes on partner/status/date.

`customer_refund_allocations`: uuid PK, `tenant_id`, `customer_refund_id` (cascade), polymorphic `source_type`/`source_id`, `amount` bigint. Unique `(customer_refund_id, source_type, source_id)`. Index `(tenant_id, source_type, source_id)` backs the refundable-balance query.

No FK onto `return_documents` / `credit_notes` because the target is polymorphic. Tenant isolation is Eloquent `TenantScope` on `find()`, not a cross-table FK. Same-tenant is rechecked at allocate and again inside the post locks.

---

## Tenant Isolation evidence

- Active `TenantContext` required. No `withoutGlobalScope(TenantScope::class)`.
- Service `unset($data['tenant_id'])` on create/update. Forged `tenant_id` is overwritten by the active tenant (`a_forged_tenant_id_on_create_is_overwritten_by_the_active_tenant`).
- Foreign-tenant sales return does not resolve under TenantScope → allocation rejected (`a_refund_cannot_allocate_to_another_tenants_return`).
- Foreign-tenant cash account rejected by `CashBankAccountService::resolveForPayment()` (`a_refund_cannot_use_another_tenants_cash_account`).
- Second tenant sees zero refunds/allocations and cannot see the first tenant's returns (`refunds_are_isolated_per_tenant`).
- Wrong customer rejected (`allocation_to_another_customers_return_is_rejected`). Supplier partner rejected (`a_supplier_partner_cannot_receive_a_customer_refund`).
- Branch: document tagged; journal lines take the document's `branch_id` (`a_refund_keeps_the_branch_of_its_document_on_the_journal`). Controller `scopeToActiveBranch` / `assertRecordAccessible` follow Supplier Refund.

---

## RBAC evidence

New permissions, not a new architecture:

- Catalog: `customer_refunds.view`, `customer_refunds.manage`.
- owner/admin: yes via `*`.
- accountant: **no** view, **no** manage (accountant still has `returns.*` and `payments.*` — those do not move customer cash).
- staff: **no**.

Routes: view on index/show/eligible-sources; manage on store/update/destroy/post/reverse.

API test: accountant token is 403 on GET and POST `/api/customer-refunds`.

---

## Period-lock evidence

`LedgerService` is the only period-lock gate. Customer Refund does not bypass it.

- Post with `refund_date` inside a locked period → `AccountingPeriodLockedException`, status stays `draft`, no journal, refundable balance unchanged.
- Reverse with an explicit date inside a locked period → exception, status stays `posted`, `reversal_entry_id` null, balance still consumed.

No silent backdate to invoice / return / original payment date. The refund's own `refund_date` (post) or the caller-supplied reversal date is used.

---

## Tests and results

`tests/Feature/CustomerRefundTest.php` — **41 tests**. Mapping to the required coverage:

| Required | Test |
|---|---|
| 1 authorized create/post | `the_api_creates_and_posts_an_authorized_customer_refund`, `posting_a_refund_debits_receivable_and_credits_the_selected_cash_account` |
| 2 correct journal | `posting_a_refund_debits_receivable_and_credits_the_selected_cash_account`, `a_bank_refund_credits_the_bank_account_not_the_cash_box`, `a_mapped_receivable_account_is_used_and_an_invalid_mapping_fails_closed` |
| 3 Cash/Bank ACL | `a_refund_cannot_be_posted_when_withdraw_is_not_allowed_for_the_actor`, `a_refund_cannot_be_posted_to_an_inactive_cash_account`, `a_cash_method_cannot_select_a_bank_account` |
| 4 partial allocation | `a_partial_refund_leaves_the_remaining_balance` |
| 5 multiple partial refunds | `multiple_partial_refunds_can_exhaust_the_balance` |
| 6 cumulative over-refund rejected | `over_refunding_a_return_is_rejected`, `a_second_refund_cannot_exceed_the_remaining_refundable_balance` |
| 7 concurrent over-refund protection | `two_draft_refunds_cannot_both_post_beyond_the_return_balance`, `a_failed_post_leaves_no_journal_and_no_status_change` (canonical SupplierRefund sequential two-draft + `lockForUpdate`; not a `pcntl` fork) |
| 8 wrong customer rejected | `allocation_to_another_customers_return_is_rejected`, `a_supplier_partner_cannot_receive_a_customer_refund` |
| 9 cross-tenant document rejected | `a_refund_cannot_allocate_to_another_tenants_return` |
| 10 cross-tenant cash/bank rejected | `a_refund_cannot_use_another_tenants_cash_account` |
| 11 forged tenant rejected | `a_forged_tenant_id_on_create_is_overwritten_by_the_active_tenant` |
| 12 locked-period posting rejected | `posting_into_a_locked_period_is_rejected_with_no_journal` |
| 13 reversal journal correct | `reversing_a_refund_reverses_the_original_entry_and_restores_the_balance`, `reversal_uses_the_original_concrete_accounts_even_after_remapping` |
| 14 duplicate posting cannot double-post | `posting_the_same_refund_twice_creates_only_one_journal` |
| 15 reversed refund balance behavior | `a_reversed_refund_frees_the_balance_for_a_new_refund` plus restore-balance assertion in the reverse test |

Additional: cash-return / cash-credit-note rejection; purchase-return rejection; draft-source rejection; unallocated / partial-allocation-sum rejection; duplicate allocation inside one refund; mixed return+credit-note split; eligible-sources filter; numbering `CRF-{year}-00001`; commercial document unchanged (status/total/journal_entry_id, `Payment` count = 0); period-lock reverse; duplicate reverse rejected; posted cannot be edited/deleted; RBAC independence; accountant API 403.

**Local PHPUnit: not run.** This sandbox has no PHP 8.4. Tests are intended to run on GitHub Actions (SQLite + PostgreSQL matrix) after push. Financial / Tenant Isolation tests were not weakened.

Frontend i18n: `ar.json` / `en.json` parse, leaf trees match (0 ar-only, 0 en-only), `customerRefunds` key sets identical. Static `t('…')` keys used by the new pages exist in both languages.

---

## SQLite CI / PostgreSQL CI / Build CI

| Check | Result |
|---|---|
| SQLite (`php artisan test` matrix) | **Pending GitHub Actions after push** |
| PostgreSQL 16 (`php artisan test` matrix) | **Pending GitHub Actions after push** |
| Web CI (`vitest` + Next.js build) | **Pending GitHub Actions after push** (web/ paths changed) |
| Assemble allowlist | No new `app/` directory; existing copy globs pick up the new PHP files |
| Local PHP | Unavailable in this environment — cannot claim green |

Do not treat this report as a green-CI certificate. CI status is whatever GitHub reports on the PR.

---

## Risks / remaining work

1. **ReturnService / CreditNoteService still hard-code 1130** while invoices, payments, and this refund use `AccountRoleResolver('accounts_receivable')`. If AR is remapped, commercial credit still hits 1130 and the refund hits the mapped account. Pre-existing. Out of PAY-V2-6B scope. The remapped-AR test asserts the *refund* uses the mapped account.
2. **No true parallel `pcntl` race test.** Protection is `lockForUpdate` + deterministic source-lock order + sequential two-draft post, identical to Supplier Refund. Sufficient for SQLite (serialized writes) and PostgreSQL row locks; a fork test was not added because it is not the canonical pattern and would be engine-specific.
3. **PHPUnit not executed locally.** First CI run may surface an environment-only failure. Do not merge until SQLite + PostgreSQL are green.
4. **Polymorphic allocations have no FK** onto the source tables. Isolation is TenantScope + explicit eligibility checks. Same trade-off as any morph; reported so it is not mistaken for a missing constraint.
5. **V1 requires full allocation.** Unallocated customer refunds are a separate unapproved contract.

---

## Explicit deferred PAY-V2-6C (and later) scope

Not in this PR:

- provider refund APIs / SDKs / webhook handlers
- gateway clearing refund events
- settlement offsets
- original merchant-fee refund / new refund fees / fee tax
- chargebacks / disputes
- linking a Customer Refund to a gateway-funded Payment
- pending/succeeded/failed provider-refund lifecycle
- POS migration off `payment_type=cash`
- Store / PaymentIntent refunds
- automatic Credit Note / Sales Return creation
- invoice VAT / ZATCA mutation
- account-routing redesign of ReturnService/CreditNoteService off hardcoded 1130

Customer Refund is intentionally referable later (`source_type = CustomerRefund`) without redesign.

---

## Architecture-safety confirmation

Canonical placement:

- Accounting and allocation: `CustomerRefundService`
- Journals: `LedgerService` only
- Cash/bank + ACL: `CashBankAccountService` only
- AR destination: `AccountRoleResolver` only
- Tenant / branch: existing scopes and `BelongsToBranch`
- RBAC: existing `Rbac` catalog + route middleware
- Period lock: existing Ledger guard
- Controller is a thin HTTP adapter (`domain()`, `assertRecordAccessible`, actor propagation)
- No provider, middleware, helper, duplicate service, or TenantScope bypass

---

## Tool-limitation confirmation

**Did any tool limitation influence where or how this implementation was placed?**

**NO.**

Logic lives in the canonical service/model/migration/test files. The GitHub connector was used only to read PR #778 design docs. Runtime files were written in the cloned canonical repo (`/tmp/Nebrax`) and will be pushed on the dedicated branch. PHP not being installed locally did not move any logic; it only deferred test execution to CI.

---

## Next recommended step

1. Wait for GitHub Actions: `php artisan test` on SQLite **and** PostgreSQL, plus web CI.
2. If focused `CustomerRefundTest` is green on both engines, run the relevant accounting regressions already in CI (`ReturnTest`, `CreditNoteTest`, `SupplierRefundTest`, `PaymentTest`, `LedgerTest`, `AccountingPeriodLockTest`, `NumberingSettingsTest`, `RoleTest`).
3. Owner review of the journal (`Dr AR / Cr Cash-Bank`) and the AR-hardcode debt on returns/credit notes (separate task).
4. **Do not merge. Do not deploy.**
5. After merge of this foundation (owner decision): PAY-V2-6C gateway-refund integration that *references* Customer Refund, never mutates historical Payment/settlement.

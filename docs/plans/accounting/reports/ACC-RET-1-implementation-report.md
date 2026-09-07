# ACC-RET-1 — Purchase Return Cutover + Supplier Refund — Implementation Report

**Status:** DONE
**Task doc:** `docs/plans/accounting/ACC-RET-1-purchase-return-cutover-supplier-refund.md`
**Architecture gate:** `docs/plans/accounting/GATE-ACC-RET-1-purchase-return-supplier-refund.md`
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`
**Dependency:** ACC-2 (merged) + ACC-3 (merged, `a1268d4`)

## Summary

Implemented the resolved gate contract: **`Purchase Return != Supplier Refund`**.

A purchase return now reverses only the supplier's commercial liability and moves no cash at all.
Money actually coming back from a supplier is a new, dedicated, fully-allocated, auditable financial
document (`SupplierRefund`) that debits a real `CashBankAccount` and credits `accounts_payable`.

`LedgerService` was not modified, `Payment` gained no third direction, no generic cash/bank semantic
role was introduced, and no historical journal, return, or `payment_type` datum was rewritten.

## Baseline checks performed before coding

| Check | Result |
|---|---|
| `main` contains the ACC-3 merge `a1268d4df5e0061c9dd0fc51c0f6abe7c17b1c94` | ✅ verified it is the head of `origin/main` |
| `SRF` prefix collision | ✅ none — 18 existing prefixes scanned, `SRF` unused |
| Migration naming/FK conventions | ✅ mirrored `2025_01_01_000071_create_employee_custodies` (branch-scoped financial doc + partial unbranched unique index) |
| Financial-document RBAC convention | ✅ `domain.view` / `domain.manage` (payments, expenses, returns, assets) → `supplier_refunds.view/manage` |
| `CashBankAccountService` deposit resolution | ✅ `resolveForPayment()` + `assertAllowed($entity, 'deposit', $actor)` (same pair `PaymentService::post()` uses) |
| `ReturnService`/API/UI materially changed since audit | ✅ no — `postPurchaseReturn()` still selects `1110` vs `2110` from `payment_type`, exactly as audited |

## Posting behaviour: before / after

### Purchase return (20,000 goods + 15% VAT)

| Line | Before (`payment_type=cash`) | Before (`credit`) | After (always) |
|---|---|---|---|
| Debit | `1110` Cash 23,000 (no partner) | `2110` AP 23,000 (partner) | **`accounts_payable` (resolved) 23,000, partner: supplier** |
| Credit inventory | `1140` 20,000 | `1140` 20,000 | `1140` 20,000 *(unchanged)* |
| Credit expense | `5150` (non-tracked) | `5150` | `5150` *(unchanged)* |
| Credit input VAT | `1150` 3,000 | `1150` 3,000 | `1150` 3,000 *(unchanged)* |
| Valuation variance | `5116` | `5116` | `5116` *(unchanged)* |
| Cash movement | **yes** | no | **never** |

Amounts, VAT computation, debit/credit directions, rounding, inventory issue quantities and the
document lifecycle are byte-for-byte unchanged; only the debit line's account source changed.

### Supplier refund (new document)

```
Dr  <selected CashBankAccount.account_id>   23,000
Cr  accounts_payable (resolved)             23,000   partner: supplier
```

### Reversal

`LedgerService::reverse()` on the stored original entry — reverses the **original concrete accounts**,
never re-resolved against current mappings.

## Schema / migrations

`database/migrations/2026_09_08_010000_create_supplier_refund_tables.php` — additive only, touches no
existing table.

- **`supplier_refunds`**: uuid PK, `tenant_id` (cascade), `branch_id` (nullable, nullOnDelete), `number`,
  `partner_id` (restrictOnDelete), `refund_date`, `amount` bigint (halalas), `method` (cash|bank),
  `payment_method_id` + `payment_method_name` snapshot, `cash_account_id` → `accounts` (restrictOnDelete,
  same convention as `payments.cash_account_id`), `reference`, `notes`, `status` (draft|posted|reversed),
  `journal_entry_id`, `reversal_entry_id`, `posted_at`, `reversed_at`, `created_by`, timestamps.
  Unique `(tenant_id, branch_id, number)` + partial unique index for unbranched rows. Indexes on
  partner/status/date.
- **`supplier_refund_allocations`**: uuid PK, `tenant_id`, `supplier_refund_id` (cascade),
  `purchase_return_id` → `return_documents` (restrictOnDelete), `amount` bigint, timestamps.
  Unique `(supplier_refund_id, purchase_return_id)` so one return cannot be allocated twice in one refund;
  index `(tenant_id, purchase_return_id)` backs the refundable-balance query.

No migration touches `return_documents`, `journal_entries`, `journal_lines`, `payments`, or `purchases`.

## Changed files

| File | Why |
|---|---|
| `app/Services/Accounting/ReturnService.php` | Purchase-return debit always `accounts_payable` via `AccountRoleResolver` with the supplier dimension; cash branch removed; service-level rejection of `payment_type=cash` for purchase returns; docblock updated. |
| `app/Http/Requests/StoreReturnRequest.php` | `payment_type` now `required_if:type,sales` (optional for purchase); `withValidator` rejects `cash` on purchase returns with an explicit deprecation message. |
| `app/Models/SupplierRefund.php`, `app/Models/SupplierRefundAllocation.php` (new) | Branch-scoped document (`BelongsToBranch` + `GeneratesDocumentNumbers` + `ResolvesBranchReferences`) and its `CompanyWide` allocation lines (they follow their header's branch). |
| `app/Services/Accounting/SupplierRefundService.php` (new) | create/update/delete draft, `post()`, `reverse()`, `refundableBalance()`, `eligibleReturns()`. |
| `app/Http/Controllers/Api/SupplierRefundController.php`, `StoreSupplierRefundRequest`, `SupplierRefundResource` (new) | REST surface. |
| `routes/api.php` | 8 routes under `supplier_refunds.view/manage`. |
| `app/Support/Rbac.php` | `supplier_refunds.view` / `supplier_refunds.manage` added to the assignable catalog (owner/admin via `*`; not auto-granted to accountant/staff). |
| `app/Support/DocumentNumberingCatalog.php` | `supplier_refund` entity, `SRF` series, yearly, branch-scoped (scope derived from the model, not hand-written). |
| `web/src/components/returns/create-return-dialog.tsx` | Cash/credit selector hidden for purchase returns; explanatory supplier-credit note; `payment_type` sent only for sales. |
| `web/src/app/(app)/supplier-refunds/page.tsx`, `[id]/page.tsx`, `web/src/components/supplier-refunds/create-supplier-refund-dialog.tsx` (new) | Dense RTL-first workspace: list + status filter, create dialog with server-computed eligible returns/refundable balances and per-return allocation, detail page with post/reverse and allocation history. |
| `web/src/components/layout/sidebar.tsx` | Purchases-group leaf gated on `supplier_refunds.view`. |
| `web/src/messages/ar.json`, `en.json` | Full ar/en copy for the workspace and the purchase-return note. |
| `tests/Feature/SupplierRefundTest.php` (new), `tests/Feature/ReturnTest.php` | 33 new tests; the old `cash_purchase_return_debits_cash_not_payables` replaced by the cutover expectation. |

## Concurrency / atomicity evidence

`SupplierRefundService::post()` runs entirely inside one `DB::transaction()`:

1. `SupplierRefund::lockForUpdate()` + draft recheck (blocks concurrent double-post).
2. Allocations read ordered by `purchase_return_id`, then each target `ReturnDocument::lockForUpdate()`
   in that **deterministic ascending order** (no lock-order inversion between concurrent refunds).
3. Full revalidation **inside** the locks: exists, `type=purchase`, posted, same supplier, and
   `amount <= refundableBalance()` recomputed live.
4. Cash destination + deposit permission, then AP role resolution (fail-closed).
5. `LedgerService::post()`, then status/journal/`posted_at` written in the same transaction.

Covered by tests: `two_draft_refunds_cannot_both_post_beyond_the_return_balance` (second post rejected),
`a_failed_post_leaves_no_journal_and_no_status_change` (journal count unchanged, status still `draft`,
`journal_entry_id` still null), and `posting_the_same_refund_twice_creates_only_one_journal`.

## Tests and results

**New — `SupplierRefundTest`, 33 tests / 93 assertions**, mapping to the gate's 24-point matrix:

| Gate point | Test |
|---|---|
| 1 AP reversal, no cash | `a_new_purchase_return_debits_payables_with_the_supplier_dimension_and_moves_no_cash` |
| 2 tracked/non-tracked/VAT unchanged | same + `a_non_tracked_purchase_return_still_credits_expense_and_input_vat_only` |
| 3 old cash returns readable | `historical_cash_purchase_returns_stay_readable_and_untouched` |
| 4 new `cash` rejected | `the_api_rejects_a_new_cash_purchase_return_with_an_explicit_error` (+ service-level test in `ReturnTest`) |
| 5 Dr CashBank / Cr AP | `posting_a_refund_debits_the_selected_cash_account_and_credits_payables`, `a_bank_refund_debits_the_bank_account_not_the_cash_box` |
| 6 mapped AP + fail closed | `a_mapped_payable_account_is_used_and_an_invalid_mapping_fails_closed` |
| 7 wrong/inactive CashBank | `a_refund_cannot_be_posted_to_an_inactive_cash_account` |
| 8 deposit not allowed | `a_refund_cannot_be_posted_when_deposit_is_not_allowed_for_the_actor` |
| 9 method/account compatibility | `a_cash_method_cannot_select_a_bank_account` |
| 10 posted purchase returns only | `allocation_to_a_draft_return_is_rejected`, `allocation_to_a_sales_return_is_rejected` |
| 11 supplier mismatch | `allocation_to_another_suppliers_return_is_rejected` |
| 12 allocation sum = amount | `a_refund_must_be_fully_allocated`, `an_unallocated_refund_is_rejected` |
| 13 over-refund rejected | `over_refunding_a_return_is_rejected`, `a_second_refund_cannot_exceed_the_remaining_refundable_balance` |
| 14 concurrent refunds | `two_draft_refunds_cannot_both_post_beyond_the_return_balance` |
| 15 concurrent double-post | `posting_the_same_refund_twice_creates_only_one_journal` |
| 16 failed post leaves nothing | `a_failed_post_leaves_no_journal_and_no_status_change` |
| 17 reversal original accounts | `reversal_uses_the_original_concrete_accounts_even_after_remapping` |
| 18 reversal restores balance, keeps history | `reversing_a_refund_reverses_the_original_entry_and_restores_the_balance`, `a_reversed_refund_frees_the_balance_for_a_new_refund` |
| 19 remapping after posting | `reversal_uses_the_original_concrete_accounts_even_after_remapping` |
| 20 branch + tenant isolation | `refunds_are_isolated_per_tenant`, `a_refund_cannot_allocate_to_another_tenants_return`, `a_refund_keeps_the_branch_of_its_document_on_the_journal` |
| 21 numbering | `numbering_uses_the_shared_document_layer_with_the_srf_prefix` |
| 22 authorization | `supplier_refund_permissions_are_independent_of_returns_permissions` |
| 23 SQLite + PostgreSQL | both engines below |
| 24 no direct-cash purchase return in API/UI | API tests above + selector removed from the dialog |

Plus lifecycle guards (`a_draft_refund_cannot_be_reversed_and_a_posted_one_cannot_be_edited_or_deleted`),
split allocation across two returns, duplicate-allocation rejection, and eligible-returns filtering.

**Targeted regression — both engines, all passing:**
- returns/credit-notes/debit-notes/restock/UOM-valuation/warehouse/application-operation: **138 passed**
- purchases/payments/ledger/account-routing/numbering/RBAC/invoices: **225 passed, 1 skipped**
- guards (`BranchIsolationGuardTest`, `ApplicationCatalogTest`, `NumberingSettingsTest`, `RoleTest`) + ACC-RET-1: **96 passed**
- PostgreSQL focused rerun (ACC-RET-1 + returns + ledger + routing + payments): **162 passed**

**Full backend suite:**
- **SQLite:** 2582 passed, 1 skipped, **25 failed** (351s, 18192 assertions).
- **PostgreSQL 16:** 2583 passed, **25 failed** (787s, 18194 assertions).
- All 25 failures on both engines are the pre-existing `Fuel*Test` failures (`Call to undefined function
  App\Services\bcmul()` — the `bcmath` PHP extension is absent in this environment). Identical count and
  class to the documented pre-ACC-RET-1 baseline in the ACC-1/ACC-2/ACC-3 reports.

**Frontend:** `npx vitest run` → 238 files / **1523 tests passed**. The repo's own i18n-key guard caught a
real bug in my first draft (a `common.saving` key that does not exist) — fixed, then green.
`npx tsc --noEmit` → the same 4 pre-existing errors in files this PR does not touch. `npm run build` →
succeeds; `/supplier-refunds` (5.94 kB) and `/supplier-refunds/[id]` (4.78 kB) compile.

## Tenant / branch isolation

- Every read/write goes through Eloquent under the existing `TenantScope`; a foreign-tenant
  `purchase_return_id` simply does not resolve, so allocation is rejected rather than leaking existence
  (`a_refund_cannot_allocate_to_another_tenants_return`).
- A second tenant sees zero refunds/allocations and cannot see the first tenant's returns
  (`refunds_are_isolated_per_tenant`).
- The document is `BelongsToBranch` (tagged, filtered explicitly — no global branch scope, per the
  multi-branch contract); `SupplierRefundController` filters lists with `scopeToActiveBranch()` and guards
  direct access with `assertRecordAccessible()`.
- The journal is tagged with **the document's** branch (`'branch_id' => $refund->branch_id`, the
  `AssetService` precedent), not whatever branch is active at post time — asserted on every journal line.

## CashBank permission evidence

The destination is resolved exclusively through `CashBankAccountService::resolveForPayment()` (type/active
checks) and authorised with `assertAllowed($entity, 'deposit', $actor)` — money entering our treasury is a
deposit. Tests cover the inactive-account rejection, the deposit-scope denial for a non-permitted actor,
and the cash-method/bank-account incompatibility rejection. No account is ever chosen by code lookup.

## Deliberate boundaries (reported, not silently expanded)

1. **Purchase-return credit lines keep their current account source.** The gate's target names
   `inventory_asset`/`purchase_expense`/`tax_input`, but ACC-RET-1's own scope says "no purchase
   account-routing adoption beyond what this cutover needs", and ACC-4/ACC-5 own those roles. Because
   ACC-2 seeds every tenant's mappings to exactly these legacy accounts, today's journals are identical
   either way; adopting them here alone would make purchase **receipt** (hardcoded 1140) and purchase
   **return** (mapped) disagree for any tenant who remaps inventory. Left to ACC-4/ACC-5.
2. **No `ApplicationCatalog` app-key guard** on the new routes. The gate specifies RBAC only, and
   extending `purchases.cycle` enforcement to supplier-side documents is still listed as out of scope in
   `CLAUDE.md`.
3. **`payment_type=credit` still accepted** on purchase returns (now redundant/deprecated), per the gate's
   "may be temporarily accepted for old clients".

## Risks and remaining work

- **Risk: medium-high domain, low regression.** This is real settlement money movement, but the diff is
  narrow: one debit-line source change on an existing path plus a wholly additive document. 33 targeted
  tests plus the full suite on both engines back it.
- `supplier_refunds.*` is not granted to `accountant` by default (least privilege, matching every recently
  added permission). If Safwan wants accountants to record refunds without a custom role, that is a
  one-line matrix decision — flagged rather than assumed.
- No automatic backfill exists for historical cash purchase returns, by explicit gate decision. Those
  returns remain as posted; if any of them should retroactively become AP + refund pairs, that is a
  separate, approved data task.
- **Remaining:** ACC-4 (Purchase Routing) is now unblocked. Not started, per this task's instruction.

## Branch / PR / SHAs

- Branch: `claude/acc-ret-1-supplier-refund`
- PR: https://github.com/safwan5001-source/Nebrax/pull/684
- Base SHA (`origin/main`, contains ACC-3 merge): `a1268d4df5e0061c9dd0fc51c0f6abe7c17b1c94`
- Head SHA: `29e6f2e27cfba648acfb59f918615ec70e3b3297`

**No merge, no deploy performed. No data reset or deleted.**

## Recommended next step

Review PR #684 in isolation — particularly the two deliberate boundaries above. Once approved and merged
by Safwan, ACC-4 (Purchase Routing) can begin; it is the phase that should adopt
`inventory_asset`/`purchase_expense`/`tax_input` on the purchase and purchase-return sides together, so
receipt and return never disagree.

# AWJ PAY-V2-1B — Implementation Report

Status: **COMPLETE FOR REVIEW — NOT MERGED — NOT DEPLOYED**

## Identifiers

- Repository: `safwan5001-source/Nebrax`
- Branch: `feat/pay-v2-1b-payment-reversal`
- PR: [#763](https://github.com/safwan5001-source/Nebrax/pull/763) (draft, open, not merged)
- Base SHA: `e33b52ef353d4d1e85b6dba847056ead963ddf1e`
- Verified implementation Head (full CI green): `c402707ea12bfcc389fb01f4e9fa88d8854da631`
- Previous accounting Head (also CI-green): `2ab87e6ed5ccc40925bdb6d20e90562a62626384`

## Implementation summary

PAY-V2-1B finishes safe reversal of posted receipt/payment vouchers.

Accounting core already existed on this branch and passed full GitHub Actions CI on SQLite and PostgreSQL at `2ab87e6`. This completion exposed `POST /api/payments/{id}/reverse` with existing `payments.manage` and added focused API / RBAC / tenant / branch / original-journal / period-lock coverage.

What this completion added:

- `POST /api/payments/{id}/reverse` using the same protection stack as other payment mutations (`ForceJsonResponse`, Sanctum, user principal, tenant, branch, active subscription, `payments.manage`).
- Focused API/RBAC tests for authorized reverse, 403 without `payments.manage`, response metadata, double-reverse rejection, and draft-only mutation protections on a reversed voucher.
- Focused tenant and active-branch isolation negatives, including proof that reversal copies the original stored journal and does not reroute from the caller’s current cash/bank defaults.
- Focused period-lock regression through existing `LedgerService::reverse()` / `AccountingDateGuard` behavior. Failure leaves Payment, original journal, allocations, and Invoice/Purchase paid state unchanged.
- Removal of the temporary API-integration note and interim report.
- This report as the final documentation file.

Route registration: `app/Providers/TenancyServiceProvider.php` registers `POST api/payments/{id}/reverse` with `whereUuid('id')`. Contract and guards match `POST payments/{id}/post`. Placement is in the provider rather than `routes/api.php` so the large route file is not rewritten.

## Changed files

Accounting / model / resource (already on `2ab87e6`):

- `app/Services/Accounting/PaymentReversalService.php`
- `app/Models/Payment.php`
- `app/Http/Resources/PaymentResource.php`
- `app/Http/Controllers/Api/PaymentController.php` (`reverse` action)
- `database/migrations/2026_09_11_190000_add_reversal_lifecycle_to_payments.php`
- `tests/Feature/PaymentReversalTest.php`
- `tests/Feature/SupplierPaymentTest.php`

Integration / hardening:

- `app/Providers/TenancyServiceProvider.php` — registers `POST api/payments/{id}/reverse`
- `tests/Feature/PaymentReversalApiTest.php`
- `tests/Feature/PaymentReversalTest.php` — period-lock failure leaves state unchanged
- `docs/plans/payments/AWJ_PAY_V2_1B_IMPLEMENTATION_REPORT.md`

Removed:

- `docs/plans/payments/PAY-V2-1B-NOTE.md`
- `docs/plans/payments/PAY-V2-1B-IMPLEMENTATION-REPORT.md`

No leftover temporary notes remain under `docs/plans/payments/`.

## Database / migration changes

Migration `2026_09_11_190000_add_reversal_lifecycle_to_payments.php`:

- Adds nullable `payments.reversal_entry_id` (FK to `journal_entries`, restrict on delete).
- Adds nullable `payments.reversed_at`.
- On PostgreSQL only: replaces `payments_status_check` so `status` may be `draft | posted | cancelled | reversed`.
- SQLite keeps the existing varchar status column; no enum DDL.

No other schema, numbering, or allocation-table changes.

## Accounting invariants

Preserved; not redesigned:

- Posted Payment vouchers remain immutable. Correction is reversal, never delete/edit of posted rows or original journals.
- Reversal calls `LedgerService::reverse()` on the actual stored `journal_entry_id`.
- Reversal journal lines copy the original stored accounts, partners, cost centers, and line `branch_id`. Current cash/bank defaults, payment-method settings, and the caller’s active branch are not used to rebuild the entry.
- Payment amount, method snapshot, cash/bank account, allocations, and original journal stay on the Payment row.
- Invoice/Purchase `paid_amount` / `payment_status` are recomputed from allocations whose Payments remain `posted`.
- Reversal runs in one DB transaction.
- A reversed Payment is no longer `posted`, so a second reverse cannot create a second reversal journal.
- Period locks are enforced only by `LedgerService::reverse()` → `AccountingDateGuard::assertOpen()` on the proposed reversal date.
- Tenant isolation and active-branch visibility stay on the existing Payment query scope (`visiblePayment` / `scopeToActiveBranch`).

## Tenant / Branch / security guarantees

- `POST /api/payments/{id}/reverse` requires `payments.manage`. `staff` has `payments.view` only and receives 403.
- Cross-tenant Payment id cannot be shown or reversed (404). Tenant context is restored before asserting the source Payment remains posted.
- A Payment stamped to another branch is not visible under the caller’s active `X-Branch-Id` and cannot be reversed from that branch (404).
- Successful reverse from the Payment’s own branch still uses the original journal routing, even after the tenant’s main cash account is changed.
- No new RBAC permission and no change to tenant/branch middleware.

## Focused tests and exact results

Focused suites included in the full GitHub Actions run on Head `c402707ea12bfcc389fb01f4e9fa88d8854da631`:

`PaymentReversalTest`

- posted receipt is reversed from its original journal and keeps allocation history
- reversing one of multiple receipts recalculates from remaining posted allocations
- draft payment cannot be reversed
- payment cannot be reversed twice
- missing original journal fails without changing payment or invoice
- reversal into a locked period fails without changing payment, journal, allocations, or invoice

`PaymentReversalApiTest`

- `payments.manage` user can reverse a posted Payment; response exposes `status=reversed`, `reversal_entry_id`, `reversed_at`
- user without `payments.manage` receives 403; Payment stays posted
- reversed Payment cannot be reversed twice (422); only one reversal journal exists; update/post/delete remain 422
- cross-tenant Payment cannot be shown or reversed (404)
- Payment outside the caller’s active branch cannot be reversed (404); same-branch reverse succeeds
- reversal uses the original stored journal and ignores current cash/method defaults
- API reversal dated inside a locked period returns 422 and leaves Payment, original journal, allocations, and invoice paid state unchanged

`SupplierPaymentTest` (existing + reversal cases)

- reversing a supplier payment restores purchase payable and keeps original routing
- reversing one supplier payment recalculates purchase from other posted payments

Exact engine results for the full suite that contains those tests:

| Engine | Job | Result | Tests step |
|---|---|---|---|
| SQLite | `php artisan test (L11, sqlite)` | **success** | 17:30:14Z – 17:35:10Z |
| PostgreSQL | `php artisan test (L11, pgsql)` | **success** | 17:30:15Z – 17:41:56Z |

## Full CI results for SQLite and PostgreSQL

Verified on Head `c402707ea12bfcc389fb01f4e9fa88d8854da631`:

- Push run [#34627929738](https://github.com/safwan5001-source/Nebrax/actions/runs/34627929738) — **success**
  - `php artisan test (L11, sqlite)` — success — [job 103357439190](https://github.com/safwan5001-source/Nebrax/actions/runs/34627929738/job/103357439190)
  - `php artisan test (L11, pgsql)` — success — [job 103357438865](https://github.com/safwan5001-source/Nebrax/actions/runs/34627929738/job/103357438865)

Previously verified on accounting Head `2ab87e6ed5ccc40925bdb6d20e90562a62626384`:

- Push run [#34623933095](https://github.com/safwan5001-source/Nebrax/actions/runs/34623933095) — **success** (sqlite + pgsql)

A docs-only follow-up commit on this branch may start another CI run. It does not change application code.

## Build / CI status

- Full CI on verified implementation Head `c402707e`: **PASS** (SQLite + PostgreSQL)
- Merge: **NOT MERGED**
- Deploy: **NOT DEPLOYED**
- Draft PR #763 remains open.

## Risks and remaining work

- No UI for reverse. Operators can only reverse through the API until a later scoped UI task.
- The reverse route lives in `TenancyServiceProvider` with the same mutation guards as other payment writes. Moving the one-line registration into `routes/api.php` beside `POST payments/{id}/post` is placement cleanup only and does not change behavior.
- `cancelled` remains in the status contract; this task does not introduce a cancel flow.
- Classification update on a reversed voucher is unchanged existing behavior and was not redesigned here.
- Duplicate of a reversed voucher still creates a new draft without allocations (existing `PaymentService::duplicate` contract).
- PAY-V2-2, gateways, fees, surcharge, VAT/ZATCA, Store checkout, POS, allocation redesign, and LedgerService refactors stay out of scope.

## Next recommended step

Safwan review of draft PR #763. Do not merge or deploy without explicit approval.

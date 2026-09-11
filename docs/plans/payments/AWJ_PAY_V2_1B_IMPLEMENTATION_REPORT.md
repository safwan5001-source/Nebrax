# AWJ PAY-V2-1B — Implementation Report

Status: **COMPLETE FOR REVIEW — NOT MERGED — NOT DEPLOYED**

## Identifiers

- Repository: `safwan5001-source/Nebrax`
- Branch: `feat/pay-v2-1b-payment-reversal`
- PR: [#763](https://github.com/safwan5001-source/Nebrax/pull/763) (draft)
- Base SHA: `e33b52ef353d4d1e85b6dba847056ead963ddf1e`
- Head SHA: `e69798ba60a39549fcd0b91aa9680afb5738ed3e` (report commit will follow)
- Previous accounting Head (CI-green): `2ab87e6ed5ccc40925bdb6d20e90562a62626384`

## Implementation summary

PAY-V2-1B finishes safe reversal of posted receipt/payment vouchers.

Accounting core was already on the branch and passed full GitHub Actions CI on SQLite and PostgreSQL at `2ab87e6`. This completion exposed `POST /api/payments/{id}/reverse` with existing `payments.manage` and added focused API / RBAC / tenant / branch / period-lock coverage.

What this completion added:

- `POST /api/payments/{id}/reverse` using the same protection stack as other payment mutations (`ForceJsonResponse`, Sanctum, user principal, tenant, branch, active subscription, `payments.manage`).
- Focused API/RBAC tests for authorized reverse, 403 without `payments.manage`, response metadata, double-reverse rejection, and draft-only mutation protections on a reversed voucher.
- Focused tenant and active-branch isolation negatives, including proof that reversal copies the original stored journal and does not reroute from the caller’s current cash/bank defaults.
- Focused period-lock regression through existing `LedgerService::reverse()` / `AccountingDateGuard` behavior.
- Removal of the temporary API-integration note and interim report.
- This report as the final documentation file.

## Changed files

Accounting / model / resource (already on `2ab87e6`):

- `app/Services/Accounting/PaymentReversalService.php`
- `app/Models/Payment.php`
- `app/Http/Resources/PaymentResource.php`
- `app/Http/Controllers/Api/PaymentController.php` (`reverse` action)
- `database/migrations/2026_09_11_190000_add_reversal_lifecycle_to_payments.php`
- `tests/Feature/PaymentReversalTest.php`
- `tests/Feature/SupplierPaymentTest.php`

Integration / hardening (this completion):

- `app/Providers/TenancyServiceProvider.php` — registers `POST api/payments/{id}/reverse`
- `tests/Feature/PaymentReversalApiTest.php`
- `tests/Feature/PaymentReversalTest.php` — period-lock failure leaves state unchanged
- `docs/plans/payments/AWJ_PAY_V2_1B_IMPLEMENTATION_REPORT.md`

Removed:

- `docs/plans/payments/PAY-V2-1B-NOTE.md`
- `docs/plans/payments/PAY-V2-1B-IMPLEMENTATION-REPORT.md`

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
- Cross-tenant Payment id cannot be shown or reversed (404).
- A Payment stamped to another branch is not visible under the caller’s active `X-Branch-Id` and cannot be reversed from that branch (404).
- Successful reverse from the Payment’s own branch still uses the original journal routing, even after the tenant’s main cash account is changed.
- No new RBAC permission and no change to tenant/branch middleware.

## Focused tests and exact results

Pending the completion CI run on this Head. Intended focused set:

- `php artisan test --filter=PaymentReversalTest`
- `php artisan test --filter=PaymentReversalApiTest`
- `php artisan test --filter=SupplierPaymentTest`

Existing accounting tests at Head `2ab87e6` already passed full CI on SQLite and PostgreSQL.

## Full CI results for SQLite and PostgreSQL

Already verified on previous Head `2ab87e6ed5ccc40925bdb6d20e90562a62626384`:

- `php artisan test (L11, sqlite)` — success — https://github.com/safwan5001-source/Nebrax/actions/runs/34623933095
- `php artisan test (L11, pgsql)` — success — https://github.com/safwan5001-source/Nebrax/actions/runs/34623933095

Completion CI is running on later commits; this section will be treated as PASS only after those jobs succeed.

## Build / CI status

- Merge: **NOT MERGED**
- Deploy: **NOT DEPLOYED**
- Draft PR #763 remains open.

## Risks and remaining work

- No UI for reverse. Operators can only reverse through the API until a later scoped UI task.
- The reverse route is registered from `TenancyServiceProvider` with the same mutation guards as other payment writes. Moving the one-line registration into `routes/api.php` beside `POST payments/{id}/post` is a documentation/placement cleanup only and does not change behavior.
- `cancelled` remains in the status contract; this task does not introduce a cancel flow.
- Classification update on a reversed voucher is unchanged existing behavior and was not redesigned here.
- Duplicate of a reversed voucher still creates a new draft without allocations (existing `PaymentService::duplicate` contract).
- PAY-V2-2, gateways, fees, surcharge, VAT/ZATCA, Store checkout, POS, allocation redesign, and LedgerService refactors stay out of scope.

## Next recommended step

Safwan review of draft PR #763 after completion CI is green. Do not merge or deploy without explicit approval.

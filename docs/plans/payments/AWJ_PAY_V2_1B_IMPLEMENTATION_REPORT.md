# AWJ PAY-V2-1B — Implementation Report

Status: **BLOCKED ON CANONICAL ROUTE PLACEMENT — NOT MERGED — NOT DEPLOYED**

The accounting implementation and tests remain accepted. This report covers the review-required route-placement correction only.

## Identifiers

- Repository: `safwan5001-source/Nebrax`
- Branch: `feat/pay-v2-1b-payment-reversal`
- PR: [#763](https://github.com/safwan5001-source/Nebrax/pull/763) (draft, open, not merged)
- Base SHA: `e33b52ef353d4d1e85b6dba847056ead963ddf1e`
- Current PR #763 Head SHA: `258c1c8c47d499866ce2ff1f34b888f3c0a10d82`
- Last verified implementation Head (full CI green, pre-correction): `c402707ea12bfcc389fb01f4e9fa88d8854da631`
- Previous accounting Head (also CI-green): `2ab87e6ed5ccc40925bdb6d20e90562a62626384`
- Route-placement restore prepared on: `copilot/featpay-v2-1b-payment-reversal` @ `3deebdd6f298a38efa97b5d2bd3a407d8ac75a2e`
- Restore vehicle PR (into the feature branch, not `main`): [#764](https://github.com/safwan5001-source/Nebrax/pull/764)

## What this correction intended

1. Remove PAY-V2-1B route registration and all route-only imports from `app/Providers/TenancyServiceProvider.php`.
2. Register `POST payments/{id}/reverse` in `routes/api.php` immediately beside `POST payments/{id}/post`, using existing `payments.manage`.
3. Change no accounting logic, tests, permissions, middleware semantics, schema, or scope.

## What is actually on GitHub now

### Done on PR #763

- `app/Providers/TenancyServiceProvider.php` restored to the main/canonical provider (blob `816325767da1f08dcf746c4815c6823fdc8561d9`).
- No `PaymentController` import, no `Route` facade, no payment middleware stack, no `POST api/payments/{id}/reverse` in the provider.
- Accounting services, controller `reverse` action, tests, and schema were not modified.

### Blocker on PR #763 Head `258c1c8`

- `routes/api.php` on this Head is **not** the canonical file. It was overwritten to the placeholder text `see-local-file-too-large` while attempting to upload the 143 KB route file through the GitHub file connector.
- Consequence: PR #763 Head cannot boot the API route table. Do not merge or deploy this Head.

### Prepared correct file (not yet on #763 Head)

On `copilot/featpay-v2-1b-payment-reversal` @ `3deebdd6`:

```php
Route::post('payments/{id}/post', [PaymentController::class, 'post'])->middleware($perm('payments.manage'));
Route::post('payments/{id}/reverse', [PaymentController::class, 'reverse'])->middleware($perm('payments.manage'));
```

Verified: file length 1272 lines / 134780 chars; reverse line is immediately after post; remainder matches the last good canonical `routes/api.php`.

PR #764 is based on the feature branch and contains only `routes/api.php`. GitHub returned `403 Merging stacked PRs via this endpoint is not supported` when merging #764 into `feat/pay-v2-1b-payment-reversal` through the connector.

## Changed files (correction attempt)

On `feat/pay-v2-1b-payment-reversal`:

- `app/Providers/TenancyServiceProvider.php` — route registration and route-only imports removed. **Correct.**
- `routes/api.php` — currently damaged on #763 Head. **Must be replaced from `3deebdd6`.**

On `copilot/featpay-v2-1b-payment-reversal`:

- `routes/api.php` — restored + one reverse route. **Correct content. Not on #763 Head yet.**

Accounting / tests unchanged in this correction.

## Tests / CI

- Focused reversal/API tests were **not** re-run against #763 Head `258c1c8` because `routes/api.php` is invalid.
- Last full green CI remains Head `c402707e` run [34627929738](https://github.com/safwan5001-source/Nebrax/actions/runs/34627929738) (SQLite + PostgreSQL).
- CI started on the intermediate broken commits was cancelled.
- After `routes/api.php` from `3deebdd6` is on #763, run focused `PaymentReversalTest` + `PaymentReversalApiTest` + `SupplierPaymentTest`, then full SQLite + PostgreSQL CI.

## Accounting / security / tenant-isolation impact

- None intended and none implemented in this correction.
- Posted-voucher immutability, `LedgerService::reverse()` on the stored `journal_entry_id`, allocation recompute, period locks, tenant/branch isolation, and `payments.manage` are unchanged.

## Risks / unresolved

1. **PR #763 Head is unsafe until `routes/api.php` is restored.**
2. Connector cannot replace the 143 KB `routes/api.php` in one Contents-API call from this environment, and cannot merge stacked PR #764 into the feature branch.
3. Accidental placeholder commits exist in #763 history (`27c95bb`, `f523fe0`). They should be superseded by the restore commit, not left as Head.
4. A short-lived size-probe file was added and deleted (`aa87b3c` / `258c1c8`). No probe file remains.

## Required next step (Safwan)

From the feature branch, take the already-verified file from the Copilot branch. Do **not** merge #763 or #764 into `main`.

```bash
git fetch origin
git checkout feat/pay-v2-1b-payment-reversal
git checkout origin/copilot/featpay-v2-1b-payment-reversal -- routes/api.php
git add routes/api.php
git commit -m "fix(pay-v2-1b): restore routes/api.php and register POST payments/{id}/reverse"
git push origin feat/pay-v2-1b-payment-reversal
```

Then run focused reversal/API tests and full SQLite + PostgreSQL CI on the new Head. Close #764 after the file is on #763.

Do not merge. Do not deploy.

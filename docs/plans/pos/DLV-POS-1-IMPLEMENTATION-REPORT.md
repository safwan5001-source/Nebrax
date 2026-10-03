# DLV-POS-1 — Manual Delivery Platform Selection

**Task:** DLV-POS-1
**Branch:** `feat/dlv-pos-1-manual-platform-selection`
**Base SHA:** `83635d648732a3262c23e3bc0de49f3a88d64d81` (`origin/main` after PR #1186; includes merged PR #1193 at `3a94eb36635208e33acc4dbd90572140c47e7e4c`)
**Head SHA:** the PR head. This file cannot embed its own commit hash.
**Merge:** not merged. **Deploy:** not deployed.

## Evidence map (before the edit)

| Authority | What it already did |
|---|---|
| `PosService::checkout` | Posts a credit invoice through `InvoiceService`, then tenders through `PaymentService`. Price comes from `PosCustomerPriceListResolver` for the invoice customer. Idempotency is `PosCheckoutAttempt.request_checksum`. |
| `DeliveryPlatformConfigService::resolve` | Branch-effective collection mode, reference policy, version, and channel. |
| `DeliveryInvoiceContextService::record` | Pins that resolution on a posted invoice. Rejects a new `platform_collected` context once the invoice is already paid. |
| `PaymentService::post` | If `delivery_platform_profile_id` is set, debits `platform_receivable_clearing` and requires a matching platform-collected context. Cash/bank payments cannot bypass that context. |
| `PosSessionService::cashMovement` | Expected cash is posted session payments with `method = cash` only. Non-cash expected rows are every other posted session payment. |
| POS routes | Checkout is `invoices.manage` + `sales.pos`. No new permission was required. |
| Logos | `logo_asset_key` is an opaque string. No licensed logo bytes are in the repo. |

No contradiction with the accepted decisions. DG-4 was not reopened: the platform clearing payment is not attached to `pos_session_id`, so existing close math does not count it as cash or card. `PosSessionService` was not changed. FLOWERS H1 on the new base does not touch POS or delivery accounting.

## What changed

An authorized cashier can optionally select one active delivery platform on the current branch. The browser sends `delivery_platform_profile_id` and, when the policy allows, `external_order_reference`. It cannot send collection mode, version, GL account, commission, or tax treatment.

The server resolves the profile in the current tenant and the session branch, pins `DeliveryInvoiceContext`, and:

- `platform_collected`: one clearing receipt for the invoice total. No cash, no bank, no drawer expectation.
- `merchant_collected`: the existing tender path, including multi-tender.
- no selection: the previous checkout payload and checksum, unchanged.

`Invoice.partner_id` stays the POS customer. Price resolution is untouched.

## Files

- `app/Services/Accounting/PosService.php`
- `app/Http/Controllers/Api/PosController.php`
- `app/Http/Requests/StorePosSaleRequest.php`
- `routes/api.php`
- `tests/Feature/PosDeliveryPlatformCheckoutTest.php`
- `web/src/components/pos/pos-delivery-platform-picker.tsx`
- `web/src/components/pos/pos-payment.tsx`
- `web/src/components/pos/pos-payment.test.tsx`
- `web/src/app/(pos)/pos/page.tsx`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`
- `docs/autonomous-engineering/TASK-QUEUE.md`
- `docs/autonomous-engineering/CURRENT-STATE.md`

## Accounting

Gross invoice is still the canonical sale. Platform-collected POS posts `Dr platform_receivable_clearing / Cr accounts receivable` through `PaymentService`. Merchant-collected POS posts the normal cash/bank receipts. No commission, fee, or tax-point document.

## POS UX

The selector sits on the payment step. The platform name is always visible. There is no remote logo and no emoji: the repo has no approved logo asset, so the tile is a neutral monogram. Selecting a platform does not reprice the cart. A platform-collected sale hides cash/card entry. RTL, focus rings, and the existing density are kept.

## Isolation and idempotency

Tenant scope hides a foreign profile. The same generic refusal is used for inactive, disabled, deactivated version, and mismatched channel chains. The branch used is the session branch, not a client `branch_id`. A branch override changes only that branch's derived collection mode. The checksum includes the profile and the normalized reference when either is present, and omits both when absent so an ordinary retry from before this change still matches. The same key replays one invoice, one context, one payment, and one stock effect. A different platform or reference on that key is 409.

## Tests

Focused suite: `tests/Feature/PosDeliveryPlatformCheckoutTest.php` (ordinary sale, platform clearing, merchant multi-tender, branch override, fail-closed references, idempotent retry, conflicts, unchanged price, historical pin, existing POS authorization, rejected client collection mode).

Frontend: `web/src/components/pos/pos-payment.test.tsx` covers a platform-collected confirm with an empty tender list.

SQLite and PostgreSQL are the CI matrix (`php artisan test`). This sandbox has no PHP runtime, so those results are the exact-head CI jobs, not a local claim. Frontend `web-ci` covers the Vitest file.

## Review

Implementer pass: no second price path, no new permission, no Hub, no commission, clearing payment kept off the drawer. No Decision Gate opened.

PRE_MERGE_REVIEW: NOT RECORDED until the exact Head SHA is green and this review is repeated against that SHA.

## Remaining

- DG-9-HUB and DG-6-TRIGGER stay open. Do not start DLV-HUB-1.
- Official platform logos are still an asset gap.
- DLV-COMMISSION-1 and DLV-SETTLEMENT-1 stay blocked on DG-3.
- Next Horizon task after merge, not started here: not DLV-HUB-1. The queue does not promote a hub slice.

## Decision Gates

None. DG-4 was avoided rather than decided: close/Z-report code was not changed.

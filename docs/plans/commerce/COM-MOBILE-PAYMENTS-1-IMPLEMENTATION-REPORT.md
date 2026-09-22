# COM-MOBILE-PAYMENTS-1 — Implementation Report

**ADR:** `ADR-09-COMMERCE-PAYMENT-INTENT-V1-SCOPE.md` (Accepted — Owner Decision, 2026-09-22), implementing `ADR-04-PAYMENT-INTENT-CAPTURE-REFUND.md` (Accepted, architecture-only, 2026-09-09)
**Branch:** `claude/com-mobile-payments-1`

## Outcome

Implements ADR-04's `Commerce Order → Payment Intent → Provider Attempt →
Successful Settlement → AWJ Payment Core` boundary for the first time,
bounded exactly to ADR-09's V1 scope: `cod`/`pay_on_pickup` only, no
provider/PSP, no parallel ledger.

## Repository evidence / root cause

- No `CommercePaymentIntent` model, table, or service existed anywhere in
  the repository before this task — `CommerceOrder`'s completion recorded
  no payment-related fact at all beyond the order's own `total`.
- `PaymentMethodChannelAvailabilityService::isAvailable()` already existed
  (tenant-scoped, backward-compatible fallback to `$method->available_online`
  when no explicit per-channel policy row exists) but was never consumed by
  any Commerce checkout path — ADR-09 §3 required wiring it in unchanged.
- `CashBankAccountService::bootstrapDefaults()` seeds every tenant's
  default `PaymentMethod` rows (نقدي/تحويل بنكي/شيك/بطاقة ائتمان) with
  `available_online => false` — confirmed by reading the seeder directly.
  This meant no tenant has any payment method available online by default,
  which drove the critical design decision below.

## Approach chosen

1. **`CommercePaymentIntent` model** (`CompanyWide`, mirrors `CommerceOrder`'s
   own classification since it has no branch of its own — Commerce's
   isolation boundary is the sales channel, ADR-03 §1) + `CommercePaymentIntentService`,
   the sole authority for creating/transitioning intents.
2. **`method` derivation** — `cod`/`pay_on_pickup` are derived automatically
   from the order's `delivery_method` (`standard`/`pickup`), never a
   separate customer choice, since ADR-09 §1 scopes V1 to exactly these two
   methods and they already mirror the two existing delivery methods
   one-to-one.
3. **`payment_method_id` made optional, not required** — the critical design
   decision of this task. An initial implementation added a hard
   `CheckoutReviewRequiredException` gate requiring a selected method before
   completion. Running the broader Commerce regression showed **60 failed
   tests**: every tenant's default-seeded payment methods start
   `available_online = false`, so no tenant could complete a checkout at
   all under that gate. Reverted to an optional design: `payment_method_id`/
   `payment_method_name` stay `null` on the intent when none was ever
   selected, and completion succeeds regardless.
4. **`CommerceCheckoutService::updatePayment()`** (new) — validates the
   selected method is active and available for the checkout's channel via
   `PaymentMethodChannelAvailabilityService::isAvailable()`, mirroring
   `updateDelivery()`'s own validation pattern exactly.
5. **`createForOrder()` inside the order-creation transaction** — called
   from `CommerceCheckoutService::complete()` right after
   `CommerceOrderService::createFromCheckout()`, inside the same outer
   transaction (Laravel's savepoint semantics make this safe): no order is
   ever created without its matching Payment Intent.
6. **New routes, both `/commerce/v1` and `/store/v1`**: `GET
   payment-methods` (via `PaymentMethodChannelAvailabilityService::availableFor()`,
   new method added to the existing service) and `PATCH checkout/payment`.
   Internal-only `commerce/payment-intents` index/collect/cancel routes
   reuse the existing `payments.view`/`payments.manage` RBAC scope — no new
   permission scope invented.
7. **Storefront `PaymentStage`** — fully rewritten from its earlier
   `design_only` placeholder: renders the channel's real enabled methods as
   a genuine, selectable `RadioGroup`, or an honest empty state when none
   are enabled (the correct out-of-the-box default per point 3 above).
   Selecting a method is a real `PATCH`, matching every other checkout
   stage's save-per-stage discipline. `AwjCheckoutFlow` pre-selects a sole
   enabled method as a draft (still only saved on `saveAndAdvance()`).

## Why this fits AWJ

- **ADR-04 §5 respected**: a `CommercePaymentIntent` is always created
  `awaiting_collection`, never `collected`, at order creation — `collect()`
  is a separate, explicit transition.
- **ADR-04 §11 respected**: Payment/Order/Fulfillment/Invoice remain
  separate state dimensions — this task adds only the Payment dimension,
  touches no `CommerceOrder.status` semantics.
- **ADR-04 §13 respected**: no parallel ledger. `markCollected()` only
  transitions `CommercePaymentIntent.status` — no `LedgerService::post()`,
  no `Payment`/`PaymentAllocation` row, anywhere in this task.
- **ADR-09 §3 respected literally**: `PaymentMethodChannelAvailabilityService`
  is consumed exactly as it already existed (`isAvailable()`, plus one new
  read-only `availableFor()` helper following the same filtering logic) —
  no parallel availability policy invented.
- **Shared, not mobile-only**: `CommercePaymentIntentService` and the new
  routes are consumed identically by `/commerce/v1` and `/store/v1` via
  the same `CommerceCheckoutService`/`CommerceOrderSerializer` — no
  channel-specific copy.

## Changed files

- `database/migrations/2026_10_10_010000_add_payment_method_to_commerce_checkouts_table.php` (new)
- `database/migrations/2026_10_10_020000_create_commerce_payment_intents_table.php` (new)
- `app/Models/CommercePaymentIntent.php` (new)
- `app/Services/Commerce/CommercePaymentIntentService.php` (new)
- `app/Http/Controllers/Api/CommercePaymentIntentController.php` (new)
- `app/Models/CommerceCheckout.php` — `payment_method_id` fillable + `paymentMethod()` relation.
- `app/Models/CommerceOrder.php` — `paymentIntent()` relation.
- `app/Services/Commerce/CommerceCheckoutService.php` — constructor gains `PaymentMethodChannelAvailabilityService`/`CommercePaymentIntentService`; new `updatePayment()`; `complete()` creates the intent; `serialize()`/`emptyResponse()` gain a `payment` block; new `previewPaymentMethod()` helper.
- `app/Services/PaymentMethodChannelAvailabilityService.php` — new `availableFor(SalesChannel): Collection` method.
- `app/Support/CommerceOrderSerializer.php` — `payment` block added.
- `app/Http/Controllers/Api/CommerceCheckoutController.php`, `app/Http/Controllers/Api/StorefrontCheckoutController.php` — `paymentMethods()`/`updatePayment()` actions; order-block `payment` sub-object.
- `routes/api.php`, `routes/api_commerce.php`, `routes/api_storefront.php` — new routes.
- `tests/Feature/CommercePaymentIntentTest.php` (new, 19 tests)
- `tests/Feature/CommerceModuleBoundaryTest.php` — allow-listed the new routes.
- Storefront: `checkout-types.ts`, `checkout.ts`, `lib/data/awj-checkout.ts`, `capabilities.ts`, `PaymentStage.tsx`, `AwjCheckoutFlow.tsx`, `ReviewStage.tsx`, `Confirmation.tsx`, `account-preview.ts`, locale files (all 6), `AwjCheckoutFlow.test.tsx`, `PaymentStage.test.tsx` (rewritten).

## Tests and exact results

New file: `tests/Feature/CommercePaymentIntentTest.php` — 19 tests: intent
creation derives the correct method from delivery method and never marks
paid at creation, `collect`/`cancel` state machine including double-collect
and cancel-after-collect rejection, two atomicity tests proving a stale
in-memory intent instance cannot bypass the locked-row check, RBAC,
payment-methods listing (empty by default / shows an enabled method),
selecting an available method persists and completion snapshots its name,
selecting an unavailable method is rejected (422), a method disabled for
the channel after selection is rejected at completion, completion succeeds
with no method ever selected, and the empty-checkout response carries a
present-but-null `payment` shape.

- SQLite (`/home/user/nibras-app`): `CommercePaymentIntentTest` — **19
  passed** (84 assertions). Broader `Commerce|Customer|Storefront|
  BranchIsolationGuard` regression: **1001 passed**, 25 skipped
  (PostgreSQL-only concurrency tests), 0 failed (997 before the Codex
  review-round fixes below; +4 for the new regression tests).
- PostgreSQL (`/tmp/nibras-app-addresses1-pg`): same regression filter —
  **1011 passed**, 0 failed (1007 before the review-round fixes).
- Storefront: `pnpm test` (573 passed), `npx tsc --noEmit`, `pnpm check`
  (biome), `pnpm build`, `pnpm check:locales` — all green.
- Full `php artisan test` (unfiltered) was also run locally per the repo's
  pre-PR protocol; the sandbox this session ran in is missing the
  `bcmath` PHP extension (outbound package install blocked by the
  environment's network proxy), which fails 27 unrelated `Fuel*` tests
  (`Call to undefined function App\Services\bcmath()`) — confirmed
  pre-existing and untouched by this diff (`FuelCostBasisService.php` last
  changed in PR #854, unrelated to Commerce). CI runs on an environment
  with `bcmath` present and served as the authoritative full-suite gate.

## Self-review

- **Implementer**: the `payment_method_id`-required-vs-optional question
  was the main risk, caught only by running the broader regression (60
  failures) rather than the new test file alone — a lesson this report
  records explicitly: a new feature's own tests passing is not sufficient
  evidence when the feature changes a shared completion path.
- **Reviewer**: checked that `method` is genuinely derived (not client-
  supplied) by reading `createForOrder()`'s signature — it takes
  `deliveryMethod` and matches on it, no `method` parameter exists in any
  request the client can populate.
- **AWJ Guardian** (accounting/isolation discipline): confirmed via grep
  that no path in this task calls `LedgerService::post()` or
  `PaymentService::create()` — zero accounting impact, as ADR-09 §4
  explicitly permits for this pass. `CommercePaymentIntent` explicitly
  implements `CompanyWide` — required declaration, guarded by
  `BranchIsolationGuardTest` in CI. All money fields (`amount_minor`) are
  `bigint`-cast integers.

## Accounting impact

**None.** `markCollected()`/`cancel()` only transition
`CommercePaymentIntent.status` — no `LedgerService::post()` call, no
`Payment`/`PaymentAllocation` row, created or modified by any code path in
this task. ADR-09 §4 explicitly makes real ledger/`PaymentService`
integration for collection optional for this pass; wiring `collect()` to a
real receipt needs a separate decision on how Commerce's `CustomerIdentity`
maps onto the current partner-centric payment engine (`PaymentService::create()`
requires `partner_id`) — recorded as discovered backlog below, not a
blocking gap.

## Tenant/branch isolation

Unaffected/extended safely. `CommercePaymentIntent` is `CompanyWide`
(tenant-scoped automatically via `BaseModel`), matching its parent
`CommerceOrder`. No `branch_id` — Commerce's isolation boundary is the
sales channel (ADR-03 §1), not the branch.

## Security

`resolvePaymentMethod()` re-validates both `is_active` and channel
availability at the point a method is attached to an intent (not just at
selection time) — closing a Codex-found gap where a method valid when
selected could be disabled for the channel before checkout completion.
`markCollected()`/`cancel()` lock the row (`lockForUpdate()`) and re-check
its status from that locked read inside a transaction, closing a real
concurrency hole where two requests (or the same stale caller-held
instance reused twice) could each pass a stale in-memory check.

## Backward compatibility

Fully preserved: completing a checkout with no payment method ever
selected succeeds exactly as before this task, with the intent's
`payment_method_id`/`payment_method_name` left `null`. No existing route,
field, or response shape was removed or renamed — all additions are
additive (`payment_method_id` nullable column, `payment` response block).

## API/DB impact

Additive only: two new tables/columns (`commerce_payment_intents`,
`commerce_checkouts.payment_method_id`), one new `payment` field in three
existing (already-versioned) response shapes (checkout show, checkout
complete, order detail), and five new routes (two public read/write pairs
on `/commerce/v1`+`/store/v1`, three internal on `api/commerce/payment-intents`).
No existing field removed or renamed, no existing route's shape changed.

## External research

None required — ADR-09 already resolved the method/provider scope
question (COD/Pay on Pickup only, no vendor).

## Automated review findings

One round of automated (Codex) review on PR #940, all three findings
verified and fixed before merge:
1. **P2 — Revalidate channel availability at completion**: a method valid
   when selected could be disabled for the channel (`setAvailability()`)
   before checkout completion; `createForOrder()`'s `resolvePaymentMethod()`
   checked only `is_active`. Fixed by re-checking
   `PaymentMethodChannelAvailabilityService::isAvailable()` against the
   order's `salesChannel` at completion too — a stale selection now fails
   closed (422) rather than silently attaching.
2. **P1 — Make payment-intent transitions atomic**: `markCollected()`/
   `cancel()` checked the status on the caller-passed `$intent` instance,
   which `update()` never refreshes (it mutates a separately-queried row).
   Two concurrent requests, or the same stale instance reused twice, could
   each pass the stale in-memory check and both write. Fixed by wrapping
   both methods in `DB::transaction()` with `lockForUpdate()` + a re-query
   by id before checking status.
3. **P2 — Keep empty checkout responses compatible with the payment
   shape**: `CommerceCheckoutService::emptyResponse()` (used when `GET
   checkout` is called before one exists) omitted the `payment` key
   entirely, while the frontend's `StorefrontCheckout`/`StorefrontOrder`
   types now treat it as always present — the mapper would read
   `payment.payment_method_id` off `undefined` and throw. Fixed by adding
   the null-valued `payment` shape to `emptyResponse()`.

All three fixes are included in PR #940's merged history, each with a
dedicated regression test (see Tests section above).

## Risks / remaining work

- No real settlement integration: `collect()`/`cancel()` only move
  `CommercePaymentIntent.status` — this is intentional per ADR-09 §4, not
  an oversight, but it means no actual cash/bank record is created when a
  driver collects a COD payment. Discovered backlog below.
- Provider/PSP selection remains open (ADR-09's own explicit
  non-decision) — a future, separately gated task.

## Discovered backlog

- **Real ledger/`PaymentService` integration for `collect()`**: requires a
  separate decision on how Commerce's `CustomerIdentity` (not necessarily
  a `Partner`) is represented in the current partner-centric payment
  engine (`PaymentService::create()` requires `partner_id`). ADR-09 §4
  explicitly authorized deferring this for V1; recording it here as the
  concrete next step once that representation question is resolved.

## Git state

Branch `claude/com-mobile-payments-1`, based on `main` at `5980ee4` (post
PR #937 merge). Pushed, reviewed (`PRE_MERGE_REVIEW: PASS` at Head SHA
`8218ee446995b46b3a5c66002c8d22590afe95de`, the branch's actual final
commit per `git log --oneline claude/com-mobile-payments-1`), and
squash-merged into `main` as a single commit with parent
`7ada1392eedc245ba0077de6391121adc51dfd25` (confirmed via `git log
--parents` — not assumed), **Merge SHA
`b025f363c218c58096c70dba0ff0d74a7c6e7093`**.

## POST_MERGE_REVIEW: PASS

Merge SHA: `b025f363c218c58096c70dba0ff0d74a7c6e7093`.

- **Target branch contains the change**: confirmed via `git fetch origin
  main` + `git branch -a --contains b025f36`, which lists
  `remotes/origin/main` — this commit is `origin/main`'s tip.
- **No unexpected integration change**: `git diff 8218ee4 origin/main --
  app database routes tests storefront` returns zero output — the
  squash-merged tree is byte-identical to the PR's final reviewed head for
  every changed path.
- **Required post-merge checks/workflows**: the push-to-`main` CI trigger
  re-ran on this exact SHA as its own independent workflow runs (not the
  PR's pre-merge check) and passed on all three required jobs: `php
  artisan test (L11, sqlite)` and `(L11, pgsql)` in run
  [35737658191](https://github.com/safwan5001-source/Nebrax/actions/runs/35737658191),
  and `Storefront CI` in run
  [35737658229](https://github.com/safwan5001-source/Nebrax/actions/runs/35737658229)
  — all three `conclusion: success`, `head_branch: main`, `head_sha:
  b025f363c218c58096c70dba0ff0d74a7c6e7093`, verified directly via the
  GitHub Actions API.
- **Targeted regression**: the zero-diff check above already establishes
  that the pre-merge regression evidence (1001 passed SQLite / 1011 passed
  PostgreSQL, 0 failed) applies unchanged to the merged tree — no further
  re-run was needed beyond the post-merge CI confirmation itself.

## Recommended next task

`COM-MOBILE-VERTICAL-TEST-1` (`ADR-13`, partial scope only) is the one
remaining `ready` row in this horizon. Per ADR-13's own incremental-
extension instruction, it should now incorporate both Shipping and
Payments into its end-to-end verification — the full vertical slice
remains not-done until both land, and both have now landed.

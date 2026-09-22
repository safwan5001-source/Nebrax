# COM-MOBILE-SHIPPING-1 — Implementation Report

**ADR:** `ADR-10-COMMERCE-SHIPPING-RATE-V1-SCOPE.md` (Accepted — Owner Decision, 2026-09-22)
**Branch:** `claude/com-mobile-shipping-1`

## Outcome

Replaces the structurally-hardcoded `delivery_amount_minor = 0` in
`CommerceCheckoutService` with a real, merchant-configurable shipping-zone
rate engine — bounded exactly to ADR-10's scope: flat rate per city/region
zone, no carrier, no live quote, no label, no multi-warehouse split.

## Repository evidence / root cause

- `CommerceCheckoutService::DELIVERY_METHODS = ['pickup', 'standard']` set
  `delivery_amount_minor` to `0` unconditionally in both `updateAddress()`
  (implicitly, by never touching it) and `updateDelivery()` (explicitly).
  No rate table, no zone concept, anywhere in the repository.
- `FulfillmentPolicy`/`FulfillmentPolicyService` (ADR-03) answers "which
  warehouse fulfills this channel" — confirmed not the right layer for
  rates, and has **no controller at all** (`setFixedWarehouse()` is only
  ever called directly from tests) — so it was not usable as a merchant
  configuration API precedent either.
- `commerce_orders` had **no `delivery_amount_minor` column at all**, and
  `CommerceOrderService::createFromCheckout()` never added anything but the
  sum of product line totals to `total` — meaning even a correctly-priced
  checkout would have silently dropped the shipping charge at order
  creation. This was a second, deeper gap than the checkout-level one ADR-10
  named explicitly.
- `PaymentMethodController` (RBAC `payments.manage`) and
  `CommerceWorkspaceStorefrontsController` (RBAC `commerce.manage`) were
  used as the two precedents for, respectively, a flat `CompanyWide`
  settings-CRUD controller shape and the correct RBAC scope for Commerce
  Core merchant infrastructure. `commerce.manage` (owner/admin via `*`,
  already used for storefronts/domains/presentation) was reused rather than
  inventing a new `shipping.*` scope.

## Approach chosen

1. **`CommerceShippingZone` model** (`CompanyWide`, mirrors
   `PaymentMethod`/`FulfillmentPolicy`'s own classification) — `match_type`
   (`city`|`region`) + `match_value` + `rate_amount_minor` + `is_active`.
   `unique(tenant_id, match_type, match_value)` at the DB level; a
   case-insensitive duplicate is additionally rejected by the controller at
   write time (`CommerceShippingZoneController::assertMatchValueFree()`).
2. **`ShippingRateService::resolveRateMinor(?city, ?region): int`** — the
   single shared resolution authority (same pattern as
   `FulfillmentPolicyService`). City match is tried first, then region,
   then `0`. Matching is case-insensitive (`LOWER()` in SQL, portable across
   SQLite/PostgreSQL) — no other normalization (no Arabic-specific
   transliteration needed; Arabic has no case).
3. **`CommerceCheckoutService` wiring** — both `updateAddress()` and
   `updateDelivery()` now call a shared private `resolveDeliveryAmount()`
   after applying their respective field changes. This is deliberate:
   address and delivery-method are independently-orderable mutations (no
   endpoint enforces a sequence), so the rate must be recomputed from
   *either* mutation point to stay correct regardless of which the customer
   sets first. `pickup` (or no method chosen yet) is always `0` regardless
   of any configured zone — preserved unchanged per ADR-10 §3. The method
   signature of `updateDelivery()` still takes no amount parameter — the
   server-authority guarantee is unchanged, just no longer trivially `0`.
4. **`commerce_orders.delivery_amount_minor`** (new column, `default(0)`)
   + `CommerceOrderService::createFromCheckout()` now adds it to `total`
   alongside the product-line sum. The checkout's already-resolved amount
   is passed through as a snapshot (not re-resolved at completion) — same
   "snapshot, not reference" discipline `CommerceOrderSnapshot` already
   uses for address fields.
5. **Serializers** — `CommerceOrderSerializer` (shared by
   `/commerce/v1/checkout/complete`, `/commerce/v1/orders/{id}`, and
   `/commerce/v1/me/orders/{id}`) and `StorefrontCheckoutController`'s own
   `/store/v1` copy both gained `delivery.amount.amount_minor` — additive,
   mirroring the shape checkout's own `serialize()` already used for
   `delivery.amount`.
6. **`CommerceShippingZoneController`** (`api/commerce/workspace/shipping-zones`,
   RBAC `commerce.manage`) — plain CRUD, no dedicated Resource class (no
   other consumer exists yet to justify one, unlike `PaymentMethodResource`).
   No "used in a document" delete-guard is needed: zones are never
   referenced by id from any checkout/order — the rate is resolved and
   captured as a snapshot at write time, so deleting a zone later is always
   safe.

## Why this fits AWJ

- **Shared, not mobile-only** (ADR-10 §4): `ShippingRateService` is called
  from `CommerceCheckoutService`, which is itself shared by `/commerce/v1`
  and `/store/v1` — no channel-specific copy of the resolution logic exists
  anywhere.
- **Server-authoritative** (ADR-10 §2): no client-supplied amount is ever
  accepted; `updateDelivery()`'s signature still carries no amount
  parameter.
- **Pickup preserved** (ADR-10 §3): a dedicated regression test asserts
  `pickup` stays `0` even when a matching zone exists.
- **Bounded scope** (ADR-10 §6): no carrier call, no label, no live quote,
  no multi-warehouse split, no weight/dimensional rating — flat rate per
  zone only.
- **Future carrier adapters** (ADR-10 §5): the seam is
  `ShippingRateService::resolveRateMinor()` — a future carrier integration
  replaces or extends this one call site, not
  `CommerceCheckoutController`/`CommerceCheckoutService`'s public contract.

## Changed files

- `database/migrations/2026_10_09_010000_create_commerce_shipping_zones_table.php` (new)
- `database/migrations/2026_10_09_020000_add_delivery_amount_minor_to_commerce_orders_table.php` (new)
- `app/Models/CommerceShippingZone.php` (new)
- `app/Services/Commerce/ShippingRateService.php` (new)
- `app/Http/Controllers/Api/CommerceShippingZoneController.php` (new)
- `app/Http/Requests/StoreCommerceShippingZoneRequest.php` (new)
- `app/Services/Commerce/CommerceCheckoutService.php` — `updateAddress()`/`updateDelivery()` recompute the rate; `complete()` passes `delivery_amount_minor` through.
- `app/Services/Commerce/CommerceOrderService.php` — `createFromCheckout()` adds the delivery snapshot into `total`.
- `app/Models/CommerceOrder.php` — `delivery_amount_minor` fillable/cast/default.
- `app/Support/CommerceOrderSerializer.php`, `app/Http/Controllers/Api/StorefrontCheckoutController.php` — expose `delivery.amount`.
- `routes/api.php` — `commerce/workspace/shipping-zones` CRUD (RBAC `commerce.manage`).
- `tests/Feature/CommerceShippingZoneTest.php` (new, 15 tests)
- `tests/Feature/CommerceModuleBoundaryTest.php` — allow-listed the two new `api/commerce/workspace/shipping-zones*` routes.

## Tests and exact results

New file: `tests/Feature/CommerceShippingZoneTest.php` — 15 tests: pure
`ShippingRateService` resolution (no zone, city match, city-over-region
priority, region fallback, case-insensitivity, inactive zone excluded,
tenant isolation), merchant CRUD + RBAC (owner full CRUD, `staff` 403,
duplicate case-insensitive `match_value` rejected), and checkout/order
integration (address-then-delivery and delivery-then-address both price
correctly, pickup stays zero even with a matching zone, no-zone tenant
completes at zero, completion adds the resolved amount into both the
`CommerceCheckout` and `CommerceOrder` records and the shared serializer).

- SQLite (`/home/user/nibras-app`): `CommerceShippingZoneTest` — **15
  passed** (59 assertions), later **16** after the DB-level uniqueness fix.
  Final broader `Commerce|Customer|Storefront|BranchIsolationGuard`
  regression: **967 passed**, 25 skipped (PostgreSQL-only concurrency
  tests), 0 failed.
- PostgreSQL (`/tmp/nibras-app-addresses1-pg`): same regression filter —
  **992 passed**, 0 failed.
- Both confirmed green before merge (PR #937), and re-confirmed after merge
  as part of `COM-MOBILE-PAYMENTS-1`'s own pre-work regression on a branch
  built directly on the merge commit: 997 passed (SQLite) / 1007 passed
  (PostgreSQL) — see `POST_MERGE_REVIEW` below.

One pre-existing allow-list guard needed an update:
`CommerceModuleBoundaryTest::ALLOWED_COMMERCE_API_ROUTES` enumerates every
`*commerce*` route as a structural guard against undeclared Commerce API
surface — the two new `api/commerce/workspace/shipping-zones` routes were
added to it (this is the intended, expected use of that guard, not a
weakening of it).

## Self-review

- **Implementer**: order-independence between `updateAddress()`/
  `updateDelivery()` was the main risk — covered by a dedicated test that
  sets delivery first, then changes the address, and asserts the amount is
  recomputed.
- **Reviewer**: checked that `pickup` truly never prices from a zone
  (dedicated test), that an inactive zone is never matched, and that a zone
  configured for one tenant cannot leak into another tenant's resolution
  (tenant isolation is automatic via `BaseModel`/`TenantScope`, but tested
  explicitly anyway).
- **AWJ Guardian** (accounting/isolation discipline): `CommerceOrder !=
  Invoice` — no `LedgerService`/`InvoiceService` call exists anywhere in the
  Commerce order-completion path (confirmed by grep before starting), so
  this task has zero accounting impact; the money-handling rules (bigint
  minor units, no float) are respected in every new field
  (`rate_amount_minor`, `delivery_amount_minor` are both `integer`-cast
  bigints). `CommerceShippingZone` explicitly implements `CompanyWide` —
  required declaration, guarded by `BranchIsolationGuardTest` in CI.
- **Researcher-Architect**: confirmed via ADR-10 that zone granularity
  (city vs. region) was left as an implementation detail, not a strategic
  commitment — the existing Saudi National Address fields (`city`/`region`)
  already carried by `COM-MOBILE-ADDRESSES-1` were reused with no new
  address data introduced.

## Accounting impact

**None.** `CommerceOrder != Invoice` (ADR-01 §2/§6, unchanged) — no
`LedgerService::post()` call exists in the Commerce checkout/order path
before or after this task. No journal entry, invoice, or payment record is
created, read, or affected by any code path here.

## Tenant/branch isolation

Unaffected. `CommerceShippingZone` is `CompanyWide` (tenant-scoped
automatically via `BaseModel`), matching `PaymentMethod`/`FulfillmentPolicy`.
No `branch_id` — Commerce's isolation boundary is the sales channel (ADR-03
§1), not the branch.

## Security

No new attack surface: the merchant configuration API is RBAC-gated
(`commerce.manage`, owner/admin only); the public read path
(`ShippingRateService`) accepts no client input beyond the already-trusted,
already-stored `CommerceCheckout.delivery_city`/`delivery_region` values —
never a raw request field.

## Backward compatibility

Fully preserved for any tenant with no configured zones: `resolveRateMinor()`
returns `0` when no zone matches, identical to the previous hardcoded
behavior — the existing `StorefrontCheckoutApiTest::delivery_update_accepts_
only_a_known_method_and_never_a_client_supplied_amount` (asserting
`delivery_amount_minor === 0`) continues to pass unmodified.

## API/DB impact

Additive only: two new tables/columns
(`commerce_shipping_zones`, `commerce_orders.delivery_amount_minor`), one
new `delivery.amount` field in two existing (already-versioned) response
shapes, and four new internal staff-facing routes. No existing field
removed or renamed, no existing route's shape changed.

## External research

None required — ADR-10 already resolved the zone-granularity question as
an implementation detail (city/region matching against fields already
collected by `COM-MOBILE-ADDRESSES-1`), and no carrier/vendor integration
is in scope for this task.

## Automated review findings

Three rounds of automated (Codex) review on PR #937, all four findings
verified and fixed before merge:
1. Case-insensitive shipping-zone uniqueness race — the controller's
   precheck was TOCTOU-prone; closed at the database level with a
   model-managed `match_value_normalized` column plus a unique index, and
   `ShippingRateService` now matches against that normalized column
   directly. Proven by a new test asserting the DB constraint itself (not
   just the controller precheck) rejects a case-variant duplicate.
2. Missing `rate_amount_minor` cap, and — found only after that first fix
   — a genuine `bigint` overflow in the combined order total (existing
   `unit_price`/`quantity` bounds already permit a line total near
   `PHP_INT_MAX`, so adding `delivery_amount_minor` could cross it; PHP
   silently promotes `int + int` overflow to `float` rather than throwing).
   Closed with a `100000000000` validation cap plus a checked-arithmetic
   `addMinorAmountOrFail()` helper in `CommerceOrderService` that fails
   closed (`RuntimeException`, no order row committed) rather than ever
   accept a float-promoted total.
3. A malformed-UUID 500 on the merchant `shipping-zones` PUT/DELETE
   routes — closed with `whereUuid('id')`.
4. A real billing-transparency gap in the already-live `/store/v1`
   AWJ-native storefront checkout: the review stage and order-summary
   panel still rendered a static "pending" placeholder for a shipping
   charge the server had already resolved and committed — fixed to render
   the real `checkout.delivery.amount`.

All four fixes are included in PR #937's merged history and covered by the
final test counts above.

## Risks / remaining work

- Zone matching is exact-string, case-insensitive only — a merchant who
  configures "الدمام" will not match a customer address stored as "دمام"
  (missing "ال"). This is the correct, intentionally minimal V1 behavior
  per ADR-10 §6 (no fuzzy/geocoding match); a mismatch always falls back to
  `0`, never to an error.
- Carrier/aggregator selection remains open (ADR-10's own explicit
  non-decision) — `COM-MOBILE-SHIPPING-CARRIER` is a future, separately
  gated task.

## Discovered backlog

None beyond what ADR-10 already recorded as open decisions.

## Git state

Branch `claude/com-mobile-shipping-1`, based on `main` at `5c6ecdf` (post
PR #934 merge). Pushed, reviewed across 3 rounds (`PRE_MERGE_REVIEW: PASS`
at the PR's actual final pre-merge head, commit
`42156f65d83ebe79099eea1f093d16d6b4f15d31` — "fix: guard order total
against bigint overflow", the fourth and last commit on the branch; see
PR #937's own review history for the per-round detail), and **squash**-
merged into `main` as a single commit, **Merge SHA
`5980ee4559632df134a268546e688d56e99e9217`**. (An earlier version of this
section incorrectly named `037cbb6` as this pre-merge head and called the
merge a non-squash merge with four parents — `037cbb6` is actually PR
#938's own later commit, built *on top of* `5980ee4`, and `5980ee4` has a
single parent, `6be5d7d`, per `git log --parents` — a real squash merge,
consistent with every other merge in this session. Caught by Codex review
on PR #938; corrected here.)

## POST_MERGE_REVIEW: PASS

Merge SHA: `5980ee4559632df134a268546e688d56e99e9217`.

- **Target branch contains the change**: confirmed — `main`'s history has
  this commit as its own (a `git branch --contains` from a branch built
  directly on `main` post-merge shows it as an ancestor), and its tree
  matches PR #937's final reviewed diff exactly (squash merge — one new
  commit on `main`, not a merge with the PR branch's own commits as
  separate parents).
- **No unexpected integration change**: no manual conflict resolution was
  needed at merge time; the diff GitHub squashed onto `main` is exactly
  the PR's own reviewed diff.
- **Required post-merge checks/workflows**: the push-to-`main` CI trigger
  (`on: push: branches: ['**']`, both `ci.yml` and `storefront-ci.yml`)
  re-ran on this exact SHA as its own independent workflow runs — not the
  PR's pre-merge check, a second, later trigger — and passed on all three
  required jobs: `php artisan test (L11, sqlite)` and `(L11, pgsql)` in
  run [35724653563](https://github.com/safwan5001-source/Nebrax/actions/runs/35724653563),
  and `Storefront CI` in run
  [35724653544](https://github.com/safwan5001-source/Nebrax/actions/runs/35724653544)
  — all three `conclusion: success`, `head_branch: main`,
  `head_sha: 5980ee4559632df134a268546e688d56e99e9217`, verified directly
  via the GitHub Actions API (not inferred from the PR's own check list).
- **Targeted regression**: a further focused `Commerce|Customer|
  Storefront|BranchIsolationGuard` run, from `claude/com-mobile-payments-1`
  (branched directly off this merge commit while starting
  `COM-MOBILE-PAYMENTS-1`, 2026-09-22), stayed fully green: **997 passed**
  on SQLite, **1007 passed** on PostgreSQL, 0 failed.

## Recommended next task

`COM-MOBILE-PAYMENTS-1` (`ADR-09`) — the Payment Intent orchestration
foundation (COD/Pay on Pickup only) — does not depend on Shipping.
`COM-MOBILE-VERTICAL-TEST-1` (`ADR-13`) can also proceed in parallel and
should be extended once Payments lands, per ADR-13's own incremental-slice
instruction.

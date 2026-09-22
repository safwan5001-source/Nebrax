# COM-MOBILE-VERTICAL-TEST-1 — Implementation Report

**ADR:** `ADR-13-COMMERCE-MOBILE-VERTICAL-SLICE-PARTIAL-SCOPE.md` (Accepted — Owner Decision, 2026-09-22)
**Branches:** `claude/com-mobile-vertical-test-1` (1/3), `claude/com-mobile-vertical-test-1-guest-journey` (2/3), `claude/com-mobile-vertical-test-1-auth-journey` (3/3) — a stacked PR chain, per owner decision (see Scope/split decision below).

## Outcome

Closes ADR-13's partial-scope deliverable: a machine-checked `/commerce/v1`
OpenAPI 3.1 contract (§3) plus two continuous, composition-proving journey
tests (§2) — guest (catalog → cart → checkout → order → signed guest order
lookup) and authenticated (auth → catalog → cart identity claim → saved
address → checkout → order → order history) — both now incorporating
Shipping (`ADR-10`) and Payments (`ADR-09`) per ADR-13 §5's own
incremental-extension instruction, since both landed after the ADR was
written. The full vertical slice (§4) is now done: nothing further is
gated on Payments/Shipping landing.

## Scope/split decision (owner, mid-task)

This task's real scope (31 routes, ~10 resource types with genuinely
conditional shapes) turned out disproportionately large next to prior
tasks in this horizon. Two explicit questions were put to the owner via
`AskUserQuestion` rather than silently grinding through or cutting corners:

1. **Contract rigor**: "Full field-level rigor" chosen — match the
   existing `/api/v1` contract test's own convention exactly, field-by-field
   schema assertions against live responses and FormRequest rules, enforced
   in CI (not a lighter shape-only check).
2. **PR structure**: "Split into 3 PRs" chosen — OpenAPI contract first
   (self-contained), then guest journey, then authenticated journey, each
   reviewed and merged before the next starts, rather than one large PR.

## Repository evidence / root cause

- No `/commerce/v1` OpenAPI document existed anywhere in the repository
  before this task, unlike `/api/v1` (`docs/openapi/public-api-v1.yaml` +
  `PublicApiOpenApiContractTest`, an established convention to follow).
- `/commerce/v1` authenticates via a genuinely different model than
  `/api/v1`'s scope-based one: four middleware tiers (`read`/`write`/
  `sensitive`/`customer`), requiring a custom `x-auth-tier` field rather
  than `/api/v1`'s `x-required-scope`.
- Every prior task in this horizon (Payments, Shipping, Auth, Cart
  Identity, Addresses, Order History, I18n) shipped its own isolated
  feature tests, but nothing had ever exercised them **composed together**
  in one continuous flow — ADR-13's own stated purpose.

## Approach chosen

1. **`docs/openapi/commerce-api-v1.yaml`** (PR 1/3) — full OpenAPI 3.1
   document for all 31 `/commerce/v1` routes, following
   `public-api-v1.yaml`'s structural convention. `Category`/`Product`
   schemas carry genuinely optional fields (`children`/`ancestors` depend
   on depth/ancestor existence; `media`/`options`/`variants` depend on
   detail level/variant management) rather than forcing one flat required
   set the real conditional responses could never satisfy.
2. **`tests/Feature/CommerceApiOpenApiContractTest.php`** (PR 1/3, 29
   tests) — the same four-part rigor as `PublicApiOpenApiContractTest`
   (structural / path-and-tier matching / schema-drift protection /
   targeted contract pins). Discovered and closed a real, pre-existing gap
   while writing it: `CommerceCustomerAddressController` had no
   `rejectUnknown()` allow-list guard, unlike every sibling checkout/cart
   mutation controller — an undocumented extra field was silently accepted
   rather than rejected.
3. **`tests/Feature/CommerceMobileGuestJourneyTest.php`** (PR 2/3, 4 tests)
   — one continuous scenario proving the same `X-Cart-Token` survives cart
   through checkout, a real shipping-zone rate resolved mid-checkout folds
   correctly into the final total, a real payment method selected
   mid-checkout snapshots correctly onto the completed order, and the
   signed-reference identity boundary (`CommerceOrderReference`) holds
   end-to-end — plus idempotent-replay and cross-customer invisibility.
4. **`tests/Feature/CommerceMobileAuthenticatedJourneyTest.php`** (PR 3/3,
   2 tests) — proves the four previously-separate tasks (Auth, Cart
   Identity, Addresses, Order History) genuinely compose: a guest cart is
   claimed onto a customer's identity on first presenting both tokens
   (ADR-07), a saved address is selected by `address_id` at checkout and
   its fields copied in (Order Snapshot Rule, ADR-08), and the resulting
   order is genuinely linked (`customer_identity_id`) and visible in both
   `GET /me/orders` and `GET /me/orders/{id}`. A second test proves editing
   a saved address after order completion never retroactively changes that
   order's own delivery snapshot.

## Why this fits AWJ

- **ADR-13 §5 respected literally**: this slice already incorporates both
  legs that landed after the ADR was written (Shipping's real non-zero
  delivery amount, Payments' real method selection/snapshotting), rather
  than testing against the ADR's original, now-superseded description.
- **Test-only, zero accounting impact**: no ledger, payment, or order
  business logic was added by this task itself — one real pre-existing
  code bug was found and fixed (see below), not a new financial operation.
- **Composition risk is the point**: per-endpoint isolated tests already
  existed for every capability this slice touches; this task's entire
  value is proving they hold together end-to-end, exactly as ADR-13 §2
  specifies.

## Changed files

- `docs/openapi/commerce-api-v1.yaml` (new)
- `tests/Feature/CommerceApiOpenApiContractTest.php` (new, 29 tests)
- `app/Http/Controllers/Api/CommerceCustomerAddressController.php` —
  added `rejectUnknown()` guard (real pre-existing gap, closed).
- `tests/Feature/CommerceMobileGuestJourneyTest.php` (new, 4 tests)
- `tests/Feature/CommerceMobileAuthenticatedJourneyTest.php` (new, 2 tests)
- `app/Services/Commerce/CommerceCheckoutService.php` — `emptyResponse()`
  address block gained `building_no`/`additional_number` (real pre-existing
  bug, closed — see Automated review findings).

## Tests and exact results

- SQLite (`/home/user/nibras-app`): `CommerceApiOpenApiContractTest` — 29
  passed (1125 assertions after the recursive-validator hardening below;
  954 before it). Full `Commerce|Customer|Storefront|BranchIsolationGuard`
  regression: 1036 passed, 25 skipped, 0 failed.
- PostgreSQL (`/tmp/nibras-app-addresses1-pg`): same regression filter —
  1046 passed, 0 failed. Same contract-test count (29 passed, 1125
  assertions).
- Full unfiltered `php artisan test` was also run per the repo's pre-PR
  protocol on both engines; 27 pre-existing failures surfaced identically
  on both — 26 in the Fuel/Logistics module (`Call to undefined function
  App\Services\bcmul()`, this sandbox is missing the `bcmath` PHP
  extension, confirmed by `php -m | grep bcmath` and blocked from
  installing by the environment's network proxy) and one Document Center
  PDF-intake test (unrelated, likely a similar missing-tool gap). None
  touch Commerce; `ci.yml` line 80 explicitly installs `bcmath`, so CI is
  unaffected. Confirmed by CI itself: every required job (`sqlite`/`pgsql`)
  on every pushed commit in this task passed green.

## Self-review

- **Implementer**: caught a real testing-methodology bug while writing the
  guest-journey reference-boundary test — Laravel's test client merges
  `withHeaders()` into persistent per-test defaults rather than replacing
  them, so a second simulated guest's request silently inherited the first
  guest's already-consumed `X-Cart-Token`. Fixed with `flushHeaders()`
  before the second guest's session, documented inline for future readers
  of the same pattern.
- **Reviewer**: re-read `assertMatchesSchema`'s design against the
  motivating question ("would this test actually catch a wrong response
  shape?") and initially shipped a shallow, top-level-only version — caught
  by automated review, not self-review, and fixed (see below). This
  omission is recorded here as a lesson: a schema-drift test's own depth
  needs the same adversarial scrutiny as the production code it guards.
- **AWJ Guardian** (accounting/isolation discipline): confirmed via review
  of every changed file that no path in this task calls
  `LedgerService::post()` or creates a `Payment`/`PaymentAllocation` row —
  zero accounting impact, consistent with this being a test-only task
  (the two production-code fixes are response-shape corrections, not new
  financial operations).

## Accounting impact

**None.** No new financial operation, ledger entry, or accounting-relevant
model was added by this task. The two production-code changes
(`CommerceCustomerAddressController::rejectUnknown()`,
`CommerceCheckoutService::emptyResponse()`'s address block) are,
respectively, an input-validation tightening and a response-shape
correction — neither touches `LedgerService`, `Payment`, or any
`journal_lines`/`journal_entries` path.

## Tenant/branch isolation

Unaffected. No new model was introduced by this task; the two production
fixes operate entirely within existing, already-isolated request paths
(`CommerceCustomerAddress` is already `BelongsTo`-scoped to
`CustomerIdentity`; `CommerceCheckoutService` already operates within the
existing tenant/channel-scoped checkout).

## Security

The `CommerceCustomerAddressController::rejectUnknown()` fix closes a real
gap: an undocumented field on an address create/update request was
previously silently ignored rather than rejected, unlike every sibling
mutation controller on this surface — now consistently rejected with a
422, matching the documented contract exactly.

## Backward compatibility

Fully preserved. `CommerceCheckoutService::emptyResponse()`'s added
`building_no`/`additional_number: null` fields are purely additive to an
existing nullable-field object; no existing field was removed, renamed, or
had its type narrowed. The `rejectUnknown()` addition only starts
rejecting requests that were never a documented part of the address
controller's contract in the first place.

## API/DB impact

None beyond the OpenAPI document itself (which describes, not changes, the
existing `/commerce/v1` surface) and the two additive/tightening fixes
above. No migration, no new route, no existing route's request/response
shape changed in an incompatible way.

## External research

None required — this task documents and tests an existing, already-shipped
surface; no new design decision was needed beyond the two owner-confirmed
scope/split questions above.

## Automated review findings

**Round 1 (PR #942, OpenAPI contract, pre-merge)**: no findings — reviewed
clean.

**Round 2 (PR #943, guest journey — reviewed with the accumulated diff
since #943 was stacked on #942 before #942 merged), 5 findings, all
confirmed real and fixed in commit `1c4432b`:**
1. **P1 — `ProductDetail`/`ProductVariantDetail` `allOf` over a closed base
   schema**: `ProductListItem` declares `additionalProperties: false`,
   which OpenAPI 3.1/JSON Schema validators evaluate per-subschema — the
   base's own closure check never sees properties added by sibling `allOf`
   parts, so every real product-detail response would fail validation.
   Fixed by flattening both into independent, fully-closed schemas.
2. **P1 — `Order.payment` referenced the wrong schema**: pointed at
   `CheckoutPayment` (requires `payment_method_id`, disallows `status`),
   but `CommerceOrderSerializer::serialize()` emits `{method, status,
   payment_method_name}` with no `payment_method_id`. Fixed by adding a
   distinct `OrderPayment` schema and repointing `Order.payment` to it.
3. **P2 — Undocumented optional `X-Customer-Token` on cart/checkout**: the
   description already stated it could be presented alongside
   `X-Cart-Token` to claim a guest cart (ADR-07), but no parameter declared
   it. Fixed by adding an `OptionalCustomerToken` parameter to all 9
   relevant paths.
4. **P2 — Contract test only checked top-level keys**: `assertMatchesSchema`
   never recursed into nested objects/arrays/enums/types — exactly why
   finding 2 above hadn't been caught by the test itself. Fixed by
   rewriting it into a recursive validator
   (`assertMatchesResolvedSchema`/`assertValueMatchesPropertySchema`/
   `assertValueMatchesDeclaredType`).
5. **P2 — `GET /checkout`'s empty response violated its own documented
   invariant**: `CommerceCheckoutService::emptyResponse()`'s address block
   was missing `building_no`/`additional_number`, contradicting both the
   schema and the endpoint's own description promising empty/populated
   key-set parity. Confirmed as a genuine pre-existing code bug, not a doc
   error. Fixed in `emptyResponse()`.

A sixth, related finding surfaced independently by the same review pass on
PR #944 (which carried the accumulated diff before #943 merged):
`Cart.status` was typed as a plain `string`, but
`CommerceCartService::emptyResponse()` returns `status: null` for a cart
that doesn't exist yet, and `GET /commerce/v1/cart` exercises exactly that
state. Fixed by widening the schema to `[string, 'null']` in the same
commit.

**Round 3 (PR #943, second pass on the fix commit itself), 2 findings, both
confirmed real and fixed in commit `e22a04a`:**
1. **P2 — The new recursive validator unconditionally accepted `null`**:
   `assertValueMatchesPropertySchema` returned early for any `null` value
   without checking whether the schema actually declared it nullable — a
   required, non-nullable field serialized as `null` would still pass.
   Fixed by resolving `$ref` first, then only accepting `null` when the
   schema declares it via a new `schemaAllowsNull()` helper. Turning this
   on for real surfaced two genuine schema-accuracy bugs it was built to
   catch: `CartItem.unit_name` and `Order.items[].unit_name` were typed as
   non-nullable `string`, but `unit_name` is `?string` end-to-end in the
   code (nullable `unit_name_snapshot` column) — both widened to
   `[string, 'null']`.
2. **P2 — The `$ref` branch silently passed a wrong-type value**: when a
   `$ref` property expected an object received a scalar (e.g. `Order.payment`
   as a string), the `is_array($value)` guard failed and the branch
   returned with no assertion at all — silently passing the exact class of
   drift this validator exists to catch. Fixed by having the `$ref` branch
   replace `$schema` with the resolved schema and fall through into the
   same `properties`/`type`/`enum` checks used for every other property,
   instead of a separate early-return branch.

After round 3, Codex reported it had exhausted its review usage limit for
this account (posted on both PRs) — no further automated review rounds
were available for the remainder of this task.

## Risks / remaining work

None specific to this task. It is purely additive test/documentation
coverage plus two small, already-fixed production corrections.

## Discovered backlog

None beyond what is already recorded in prior tasks' reports.

## Git state

Three-PR stacked chain, each branched from the previous (not-yet-merged)
branch, per the owner's split decision:

- **PR #942** (`claude/com-mobile-vertical-test-1`, 1/3 — OpenAPI contract):
  squash-merged into `main`, **Merge SHA `b7d16ecb75808c3622d3c5782c451c21b71e0f0f`**
  (single parent `72e0e9f44d4ec32b589586b32c92d0008f8f83aa`, confirmed via
  `git log --parents`).
- **PR #943** (`claude/com-mobile-vertical-test-1-guest-journey`, 2/3 —
  guest journey): after PR #942 merged, this branch's base diverged from
  `main` (an add/add conflict against the two files PR #942 also touched,
  since this branch still pointed at PR #942's pre-squash tip); merged
  `origin/main` in twice — once for the initial base-shift, once more after
  the round-2/3 Codex fix commits — resolving by keeping this branch's
  content (a strict superset, verified via `diff` before each resolution).
  Squash-merged into `main`, **Merge SHA
  `c05c62e392f7f33fe57fcb1f8ff1fe97a1a66740`** (single parent `b7d16ecb75808c3622d3c5782c451c21b71e0f0f`,
  confirmed via `git log --parents`).
- **PR #944** (`claude/com-mobile-vertical-test-1-auth-journey`, 3/3 —
  authenticated journey): same base-shift conflict after PR #943 merged
  (this branch never touched the two shared files itself, verified via
  `git diff 098bb2a..56198ce` on them being empty — so `main`'s versions
  were taken entirely, auto-merging cleanly for
  `CommerceCheckoutService.php`). Squash-merged into `main`, **Merge SHA
  `b8e1a121f202eb9cb967bcb056092f8a2305a5c9`** (single parent
  `c05c62e392f7f33fe57fcb1f8ff1fe97a1a66740`, confirmed via `git log
  --parents`).

## POST_MERGE_REVIEW: PASS

Final Merge SHA (this task's last PR): `b8e1a121f202eb9cb967bcb056092f8a2305a5c9`.

- **Target branch contains the change**: `git fetch origin main` confirms
  `b8e1a12` (and, in sequence, `c05c62e`/`b7d16ec`) as `origin/main`'s tip
  at each respective merge point.
- **Squash-merge shape confirmed at each step**: `git log --parents -1
  <sha>` shows a single parent for all three merges (`b7d16ec` → parent
  `72e0e9f`; `c05c62e` → parent `b7d16ec`; `b8e1a12` → parent `c05c62e`) —
  verified directly, not assumed.
- **Required post-merge checks/workflows, verified via the GitHub Actions
  API on each exact `head_sha`** (the push-to-`main` trigger, a separate,
  later workflow run from each PR's own pre-merge check):
  - `b7d16ec`: both `php artisan test (L11, sqlite)` and `(L11, pgsql)`
    passed.
  - `c05c62e`: both jobs passed (run
    [35760647415](https://github.com/safwan5001-source/Nebrax/actions/runs/35760647415)).
  - `b8e1a12`: both jobs passed, run
    [35763886208](https://github.com/safwan5001-source/Nebrax/actions/runs/35763886208),
    `conclusion: success`, `head_branch: main`, `head_sha:
    b8e1a121f202eb9cb967bcb056092f8a2305a5c9`.
- **No unexpected integration change**: each stacked branch's diff against
  its predecessor's merged `main` state was inspected directly
  (`git diff`/`git merge-tree`) before every conflict resolution in this
  chain — every conflict was a pure content-superset case (this branch's
  fixed/additive version vs. `main`'s now-superseded pre-fix version),
  never a genuine three-way merge requiring judgment calls.
- **Targeted regression**: full `Commerce|Customer|Storefront|
  BranchIsolationGuard` regression re-run after each merge-in of `main`,
  staying green throughout (1036/1046 on SQLite/PostgreSQL, final state).

## Recommended next task

This closes the entire currently-authorized Commerce Mobile API readiness
horizon: Payments (`COM-MOBILE-PAYMENTS-1`), Shipping
(`COM-MOBILE-SHIPPING-1`), I18N (`COM-MOBILE-I18N-1`), and the Vertical
Slice (`COM-MOBILE-VERTICAL-TEST-1`) are now all `done`.
`COM-MOBILE-PROMO-1` remains explicitly `deferred` (`ADR-11`), not
pending. No further row in the Commerce Mobile prerequisites table is
`ready` — the authorized execution horizon is complete pending a new
owner-authorized horizon or task.

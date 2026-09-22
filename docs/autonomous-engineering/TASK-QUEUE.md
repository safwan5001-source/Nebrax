# AWJ Autonomous Engineering — Durable Task Queue

## Purpose

This is the human-reviewable V1 queue. It is deliberately Markdown first. Do not introduce a second YAML/JSON source of truth until the schema and workflow prove stable.

## Queue rules

- One stable task ID per outcome.
- Dependencies must be explicit.
- A task becomes `ready` only from evidence, not optimism.
- `done` means its Definition of Done is evidenced.
- Represent merge/deploy/production state truthfully; code-only completion is not `done` when the task Definition of Done requires merge or production verification.
- Claude may append discovered tasks, but may not silently promote a material new task to `ready` if it expands the authorized horizon.
- Material decisions link an ADR/decision ID.
- An unmerged code dependency does not satisfy a downstream dependency unless an explicit stacked-branch strategy has been authorized.

## Authorized horizon

STATUS: ACTIVE

**Horizon: Commerce Mobile API readiness closure V1**

Source of truth:
- `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` merged via PR #887.
- App Builder architecture/contract pack merged via PR #887.

Authorization:
- Claude may execute this horizon sequentially and autonomously.
- Promote later backlog items to `ready` only when their dependencies, acceptance criteria, tests and Decision Gates are satisfied from current-main evidence.
- A blocked/material decision does not authorize guessing; use Decision Escalation and continue only independent ready work.
- Ordinary merges use standing merge authority after mandatory pre-merge review + required green CI + mandatory post-merge review.
- Deploy/production release/destructive production operations remain owner-gated.

## Candidate queue — Commerce Mobile prerequisites

| Order | Task ID | Status | Risk | Depends on | Outcome |
|---|---|---|---|---|---|
| 1 | COM-MOBILE-MEDIA-1 | done | high | accepted readiness contract | Mobile-authorized product media |
| 2 | COM-MOBILE-VARIANTS-1 | done | high | COM-MOBILE-MEDIA-1 (done) | Variant/options/UOM mobile contract |
| 3 | COM-MOBILE-AUTH-1 | done | critical | identity architecture decision/readiness (resolved, ADR-06) | Customer mobile auth + profile |
| 4 | COM-MOBILE-CART-IDENTITY-1 | done | critical | COM-MOBILE-AUTH-1 (done); decision resolved, ADR-07 | Guest → authenticated cart transition |
| 5a | COM-MOBILE-ORDER-HISTORY-1 | done | normal | COM-MOBILE-AUTH-1 (done) | Customer order history (split from COM-MOBILE-CUSTOMER-1) |
| 5b | COM-MOBILE-ADDRESSES-1 | done | high | COM-MOBILE-AUTH-1 (done); decision resolved, ADR-08 | Commerce customer address book (split from COM-MOBILE-CUSTOMER-1) |
| 6 | COM-MOBILE-PAYMENTS-1 | ready | critical | COM-MOBILE-CART-IDENTITY-1 (done); decision resolved, ADR-09 | Payment Intent foundation + COD/Pay on Pickup (PSP selection remains a separate future decision) |
| 7 | COM-MOBILE-SHIPPING-1 | done | high | COM-MOBILE-ADDRESSES-1 (done); decision resolved, ADR-10 | Configurable shipping zones/rates, no carrier (carrier selection remains a separate future decision) |
| 8 | COM-MOBILE-PROMO-1 | deferred | high | decision resolved, ADR-11 — explicitly out of scope | Coupon/promotion mobile contract — deliberately deferred, not missing |
| 9 | COM-MOBILE-I18N-1 | done | normal | decision resolved, ADR-12 | Shared Accept-Language locale resolution (ar default, ar/en supported) |
| 10 | COM-MOBILE-VERTICAL-TEST-1 | ready | high | decision resolved, ADR-13 — partial scope only | Partial vertical slice (guest + authenticated journeys, currently-merged capabilities) + `/commerce/v1` OpenAPI contract; full slice remains gated on Payments/Shipping landing |

`COM-MOBILE-CUSTOMER-1` (Addresses + customer order history) is retired as a bundled row — split per owner approval into `COM-MOBILE-ORDER-HISTORY-1` and `COM-MOBILE-ADDRESSES-1` above (`5a`/`5b`), each independently ready and independently dependency-tracked; neither depends on the other.

Source: `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` on `main` (accepted via merged/post-reviewed PR #887).

`COM-MOBILE-MEDIA-1` is `done`: PR #911 merged (Merge SHA `8386ece721f3e6b37c9f2ff8db64f10e2b44d9c4`), post-merge CI green on `main` (SQLite + PostgreSQL), post-merge review passed. Full evidence: `docs/plans/commerce/COM-MOBILE-MEDIA-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-VARIANTS-1` promoted to `ready` from current-`main` evidence (promotion checklist below):
- Source requirement: `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §5 (variant gap), required contract: option/attribute definitions, valid combinations, UOM, variant price, variant availability, media relationship, add-to-cart requirements.
- Hard dependency (media) is `done`.
- **Business logic is already fully variant-aware and shared, not new**: `CommerceCartController::store()` already accepts and forwards `product_variant_id` to `CommerceCartService::add()` — the same shared service `/store/v1` uses, already covered by `StorefrontVariantCommerceTest`'s cart/checkout/order variant-identity assertions. `CommercePriceResolver::resolve()` and `AvailableToSellService::forWarehouse()` are already variant-aware (`?string $variantId` parameter, VAR-COM-1). This task is a **read/DTO exposure** task on `CommerceProductController::show()`, mirroring `StorefrontProductController::show()`'s already-shipped, already-tested variant branch (options/variants payload, per-variant price/stock/media) for the mobile trust boundary — the same "reuse existing authority, no parallel logic" shape as COM-MOBILE-MEDIA-1, not a new business-logic design.
- No unresolved material decision: no new pricing/availability/cart rule, no new contract shape (the `options`/`variants` JSON shape is already defined and shipped by `StorefrontProductResource`).
- Acceptance criteria: `GET /commerce/v1/products/{id}` for a variant-managed product returns `options`/`variants` (id, sku, descriptor, option_value_ids, price, in_stock, media) matching `/store/v1`'s shape; list (`index()`) keeps its existing deferred behavior (`is_variant_managed` flag only) unchanged, matching `/store/v1`'s own list/detail asymmetry; tenant/channel/publication/inactive-variant negatives; cross-tenant/cross-product variant rejection (already enforced by `DocumentLineVariantResolver::resolve()`, reused unchanged).
- Tests: focused `/commerce/v1` variant detail tests + regression on `CommerceCatalogApiTest`/`CommerceMediaApiTest`, SQLite + PostgreSQL.

`COM-MOBILE-VARIANTS-1` is `done`: PR #916 merged (Merge SHA `40445016973d050963d25519ed15ba05e0de6b66`), post-merge CI green on `main` (SQLite + PostgreSQL), post-merge review passed. Discovered backlog: alternate-unit (UOM) selection contract, needed by both `/store/v1` and `/commerce/v1` alike, not yet designed. Full evidence: `docs/plans/commerce/COM-MOBILE-VARIANTS-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-AUTH-1` evaluated against current-`main` evidence and found **not** promotable to `ready` — moved to `decision_required`:
- `docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md` (Accepted, 2026-09-09) fixes the conceptual boundary (Commerce Authentication Identity / Customer Account / ERP User / Partner remain distinct; tenant-scoped; ownership-based API authorization; guest checkout preserved) but its own §22 "Explicit non-decisions" lists exactly what implementation needs and does not yet have: authentication framework/provider, SMS/OTP provider, password-vs-passwordless default, and token/session format.
- This is a genuine Decision Escalation Gate per `DECISION-ESCALATION.md` (Tenant/Auth/Security architecture; a paid SMS/OTP provider is also a strategic vendor commitment) — not an evidence gap Claude can close by reading more repository state.
- Decision Escalation packet delivered to Safwan.

**Decision resolved** (`COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`, recorded durably in `docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md`): support both phone+OTP (primary) and email+password (alternative) customer authentication on `/commerce/v1`, behind a provider-neutral OTP abstraction with no real SMS/OTP vendor integrated yet (Unifonic remains a future candidate only, a separate Decision/Owner Gate).
- Implementation reuses the existing, pre-existing-but-unwired `/customer/v1` identity stack (`CustomerIdentity`, `CustomerIdentityService`, `CustomerAuthenticationService`, `CustomerContext`, `EstablishCustomerContext` — all unmodified) extended into `/commerce/v1` via a new `X-Customer-Token` header/middleware, plus new OTP scaffolding (`CustomerOtpService`, `OtpProvider`/`FakeOtpProvider`, `CustomerPhoneAuthenticationService`).
- Automated (Codex) review on PR #920 found and this PR fixed, before merge: (1) the customer-resolver swap silently dropped `PublicApiRequestAudit` records for authenticated customer requests; (2) phone-OTP-only identities could never be Partner-linked (`CustomerPartnerLinkService::assertEligible()` hard-required `email_verified_at`); (3) a concurrency race in OTP issuance could leave two simultaneously active codes; (4) the shared store `ApiClient` bearer meant one customer's traffic could exhaust the whole store's authentication rate-limit budget. All four fixed and regression-tested. Full evidence including a fifth, self-found security fix (phone-squatting account-boundary leak, closed before the automated review even ran): `docs/plans/commerce/COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-AUTH-1` is `done`: PR #920 merged (Merge SHA `a8f83b170eb2f696541e9f4d48d3db407ab02dd5`), post-merge CI green on `main` (SQLite + PostgreSQL), post-merge review passed.

`COM-MOBILE-CART-IDENTITY-1` and `COM-MOBILE-CUSTOMER-1` evaluated now that their hard dependency is `done` — both found **not** promotable to `ready`, moved to `decision_required`:

- `COM-MOBILE-CART-IDENTITY-1`: `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` §12 ("Guest → customer cart transition — Blocked") explicitly lists this as requiring a decision, not an evidence gap: claim vs. merge the guest cart, conflict/quantity behavior when both carts hold the same line, pricing/revalidation timing, abandoned/expired guest-cart handling, logout behavior, and multi-device behavior are all named as undecided. The doc's own words: "Backend must own the merge decision." `COM-MOBILE-AUTH-1` only supplied the customer identity/token half of this task's dependency — it did not and could not resolve cart-merge policy, which is a distinct, still-open product decision.
- `COM-MOBILE-CUSTOMER-1`: `docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md` §13 ("Commerce Addresses are not forced into the current Partner address shape") explicitly defers the Commerce Address schema/design, and §22 lists "Commerce Address database schema" among its non-decisions — unaffected by ADR-06 (ADR-06 resolved only the authentication mechanism, not addresses or profile schema). The order-history half of this task is comparatively evidence-ready (`CommerceOrderService::ownedOrders()` — a reusable, already-tested, ownership-filtered query — already exists per `CommerceCustomerContextIntegrationTest`), but the task as currently scoped bundles both, and the addresses half remains blocked by an explicit ADR-05 non-decision. Splitting this task into an addresses-decision-gated half and an order-history-ready half is a queue-structure change, not a decision Claude makes unilaterally — recorded here for Safwan's consideration rather than acted on.
- Both are genuine Decision Escalation Gates (configurable-policy-shaped product decisions per CLAUDE.md's "السياسة تُضبط ولا تُفرَض" rule — cart-merge semantics and address schema both have more than one reasonable, correct answer depending on AWJ's actual commerce policy), not evidence gaps Claude can close by reading more repository state.
- No further candidate in the queue is independently ready: `COM-MOBILE-PAYMENTS-1` is separately gated on "checkout/auth/provider decisions" (and checkout's own guest/customer identity shape is exactly what CART-IDENTITY-1 would decide); `COM-MOBILE-SHIPPING-1` on "checkout contract"; `COM-MOBILE-PROMO-1` on "V1 product decision"; `COM-MOBILE-I18N-1` on "resource contracts"; `COM-MOBILE-VERTICAL-TEST-1` on "selected vertical slice complete". All trace back to the same two open decisions or to scope not yet confirmed.

**Both decisions resolved by Safwan** (owner decision, 2026-09-21):

- **`COM-MOBILE-CART-IDENTITY-1-MERGE-POLICY`**, recorded durably in `docs/plans/store/ADR-07-COMMERCE-CART-MERGE-POLICY.md`: Merge (not claim-replace) — reuses `CommerceCartService::add()`'s existing quantity-sum-on-duplicate-line semantics unchanged, no price freezing (checkout completion's existing `revalidateAndPrice()` remains sole authority), source guest cart becomes terminal (`STATUS_CONSUMED`) after a successful merge, logout never exposes the customer's cart to a subsequent guest bearer, multi-device favors preserving the customer's existing cart over a second device's guest cart. `COM-MOBILE-CART-IDENTITY-1` promoted to `ready`.
- **`COM-MOBILE-CUSTOMER-1-ADDRESS-SCHEMA`**, recorded durably in `docs/plans/store/ADR-08-COMMERCE-CUSTOMER-ADDRESS-SCHEMA.md`: a dedicated `commerce_customer_addresses` table owned by `CustomerIdentity` (not `Partner`, no Partner refactor), with explicit Saudi National Address support (`building_no`, `additional_number`, `short_address`, all country-aware — never unconditionally mandatory), reusing `CommerceOrderSnapshot`'s existing immutability guard for order-time snapshotting, and closing the pre-existing `shipping_building_no` propagation gap found during the escalation's evidence pass. **Task split approved**: `COM-MOBILE-CUSTOMER-1` retired as a bundled row, replaced by independently-ready `COM-MOBILE-ORDER-HISTORY-1` and `COM-MOBILE-ADDRESSES-1` (table above).

`COM-MOBILE-CART-IDENTITY-1` is `done`: PR #924 merged (Merge SHA `dffe6c86017e88019a82fceb2b0214d8a895b332`), post-merge CI green on `main` (SQLite + PostgreSQL), post-merge review passed. Implements ADR-07's Merge policy across both cart and checkout entry points (`CommerceCheckoutService::current()`/`createOrResume()` route through `CommerceCartService::resolveCurrent()`, not the legacy `findByToken()`, so an authenticated customer going straight to checkout with a guest token still gets the merge). Went through 11 rounds of automated (Codex) review, each verified and fixed except one explicitly declined with reasoning posted on its thread (a suggested "merge carts before checkout completion" fix that would have orphaned the very checkout being completed or violated the one-active-cart-per-customer invariant — left as a standing-down comment, not a code change). Fixes progressively closed: guest/owned-cart isolation, concurrent-claim races on both write and read paths (cart and checkout), a bounded two-slot token-rotation grace window, quantity/monetary overflow handling during merges, a channel-scoped active-cart uniqueness index, and consistent cart/checkout lock ordering removing a latent deadlock risk pre-dating this task. 35 focused tests in `CommerceCartMergeApiTest.php` + full `Commerce|Customer|Storefront` regression: 931 passed/25 skipped on SQLite, 956 passed on PostgreSQL, 0 failed. Full evidence: `docs/plans/commerce/COM-MOBILE-CART-IDENTITY-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-ADDRESSES-1` is `done`: PR #929 merged (Merge SHA `482c33053a07cad8bdcf79790e6125e31d4db895`), post-merge CI green on `main` (SQLite + PostgreSQL), post-merge review passed. Implements ADR-08: a dedicated `CommerceCustomerAddress` book owned by `CustomerIdentity` (independent of `Partner`, no `Partner` refactor), full CRUD under the existing `X-Customer-Token` group, country-aware Saudi National Address validation, DB-enforced default-shipping/default-billing exclusivity, and — as its deferred "select a saved address at checkout" feature, unblocked once `COM-MOBILE-CART-IDENTITY-1` landed `EstablishCommerceCustomerContextIfPresent` on the checkout route group — `address_id` selection at checkout that copies field values in (Order Snapshot Rule) rather than storing a reference. Went through 3 rounds of automated (Codex) review before Codex exhausted its review usage limit for this account (posted on the PR, not an implementation issue); all 8 findings across the 3 rounds verified as genuine and fixed: round 1 (address-id UUID validation gap, missing merged-PATCH-state Saudi validation, an unnormalized boolean-flag comparison bug), round 2 (two concurrency races round 1's own fixes exposed — merged-state validation and default-address assignment both raced under concurrent requests, closed by locking the owning `CustomerIdentity` row), round 3 (missing Saudi National Address digit/shape validation per ADR-08 §4, a `region` field silently dropped from the immutable order snapshot at checkout completion, `additional_number`/`region` missing from the generic snapshot-write path's field whitelist). 17 focused tests in `CommerceCustomerAddressApiTest.php` + 4 in `CommerceCheckoutApiTest.php` + full `Commerce|Customer|Storefront` regression: 936 passed/25 skipped on SQLite, 961 passed on PostgreSQL, 0 failed; `BranchIsolationGuardTest`/`CommerceModuleBoundaryTest` green on both engines. Full evidence: `docs/plans/commerce/COM-MOBILE-ADDRESSES-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-ORDER-HISTORY-1` is `done`: PR #932 merged (Merge SHA `1813c63721eaa1859566b5533c86a18df7a31679`), post-merge CI green on `main` (SQLite + PostgreSQL), post-merge review passed. Closes the `CustomerContext`-sourcing gap `CommerceOrderService::createFromCheckout()` had held since PR-COM-6B — `customer_identity_id` was hardcoded to `null` on every order regardless of the completing bearer, even though `CommerceOrder`'s own docblock always documented it as sourced from `CustomerContext` when established; now read directly from it, mirroring how the same method already sources `TenantContext`. Adds `GET /commerce/v1/me/orders` (paginated list, lightweight summary rows) and `GET /commerce/v1/me/orders/{id}` (full detail via `CommerceOrderSerializer`), both under the existing `X-Customer-Token` required-auth group, deliberately a separate path from the guest signed-reference `GET /commerce/v1/orders/{id}` (different trust mechanism entirely). Discovered and fixed along the way: extending `CommerceOrderSerializer`'s `delivery` block with `region`/`building_no`/`additional_number` surfaced that `CommerceCheckoutController::complete()` had its own independent literal copy of the same shape that had already silently drifted from it (caught immediately by `CommerceOrderStatusApiTest`'s own shape-parity assertion) — replaced with a direct call to the shared serializer instead of patching the duplicate a second time. 10 new tests in `CommerceCustomerOrderApiTest.php` + full `Commerce|Customer|Storefront` regression: 946 passed on SQLite, 971 passed on PostgreSQL, 0 failed; `BranchIsolationGuardTest`/`CommerceModuleBoundaryTest` green on both engines. This closes the full three-way split from the former `COM-MOBILE-CUSTOMER-1` (`COM-MOBILE-CART-IDENTITY-1`, `COM-MOBILE-ADDRESSES-1`, `COM-MOBILE-ORDER-HISTORY-1`) — all three now `done`. Full evidence: `docs/plans/commerce/COM-MOBILE-ORDER-HISTORY-1-IMPLEMENTATION-REPORT.md`.

With the Commerce Mobile Customer track fully closed, a Decision/Evidence Packet was prepared for the five remaining rows (`6`–`10`) per `DECISION-ESCALATION.md`'s escalation-packet format, evaluating repository evidence, external evidence, alternatives, trade-offs, and a recommendation for each, without implementing or recording a final decision.

**Five decisions resolved by Safwan** (owner decision, 2026-09-22):

- **`COM-MOBILE-PAYMENTS-PROVIDER`** (partially resolved), recorded durably in `docs/plans/store/ADR-09-COMMERCE-PAYMENT-INTENT-V1-SCOPE.md`: implement `ADR-04`'s Payment Intent orchestration boundary now, bounded to COD and Pay on Pickup (no vendor needed for either); wire the existing `PaymentMethodChannelAvailabilityService` into the shared checkout/payment contract; no parallel ledger, existing AWJ Payment Core remains authoritative. Payment provider/vendor selection, online capture policy, and saved payment methods remain open, separately gated decisions. `COM-MOBILE-PAYMENTS-1` promoted to `ready` on this bounded scope.
- **`COM-MOBILE-SHIPPING-CARRIER`** (partially resolved), recorded durably in `docs/plans/store/ADR-10-COMMERCE-SHIPPING-RATE-V1-SCOPE.md`: implement a merchant-configurable shipping-zone/rate model now (server-authoritative, reuses the existing Saudi National Address fields, replaces the hardcoded `delivery_amount_minor = 0`), intentionally bounded — no carrier API, label, live quote, multi-warehouse optimization, or dimensional rating. Carrier/aggregator selection remains a separate, open decision. `COM-MOBILE-SHIPPING-1` promoted to `ready` on this bounded scope.
- **`COM-MOBILE-PROMO-SCOPE`** (resolved — deferred), recorded durably in `docs/plans/store/ADR-11-COMMERCE-PROMOTIONS-DEFERRAL.md`: promotions/coupons are explicitly out of scope for the current horizon, a deliberate deferral (not a missing capability); any future promotion system must be Commerce-Core/shared and undergo financial/order-total review before implementation, sequenced after `ADR-09` lands. `COM-MOBILE-PROMO-1` marked `deferred`.
- **`COM-MOBILE-I18N-FALLBACK-DEFAULT`** (resolved), recorded durably in `docs/plans/store/ADR-12-COMMERCE-API-LOCALE-RESOLUTION.md`: a shared `Accept-Language` locale resolver/middleware, `ar`/`en` supported, `ar` default, applied identically across `/commerce/v1`/`/store/v1`/future App Builder consumers, introduced backward-compatibly (existing `name`/`name_en` fields unchanged); error-message translation may proceed incrementally. `COM-MOBILE-I18N-1` promoted to `ready`.
- **`COM-MOBILE-VERTICAL-SLICE-SCOPE`** (resolved), recorded durably in `docs/plans/store/ADR-13-COMMERCE-MOBILE-VERTICAL-SLICE-PARTIAL-SCOPE.md`: a partial vertical slice (guest journey: catalog→cart→checkout→order→signed lookup; authenticated journey: auth→catalog→cart→saved address→checkout→order→order history) plus a `/commerce/v1` OpenAPI contract is accepted as its own independently-ready deliverable now, using only currently-merged capabilities; the full slice remains explicitly not-done until Payments/Shipping land and are incorporated. `COM-MOBILE-VERTICAL-TEST-1` promoted to `ready` on this partial scope.

**Cross-cutting rule recorded (owner decision, 2026-09-22, no dedicated ADR — a standing constraint restated across ADR-09/10/12):** Payments, shipping, locale behavior, and any future promotions belong to shared AWJ Commerce/platform authorities, reusable by Commerce Core, Web Storefront, Mobile App, and future App Builder apps. Channel-specific presentation may differ; business authority must not be duplicated per channel.

**Messaging Foundation flag (owner decision, 2026-09-22, no ADR — recorded as backlog, not a task row):** if Payments or Shipping implementation surfaces a need for customer-facing SMS/email/push, that specific messaging integration must stop short of a feature-specific provider wire-up; the requirement is recorded here for a future shared **AWJ Messaging/Communications Foundation** (provider-neutral, eventually shared by OTP, payment notifications, and shipping notifications alike — mirroring the existing `OtpProvider`/`FakeOtpProvider` abstraction's own shape). A real SMS/messaging provider remains a separate, not-yet-scheduled Owner Decision. No production payment provider, shipping carrier/aggregator, SMS provider, or other paid vendor/credential/contract is authorized by any decision recorded on this page.

`COM-MOBILE-I18N-1` is `done`: PR #935 merged (Merge SHA `220fffb2fb4bcdc9ce0819ae089b42d9e145af1f`), CI green on both engines pre-merge (SQLite + PostgreSQL). Implements `ADR-12`: `App\Support\CommerceLocale` (pure RFC 9110 §12.5.4 `Accept-Language` resolver — quality-value ordering, primary-subtag matching, wildcard handling, `ar`/`en` supported, `ar` default) plus `App\Http\Middleware\ResolveCommerceLocale`, wired into the single shared route-registration middleware array both `CommerceApiServiceProvider` (`/commerce/v1`) and `StorefrontApiServiceProvider` (`/store/v1`) already used for `ForceJsonResponse`/`PublicApiRequestContext` — one insertion point for both surfaces. Sets `app()->setLocale()` for the request only (restored in a `finally`, same discipline as `EstablishCommerceCustomerContextIfPresent`) and adds the standard `Content-Language` response header (RFC 9110 §12.5.5) — the one new, purely additive, externally observable effect. Fully backward compatible: no existing route/resource/response field changed shape; error-message localization explicitly deferred per `ADR-12` §6. 15 new tests in `CommerceLocaleResolutionTest.php`; full `Commerce|Customer|Storefront` regression: 961 passed on SQLite, 986 passed on PostgreSQL, 0 failed. Full evidence: `docs/plans/commerce/COM-MOBILE-I18N-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-SHIPPING-1` is `done`: PR #937 merged (Merge SHA `5980ee4559632df134a268546e688d56e99e9217`), CI green on all engines pre-merge (SQLite + PostgreSQL + storefront lint/typecheck/test). Implements `ADR-10`: `CommerceShippingZone` (`CompanyWide`) + `ShippingRateService` — the shared rate-resolution authority (city match, then region, then `0`) consumed identically by `/commerce/v1` and `/store/v1` via `CommerceCheckoutService`, which now recomputes the amount from both `updateAddress()` and `updateDelivery()` (independently-orderable mutations). Closed a deeper pre-existing gap discovered along the way: `commerce_orders` had no `delivery_amount_minor` column at all, so a checkout's resolved shipping amount was silently dropped at order creation even before this task — `CommerceOrderService::createFromCheckout()` now folds it into `total`. Merchant configuration via `commerce/workspace/shipping-zones` (RBAC `commerce.manage`, reused — no new permission scope). Three rounds of automated (Codex) review, all four findings verified and fixed: a case-insensitive shipping-zone uniqueness race (moved to a DB-level unique constraint on a model-managed `match_value_normalized` column, not just the controller's TOCTOU-prone precheck), a missing `rate_amount_minor` cap and — found only after that first cap — a genuine `bigint` overflow in the combined order total (`unit_price`/`quantity`'s own pre-existing bounds already permit a line total near `PHP_INT_MAX`; guarded with a checked-arithmetic `addMinorAmountOrFail()` helper that fails closed rather than let PHP silently promote the sum to a `float`), a malformed-UUID 500 on the merchant routes (`whereUuid('id')`), and a real UX/billing-transparency gap in the already-live `/store/v1` AWJ-native storefront checkout (`ReviewStage`/order-summary panel still rendered a static "pending" placeholder for a charge the server had already committed — fixed to show the real `checkout.delivery.amount`). 18 new backend tests (`CommerceShippingZoneTest.php` + one in `CommerceOrderServiceTest.php`) + storefront `pnpm test` (572 passed) + `pnpm check`/`tsc --noEmit`/`pnpm build`; full `Commerce|Customer|Storefront|BranchIsolationGuard` regression: 967 passed on SQLite, 992 passed on PostgreSQL, 0 failed. Full evidence: `docs/plans/commerce/COM-MOBILE-SHIPPING-1-IMPLEMENTATION-REPORT.md`.

## Promotion checklist: backlog → ready

Before changing status to `ready`:
- source requirement/contract accepted;
- hard dependencies complete at the required merge/verification level;
- no unresolved material decision;
- outcome and acceptance criteria defined;
- risk classified;
- test expectations defined;
- authorized execution horizon includes the task;
- current `main` evidence does not invalidate the task.

## Agent transitions

Routine:
`ready → in_progress → review → merge_ready → merged → done`

A task may go `review → done` when no merge is required and all Definition-of-Done evidence exists.

Exceptional:
`in_progress/review → decision_required/blocked/owner_gate`

`owner_gate` is now reserved for actions still requiring Safwan, such as deploy/production release/destructive production operation or a material escalated decision. It is **not** required for an ordinary merge that satisfies the standing merge policy.

## Merge continuation rule

For an ordinary merge inside the standing authority:
- verify applicable review/Quality Gates;
- observe required CI green;
- merge;
- verify merge SHA/state;
- update queue/report/current state;
- then unlock merge-dependent tasks.

If a task reaches a true `owner_gate`, Claude may continue only with independent ready tasks inside the authorized horizon; otherwise persist state and stop cleanly for Safwan.

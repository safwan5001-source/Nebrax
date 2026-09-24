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
| 6 | COM-MOBILE-PAYMENTS-1 | done | critical | COM-MOBILE-CART-IDENTITY-1 (done); decision resolved, ADR-09 | Payment Intent foundation + COD/Pay on Pickup (PSP selection remains a separate future decision) |
| 7 | COM-MOBILE-SHIPPING-1 | done | high | COM-MOBILE-ADDRESSES-1 (done); decision resolved, ADR-10 | Configurable shipping zones/rates, no carrier (carrier selection remains a separate future decision) |
| 8 | COM-MOBILE-PROMO-1 | deferred | high | decision resolved, ADR-11 — explicitly out of scope | Coupon/promotion mobile contract — deliberately deferred, not missing |
| 9 | COM-MOBILE-I18N-1 | done | normal | decision resolved, ADR-12 | Shared Accept-Language locale resolution (ar default, ar/en supported) |
| 10 | COM-MOBILE-VERTICAL-TEST-1 | done | high | decision resolved, ADR-13 — partial scope only | Partial vertical slice (guest + authenticated journeys, currently-merged capabilities) + `/commerce/v1` OpenAPI contract; full slice remains gated on Payments/Shipping landing |

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

`COM-MOBILE-SHIPPING-1` is `done`: PR #937 merged (Merge SHA `5980ee4559632df134a268546e688d56e99e9217`), CI green on all engines pre-merge (SQLite + PostgreSQL + storefront lint/typecheck/test). Implements `ADR-10`: `CommerceShippingZone` (`CompanyWide`) + `ShippingRateService` — the shared rate-resolution authority (city match, then region, then `0`) consumed identically by `/commerce/v1` and `/store/v1` via `CommerceCheckoutService`, which now recomputes the amount from both `updateAddress()` and `updateDelivery()` (independently-orderable mutations). Closed a deeper pre-existing gap discovered along the way: `commerce_orders` had no `delivery_amount_minor` column at all, so a checkout's resolved shipping amount was silently dropped at order creation even before this task — `CommerceOrderService::createFromCheckout()` now folds it into `total`. Merchant configuration via `commerce/workspace/shipping-zones` (RBAC `commerce.manage`, reused — no new permission scope). Three rounds of automated (Codex) review, all four findings verified and fixed: a case-insensitive shipping-zone uniqueness race (moved to a DB-level unique constraint on a model-managed `match_value_normalized` column, not just the controller's TOCTOU-prone precheck), a missing `rate_amount_minor` cap and — found only after that first cap — a genuine `bigint` overflow in the combined order total (`unit_price`/`quantity`'s own pre-existing bounds already permit a line total near `PHP_INT_MAX`; guarded with a checked-arithmetic `addMinorAmountOrFail()` helper that fails closed rather than let PHP silently promote the sum to a `float`), a malformed-UUID 500 on the merchant routes (`whereUuid('id')`), and a real UX/billing-transparency gap in the already-live `/store/v1` AWJ-native storefront checkout (`ReviewStage`/order-summary panel still rendered a static "pending" placeholder for a charge the server had already committed — fixed to show the real `checkout.delivery.amount`). 18 new backend tests (`CommerceShippingZoneTest.php` + one in `CommerceOrderServiceTest.php`) + storefront `pnpm test` (572 passed) + `pnpm check`/`tsc --noEmit`/`pnpm build`; full `Commerce|Customer|Storefront|BranchIsolationGuard` regression: 967 passed on SQLite, 992 passed on PostgreSQL, 0 failed. `POST_MERGE_REVIEW: PASS` (Merge SHA `5980ee4559632df134a268546e688d56e99e9217`, Gate 11): `main` verified to contain this exact commit as its own history (a squash merge, one commit — confirmed via `git log --parents` showing a single parent `6be5d7d`, this session's standard merge method); post-merge CI on that exact SHA (the push-to-`main` trigger, a separate, later workflow run from the PR's own pre-merge head check) re-ran and passed on all three required jobs — verified via the GitHub Actions API, runs [35724653563](https://github.com/safwan5001-source/Nebrax/actions/runs/35724653563) (sqlite+pgsql) and [35724653544](https://github.com/safwan5001-source/Nebrax/actions/runs/35724653544) (storefront), all `conclusion: success` on this `head_sha`; a further focused `Commerce|Customer|Storefront|BranchIsolationGuard` regression from a branch built directly on that commit (while starting `COM-MOBILE-PAYMENTS-1`, 2026-09-22) stayed green: 997 passed on SQLite, 1007 passed on PostgreSQL, 0 failed — no unexpected integration change. (An earlier version of this evidence wrongly called this a non-squash 4-parent merge and cited PR #938's own later commit as PR #937's pre-merge head; corrected after Codex review caught it on PR #938.) Full evidence: `docs/plans/commerce/COM-MOBILE-SHIPPING-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-PAYMENTS-1` is `done`: PR #940 merged (Merge SHA `b025f363c218c58096c70dba0ff0d74a7c6e7093`, a squash merge with single parent `7ada1392eedc245ba0077de6391121adc51dfd25` — confirmed via `git log --parents`), pre-merge head `8218ee446995b46b3a5c66002c8d22590afe95de` on `claude/com-mobile-payments-1` (confirmed the branch's actual tip via `git log --oneline`), CI green on all engines pre-merge (SQLite + PostgreSQL + storefront lint/typecheck/test). Implements `ADR-04`'s `Commerce Order → Payment Intent → ... → Successful Settlement` boundary for the first time, bounded to `ADR-09`'s V1 scope: `CommercePaymentIntent` (`CompanyWide`) + `CommercePaymentIntentService` — the sole authority for creating/transitioning intents; `method` (`cod`/`pay_on_pickup`) is derived from the order's delivery method, never a separate customer choice, never marked paid at creation. `payment_method_id` is an independent, optional customer choice — which of the store's already-enabled settlement methods (`PaymentMethodChannelAvailabilityService::availableFor()`, wired unchanged per ADR-09 §3) collects the amount — made optional by necessity, not just design: `CashBankAccountService` seeds every default `PaymentMethod` with `available_online = false`, so a first attempt at requiring selection at checkout completion broke 60 existing tests before being reverted in favor of the optional design implemented here. `CommerceCheckoutService::updatePayment()` (new) mirrors `updateDelivery()`'s validation pattern; `complete()` creates the intent inside the same transaction as order creation. New routes on both `/commerce/v1` and `/store/v1`: `GET payment-methods`, `PATCH checkout/payment`; internal `commerce/payment-intents` index/collect/cancel routes reuse the existing `payments.view`/`payments.manage` RBAC scope. One round of automated (Codex) review, three findings verified and fixed: completion accepted a payment method that had been disabled for the channel after selection but before completion (now revalidates `PaymentMethodChannelAvailabilityService` at completion, not just `is_active`), `collect`/`cancel` checked the caller-passed intent's own possibly-stale in-memory status rather than the DB row (now lock and re-check the row inside a transaction), and the empty-checkout response (`GET checkout` before one exists) omitted the `payment` key entirely while the frontend types now treat it as always present (added the null-valued shape). 19 backend tests (15 original + 4 proving the review fixes) + storefront `pnpm test` (573 passed) + `pnpm check`/`tsc --noEmit`/`pnpm build`/`pnpm check:locales`; full `Commerce|Customer|Storefront|BranchIsolationGuard` regression: 1001 passed on SQLite, 1011 passed on PostgreSQL, 0 failed (after the review fixes; 997/1007 before). `POST_MERGE_REVIEW: PASS` (Merge SHA `b025f363c218c58096c70dba0ff0d74a7c6e7093`, Gate 11): `main` verified to contain this exact commit (`git fetch origin main` + `git branch -a --contains` confirm it as `origin/main`'s tip); its tree diffs identical to zero against the PR's pre-merge head `8218ee4` for every changed path (`git diff 8218ee4 origin/main -- app database routes tests storefront`), confirming the squash preserved the reviewed content exactly; post-merge CI on this exact SHA (the push-to-`main` trigger, a separate later workflow run from the PR's own pre-merge check) passed on all three required jobs — verified via the GitHub Actions API, runs [35737658191](https://github.com/safwan5001-source/Nebrax/actions/runs/35737658191) (sqlite+pgsql) and [35737658229](https://github.com/safwan5001-source/Nebrax/actions/runs/35737658229) (storefront), all `conclusion: success` on this `head_sha` — no further regression re-run was needed beyond this, since the zero-diff check already establishes the pre-merge 1001/1011 regression evidence applies unchanged to the merged tree. Full evidence: `docs/plans/commerce/COM-MOBILE-PAYMENTS-1-IMPLEMENTATION-REPORT.md`.

`COM-MOBILE-VERTICAL-TEST-1` is `done`: three stacked PRs merged in sequence — PR #942 (1/3, `/commerce/v1` OpenAPI 3.1 contract, Merge SHA `b7d16ecb75808c3622d3c5782c451c21b71e0f0f`), PR #943 (2/3, guest journey, Merge SHA `c05c62e392f7f33fe57fcb1f8ff1fe97a1a66740`), PR #944 (3/3, authenticated journey, Merge SHA `b8e1a121f202eb9cb967bcb056092f8a2305a5c9`) — each confirmed a genuine squash merge with a single parent via `git log --parents`. Per the owner's explicit split decision (asked via `AskUserQuestion` mid-task once the true scope, 31 routes across ~10 resource types, proved disproportionately large): full field-level contract rigor, matching `PublicApiOpenApiContractTest`'s own convention exactly, split into 3 reviewed-and-merged-in-sequence PRs rather than one large one. Implements ADR-13's partial-scope deliverable in full: `docs/openapi/commerce-api-v1.yaml` (all 31 routes, four `x-auth-tier` groups) + `CommerceApiOpenApiContractTest` (29 tests, four-part rigor) + a guest journey test (catalog→cart→checkout→order→signed lookup, 4 tests) + an authenticated journey test (auth→cart-identity-claim→saved-address→checkout→order→order-history, 2 tests) — both journeys now incorporating Shipping (ADR-10) and Payments (ADR-09) per ADR-13 §5's own incremental-extension instruction, since both landed after the ADR was written. Discovered and closed two real pre-existing bugs along the way: `CommerceCustomerAddressController` had no `rejectUnknown()` allow-list guard unlike every sibling mutation controller (an undocumented field was silently accepted, not rejected); `CommerceCheckoutService::emptyResponse()`'s address block was missing `building_no`/`additional_number`, violating the endpoint's own documented empty/populated key-set-parity invariant. Went through 3 rounds of automated (Codex) review across the stack (round 1 on #942 clean; round 2 on #943's accumulated diff found 5 findings — the `allOf`/`additionalProperties:false` incompatibility on `ProductDetail`/`ProductVariantDetail`, `Order.payment` referencing the wrong schema, an undocumented optional `X-Customer-Token` on cart/checkout, the contract test's own schema-drift check only validating top-level keys, and the `emptyResponse()` bug above — plus a sixth, `Cart.status` non-nullable despite `emptyResponse()` returning `null`, found independently on #944's accumulated diff; round 3 on the fix commit itself found 2 more — the new recursive validator's null-handling and `$ref`-type-checking both had real gaps, which on being fixed properly surfaced two more genuine schema-accuracy bugs, `CartItem.unit_name`/`Order.items[].unit_name` wrongly typed non-nullable). All findings across all three rounds verified as real and fixed; Codex then reported its review-usage limit exhausted for this account. Full `Commerce|Customer|Storefront|BranchIsolationGuard` regression stayed green throughout, final state: 1036 passed on SQLite, 1046 passed on PostgreSQL, 0 failed. `POST_MERGE_REVIEW: PASS` for the final merge (Gate 11): `main` verified to contain `b8e1a12` as its own tip; single-parent squash merge confirmed via `git log --parents` at each of the three merge points; post-merge CI on the exact final `head_sha` re-ran and passed on both required jobs — verified via the GitHub Actions API, run [35763886208](https://github.com/safwan5001-source/Nebrax/actions/runs/35763886208), `conclusion: success`. This closes the entire currently-authorized Commerce Mobile API readiness horizon (rows 1–10): Payments, Shipping, I18N, and the Vertical Slice are now all `done`; `COM-MOBILE-PROMO-1` remains explicitly `deferred` (ADR-11), not pending. No further row in this table is `ready`. Full evidence: `docs/plans/commerce/COM-MOBILE-VERTICAL-TEST-1-IMPLEMENTATION-REPORT.md`.

## Authorized horizon — AWJ Mobile Runtime Proof Horizon V1

STATUS: CLOSED (2026-09-23) — all 10 tasks `done`; see
`docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1_CLOSURE_REPORT.md`.
No task in this horizon is `ready`; continuation to a next horizon
requires new owner authorization per `AWJ-HORIZON-SYSTEM.md`'s closure
rule.

Source of truth:
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` (full task
  outcomes, dependencies, invariants, Quality Gates A–H, Definition of Done,
  Decision Gates — not duplicated here per the 00-START-HERE documentation
  rule).
- `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_BOOTSTRAP.md` (launch
  entrypoint).

Authorization: the previous Commerce Mobile API readiness closure V1
horizon (table above) is fully closed — see `CURRENT-STATE.md`. This
horizon starts from that closed state and executes sequentially and
autonomously per نظام الأفق, `MOBILE-RUNTIME-1` first.

| Order | Task ID | Status | Risk | Depends on | Outcome |
|---|---|---|---|---|---|
| 1 | MOBILE-RUNTIME-1 | done | normal | horizon authorization | Flutter workspace + toolchain proof |
| 2 | MOBILE-RUNTIME-2 | done | normal | MOBILE-RUNTIME-1 (done) | App Schema + compatibility kernel |
| 3 | MOBILE-RUNTIME-3 | done | normal | MOBILE-RUNTIME-2 (done) | Component + Action Registry |
| 4 | MOBILE-RUNTIME-4 | done | high | MOBILE-RUNTIME-1 (done) | Commerce OpenAPI client + secure session boundary |
| 5 | MOBILE-RUNTIME-5 | done | high | MOBILE-RUNTIME-3, MOBILE-RUNTIME-4 | Home/Product/Cart vertical UI |
| 6 | MOBILE-RUNTIME-6 | done | normal | MOBILE-RUNTIME-5 | ar/en + RTL/LTR + theme/accessibility |
| 7 | MOBILE-RUNTIME-7 | done | high | MOBILE-RUNTIME-3, MOBILE-RUNTIME-5 | Universal/App Links |
| 8 | MOBILE-RUNTIME-8 | done | high | MOBILE-RUNTIME-3, MOBILE-RUNTIME-7 | Push adapter + notification routing proof |
| 9 | MOBILE-RUNTIME-9 | done | normal | MOBILE-RUNTIME-6, 7, 8 | Android/iOS release-build proof |
| 10 | MOBILE-RUNTIME-10 | done | high | MOBILE-RUNTIME-9 | Final compatibility/security/performance/runtime evidence + horizon closure |

`MOBILE-RUNTIME-1` promoted directly to `ready`/`in_progress` from horizon
authorization (no further evidence gap): the horizon document itself is the
accepted source requirement, this is the first task, and its outcome
(workspace scaffold + toolchain baseline) has no unresolved product/
architecture decision — MR-01/MR-02 already fix Flutter-first and the
`mobile/` workspace location. Full task-by-task evidence recorded in
`CURRENT-STATE.md` as each completes.

`MOBILE-RUNTIME-1` is `done`: PR #948 merged (Merge SHA
`761d546c82b868850ed71889f49c8909dec0063b`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI green
on both required workflows (`ci.yml`, `mobile-ci.yml`), post-merge review
passed. Includes an owner-directed pre-merge correction: the initial
`sa.nebrax` Android/iOS identity and `'نبراس'` placeholder UI text were
corrected to a temporary `com.example.awjmobileruntimeproof` proof
identifier and `'أَوْج — AWJ Mobile Runtime'` text — no canonical AWJ mobile
namespace is documented anywhere, so none was invented; the production
Bundle/Application ID remains an explicit open Decision Gate recorded in
`mobile/README.md`. Full evidence:
`docs/plans/mobile/MOBILE-RUNTIME-1-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-2` promoted to `ready`/`in_progress` now that its hard
dependency (`MOBILE-RUNTIME-1`) is merged and post-merge reviewed. Source
requirement: `docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §4
MR-04 (App Schema shape) and Quality Gate B. No unresolved product decision:
MR-04's schema shape (schemaVersion/minRuntimeVersion, page definitions,
approved component instances, typed props/bindings, allowlisted actions,
navigation, theme tokens, compatibility/fallback) and RUNTIME_COMPATIBILITY_V1.md's
capability-manifest/fail-closed rules are already fixed; this task
implements a parser/validator/compatibility kernel against those already-
accepted contracts, not a new architecture decision.

`MOBILE-RUNTIME-2` is `done`: PR #950 merged (Merge SHA
`12ae268ff0f60b6f7d1044d58bd87b4dcb01eb10`, confirmed single-parent squash,
zero content drift), post-merge CI green on both required workflows,
post-merge review passed. 35/35 tests, 0 analyze issues, no new dependency.
Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-2-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-3` promoted to `ready`/`in_progress` now that its hard
dependency (`MOBILE-RUNTIME-2`) is merged and post-merge reviewed. Source
requirement: horizon doc §4 MR-04 (component candidate list: Page, Section,
Text, Image, ProductList, ProductCard, ProductDetail, Price,
VariantSelector, Quantity, AddToCart, CartList, CartSummary, Button,
Navigation target) and MR-05 (action allowlist: navigate, openProduct,
addToCart, updateCartQuantity, removeCartItem, refresh), Quality Gate B
("typed Component Registry", "typed Action Registry"). No unresolved
product decision: the identifier lists are already fixed (and already
mirrored in `mobile/lib/schema/registry_identifiers.dart`); this task gives
each identifier an actual typed Flutter widget/prop-schema and a typed
action-dispatch handler consuming `CompatibilityResolver`'s
`RenderableExperience` output — an implementation task against an
already-accepted contract, not a new architecture decision. Sensitive
actions (`addToCart`, `updateCartQuantity`, `removeCartItem`) will not yet
call a real Commerce API (that is `MOBILE-RUNTIME-4`/`5`) — this task's
dispatch layer is proved with an injectable/fake action handler, matching
the horizon's own task-4-comes-after-task-3 dependency ordering.

`MOBILE-RUNTIME-3` is `done`: PR #952 merged (Merge SHA
`b7637f3990702a2cd6277422493dae3eda3b3ced`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI
green on both required workflows, post-merge review passed. 72/72 tests
(37 new), 0 analyze issues, no new dependency. Full evidence:
`docs/plans/mobile/MOBILE-RUNTIME-3-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-4` promoted to `ready`/`in_progress` now that its hard
dependency (`MOBILE-RUNTIME-1`, done) is satisfied — it does not depend on
`MOBILE-RUNTIME-2`/`3` per the horizon's own dependency table (§8), though
this session continues sequentially. Source requirement: horizon doc §8
row 4, Quality Gate C ("generated or strongly typed client based on the
committed OpenAPI contract", "tenant/channel remain server-resolved",
"error envelope handled explicitly") and Gate D ("secure token/session
abstraction", "no token logging"). No unresolved product decision: the
`/commerce/v1` contract (`docs/openapi/commerce-api-v1.yaml`) is already
committed and accepted (COM-MOBILE-VERTICAL-TEST-1, done); this task
implements a typed client against it plus a secure-storage session
abstraction, not a new API design. Adding a secure-storage package (this
horizon's likely first non-trivial Flutter dependency) requires the MR-19
license/maintenance/security/native-permission review recorded in the
task's implementation report before it lands in `pubspec.yaml`.

`MOBILE-RUNTIME-4` is `done`: PR #954 merged (Merge SHA
`b645d33b84cfaa85266122f1ea0272c28ee79158`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI
green on both required workflows, post-merge review passed. 101/101 tests
(29 new), 0 analyze issues, one new dependency (`flutter_secure_storage`,
MR-19 review recorded in the report). Checkout/payments/orders/addresses
explicitly out of scope — not on Gate C's bar or MR-05's action allowlist.
Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-4-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-5` promoted to `ready`/`in_progress` now that both hard
dependencies (`MOBILE-RUNTIME-3`, `MOBILE-RUNTIME-4`) are merged and
post-merge reviewed. Source requirement: horizon doc §5 (Runtime proof
vertical slice: Boot → compatibility → Arabic/English shell → Home from
App Schema → product list from `/commerce/v1` → Product screen → Add to
Cart → Cart read/update/remove → persist/recover session material →
deep-link → push interaction) and §8 row 5. No unresolved product
decision: this task wires MOBILE-RUNTIME-2's schema/compatibility kernel,
MOBILE-RUNTIME-3's Component/Action Registry, and MOBILE-RUNTIME-4's
Commerce client together into real Home/Product/Cart screens — an
integration task against three already-accepted contracts, not a new
architecture decision. MOBILE-RUNTIME-3's report explicitly flagged one
open design point this task must resolve: `AddToCart` does not read a
sibling `Quantity`'s live value, so a page-level state coordinator is
needed (MR-06 state separation still applies — the coordinator holds
navigation/ephemeral UI state, never business authority). Deep links
(MR-08) and push (MR-09) remain `MOBILE-RUNTIME-7`/`8`'s scope, per §8's
own dependency table — this task's "deep-link into a supported screen"
line in the vertical slice is realized later via that same navigation
boundary, not built ahead of schedule here.

`MOBILE-RUNTIME-5` is `done`: PR #956 merged (Merge SHA
`5b2815a353bebc6a136ba682ef0b874f22c0e9ff`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI
green on both required workflows, post-merge review passed. 116/116 tests
(15 new), 0 analyze issues, no new dependency. `NoopActionHandler` is
retired; `RuntimeActionHandler` now wires every allowlisted action to
`CommerceClient`. Full evidence:
`docs/plans/mobile/MOBILE-RUNTIME-5-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-6` promoted to `ready`/`in_progress` now that its hard
dependency (`MOBILE-RUNTIME-5`) is merged and post-merge reviewed. Source
requirement: horizon doc §4 MR-10 (Localization) and MR-11
(Accessibility), Quality Gate E ("ar/en", "RTL/LTR", "large text",
"semantics", "VoiceOver/TalkBack smoke evidence where executable"). No
unresolved product decision: AWJ's project-wide rule already fixes
Arabic-first/RTL-first (CLAUDE.md), and full `flutter_localizations` was
already flagged as deferred-to-this-task since MOBILE-RUNTIME-1's own
report. This task adds the ar/en locale delegate stack, LTR support for
English, and accessibility semantics/large-text support to the existing
Home/Product/Cart screens — not a new screen or a new Commerce
interaction.

`MOBILE-RUNTIME-6` is `done`: PR #958 merged (Merge SHA
`1dfce398a9efc1afccdb91b250015e2cf5c462d5`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI
green on both required workflows, post-merge review passed. 123/123 tests
(7 new), 0 analyze issues, one new dependency (`flutter_localizations`,
Flutter SDK package — no MR-19 review needed). Building the required
large-text-resilience test surfaced and fixed two genuine pre-existing
MR-11 gaps (`NavigationTarget`'s direction-only chevron,
`ProductList`'s fixed-height overflow at accessibility text scale) —
neither introduced by this task. A CI flake in an unrelated pre-existing
test (`ZatcaQrCertificateMaterialExtractorTest`, non-deterministic EC
keypair generation) surfaced on this task's own post-merge docs commit;
root-caused and confirmed via a single re-run, no code change needed.
Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-6-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-7` promoted to `ready`/`in_progress` now that its hard
dependencies (`MOBILE-RUNTIME-3`, `MOBILE-RUNTIME-5`) are merged and
post-merge reviewed — `MOBILE-RUNTIME-6` was not itself a dependency, but
this session continues sequentially. Source requirement: horizon doc's
Universal/App Links task (Android App Links + iOS Universal Links routing
into the existing schema-driven navigation, per the horizon's own task
table). To be read in full before implementation: the horizon doc's
deep-link section and MR-06 state-separation rule (a deep link is a
navigation parameter, never business/session authority — MR-06 already
established this boundary for `RuntimeState.selectedProductId`).

`MOBILE-RUNTIME-7` is `done`: PR #960 merged (Merge SHA
`4929e9106e07c743a1c3814ae019064b2d625812`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI
green on both required workflows, post-merge review passed. 151/151 tests
(28 new), 0 analyze issues, no new dependency. `resolveDeepLinkUri`
validates scheme/host/path and maps to the exact same `navigate`/
`openProduct` `ActionRef` shape every schema-driven tap already
dispatches — structurally incapable of a destructive action and never
reads query parameters. Uses a placeholder `.example` domain, same
Decision Gate convention as MOBILE-RUNTIME-1's Bundle ID. Native
Kotlin/Swift changes are acknowledged as not build-verified by this
environment (no native build step exists until `MOBILE-RUNTIME-9`). Full
evidence: `docs/plans/mobile/MOBILE-RUNTIME-7-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-8` promoted to `ready`/`in_progress` now that its hard
dependencies (`MOBILE-RUNTIME-3`, `MOBILE-RUNTIME-7`) are merged and
post-merge reviewed. Source requirement: horizon doc's MR-09 (Push
boundary — "Prove a provider adapter boundary and one safe
notification-to-navigation path"; FCM may be used as proof transport but
this is not a permanent AWJ Messaging architecture decision, which is a
Decision Gate if it comes up) and Gate F ("push adapter proof",
"lifecycle handling for foreground/background/open-from-notification
where applicable"). To be read in full before implementation: MR-09's
exact wording and MOBILE-RUNTIME-7's own `DeepLinkController`/
`resolveDeepLinkUri` pattern — a notification-to-navigation path should
very likely reuse the identical `ActionRef`-through-`AppActionDispatcher`
pipeline rather than invent a third one, matching how MOBILE-RUNTIME-7
reused it for deep links instead of MOBILE-RUNTIME-5's own navigation.

`MOBILE-RUNTIME-8` is `done`: PR #962 merged (Merge SHA
`9a1e45b90643bc81f4dbf5085cbaaeda2daf3213`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI
green on both required workflows, post-merge review passed. 190/190 tests
(39 new), 0 analyze issues, no new dependency. `resolvePushPayload` maps a
notification's `data` payload to the exact same `navigate`/`openProduct`
`ActionRef` shape `resolveDeepLinkUri` already produces — structurally
incapable of a destructive action. `PushController` dispatches only on a
tap, never on mere foreground arrival. `ChannelPushAdapter` (a first-party
`MethodChannel`) is the only concrete adapter shipped — no vendor push SDK
(Firebase or otherwise) was added to `pubspec.yaml` or any native build
file; that remains an explicit, undecided Decision Gate per MR-09/MR-19,
deliberately not resolved on this task's own initiative. `CapabilityManifest`
gained a `nativeCapabilities` namespace (`push.notifications`) proving
MR-15's native capability rollout ordering and Gate F's iOS/Android
divergence requirement. Native Android/iOS permission-handling code is
acknowledged as not build-verified by this environment (no native build
step exists until `MOBILE-RUNTIME-9`). Full evidence:
`docs/plans/mobile/MOBILE-RUNTIME-8-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-9` promoted to `ready`/`in_progress` now that all three
hard dependencies (`MOBILE-RUNTIME-6`, `MOBILE-RUNTIME-7`,
`MOBILE-RUNTIME-8`) are merged and post-merge reviewed. Source requirement:
horizon doc's MR-12 (Build proof — release-mode buildability proof for
both Android and iOS as far as available CI/tooling permits; a successful
local/simulator debug run alone is insufficient) and Gate G (Android
release build, iOS release/archive build to the maximum non-signing level
available, no production signing/release required, build instructions
reproducible). To be read in full before implementation: MR-12/Gate G's
exact wording, and `.github/workflows/mobile-ci.yml`'s own header comment
(already states release-build jobs are added in this task). Store
signing, merchant certificates, and App Store/Google Play submission are
explicitly outside this horizon and remain owner-gated — never attempted
by this task.

`MOBILE-RUNTIME-9` is `done`: PR #964 merged (Merge SHA
`4b8bc4fda04ff960da691f43d625dccda2c54eea`, confirmed single-parent
squash onto `main`, zero content drift from the reviewed head),
post-merge CI green on both required workflows, post-merge review
passed. 190/190 tests unchanged, 0 analyze issues, no new dependency.
Two new `mobile-ci.yml` jobs (`android-release-build` on `ubuntu-latest`,
`ios-release-build` on `macos-latest`) prove Gate G — this session's own
Linux environment has neither an Android SDK nor Xcode, so this PR's own
CI run was the first real compile-time verification either release build
ever had, and it caught a genuine pre-existing Swift compile bug in
`AppDelegate.swift` (MOBILE-RUNTIME-8's unhandled optional plugin
registrar), fixed with a `guard let` unwrap. After the fix both
release-build jobs passed; a separately-hit `ci.yml` `pgsql` job failure
was confirmed as the same known EC-keypair-generation flake from
MOBILE-RUNTIME-6's report via one `rerun_failed_jobs`, unrelated to this
PR's diff. Both jobs upload their build artifacts for MOBILE-RUNTIME-10's
use. Full evidence: `docs/plans/mobile/MOBILE-RUNTIME-9-IMPLEMENTATION-REPORT.md`.

`MOBILE-RUNTIME-10` promoted to `ready`/`in_progress` now that its only
dependency (`MOBILE-RUNTIME-9`) is merged and post-merge reviewed — this
is the horizon's **final task** (§8 row 10). Source requirement: the
complete §9 Definition of Done, Gate H (final runtime evidence), and
MR-13 (capability manifest + runtime handshake), MR-14 (last-known-good
startup and offline safety), MR-15 (native capability rollout ordering),
MR-16 (lifecycle and network resilience), MR-17 (observability and
privacy), MR-18 (performance evidence) — all to be read in full before
designing anything, since this task closes the entire horizon rather than
proving one more incremental capability. Expected evidence: version-skew/
rollback matrix, compatible last-known-good and controlled-unavailable
startup paths, cold start/resume/network interruption/retry behavior,
diagnostics redaction proof, performance measurements against
`docs/plans/mobile/AWJ_MOBILE_RUNTIME_PERFORMANCE_BASELINE.md` (MR-18's
provisional baseline from MOBILE-RUNTIME-1), release artifact sizes (from
MOBILE-RUNTIME-9's uploaded CI artifacts), and a Flutter-viability
conclusion based on evidence — plus a horizon closure report.

`MOBILE-RUNTIME-10` is `done`: PR #966 merged (Merge SHA
`95198157f1b64e0e437675d9c0e01f45479d776d`, confirmed single-parent squash
onto `main`, zero content drift from the reviewed head), post-merge CI
green on both required workflows (including both release-build jobs on
the merge commit itself), post-merge review passed. This session was a
handoff from a prior session that hit its weekly usage limit mid-task; the
handoff checkpoint (base SHA, PR #965's merge SHA, "no MOBILE-RUNTIME-10
PR yet") was independently verified against live repo/GitHub state before
any work began, and both owner decisions recorded in the handoff were
preserved exactly: MR-14 (`mobile/lib/startup/`, last-known-good startup
decision mechanism) and MR-17 (`mobile/lib/diagnostics/`, diagnostic
context + redaction) are real, tested, standalone primitives with zero
production call site — no remote Published Experience fetch flow was
invented, and the real Home/Cart startup path (still rendering bundled
fixture schemas, unchanged since MOBILE-RUNTIME-5) was left undisturbed.
MR-16 (network resilience) added `ResilientCommerceTransport` (timeout +
bounded retry, `GET`-only — a mutating request always gets exactly one
attempt) as `CommerceClient`'s new default transport, plus an
`AwjRuntimeShell` lifecycle observer that re-triggers the existing
`refresh` action on background resume. A Gate H audit found horizon §6's
13-fixture compatibility matrix already 11/13 proven by MOBILE-RUNTIME-2/
8's existing tests; `startup/` closes the remaining two. Per the preserved
performance-evidence decision, real measurements were produced for
schema parse/resolve wall-clock and release artifact sizes (70,209,077
bytes zipped Android APK+AAB; 7,036,117 bytes zipped iOS `Runner.app`,
both from this task's own fresh CI build); every device-backed metric is
recorded as explicitly NOT MEASURED with the exact reason (no emulator/
Simulator/device in this environment; none provisioned, per explicit
owner instruction) rather than fabricated. 252/252 tests passing (62 new,
up from 190), 0 analyze issues, no native code touched. **This closes the
entire authorized `AWJ Mobile Runtime Proof Horizon V1`** — no task in
this horizon remains `ready`. Full evidence:
`docs/plans/mobile/MOBILE-RUNTIME-10-IMPLEMENTATION-REPORT.md`. Full
horizon closure report (Flutter viability conclusion, all 10 Merge SHAs,
remaining Decision Gates, next recommended horizon):
`docs/plans/mobile/AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1_CLOSURE_REPORT.md`.

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

## Authorized horizon — AWJ App Builder Horizon V1

STATUS: ACTIVE (2026-09-23) — authorized by `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1.md`
and its bootstrap `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1_BOOTSTRAP.md`, launched
after AWJ Mobile Runtime Proof Horizon V1 closed (`main@95198157f1b64e0e437675d9c0e01f45479d776d`).

Source of truth:
- `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1.md` (V1 product slice, AB-01..AB-12
  architecture decisions, dependency-safe task queue, Quality Gates A-F, Definition of Done,
  Decision Escalation Gates — not duplicated here per the 00-START-HERE documentation rule).
- `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1_EVIDENCE.md` (evidence pass).
- `docs/plans/store/AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`, `APP_SCHEMA_V1.md`,
  `COMPONENT_REGISTRY_V1.md`, `ACTION_REGISTRY_V1.md`, `DATA_RESOURCE_REGISTRY_V1.md`,
  `RUNTIME_COMPATIBILITY_V1.md` (accepted contract pack this horizon builds on).

| Order | Task ID | Status | Risk | Depends on | Outcome |
|---|---|---|---|---|---|
| 1 | APP-BUILDER-1 | done | normal | horizon authorization | Domain/persistence foundation (App/Draft/Published Experience Version, tenant/RBAC) |
| 2 | APP-BUILDER-2 | done | normal | APP-BUILDER-1 (done) | Schema validation + runtime capability contract |
| 3 | APP-BUILDER-3 | done | normal | APP-BUILDER-2 (done) | Component/Action/Data Resource registries |
| 4 | APP-BUILDER-4 | done | high | APP-BUILDER-3 (done) | App Manager + creation wizard (UI/UX Evidence Pass required) |
| 5 | APP-BUILDER-5 | done | high | APP-BUILDER-4 (done) | Builder workspace shell (UI/UX Evidence Pass required) |
| 6 | APP-BUILDER-6 | done | normal | APP-BUILDER-5 (done) | Visual editing + history |
| 7 | APP-BUILDER-7 | decision_required | normal | APP-BUILDER-6 (done) | Data/Actions/Conditions/Visibility (Develop mode) |
| 8 | APP-BUILDER-8 | done | high | APP-BUILDER-6 (done); no real dependency on APP-BUILDER-7 (verified, see below) | Theme + Use My Store Design |
| 9 | APP-BUILDER-9 | done | normal | APP-BUILDER-8 (done) | Templates + navigation/pages |
| 10 | APP-BUILDER-10 | done | high | APP-BUILDER-9 (done); no real dependency on APP-BUILDER-7 (verified, see below) | Validate/Publish/Version/Rollback foundation |
| 11 | APP-BUILDER-11 | done | high | APP-BUILDER-10 (done) | Integrated vertical proof + UX/security closure |
| 12 | APP-BUILDER-12 | done | normal | APP-BUILDER-11 (done) | Horizon closure — STOP for owner/ChatGPT review |

`APP-BUILDER-1` promoted directly to `ready`/`in_progress` from horizon authorization: the horizon
document itself is the accepted source requirement, this is the first task, and its outcome
(App/Draft Experience/Published Experience Version lifecycle, tenant/RBAC boundary) has no
unresolved product/architecture decision — AB-01/AB-02/AB-03 already fix the shape
(server-authoritative persistence, immutable versioned publish, reuse of the accepted App Schema
identity fields). Repository convention research (`BaseModel`/`CompanyWide` classification,
`Rbac::PERMISSIONS`, `ApplicationCatalog`, migration/service/controller/test house style) completed
before implementation per Gate 1/Gate 2.

`APP-BUILDER-1` is `done`: PR #969 merged (Merge SHA `0560429d5987d89549e9e436dc86d2504634eb38`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed head `869cde3`),
post-merge CI green on the merge commit (`ci.yml` run 35916107117, sqlite+pgsql both success),
post-merge review passed. 12 new focused tests + `ApplicationCatalogTest`/`TenantApplicationTest`
fixture updates for the new `commerce.app_builder` catalog key (44→45). Full evidence:
`docs/plans/app-builder/APP-BUILDER-1-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-2` promoted to `ready` now that its hard dependency (`APP-BUILDER-1`) is merged and
post-merge reviewed. Source requirement: horizon doc task 2 ("align backend validator with
accepted App Schema and Mobile Runtime capability manifest; compatibility negatives") and
`RUNTIME_COMPATIBILITY_V1.md`. No unresolved product decision: the capability-manifest concept and
fail-closed compatibility rules are already fixed by the accepted contract pack and proven by the
Mobile Runtime Proof horizon's own `CompatibilityResolver`; this task implements a PHP-side
validator against those already-accepted contracts (deepening `AppSchemaStructuralValidator`
introduced in APP-BUILDER-1), not a new architecture decision.

`APP-BUILDER-2` is `done`: PR #971 merged (Merge SHA `8844881de5171055342b397294d8d8fd7ae1e33f`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed head `30abaa3`).
Realigned the backend App Schema validator/`BuilderDraftExperience` schema shape to the real,
already-tested Mobile Runtime contract (`mobile/lib/schema/`) instead of the illustrative
architecture-doc shape used in APP-BUILDER-1 — the horizon's own anti-duplication rule required
this correction. Added `SchemaVersion`/`RuntimeCapabilities`/`AppSchemaParser`/`CapabilityManifest`/
`CompatibilityResult`/`CompatibilityResolver`, all faithful PHP ports of the corresponding Dart
files. 44 new/updated tests (16 + 10 mirror the Dart test suite's own taxonomy 1:1) + full
guard-test regression (55/55, no tenant/RBAC/ApplicationCatalog impact). Full evidence:
`docs/plans/app-builder/APP-BUILDER-2-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-3` promoted to `ready` now that its hard dependency (`APP-BUILDER-2`) is merged and
post-merge reviewed. Source requirement: horizon doc task 3 ("metadata contracts powering Inspector
and safe bindings/actions") and `COMPONENT_REGISTRY_V1.md`/`ACTION_REGISTRY_V1.md`/
`DATA_RESOURCE_REGISTRY_V1.md`. No unresolved product decision for the identifier set itself
(`RuntimeCapabilities` from APP-BUILDER-2 already fixes the 15 component / 6 action / 1 native
capability identifiers); this task adds the richer per-identifier metadata (props, bindings,
events, editor hints) those contract docs describe, against the same already-fixed identifiers —
an implementation task, not a new architecture decision.

`APP-BUILDER-3` is `done`: PR #973 merged (Merge SHA `4256d0aadb1a53f5288d054d5d937cd85ddf4d97`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed head `82cbc1a`),
post-merge CI green on the merge commit (`ci.yml` run 35931041709, sqlite+pgsql both success),
post-merge review passed. Added
`ComponentRegistry`/`ActionRegistry` (full per-identifier metadata: props, children rules,
actionability, typed action params) plus a deliberately empty `DataResourceRegistry`. Two scoping
findings, both repository-evidence-grounded (not product decisions): (1) the real, tested schema
contract (`SchemaComponent._allowedKeys`) has no `bindings` field at all, so no Component "Bindings"
metadata was invented; (2) no `COMMERCE_MOBILE_API_READINESS.md` exists and the Mobile Runtime
horizon never built live data binding, so `DataResourceRegistry` ships empty (guarded by a test)
rather than populated with speculative resources. 14 new focused tests, zero modified files (fully
additive), full local suite shows zero regressions (35 pre-existing unrelated failures, same as
APP-BUILDER-1/2's documented `bcmath`/`app/Mail` local-environment gaps). Full evidence:
`docs/plans/app-builder/APP-BUILDER-3-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-4` promoted to `ready` now that its hard dependency (`APP-BUILDER-3`) is done.
**Requires a UI/UX Evidence Pass and AWJ Design System conformance check before implementation**
per the horizon's own gate for the first major Builder UI slice — not to be skipped.

`APP-BUILDER-4` is `done`: PR #975 merged (Merge SHA `163bcc1c27ad87e874626710910a28e381029cd0`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed head `0a14ffa`),
post-merge CI green on the merge commit (both `ci.yml` run 35935456801 and `web-ci.yml` run
35935456789, sqlite+pgsql/web build all success), post-merge review passed. Completed
a focused UI/UX Evidence Pass (`APP-BUILDER-4-UX-EVIDENCE-PASS.md`) before any implementation, per
the horizon's mandatory gate for the first major Builder UI slice — external interaction evidence
(WordPress.com site creation, Shopify theme library, empty-state UX literature), retained/rejected
patterns, and an explicit AWJ UX Decision, all reusing the AWJ Design System's existing components
exclusively (no new visual primitive). Built `/app-builder` (list), `/app-builder/new` (path-first
creation: Use My Store Design / Choose Template / Start From Scratch), `/app-builder/[id]`
(overview) — pure frontend, zero backend files touched, consuming APP-BUILDER-1's existing REST
API unchanged. Sidebar entry added to the `sales` group, gated by the same
`commerce.app_builder`/`apps_builder.view` mechanism every other catalog-backed nav item uses.
11 new focused tests, all passing; found and fixed one real test-mock bug (unstable `next-intl`
mock reference causing an infinite re-render loop in the test only, not production code) before
any external review. Full evidence: `docs/plans/app-builder/APP-BUILDER-4-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-5` promoted to `ready` now that its hard dependency (`APP-BUILDER-4`) is done.
**Requires its own focused UI/UX Evidence Pass and AWJ Design System conformance check before
implementation** — the bootstrap explicitly requires repeating this workflow per major Builder UI
slice, not reusing APP-BUILDER-4's pass.

`APP-BUILDER-5` is `done`: PR #977 merged (Merge SHA `f48d583`), docs follow-up PR #978 merged
(Merge SHA `84d528a`), post-merge review passed. Completed its own focused UI/UX Evidence Pass
(`APP-BUILDER-5-UX-EVIDENCE-PASS.md`) — external evidence (Oracle Visual Builder/Page Designer,
Sitecore Page Builder docs) plus internal precedent (`ExperienceBuilder.tsx`, the Store
Customizer's already-shipped workspace chrome — a different product/data model, only the
interaction shape reused). Built the Builder workspace shell: read-only Pages/Layers panel,
framework-neutral canvas (15 component types, defensive prop fallbacks matching
`component_widgets.dart`), read-only Inspector driven by APP-BUILDER-3's registries (first real
consumer, as flagged in that task's own report), locale/device preview toggles, Draft/Saved badge,
responsive mobile baseline. New backend route `GET /app-builder/registries` (serializes
`ComponentRegistry`/`ActionRegistry`), same `apps_builder.view`/`commerce.app_builder` gate as
every other app-builder route. Editing itself (add/remove/reorder/property edits/undo-redo) was
explicitly deferred to APP-BUILDER-6 — no editable field existed yet, by design. 4 new backend
tests + 3 new frontend tests, full guard-test regression (93/93). Full evidence:
`docs/plans/app-builder/APP-BUILDER-5-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-6` is `done`: PR #979 merged (Merge SHA `08c143b614be7f2b303528a17a13e862c08b6261`),
post-merge review passed. Judged to
need its own focused UI/UX Evidence Pass (`APP-BUILDER-6-UX-EVIDENCE-PASS.md`, completed before
implementation) — APP-BUILDER-5's own pass left this as an open question, and this task's
interaction problem (the workspace's first destructive/undoable actions and its first form inputs)
is materially different from a read-only shell. Turned APP-BUILDER-5's shell into a real editor:
select/add/remove/reorder (bounded to same-parent siblings, via `@dnd-kit` reused verbatim from
`section-designer.tsx`'s existing pattern — no new dependency), inline typed property/action-param
editing (one control per registry `PropType`, `enum_values` as a `<Select>`, `amountMinor` as a
Riyal-denominated input converted at the edit boundary), a bounded (50-entry) undo/redo history,
and explicit Draft/Unsaved/Saving/Saved state with a Save action calling APP-BUILDER-1's existing
`PUT /app-builder/apps/{id}/draft` unchanged. Zero backend files touched. Caught and fixed two real
issues via self-review before any external review: a dropped "unknown action type" fallback
message, and a React Strict-Mode hazard (ref mutation inside a `setState` updater function) fixed
by design before any test was written. 17 new tree-helper unit tests + 6 new/expanded workspace
tests (9/9 total, up from 3/3), full frontend suite 2037/2037, full backend suite unaffected
(4630 passed, same pre-existing unrelated failure set). Full evidence:
`docs/plans/app-builder/APP-BUILDER-6-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-7` initially promoted to `ready` now that its hard dependency (`APP-BUILDER-6`) is
done, then **evaluated for implementation and found not ready** — moved to `decision_required`:

Source requirement: horizon doc task 7 ("Data/Actions/Conditions/Visibility — bounded Develop
controls using registries; no arbitrary code/HTTP"). Before implementing, read the real, tested
App Schema contract (`mobile/lib/schema/app_schema.dart`) and the architecture doc's own section
on this exact surface (`AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §13/§13A, "Data binding,
state, events and conditions"), per the horizon's own anti-duplication rule ("do not invent a
second schema/runtime contract" — the same check that corrected APP-BUILDER-1→2 and kept
APP-BUILDER-3's `DataResourceRegistry` honestly empty).

Finding: three of this task's four named concepts have **no backing in the accepted, tested
Mobile Runtime contract today**, and building them requires inventing exactly what the
architecture doc explicitly says is not yet decided:
- **Data** — `DataResourceRegistry::RESOURCES` ships empty by APP-BUILDER-3's own explicit
  decision; §13B: "the final registry is not yet locked." A "Data" tab has nothing real to bind.
- **Conditions** — `SchemaComponent._allowedKeys` (`type`/`id`/`optional`/`props`/`children`/
  `action`) has no condition/expression field. §13's own "Open Decision" reads verbatim: "Do not
  invent an expression engine from competitor UI alone" and lists "expression syntax/engine" among
  the items explicitly **not** to lock yet.
- **Visibility** — same gap. The existing `optional` boolean is `CompatibilityResolver`'s own
  fallback-pruning flag (decided by runtime capability, not merchant intent) — a different concept
  that happens to share vocabulary, not a usable substitute for a merchant-authored show/hide rule.
- **Actions** — the one concept with real backing (`ActionRegistry`, `RuntimeCapabilities`) — is
  already fully built, in APP-BUILDER-6 (attach/detach/edit action + typed params).

The architecture doc's own Builder-workspace diagram (§4) is explicitly labeled "Conceptual layout
only — not locked UI," so this is not a UI-shape question APP-BUILDER-7 can resolve by picking a
different layout. Implementing real Conditions/Visibility editing requires either a new App Schema
expression/condition contract or a new Data Source Registry contract — both are "material App
Schema security/authority changes," a Decision Escalation Gate per the horizon bootstrap, and both
are explicitly listed as **not yet locked** in the accepted architecture doc, which itself warns
against inventing them "from competitor UI alone." This is not an evidence gap Claude can resolve
by building a narrower version — a Decision Escalation packet was delivered to Safwan/ChatGPT.
Execution of `APP-BUILDER-7` is paused pending that decision.

**Owner decision (2026-09-24):** proceed to `APP-BUILDER-8` after a narrow dependency check;
`APP-BUILDER-7` stays explicitly deferred (`decision_required`) — not completed, not permanently
skipped — to be returned to through its own dedicated architecture/evidence decision before any
implementation. Do not invent a Data Source Registry, expression/condition language, or
merchant-authored visibility semantics merely to unblock sequencing. Escalate again only if a
later task turns out to have a genuine architectural dependency on `APP-BUILDER-7`'s output, or
another Decision Escalation Gate is reached.

**Dependency check performed:** `APP-BUILDER-8`'s content (`AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`
§6, "Shared store/app theme foundation" — shared brand/theme mapping, Linked/Review-Changes/
Independent sync policy, override tracking, Detect → Diff → Preview → Apply) operates entirely on
the App Schema's `theme.tokens` field (`ThemeTokens` in `mobile/lib/schema/app_schema.dart` —
already accepted, already parsed, a plain `Map<String, String>` of token→value pairs with no
condition/expression/data-binding involved) and on Store Customizer's existing theme data
(`commerce.storefront`, already shipped). It never touches `SchemaComponent`-level Actions,
Conditions, Visibility, or Data bindings — a structurally separate part of the schema and a
separate workspace surface (a Theme editor, not the per-component Inspector). Confirmed: **no real
runtime/schema dependency on `APP-BUILDER-7`**. Table updated: `APP-BUILDER-8`'s dependency is now
`APP-BUILDER-6 (done)`, promoted to `ready`.

`APP-BUILDER-8` is `done`: PR #983 merged (Merge SHA `1248223dd1668ad840f2b39f21e3de5a6d86755b`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed head `4c28197`),
post-merge CI green on the merge commit (`ci.yml` run 35968746817 sqlite+pgsql both success,
`web-ci.yml` run 35968746879 success). A focused UI/UX Evidence Pass
(`APP-BUILDER-8-UX-EVIDENCE-PASS.md`) was completed before implementation. Added a **Theme** tab to
the Builder workspace's structure panel editing `schema.theme.tokens` (manual preset/color/radius/
density/product-card-style editing, plus **"Use My Store Design"** — a one-time Detect → Diff →
Preview → Apply sync against the Store Customizer's real, already-shipped presentation data, the
architecture doc's own "Review Changes" preferred-default mode). Canvas preview reflects the
theme's primary color live via CSS custom properties; radius/density/product-card tokens are
persisted/diffed/synced but not yet visually reflected in the canvas (`tailwind.config.ts`'s
`borderRadius.DEFAULT` is a fixed value, not CSS-variable-driven) — an explicitly documented, scoped
gap. Pure frontend — zero backend files touched. Honored every explicit constraint from the owner's
APP-BUILDER-7 resolution: no Data Source Registry, expression/condition language, or
merchant-authored visibility semantics invented; no duplication of APP-BUILDER-6's Actions editing;
`APP-BUILDER-7` left untouched, still `decision_required`. 4 new `app-builder.ts` unit tests (21/21
total) + 5 new workspace tests (14/14 total), full frontend suite 2046/2046 passing, `npm run build`
succeeds, `ar.json`/`en.json` key parity verified, full backend suite unaffected (4630 passed / 35
pre-existing-failure baseline unchanged, zero backend source drift). Full evidence:
`docs/plans/app-builder/APP-BUILDER-8-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-9` (Templates + navigation/pages) — dependency check performed before implementation,
mirroring `APP-BUILDER-8`'s: source requirement is "same schema/runtime; safe system page
constraints and minimum shell" (horizon doc task 9). Read the real, accepted, tested contract
before scoping: `mobile/lib/schema/app_schema.dart`'s `SchemaNavigation` is "**deliberately
minimal** — `initialPageId` is the only concept needed" (its own doc comment), and
`app/Services/AppBuilder/AppSchemaParser.php::validate()` already enforces the **entire** "system
page constraint" surface server-side today: `pages` must be a non-empty object, every page root's
`type` must be `'Page'`, and `navigation.initialPageId` must reference a declared page — no
"required page type" (cart/checkout/account) concept exists anywhere in the schema, parser, or
`CompatibilityResolver`. Unlike `APP-BUILDER-7`'s Data/Conditions/Visibility (which needed
inventing wholly new JSON fields and validation semantics), this task's entire scope is
representable in the already-accepted `pages: Map<String, SchemaComponent>` /
`navigation.initialPageId` shape: page add/remove/rename/set-initial as new client-side tree
operations (the `pages`-map analogue of `APP-BUILDER-6`'s component-tree helpers), with UI
guardrails that only mirror validation the server already performs (never removing the last page,
never leaving `initialPageId` dangling) — not a new contract. "Templates" (architecture doc §7:
"more than colors/screenshots... representable through the same app contract/runtime") is a small
curated set of complete, valid `AppSchema` starter payloads (multi-page, may reference theme
tokens/components/actions — all already-accepted concepts) selected in the `/app-builder/new`
wizard's existing `template` creation path (today honestly indistinguishable from `scratch`, per
that page's own comment: "محتوى التصميم/القالب الفعلي مؤجَّل صراحةً إلى APP-BUILDER-8/9"), written
through the same `POST /app-builder/apps` + `PUT .../draft` endpoints `APP-BUILDER-8` already used
unchanged. **Confirmed: no real runtime/schema dependency on `APP-BUILDER-7`, and no new App
Schema contract required** — table dependency is `APP-BUILDER-8 (done)` alone, `ready`.

`APP-BUILDER-9` is `done`: PR #985 merged (Merge SHA `c054c9c2425e0f1f6172cee437d9fc2415073b66`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed head `0312ad0`
despite two unrelated commits landing on `main` in between — verified with a path-restricted diff
comparison), post-merge CI green on the merge commit (`ci.yml` run 35981924200 sqlite+pgsql both
success, `web-ci.yml` run 35981924104 success). This PR grew to also carry `APP-BUILDER-8`'s
post-merge documentation (recording its own `POST_MERGE_REVIEW: PASS`, PR #983) since it was
pushed to the same still-open branch before that earlier docs-only PR had merged — both pieces are
independently complete and tested. A focused UI/UX Evidence Pass
(`APP-BUILDER-9-UX-EVIDENCE-PASS.md`) was completed before implementation. Delivered: page
add/remove/set-home in the Builder workspace's Pages tab (new `pages`-map helpers in
`app-builder.ts`, guardrails mirroring `AppSchemaParser::validate()`'s own checks exactly — never a
new rule); a real page picker for the `navigate` action's `pageId` param in the Inspector,
replacing a free-text field that had no validation against real pages anywhere; a small curated
template set (Blank, Catalog) in `/app-builder/new`'s `template` creation path, each a complete,
valid `AppSchema` applied via a second `PUT .../draft` call right after app creation — Catalog's
`Button`→`navigate` action doubles as a live demonstration of the new page navigation. Pure
frontend — zero backend files touched. 7 new `app-builder.ts` unit tests (28/28 total) + 4 new
Builder-workspace tests (18/18 total) + 2 new creation-wizard tests (5/5 total), full frontend
suite 2060/2060 passing, `npm run build` succeeds, `ar.json`/`en.json` key parity verified, full
backend suite unaffected (4630 passed / 35 pre-existing-failure baseline unchanged, zero backend
source drift). Full evidence: `docs/plans/app-builder/APP-BUILDER-9-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-10` (Validate/Publish/Version/Rollback foundation) — dependency check performed
before implementation, mirroring `APP-BUILDER-8`/`APP-BUILDER-9`'s. Source requirement: "Draft →
Validate → Published Experience; immutable versions; compatibility-safe rollback within contract"
(horizon doc task 10). Read the real backend contract before scoping (models, services, routes,
RBAC, prior implementation reports — not the architecture doc's richer aspiration alone):

- **Already built (APP-BUILDER-1/2):** `BuilderPublishedExperienceVersion` is a fully immutable row
  (model-level `booted()` guard rejects any `update`/`delete` outright), race-safe sequential
  `version` numbering per app, a full independent `schema` snapshot at publish time.
  `BuilderPublishedExperienceVersionService::publish()` already runs the exact two checks task 10
  asks for — `AppSchemaParser::validate()` (structural) then `CompatibilityResolver::resolve()`
  against the live `CapabilityManifest` (fail-closed: an incompatible schema is rejected outright,
  no partial/staged publish) — before creating the version row. `apps_builder.publish` is already a
  distinct, narrower RBAC permission from `.manage`, gating `POST .../versions`. `GET .../versions`
  and `GET .../versions/{version}` (returning the full historical `schema`) already exist.
- **Genuinely missing (confirmed by direct grep, zero implementation found):**
  - No standalone validate-only/dry-run endpoint — draft save only runs structural validation, not
    the compatibility check; a merchant cannot know a draft would fail `CompatibilityResolver`
    without attempting a real (gated, irreversible-feeling) publish.
  - No rollback of any kind. The model's own docblock and `RUNTIME_COMPATIBILITY_V1.md` §15 already
    settle the *mechanism* — "modeled as publishing a new version on top, never mutating an old
    row" — so this is not an open design question requiring escalation, only unbuilt.
  - Frontend: `/app-builder/[id]` shows only a bare read-only version+date list (no note, no
    publisher, no Publish button, no Validate button, no rollback affordance anywhere).
- **Explicitly scoped out of this task** (architecture doc §"Validation UX"/"Publish flow"/"Version
  comparison" richer aspirations, the same class of not-yet-decided items that made `APP-BUILDER-7`
  a Decision Escalation Gate when treated as a hard requirement): a structured, itemized,
  Blocker/Warning/Info Issues panel (today's single thrown-exception error message is kept — the
  same "fail closed with one clear message" posture `APP-BUILDER-8`'s Store Design sync already
  established); human-readable version-to-version diffs; native-build/release impact classification
  (§"Impact classification" — no backing data model exists, mobile store submission is a wholly
  separate, unbuilt concern); optimistic-concurrency conflict detection on draft save (a real,
  already-flagged `APP-BUILDER-1` backlog item, adjacent but not this task's stated line). None of
  these are required by the horizon doc's own task-10 outcome line, and none block a real, honest
  Validate/Publish/Rollback.
- **Rollback's real mechanism needs zero new backend business logic**: `GET .../versions/{version}`
  already returns the full historical `schema`; restoring it is exactly one `PUT .../draft` call
  (already accepts any structurally-valid schema) followed by an ordinary `POST .../versions`
  publish — which re-runs the *exact same* compatibility check automatically, satisfying
  "compatibility-safe rollback within contract" for free, no new validation rule invented. Only
  genuinely new backend surface: a thin validate-only endpoint that runs the same two existing
  validators without creating a row (exposing existing logic as a standalone check, not new rules) —
  the first backend files this horizon touches since `APP-BUILDER-2`, unlike `APP-BUILDER-6/8/9`'s
  zero-backend precedent, and narrowly justified by task 10's own explicit "Validate" step.

**Confirmed: no real runtime/schema dependency on `APP-BUILDER-7`** — rollback/publish/validate all
operate on the whole schema as an already-validated opaque document via the already-accepted
`AppSchemaParser`/`CompatibilityResolver`, never touching `SchemaComponent`-level Actions/
Conditions/Visibility/Data. Table dependency is `APP-BUILDER-9 (done)` alone, promoted to `ready`.

`APP-BUILDER-10` is `done`: PR #988 merged (squash SHA `b69f98125d0b9010986cd7df16247dea68d4e0e4`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed pre-merge head
`10babae` verified via a path-restricted diff), post-merge CI green on the merge commit itself
(`ci.yml` run `35989443086` sqlite+pgsql both success, `web-ci.yml` run `35989443048` success).
This PR grew to also carry `APP-BUILDER-9`'s post-merge documentation and the `APP-BUILDER-10`
dependency check above, since implementation began on the same still-open branch before that
earlier docs-only content had merged — all pieces independently complete and tested. Delivered
exactly the three pieces scoped above: a `POST .../validate` endpoint (refactored out of
`publish()`'s existing two checks, creates no row); a "Publish" dialog in the Builder workspace
header that auto-runs Validate, shows its result, and is disabled — with a visible reason — while
the draft is unsaved or the user lacks `apps_builder.publish`; a `/app-builder/[id]/versions` page
listing every published version with its note/publisher and a "Restore to draft" action that writes
the historical schema back via the existing `PUT .../draft` and redirects into the Builder
workspace — never auto-publishing. Zero new App Schema contract, zero duplication of `APP-BUILDER-6`
Actions editing, `APP-BUILDER-7` left untouched, still `decision_required`. 4 new `BuilderAppTest`
cases (22/22 total) + 97/97 across the full App Builder/RBAC/tenancy test slice, 4 new Builder-page
tests (22/22 total) + 4 new versions-page tests (new file) + 3/3 detail-page tests, full frontend
suite 2076/2076 passing, `npm run build` succeeds, `ar.json`/`en.json` key parity verified, full
backend suite 4634 passed / 35 pre-existing-failure baseline unchanged (zero backend source drift,
+4 matching this task's new tests exactly). Full evidence:
`docs/plans/app-builder/APP-BUILDER-10-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-11` (Integrated vertical proof + UX/security closure) — dependency check performed
before implementation, mirroring every prior task's. Source requirement (horizon doc task 11):
*"create app → edit → bind real Commerce resource → validate → publish → proven Flutter runtime
consumes compatible experience fixture/contract; tenant/RBAC/security/accessibility/bidi/
regression evidence."* Unlike every prior task in this horizon, this one's literal requirement is
**not** satisfiable inside the accepted, tested contract — confirmed by direct reading, not
inference:

- `SchemaComponent._allowedKeys` in the tested `mobile/lib/schema/app_schema.dart` accepts only
  `type/id/optional/props/children/action` — a `bindings` key is structurally rejected
  (`unknown_key`), not merely unsupported today.
- `DataResourceRegistry::RESOURCES` is deliberately empty (`APP-BUILDER-3`'s own finding, guarded
  by its own test) — zero Commerce data resources exist in the compatible runtime contract.
- Every registered `Action` is `DISPATCH_PROVEN_NOOP` — real Commerce API dispatch
  (`MOBILE-RUNTIME-4/5`) was never built; that work belongs to the **already-closed** Mobile
  Runtime Proof V1 horizon, not this one.
- `AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §"Open Decisions after 04B" lists "exact Data
  Source Registry contract" as explicitly **not locked** — the identical undecided item that made
  `APP-BUILDER-7` a Decision Escalation Gate.

Escalated to the owner (the same posture `APP-BUILDER-7` itself used). Owner decision (2026-09-24,
option 2): redefine APP-BUILDER-11 as an **Integrated Proof of the currently accepted and actually
implemented App Builder contract** — prove the full real journey (create → edit →
components/actions already supported → theme / Use My Store Design → pages/navigation/templates →
Validate → Publish → immutable published version → restore/rollback to draft → revalidate) end to
end, using only real existing behavior, with tenant/RBAC/security/accessibility/bidi/regression
evidence drawn from what is actually built. Explicitly never invent `bindings` in App Schema, a
Data Resource Registry contract, a condition/expression contract, merchant-authored visibility
semantics, arbitrary JS/expression evaluation, real Commerce API action dispatch, or a new
Flutter/runtime contract merely to satisfy the original aspirational wording — and never claim
real Commerce resource binding or live Commerce runtime dispatch is proven. That portion of the
original task-11 intent is recorded as a connected deferred/`decision_required` follow-up track
with `APP-BUILDER-7`, for owner/ChatGPT review after Horizon closure (`APP-BUILDER-12`) — not
silently dropped, not marked done. Full redefinition record:
`docs/plans/app-builder/APP-BUILDER-11-UX-EVIDENCE-PASS.md`. **`APP-BUILDER-7` itself remains
untouched, still `decision_required`.** Table dependency is `APP-BUILDER-10 (done)` alone,
promoted to `ready`.

`APP-BUILDER-11` is `done`: PR #990 merged (squash SHA
`a7a2e0c35ee5a0a2ddebe7aaf23e281f861ce744`, confirmed single-parent squash onto `main`, zero
content drift from the reviewed pre-merge head `9ce280c` verified via a path-restricted diff),
post-merge CI green on the merge commit itself (`ci.yml` run `36003417429` sqlite+pgsql both
success; no `web-ci.yml` run was expected or triggered since the diff touches only
`tests/Feature/` and `docs/`). Delivered exactly the redefined scope above: one new test file,
`tests/Feature/AppBuilderIntegratedProofTest.php`, driving the real, already-shipped HTTP contract
through one connected merchant journey (create → edit → theme sync from a real seeded
`Storefront`/presentation → pages/navigation → Validate → Publish → immutable version → restore to
draft → revalidate → Publish again, proving an exact round trip) plus tenant-isolation and RBAC
coverage across every surface the proof touches, plus an explicit boundary test proving `bindings`
is still rejected and `DataResourceRegistry` stays empty after the full lifecycle runs. Zero
production code changed. 4/4 new tests passed (61 assertions), 126/126 across the full App
Builder/Commerce-workspace regression slice (741 assertions), full frontend suite 2076/2076
passing (unaffected), `npm run build` succeeds, `npx tsc --noEmit` zero errors, full backend suite
4638 passed / 35 pre-existing-failure baseline unchanged (zero backend source drift, +4 matching
this task's new tests exactly). The original task-11 intent's real-Commerce-binding/live-runtime
portion is recorded as a connected deferred/`decision_required` follow-up track with
`APP-BUILDER-7`, carried into `APP-BUILDER-12`'s closure report — not silently dropped, not marked
done. Full evidence: `docs/plans/app-builder/APP-BUILDER-11-IMPLEMENTATION-REPORT.md`.

`APP-BUILDER-12` (Horizon closure) is `done`: PR #991 merged (squash SHA `ac6c375f669adfbcb9dc301c8296c42d8506c4b3`,
confirmed single-parent squash onto `main`, zero content drift from the reviewed pre-merge head
`9d0828d` verified via a path-restricted diff), post-merge CI green on the merge commit itself
(`ci.yml` run `36009975210` sqlite+pgsql both success). Produced the horizon's mandatory final
closure report — `docs/plans/app-builder/APP-BUILDER-12-HORIZON-CLOSURE-REPORT.md` — covering all
11 completed tasks with their PR/merge-SHA evidence, tenant/RBAC/App-Schema-declarative-only
security evidence, accessibility/bidi evidence, runtime compatibility evidence, cumulative
regression evidence, the one connected deferred architecture track (`APP-BUILDER-7` +
`APP-BUILDER-11`'s original real-Commerce-binding clause, both tied to the same unlocked Data
Source Registry boundary), known limitations carried forward (not blockers), the horizon's
explicit out-of-scope boundary, and a next-horizon recommendation.

**AWJ App Builder Horizon V1 is CLOSED.** Per the horizon bootstrap's own "Horizon End" rule, this
session STOPS here — no automatic continuation to Preview & Testing or any new horizon.

---

## Horizon: AWJ App Builder — Commerce Data & Dynamic Runtime V1

STATUS: **ACTIVE — Decision Gate approved (ADR-01), Option A with amendments.** See
`docs/plans/app-builder/ADR-01-APP-BUILDER-COMMERCE-DATA-RUNTIME-V1.md` for the full decision
record: Decision Point 1 = YES (live fetch/cache loop in scope), Decision Point 2 = EXCLUDE
(customer profile/orders out of V1), Conditions/Visibility closed/typed/allowlisted only,
`commerce/v1` confirmed as the binding target, store-bearer credential lifecycle explicitly out of
scope (future App Factory boundary). `APP-BUILDER-21`/`APP-BUILDER-22` are mandatory.

Source of truth for this horizon:
- `docs/plans/app-builder/AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_BOOTSTRAP.md`
- `docs/plans/app-builder/AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md`
- `docs/plans/app-builder/ADR-01-APP-BUILDER-COMMERCE-DATA-RUNTIME-V1.md`

### Candidate queue (finalized, promoted to `ready` in dependency order)

| Order | Task ID | Status | Depends on | Outcome |
|---|---|---|---|---|
| 1 | APP-BUILDER-13 | done | ADR-01 | Data Resource Registry V1 foundation (populate `commerce.categories`/`commerce.products`/`commerce.cart`) |
| 2 | APP-BUILDER-14 | done | APP-BUILDER-13 | App Schema `binding` contract (parser + compatibility resolver) |
| 3 | APP-BUILDER-15 | ready (after 14) | APP-BUILDER-14 | Builder Data UX (Inspector binding editor) |
| 4 | APP-BUILDER-16 | done (schema contract) | ADR-01 | Conditions/Visibility contract (closed/typed/allowlisted) + Inspector UX |
| 5 | APP-BUILDER-17 | ready (after 14) | APP-BUILDER-14 | Mobile runtime binding/visibility resolver (replaces 3 hand-written screen implementations) |
| 6 | APP-BUILDER-18 | ready (after 17) | APP-BUILDER-17 | Real action dispatch wired through schema bindings |
| 7 | APP-BUILDER-19 | ready | ADR-01 (Decision Point 1 = YES) | Live publish → fetch → on-device-cache loop (Last Known Good) |
| 8 | APP-BUILDER-20 | ready (after 18+19) | APP-BUILDER-18, APP-BUILDER-19 | Same-Store integrated proof |
| 9 | APP-BUILDER-21 | ready | none (independent, mandatory) | App Builder UX/localization pass |
| 10 | APP-BUILDER-22 | ready | none (independent, mandatory) | Canvas + Flutter theme-token rendering fix |
| 11 | APP-BUILDER-23 | blocked | all above | Horizon closure report |

`APP-BUILDER-21`/`APP-BUILDER-22` have no dependency on the data/runtime track and may execute in
parallel with it.

**Scope note on row 4**: `APP-BUILDER-16`'s backend schema/compatibility contract (the closed/
typed/allowlisted `visibility` condition tree) is `done` — see below. Its Inspector UX (a
merchant-facing condition-builder editor) is deferred to land alongside `APP-BUILDER-15`'s binding
editor, since both are the same Inspector surface and neither has a backend dependency blocking the
other; tracked as `APP-BUILDER-15`'s scope now includes both editors, not a silently dropped item.

`APP-BUILDER-13` is `done`: PR #993 merged (squash Merge SHA
`ed6c485b317a15a67a742db1ae2c05b1f4e44ea0`, confirmed single-parent squash onto `main`, parent
`7e41f97`), post-merge CI green on the merge commit itself (`ci.yml` runs `36031721373`/`36031727596`,
sqlite+pgsql both `success`). This PR also carried the horizon's Phase 1 evidence pack and `ADR-01`
(landed as earlier commits on the same branch, since the Decision Gate was approved mid-CI). Delivered
exactly the scope in `ADR-01`: `DataResourceRegistry::RESOURCES` populated with the V1-locked
`commerce.categories`/`commerce.products`/`commerce.cart`, each field/filter/sort/pagination/auth
requirement read directly off the real `commerce/v1` controllers (`CommerceCategoryController`,
`CommerceProductController`, `CommerceCartController`/`CommerceCartService`) — new
`ResourceDefinition`/`ResourceFieldDefinition`/`ResourceFieldType`/`ResourceQueryParamDefinition`
classes mirror the existing `ComponentDefinition`/`PropDefinition`/`PropType` pattern. Purely
descriptive metadata; `AppSchemaParser`/`CompatibilityResolver` untouched (that's `APP-BUILDER-14`).
CI (sqlite job) caught one real regression before merge: `AppBuilderIntegratedProofTest`'s
`APP-BUILDER-11` boundary test asserted `DataResourceRegistry::RESOURCES` stayed empty — root-caused
and fixed in a follow-up commit on the same PR (updated the assertion to the new locked V1 scope; the
still-valid "`bindings` key structurally rejected" assertion in the same test was left unchanged,
since `AppSchemaParser` itself was not touched by this task). 10 new focused tests
(`DataResourceRegistryTest`, 37 assertions) + full `AppBuilder*` regression (12/12) green. Full local
suite: 4646 passed/36 failed(pre-existing local-only `bcmath`-missing failures, unrelated)/49 skipped
— not the real gate; CI (which has `bcmath`) is, and CI was green on the final head. No accounting
impact. `APP-BUILDER-14` promoted to `ready`.

**Owner clarification recorded** (2026-09-24, `ADR-01` amendment, PR #995 merged, squash Merge SHA
`fbccc252d0d75109279ce03fad65ed3bd2677226`): Storefront Web feature/UI completeness is never a
prerequisite for App Builder work — the two channels share Commerce truth, not a release schedule.
A missing Commerce capability (`commerce.promotions`, `commerce.categories.name_en`) is a recorded
gap, not an invitation to invent an app-specific substitute; escalate only if it actually blocks
this horizon's approved scope. Binding on `APP-BUILDER-15`..`23`, especially `APP-BUILDER-20`'s
Same-Store Proof scope (proves shared Commerce Core data/rules, not Storefront Web completeness).

`APP-BUILDER-14` is `done`: PR #994 merged (squash Merge SHA
`57d474e8042466afa52e0f76773f5b57eee7f3bd`, confirmed single-parent squash onto `main`, parent
`fbccc25`), post-merge CI triggered on the merge commit itself (`ci.yml` run `36036162058`).
Delivered exactly the scope in `ADR-01` §3.2: `AppSchemaParser` gains an optional `binding`
component-node key (closed sub-shape `resource`/`query`/`itemProps`, JSON-safe values only);
`CompatibilityResolver` resolves a node's `binding` using the exact same optional-prune/
required-fail-closed mechanism already used for `type`/`action.type` — unknown resource id, a
component not registered to bind that resource (`ComponentRegistry::bindableResources`, populated
for `ProductList`/`ProductDetail` → `commerce.products`, `CartList`/`CartSummary` →
`commerce.cart`), an `itemProps`/`query` key the resource doesn't expose, or a runtime not yet
declaring the resource (`CapabilityManifest::resourceVersion()`) are all "unsupported capability".
`RuntimeCapabilities::DATA_RESOURCES` is deliberately left empty — no Flutter Runtime consumes a
real binding yet, so every binding today is correctly treated as unsupported at publish time; that
capability only turns on once `APP-BUILDER-17` updates this constant **and**
`mobile/lib/schema/registry_identifiers.dart` together. **No Dart/`mobile/` file was touched by this
task** — this session has no Flutter SDK to verify `flutter analyze`/`flutter test`, so schema/
registry mirroring requiring simultaneous Dart verification is correctly deferred to
`APP-BUILDER-17`, which is scoped to land with real CI-verified Dart changes. A real design gap was
found and fixed during implementation: `itemProps` prop-key validation was originally checked
against the binding component's own `props` list, but `ProductList`/`CartList` (list-shaped
containers) declare no props of their own — the check now only applies when the component declares
props itself (`ProductDetail`/`CartSummary`), while resource-field validation always applies.
Updated `APP-BUILDER-11`'s boundary test: `binding` (singular) now saves successfully as a draft on
a bindable component but is still rejected at `/validate` (422); `bindings` (plural, the old
placeholder key) remains structurally rejected. 37 new/updated focused tests across
`AppSchemaParserTest`/`CompatibilityResolverTest`/`ComponentRegistryTest`, full `AppBuilder*`
regression green, full local suite 4664 passed/35 failed (same pre-existing `bcmath` baseline)/49
skipped. No accounting impact. `APP-BUILDER-16` promoted to `in_progress` (independent of
`APP-BUILDER-15`/`17`, per the queue's own dependency table).

`APP-BUILDER-16` (backend schema/compatibility contract) is `done`: PR #996 merged (squash Merge
SHA `22156e493ef830a34a372b5c74643ab20e37632f`, confirmed single-parent squash onto `main`, parent
`57d474e`). Adds the optional `visibility` component-node key from `ADR-01` §3.3: a closed, typed
condition tree (`{all:[...]}`/`{any:[...]}` combinators or a leaf `{signal, operator, value?}`),
bounded nesting depth (4) and branch count (16), leaf values restricted to scalars or flat scalar
lists — no expression engine. New `VisibilitySignal` (`cart.itemCount`, `customer.isAuthenticated`,
`product.inStock`) and `VisibilityOperator` (`equals`/`notEquals`/`gt`/`lt`/`gte`/`lte`/`in`/
`isTrue`/`isFalse`, each with its own value-arity rule) — closed, enumerated vocabularies.
`CompatibilityResolver` resolves `visibility` through the same optional-prune/required-fail-closed
mechanism already used for `type`/`action.type`/`binding`: unknown signal/operator, an arity
mismatch, or a runtime not yet declaring the `visibility` schema feature
(`CapabilityManifest::schemaFeatureVersion()`) are all "unsupported." `RuntimeCapabilities::
SCHEMA_FEATURES` stays deliberately empty for the same reason `DATA_RESOURCES` does — no Flutter
Runtime resolves a real visibility tree yet, so `APP-BUILDER-17` updates this constant and the Dart
mirror together. Visibility is presentation-only by construction — no authorization is touched; a
dispatched action's own independent `commerce/v1` server-side check is unaffected by what a hidden/
shown control implies. 46 new focused tests, full `AppBuilder*` regression green, full local suite
4680 passed/35 failed (same pre-existing `bcmath` baseline)/49 skipped. No accounting impact.
Inspector UX for authoring conditions deferred to land with `APP-BUILDER-15`'s binding editor (see
scope note above). `APP-BUILDER-21` promoted to `in_progress` (independent, mandatory).

# AWJ Master Execution Plan — Autonomous Agent Layer

## Purpose

This file defines how executable roadmap items are represented. It is not yet a claim that the entire historical AWJ backlog has been normalized into this format.

Do not invent completion status from old prose. Status must be grounded in repository/PR/CI/production evidence appropriate to the task.

## Status vocabulary

- `backlog` — known but not dependency-ready.
- `ready` — dependencies satisfied and authorized for implementation.
- `in_progress` — active implementation.
- `decision_required` — blocked by material decision.
- `review` — implementation complete enough for review/gates.
- `owner_gate` — technically ready but requires owner action.
- `blocked` — external/technical blocker.
- `done` — Definition of Done evidenced at the level required by the task.

Do not use `done` to mean "code written."

## Task record schema

Each executable task should include:

```yaml
id: DOMAIN-TASK-N
title: Human readable outcome
domain: commerce
status: ready
risk: low|normal|high|critical
depends_on: []
references:
  - docs/...
outcome: >
  Observable result, not prescribed code shape.
invariants:
  - tenant isolation
  - backward compatibility
acceptance:
  - concrete evidence criterion
tests:
  - focused
  - sqlite
  - postgres
merge_policy: standing-authority-after-pre-merge-review
deploy_policy: owner-approval
```

Optional:
- external_research_required;
- decision_ids;
- production_verification;
- rollout notes.

## Definition of Done

A task is `done` only when all task-specific acceptance criteria and applicable Quality Gates pass.

For a code task this normally means:
- implementation complete;
- required tests pass;
- self-review findings resolved;
- relevant CI observed;
- required docs/report updated;
- merge/deploy state represented truthfully.

If the task requires merge for true completion, keep it at `merge_ready`/`merged` until the standing merge workflow and post-merge review complete. Use `owner_gate` only for actions that still require Safwan, such as deploy/production release/destructive production operation or a material escalated decision.

## Current autonomous execution horizon

**STATUS: ACTIVE — Commerce Mobile API readiness closure V1.**

This horizon is deliberately bounded to the documented Commerce Mobile readiness gaps and their dependency chain.

Authoritative readiness source:
`docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` on `main`, accepted through merged and post-merge-reviewed PR #887.

Candidate order from that evidence:
1. Mobile Product Media.
2. Mobile Variant / Options / UOM contract.
3. Customer Mobile Auth + Profile.
4. Guest → Customer Cart transition.
5. Customer Addresses + Order History.
6. Payment architecture + Payment Methods.
7. Shipping method/rate refinement.
8. Coupons/Promotions only if V1 scope confirms them.
9. Explicit localization/fallback contract.
10. Runtime fixtures/integration tests for completed vertical slice.

**Authorization rule:** the horizon is authorized, but tasks are executable only after they are individually validated/promoted to `ready` from current `main`. Claude must not treat the full list as simultaneously ready.

## Initial seed task

```yaml
id: COM-MOBILE-MEDIA-1
title: Close the Public/Mobile Commerce product-media gap
domain: commerce
status: done
risk: high
depends_on:
  - accepted Commerce Mobile API readiness evidence
references:
  - docs/plans/store/COMMERCE_MOBILE_API_READINESS.md
  - docs/plans/store/DATA_RESOURCE_REGISTRY_V1.md
outcome: >
  Mobile Commerce clients can retrieve authorized product media through the
  /commerce/v1 trust boundary without reusing a web-host authority shortcut
  or creating a parallel media source of truth.
invariants:
  - Tenant Isolation
  - resolved mobile SalesChannel authority
  - product/category publication rules where applicable
  - no cross-tenant media leakage
  - existing product media storage remains source of truth
  - backward compatibility
acceptance:
  - authorized published product media is retrievable
  - unpublished/foreign-tenant/foreign-channel references cannot leak media
  - mobile product DTO can safely reference mobile media
  - relevant negative tests pass
  - no duplicate media storage/business authority introduced
tests:
  - focused media/API tests
  - tenant/channel/publication negatives
  - SQLite
  - PostgreSQL
merge_policy: standing-authority-after-pre-merge-review
deploy_policy: owner-approval
```

`COM-MOBILE-MEDIA-1` is `done`: merged via PR #911 (Merge SHA
`8386ece721f3e6b37c9f2ff8db64f10e2b44d9c4`), post-merge CI green on `main` (SQLite +
PostgreSQL), mandatory post-merge review passed. `GET /commerce/v1/media/{id}` +
`ProductMediaGalleryService` wiring into `CommerceProductController`, reusing
`/store/v1`'s existing hardened media authority with no parallel storage. Also fixed a
pre-existing production defect discovered via automated review: `disk = 'document'` media
(the real product-upload path) was returning a 500 in the already-shipped
`StorefrontMediaController` for `/store/v1` — fixed in both controllers. See
`docs/plans/commerce/COM-MOBILE-MEDIA-1-IMPLEMENTATION-REPORT.md` for full evidence.

Discovered backlog from this task (not yet scheduled): a dedicated rate-limit budget for
media downloads (currently shares the general read/unauth budget with catalog browsing on
both `/store/v1` and `/commerce/v1` — a configurable-policy decision, not a bug); batched
gallery loading for list endpoints (`ProductMediaGalleryService` currently resolves one
row at a time on both boundaries' `index()`).

## Second task

```yaml
id: COM-MOBILE-VARIANTS-1
title: Variant/options/UOM mobile contract
domain: commerce
status: done
risk: high
depends_on:
  - COM-MOBILE-MEDIA-1 (done)
references:
  - docs/plans/store/COMMERCE_MOBILE_API_READINESS.md
outcome: >
  A variant-managed product's GET /commerce/v1/products/{id} exposes options/
  variants (descriptor, per-variant price/stock/media) so a mobile client can
  select a concrete variant before calling the already-variant-aware
  POST /commerce/v1/cart/items.
invariants:
  - Tenant Isolation
  - no client-supplied variant id resolved on this read path
  - no cross-tenant/cross-product variant leakage
  - existing pricing/availability/cart variant authority remains source of truth
  - backward compatibility (index() list-row behavior unchanged)
acceptance:
  - variant-managed product detail exposes options/variants matching /store/v1's shape
  - inactive variant excluded
  - list endpoint keeps its deferred is_variant_managed-only row
  - tenant/channel/publication negatives pass
  - no sensitive field leakage
  - no new pricing/availability/cart-identity logic introduced
tests:
  - focused variant/API tests
  - tenant/channel/publication negatives
  - SQLite
  - PostgreSQL
merge_policy: standing-authority-after-pre-merge-review
deploy_policy: owner-approval
```

`COM-MOBILE-VARIANTS-1` is `done`: merged via PR #916 (Merge SHA
`40445016973d050963d25519ed15ba05e0de6b66`), post-merge CI green on `main` (SQLite +
PostgreSQL), mandatory post-merge review passed.
`CommerceProductController::variantResource()` mirrors
`StorefrontProductController::show()`'s already-shipped variant branch exactly — no new
pricing/availability/cart-identity logic, since `CommercePriceResolver`,
`AvailableToSellService`, and `CommerceCartController`/`CommerceCartService` were already
variant-aware before this task. Focused (7) + module regression (1001 tests) green on
SQLite and PostgreSQL. See
`docs/plans/commerce/COM-MOBILE-VARIANTS-1-IMPLEMENTATION-REPORT.md` for full evidence.

Discovered backlog from this task (not yet scheduled): an alternate-unit (UOM) selection
contract — neither `/store/v1` nor `/commerce/v1` expose selectable `unit_key`s/per-unit
prices beyond a variant's base unit, even though both cart endpoints already accept
`unit_key`. Needs a deliberate cross-boundary contract-design decision.

## Third task

```yaml
id: COM-MOBILE-AUTH-1
title: Customer mobile auth + profile
domain: commerce
status: done
risk: critical
depends_on:
  - identity architecture decision (resolved — ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md)
references:
  - docs/plans/store/ADR-05-CUSTOMER-MOBILE-IDENTITY-BOUNDARY.md
  - docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md
  - docs/plans/store/COMMERCE_MOBILE_API_READINESS.md
outcome: >
  A mobile Commerce client can authenticate a customer via phone+OTP
  (primary) or email+password (alternative) and retrieve its own profile,
  reusing the existing /customer/v1 identity authority unmodified rather
  than duplicating it, with no coupling to any real SMS/OTP vendor.
invariants:
  - Tenant Isolation
  - Commerce Authentication Identity / Customer Account / ERP User / Partner
    stay four distinct concepts (ADR-05)
  - guest checkout unchanged
  - /customer/v1 and /store/v1 behavior unchanged
  - no real SMS/OTP vendor coupling
  - OTP codes hashed at rest, never logged in plaintext
acceptance:
  - phone+OTP unified register-or-login issues a customer:access token
  - email+password reuses /customer/v1's own services byte-for-byte
  - X-Customer-Token (not Authorization) gates authenticated routes
  - cross-tenant/foreign-token/inactive-identity negatives pass
  - an unverified self-declared phone cannot be hijacked into an OTP login
  - SQLite/PostgreSQL verification
tests:
  - 24 focused tests (CommerceCustomerAuthApiTest)
  - full Customer|Commerce regression
  - SQLite
  - PostgreSQL
merge_policy: standing-authority-after-pre-merge-review
deploy_policy: owner-approval
```

`COM-MOBILE-AUTH-1` is `done`: Decision Escalation Gate resolved by Safwan
(`COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`) — full decision and rationale recorded in
`docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md`. Merged via PR #920 (Merge SHA
`a8f83b170eb2f696541e9f4d48d3db407ab02dd5`), post-merge CI green on `main` (SQLite +
PostgreSQL), mandatory post-merge review passed. Full evidence in
`docs/plans/commerce/COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md`. Two rounds of automated
(Codex) review found and this PR fixed 4 real issues before merge (a dropped audit trail for
authenticated customer requests, phone-OTP-only identities permanently ineligible for Partner
linking, an OTP-issuance concurrency race, and a shared-store-token rate-limit gap allowing
one customer to exhaust another's auth quota) on top of a fifth, self-found security issue
(OTP login resolving into a stranger's identity via an unverified, self-declared phone entered
through the separate email+password path) closed during implementation before the automated
review even ran. One trivial merge conflict against `main` (import ordering, from a
concurrently-merged unrelated PR) was resolved before merge.

Discovered backlog from this task (not yet scheduled): email verification delivery mechanism
(pre-existing gap inherited from the already-shipped `/customer/v1` stack, not introduced
here); a claim/dispute mechanism for a phone number squatted by an unverified email+password
registration before its real owner ever proves control via OTP (ADR-05 §16 itself defers
this); full E.164 phone normalization (country-default inference); real SMS/OTP vendor
selection (explicitly deferred to its own future Decision/Owner Gate).

## Fourth task

```yaml
id: COM-MOBILE-CART-IDENTITY-1
title: Guest → authenticated customer cart transition
domain: commerce
status: done
risk: critical
depends_on:
  - COM-MOBILE-AUTH-1 (done)
  - merge-policy decision (resolved — ADR-07-COMMERCE-CART-MERGE-POLICY.md)
references:
  - docs/plans/store/ADR-07-COMMERCE-CART-MERGE-POLICY.md
  - docs/plans/store/COMMERCE_MOBILE_API_READINESS.md
outcome: >
  Presenting a valid X-Customer-Token alongside a guest X-Cart-Token claims
  the guest cart outright when the customer has no existing cart, or merges
  its lines into the customer's existing cart (CommerceCartService::add()'s
  own unmodified quantity-sum semantics) when they do — across both cart and
  checkout entry points.
invariants:
  - Tenant Isolation
  - no price/availability frozen anywhere in the merge path (revalidateAndPrice() stays sole authority)
  - a claimed/merged cart is never resolvable by a plain guest bearer, even with the right token
  - customer_identity_id is never client-suppliable
  - full guest-flow backward compatibility when no X-Customer-Token is presented
  - one active cart per customer per sales channel (DB-enforced)
acceptance:
  - claim (no existing customer cart) and merge (existing cart) both work end to end, from cart and checkout entry points alike
  - concurrent-claim races are closed under lock on both write and read paths
  - a guest line no longer purchasable is dropped, never blocking sign-in or aborting the merge
  - an unrelated arithmetic/serialization failure aborts the whole merge, never silently drops a line
  - SQLite/PostgreSQL verification
tests:
  - 37 tests (CommerceCartMergeApiTest, grown across 11 review rounds)
  - full Commerce|Customer|Storefront|PublicApiOpenApiContractTest regression
  - SQLite
  - PostgreSQL
merge_policy: standing-authority-after-pre-merge-review
deploy_policy: owner-approval
```

`COM-MOBILE-CART-IDENTITY-1` is `done`: Decision Escalation Gate resolved by Safwan
(`COM-MOBILE-CART-IDENTITY-1-MERGE-POLICY`) — full decision and rationale recorded in
`docs/plans/store/ADR-07-COMMERCE-CART-MERGE-POLICY.md`. Merged via PR #924 (Merge SHA
`dffe6c86017e88019a82fceb2b0214d8a895b332`), post-merge CI green on `main` (SQLite +
PostgreSQL), mandatory post-merge review passed. Full evidence in
`docs/plans/commerce/COM-MOBILE-CART-IDENTITY-1-IMPLEMENTATION-REPORT.md`. 11 rounds of
automated (Codex) review found and this PR fixed real issues progressively hardening: guest/
owned-cart isolation, concurrent-claim races on both write and read paths for cart and
checkout, a bounded two-slot token-rotation grace window, quantity/monetary overflow handling
during merges, a channel-scoped active-cart uniqueness index, and consistent cart/checkout
lock ordering removing a latent deadlock risk that pre-dated this task. One finding (round 8,
"merge carts before authenticated checkout completion") was verified and explicitly declined
with reasoning posted on its PR thread rather than fixed: the literal remedy would have
orphaned the very checkout being completed (its cart_id never moves) or violated the
one-active-cart-per-customer invariant.

Discovered backlog from this task (not yet scheduled): `CommerceOrderService::createFromCheckout()`
still never reads `CustomerContext` (pre-existing, documented design) — a confirmed order
still has `customer_identity_id = null` regardless of cart ownership; this is
`COM-MOBILE-ORDER-HISTORY-1`'s job. A genuine multi-token-per-cart schema, if the bounded
two-slot token-rotation grace window ever proves insufficient for more than one interleaved
device touch in practice.

## Backlog discovery

Claude may discover new work while implementing.

If it is not required to complete the current outcome:
- record it as backlog;
- include evidence and suggested dependency/risk;
- do not silently expand current scope.

If it blocks correctness:
- classify it;
- resolve locally only if inside scope and non-material;
- otherwise invoke Decision Escalation.

## Future machine-readable queue

A YAML/JSON queue may be added after the task schema proves stable. Do not create two competing sources of truth prematurely.

The Markdown plan remains human-reviewable V1 authority.

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
status: review
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
  - 21 new focused tests (CommerceCustomerAuthApiTest)
  - full Customer|Commerce regression
  - SQLite
  - PostgreSQL
merge_policy: standing-authority-after-pre-merge-review
deploy_policy: owner-approval
```

Decision Escalation Gate resolved by Safwan (`COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`) — full
decision and rationale recorded in `docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md`.
Implementation on branch `claude/com-mobile-auth-1`, status `review` pending PR/CI/merge;
full evidence in `docs/plans/commerce/COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md`. A genuine
account-boundary security issue (OTP login resolving into a stranger's identity via an
unverified, self-declared phone entered through the separate email+password path) was found
and closed during implementation, before merge.

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

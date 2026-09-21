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
| 3 | COM-MOBILE-AUTH-1 | review | critical | identity architecture decision/readiness (resolved, ADR-06) | Customer mobile auth + profile |
| 4 | COM-MOBILE-CART-IDENTITY-1 | backlog | critical | COM-MOBILE-AUTH-1 | Guest → authenticated cart transition |
| 5 | COM-MOBILE-CUSTOMER-1 | backlog | high | COM-MOBILE-AUTH-1 | Addresses + customer order history |
| 6 | COM-MOBILE-PAYMENTS-1 | backlog | critical | checkout/auth/provider decisions | Payment methods + trusted payment lifecycle |
| 7 | COM-MOBILE-SHIPPING-1 | backlog | high | checkout contract | Shipping method/rate refinement |
| 8 | COM-MOBILE-PROMO-1 | backlog | high | V1 product decision | Coupon/promotion mobile contract if in scope |
| 9 | COM-MOBILE-I18N-1 | backlog | normal | resource contracts | Explicit localization/fallback |
| 10 | COM-MOBILE-VERTICAL-TEST-1 | backlog | high | selected vertical slice complete | Runtime/API integration fixtures and vertical proof |

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

**Decision resolved** (`COM-MOBILE-AUTH-1-IDENTITY-MECHANISM`, recorded durably in `docs/plans/store/ADR-06-COMMERCE-MOBILE-AUTH-MECHANISM.md`): support both phone+OTP (primary) and email+password (alternative) customer authentication on `/commerce/v1`, behind a provider-neutral OTP abstraction with no real SMS/OTP vendor integrated yet (Unifonic remains a future candidate only, a separate Decision/Owner Gate). `COM-MOBILE-AUTH-1` moved to `review`:
- Implementation reuses the existing, pre-existing-but-unwired `/customer/v1` identity stack (`CustomerIdentity`, `CustomerIdentityService`, `CustomerAuthenticationService`, `CustomerContext`, `EstablishCustomerContext` — all unmodified) extended into `/commerce/v1` via a new `X-Customer-Token` header/middleware, plus new OTP scaffolding (`CustomerOtpService`, `OtpProvider`/`FakeOtpProvider`, `CustomerPhoneAuthenticationService`).
- Full evidence, tests (21 new + full regression, SQLite + PostgreSQL), and a security fix found during implementation (phone-squatting account-boundary leak, closed before merge): `docs/plans/commerce/COM-MOBILE-AUTH-1-IMPLEMENTATION-REPORT.md`.
- `COM-MOBILE-CART-IDENTITY-1` and `COM-MOBILE-CUSTOMER-1` both depend on `COM-MOBILE-AUTH-1` and remain `backlog` until it reaches `done` (merged + post-merge-reviewed) — an unmerged code dependency does not satisfy a downstream dependency per this file's own queue rules.

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

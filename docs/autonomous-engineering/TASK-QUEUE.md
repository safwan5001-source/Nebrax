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
| 1 | COM-MOBILE-MEDIA-1 | ready | high | accepted readiness contract | Mobile-authorized product media |
| 2 | COM-MOBILE-VARIANTS-1 | backlog | high | media/readiness as applicable | Variant/options/UOM mobile contract |
| 3 | COM-MOBILE-AUTH-1 | backlog | critical | identity architecture decision/readiness | Customer mobile auth + profile |
| 4 | COM-MOBILE-CART-IDENTITY-1 | backlog | critical | COM-MOBILE-AUTH-1 | Guest → authenticated cart transition |
| 5 | COM-MOBILE-CUSTOMER-1 | backlog | high | COM-MOBILE-AUTH-1 | Addresses + customer order history |
| 6 | COM-MOBILE-PAYMENTS-1 | backlog | critical | checkout/auth/provider decisions | Payment methods + trusted payment lifecycle |
| 7 | COM-MOBILE-SHIPPING-1 | backlog | high | checkout contract | Shipping method/rate refinement |
| 8 | COM-MOBILE-PROMO-1 | backlog | high | V1 product decision | Coupon/promotion mobile contract if in scope |
| 9 | COM-MOBILE-I18N-1 | backlog | normal | resource contracts | Explicit localization/fallback |
| 10 | COM-MOBILE-VERTICAL-TEST-1 | backlog | high | selected vertical slice complete | Runtime/API integration fixtures and vertical proof |

Source: `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` on `main` (accepted via merged/post-reviewed PR #887).

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

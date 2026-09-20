# AWJ Autonomous Engineering — Durable Task Queue

## Purpose

This is the human-reviewable V1 queue. It is deliberately Markdown first. Do not introduce a second YAML/JSON source of truth until the schema and workflow prove stable.

## Queue rules

- One stable task ID per outcome.
- Dependencies must be explicit.
- A task becomes `ready` only from evidence, not optimism.
- `done` means its Definition of Done is evidenced.
- If merge/production verification is required by owner policy, represent that truthfully; do not call code-only completion `done`.
- Claude may append discovered tasks, but may not silently promote a material new task to `ready` if it expands the authorized horizon.
- Material decisions link an ADR/decision ID.

## Authorized horizon

STATUS: NONE

There is currently **no long-running implementation horizon authorized by this PR**. This PR establishes the operating system first.

## Candidate queue — Commerce Mobile prerequisites

| Order | Task ID | Status | Risk | Depends on | Outcome |
|---|---|---|---|---|---|
| 1 | COM-MOBILE-MEDIA-1 | backlog | high | accepted readiness contract | Mobile-authorized product media |
| 2 | COM-MOBILE-VARIANTS-1 | backlog | high | media/readiness as applicable | Variant/options/UOM mobile contract |
| 3 | COM-MOBILE-AUTH-1 | backlog | critical | identity architecture decision/readiness | Customer mobile auth + profile |
| 4 | COM-MOBILE-CART-IDENTITY-1 | backlog | critical | AUTH-1 | Guest → authenticated cart transition |
| 5 | COM-MOBILE-CUSTOMER-1 | backlog | high | AUTH-1 | Addresses + customer order history |
| 6 | COM-MOBILE-PAYMENTS-1 | backlog | critical | checkout/auth/provider decisions | Payment methods + trusted payment lifecycle |
| 7 | COM-MOBILE-SHIPPING-1 | backlog | high | checkout contract | Shipping method/rate refinement |
| 8 | COM-MOBILE-PROMO-1 | backlog | high | V1 product decision | Coupon/promotion mobile contract if in scope |
| 9 | COM-MOBILE-I18N-1 | backlog | normal | resource contracts | Explicit localization/fallback |
| 10 | COM-MOBILE-VERTICAL-TEST-1 | backlog | high | selected vertical slice complete | Runtime/API integration fixtures and vertical proof |

Source candidate: `docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` in PR #887.

## Promotion checklist: backlog → ready

Before changing status to `ready`:
- source requirement/contract accepted;
- hard dependencies complete;
- no unresolved material decision;
- outcome and acceptance criteria defined;
- risk classified;
- test expectations defined;
- authorized execution horizon includes the task;
- current `main` evidence does not invalidate the task.

## Agent transitions

Allowed routine transitions:
`ready → in_progress → review → owner_gate/done`

Exceptional:
`in_progress → decision_required/blocked`

Claude may perform routine transitions backed by evidence. It must not invent owner approval for `owner_gate → done` when owner policy requires merge/deploy/production action.

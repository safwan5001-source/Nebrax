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

## Current pilot execution horizon

The first autonomous execution horizon should be deliberately bounded to **Commerce Mobile API readiness closure**, because it already has a documented evidence pass and dependency chain.

Authoritative readiness source:
`docs/plans/store/COMMERCE_MOBILE_API_READINESS.md` once PR #887 is merged/otherwise made an accepted source.

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

**Important:** This is a dependency direction, not authorization to implement all ten immediately.

Before launching Claude on this horizon, normalize each candidate into a task record from current `main`, verify dependencies and mark only genuinely ready tasks as `ready`.

## Initial seed task

```yaml
id: COM-MOBILE-MEDIA-1
title: Close the Public/Mobile Commerce product-media gap
domain: commerce
status: backlog
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

It remains `backlog` here because PR #887 is currently a draft documentation source and this autonomous layer must not silently convert a draft plan into implementation authorization.

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

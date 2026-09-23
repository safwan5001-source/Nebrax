# AWJ App Builder Horizon V1 — Claude Code Bootstrap

Execute **AWJ App Builder Horizon V1** under **نظام الأفق** from latest `origin/main`.

## Start
1. Fetch latest `origin/main`; report exact Base SHA.
2. Read, in order:
   - `CLAUDE.md`
   - `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`
   - `docs/autonomous-engineering/AUTONOMOUS-ENGINEERING-PROTOCOL.md`
   - `docs/autonomous-engineering/QUALITY-GATES.md`
   - `docs/autonomous-engineering/DECISION-ESCALATION.md`
   - `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1.md`
   - `docs/plans/app-builder/AWJ_APP_BUILDER_HORIZON_V1_EVIDENCE.md`
   - `docs/plans/store/AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md`
   - `docs/plans/store/APP_SCHEMA_V1.md`
   - `docs/plans/store/COMPONENT_REGISTRY_V1.md`
   - `docs/plans/store/ACTION_REGISTRY_V1.md`
   - `docs/plans/store/DATA_RESOURCE_REGISTRY_V1.md`
   - `docs/plans/store/RUNTIME_COMPATIBILITY_V1.md`
   - Mobile Runtime Proof V1 closure report
   - current durable state/task queue.
3. Verify Mobile Runtime Proof V1 is closed on current main.
4. Do not broadly rediscover the repository. Inspect only what APP-BUILDER-1 requires.
5. Start APP-BUILDER-1 only after verifying its dependencies/current evidence.

## Autonomous loop
For each task:
inspect relevant evidence → research current official sources when materially needed → implement smallest correct slice → focused/risk-based tests → Implementer review → Reviewer review → AWJ Guardian → final diff → exact-final-Head CI → PRE_MERGE_REVIEW: PASS → merge under standing authority when gates pass → actual Merge SHA → post-merge checks/review → POST_MERGE_REVIEW: PASS → durable report/state → next dependency-ready task.

Any Head change invalidates the prior pre-merge review.

During async CI waits, prefer event-driven PR/GitHub activity continuation and arm the proven delayed-trigger fallback; do not require the owner to manually say “continue”.

## Non-negotiables
- Tenant/RBAC/security/backcompat first.
- Commerce remains business source of truth.
- no arbitrary executable remote code, arbitrary HTTP, SQL, packages or tenant authority in schema.
- no duplicate runtime/schema/business authority.
- Draft ≠ Published Experience ≠ Native Build Release.
- Published Experience immutable/versioned.
- ar/en + RTL/LTR + accessibility.
- no unrelated refactor.
- no production deploy/release/signing.
- do not start Preview & Testing or App Factory.

## Decision Gate
Use the Horizon Decision Escalation Gate for material architecture/security/financial/vendor/release decisions. Continue independent safe work where possible.

## Horizon End
After APP-BUILDER-12:
- produce final closure report with PRs/Merge SHAs/tests/CI/security/tenant/RBAC/UX/bidi/accessibility/runtime compatibility/known limitations/deferred work;
- persist durable state;
- STOP;
- do not automatically start Preview & Testing.

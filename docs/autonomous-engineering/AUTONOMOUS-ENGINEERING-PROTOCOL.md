# AWJ Autonomous Engineering Protocol V1

## Mission

Carry an authorized AWJ engineering program from its current verified state through implementation and verification with minimal human interruption while preserving correctness, security and traceability.

## Roles

Claude Code may act in four internal roles during one task:

### 1. Implementer
Find the smallest maintainable implementation that satisfies the accepted outcome.

### 2. Reviewer
Review the resulting diff as if authored by another senior engineer. Look for incorrect assumptions, overengineering, regressions, weak validation, poor failure behavior and insufficient tests.

### 3. AWJ Guardian
Explicitly assess accounting correctness, data integrity, Tenant/Branch Isolation, authorization/security, backward compatibility, API/schema compatibility and production safety.

### 4. Researcher / Architect
When a decision depends on changing platform behavior, an unfamiliar integration, or meaningful alternatives, research before guessing.

Prefer official/current documentation, primary specifications, framework/vendor source/docs, then high-quality secondary engineering evidence only when primary evidence is insufficient. Record material external evidence and why it fits AWJ.

## Do not start from zero

At the beginning of each task:
1. read current execution state;
2. read latest relevant implementation report/handoff;
3. inspect only relevant repository files/tests;
4. verify assumptions that materially affect correctness;
5. do not rediscover unrelated domains.

## Task selection

Select only a task that:
- is inside the authorized execution horizon;
- has all hard dependencies complete at the level the dependency requires;
- is not blocked by an unresolved decision or owner gate;
- has sufficiently clear outcome and acceptance criteria.

If multiple tasks are ready, prefer critical-path blockers, safety/correctness gaps, small foundations unlocking several later tasks, then documented roadmap order.

Do not optimize for number of PRs.

### Dependency and merge rule

A dependency that changes code is not automatically "complete" merely because its PR is green.

If a downstream task requires the upstream behavior on the target branch, the upstream task must be merged (and production-verified when explicitly required) before the downstream task becomes ready.

Claude may continue unrelated ready tasks while an upstream PR is not yet merged (for example while CI/review is still pending, or while a true owner gate blocks it).

Do not create an implicit chain of dependent unmerged PRs unless the authorized horizon explicitly allows a stacked-branch strategy and defines how it will be reviewed/merged safely.

## Planning freedom

The execution plan defines **outcomes, dependencies, invariants and acceptance criteria**, not mandatory code shape.

Claude may choose implementation details and improve a proposed approach when repository evidence supports it.

> Documentation describes current intent. Preserve requirements and invariants, but do not blindly implement stale or inferior implementation assumptions.

A materially different architecture or product behavior crosses the Decision Escalation gate.

## Research freedom

External research is encouraged when it materially improves correctness or avoids reinventing a solved problem.

Research must not copy incompatible architecture blindly, import dependencies merely because they are popular, replace AWJ source-of-truth/business rules, weaken security/accounting/tenant controls, or rely on stale platform policy when current official docs exist.

For Apple, Google, ZATCA, payments, security, frameworks and other changing platforms, verify current official documentation before a material platform claim.

## Scope discipline

Inside a task Claude may:
- add/adjust local abstractions necessary for correctness;
- add tests and fixtures;
- fix task-caused regressions;
- update directly affected documentation;
- make small local cleanup necessary to keep the implementation maintainable.

Claude must not opportunistically refactor unrelated areas, change unrelated APIs/schema, fix unrelated CI failures unless they block verification, or expand a feature because it would be nice to have.

Record discovered unrelated gaps in backlog/report.

## Implementation loop

### A. Evidence
Establish current behavior and relevant tests.

### B. Design
Identify viable approaches. For non-trivial choices, state why the chosen approach best fits AWJ.

### C. Implement
Keep diff bounded and backward compatible where required.

### D. Focused verification
Run tests closest to changed behavior first.

### E. Self-review
Perform Implementer / Reviewer / AWJ Guardian passes.

### F. Correct
Fix issues found by self-review.

### G. Broader verification
Expand tests/builds according to risk. Financial/security/tenant changes require stronger regression coverage, never weaker coverage for speed.

### H. CI
Inspect relevant failing jobs/logs first. Fix failures caused by the task. Do not enter unrelated cleanup.

### I. Mandatory pre-merge review
Before every merge Claude must perform a fresh review against the **final PR head**, after all implementation/fixes and required CI:
- inspect the complete final diff;
- re-run the Reviewer and AWJ Guardian passes;
- verify required checks are green for that exact head;
- verify no unresolved review finding or Decision Gate;
- verify scope, migrations, public contracts and security/accounting/tenant implications;
- record `PRE_MERGE_REVIEW: PASS` with reviewed Head SHA.

If the head changes after this review, the pre-merge review is stale and must be repeated.

### J. Merge
When standing merge conditions pass, merge and capture the actual merge commit SHA. Never infer success from an attempted merge.

### K. Mandatory post-merge review
After every merge Claude must review the result on the target branch before unlocking dependent work:
- verify the PR is actually merged and capture Merge SHA;
- verify target branch contains the intended changes;
- inspect the merge result/diff for unexpected integration changes;
- verify required post-merge checks/workflows for the merge commit when available/applicable;
- run a targeted post-merge smoke/regression check when risk or merge interaction warrants it;
- confirm no new conflict with target-branch changes;
- record `POST_MERGE_REVIEW: PASS` with Merge SHA.

If post-merge verification fails, mark the task `blocked`/incident state, do not unlock dependent work, and fix forward through a new reviewed PR unless a material decision requires escalation. Never rewrite shared `main` history.

### L. Evidence report
Record exact commands/results, changed files, risks, compatibility assessment, Branch/PR/Base SHA/Head SHA and next task.

### M. Transition
Classify the task truthfully:
- `review` when implementation/evidence are ready but review gates remain;
- `owner_gate` only when current policy still requires Safwan action (for example deploy/release/production mutation) or a material Decision Gate requires his decision;
- `done` only when the task-specific Definition of Done is actually satisfied.

Then select the next task that is **genuinely ready**. Do not treat a dependent task as ready if its required upstream change is still unmerged.

## Self-review checklist

### Implementer
- Did I satisfy the actual outcome?
- Is there a simpler safe design?
- Did I reuse existing AWJ authority instead of duplicating business logic?
- Are failure states deliberate?

### Reviewer
- What would I reject if this PR came from another engineer?
- Is any code broader than the task?
- Are tests proving behavior rather than implementation trivia?
- Did I accidentally change a public contract?

### AWJ Guardian
- Can Tenant A affect/read Tenant B?
- Can branch boundaries be bypassed?
- Is any financial value computed with unsafe types or client authority?
- Can authorization be bypassed by IDs/headers/host/schema input?
- Is posted accounting immutable?
- Could retries duplicate side effects?
- Could old clients/tenants break?
- Are secrets/PII exposed in logs/errors/artifacts?

Do not declare completion until findings are resolved or explicitly escalated.

## PR policy

Prefer one coherent PR per independently reviewable task or tightly coupled slice. A PR should contain implementation, required tests, directly affected docs, and implementation report/evidence.

Do not create artificial PR fragmentation merely to increase throughput.

## Merge policy

Autonomous engineering does **not** mean universal autonomous merge.

Safwan has granted standing merge authority for AWJ work when merge is needed.

Claude may merge a task PR without asking Safwan again only when all of the following are true:
- the task is inside the authorized execution horizon;
- no unresolved Decision Gate exists;
- required review/self-review and Quality Gates pass;
- required CI is observed green;
- the PR contains no unapproved material scope expansion;
- merge will not itself perform a production deployment/release or destructive production operation.

Merge authority does **not** authorize bypassing review, CI, branch protections, accounting/security/tenant gates, or a material decision escalation.

After merge, complete the mandatory post-merge review, verify the actual merge result/SHA, update durable state, and only then treat merge-dependent downstream tasks as dependency-ready.

If GitHub blocks merge because of conflicts, protection, required checks, or permissions, resolve only when safely inside scope; otherwise record the blocker.

Deploy/release/production authority remains separate.

## Deploy/release policy

No deployment, production promotion, migration execution against production, store release or destructive production operation without explicit Safwan authorization.

## Accounting rule

Any task affecting accounting entries must follow `CLAUDE.md`, including full appropriate tests and an explicit resulting journal-entry table.

## Durable progress

A session ending must not destroy project state.

After each task cycle update task status/dependencies, implementation report, new ADR if a material decision was accepted, discovered backlog gaps, and exact PR/SHA/CI evidence.

A fresh capable agent should be able to resume without asking Safwan what happened last.

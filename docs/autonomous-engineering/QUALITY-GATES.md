# AWJ Autonomous Engineering Quality Gates V1

## Gate 0 — Scope and authority

Before implementation:
- task is dependency-ready;
- outcome/acceptance criteria are clear enough;
- current branch/base is known;
- no unresolved Decision Gate blocks it;
- merge/deploy authority is not assumed.

## Gate 1 — Repository evidence

Confirm relevant current behavior from code/tests, not memory alone.

Use the latest relevant handoff/report and inspect only necessary files.

## Gate 2 — Architecture invariants

Applicable invariants are identified before material code changes:
- accounting;
- tenant isolation;
- branch isolation;
- RBAC/auth;
- backward compatibility;
- public API;
- database;
- design system;
- source-of-truth/business authority.

## Gate 3 — Focused tests

Run the narrowest meaningful tests first.

A failed focused test must be understood before expanding test scope.

## Gate 4 — Self-review

Required three-pass review:
1. Implementer;
2. Reviewer;
3. AWJ Guardian.

Material findings must be fixed or escalated.

## Gate 5 — Risk-based broader verification

### Low risk
Docs/internal non-runtime change: lint/link/consistency checks as relevant.

### Normal application change
Focused tests + relevant module suite + build/type/lint as applicable.

### Financial / security / tenant / branch / auth / payment / data-integrity change
Focused tests + negative/security tests + SQLite/PostgreSQL where applicable + full suite/build according to repository policy. Do not reduce verification to save quota/time.

### Database migration
Test forward migration, fresh install, compatibility and rollback strategy where meaningful. Destructive production migration remains owner-gated.

## Gate 6 — Cross-boundary negatives

Where relevant prove:
- foreign tenant rejected/non-revealing;
- foreign branch rejected;
- unpublished/inactive resource inaccessible;
- unauthorized role rejected;
- IDs/tokens do not become authority;
- retry/idempotency behavior safe.

## Gate 7 — CI

Inspect the actual relevant CI result.

If CI fails:
1. inspect failing job/log;
2. determine whether task caused it;
3. fix task-caused failure;
4. report unrelated failure rather than casually expanding scope.

Do not claim Green until observed.

## Gate 8 — Diff review

Before final report:
- inspect complete diff;
- confirm no debug code/secrets;
- confirm no unrelated files;
- confirm migrations/API changes are intentional;
- confirm tests cover changed behavior;
- confirm docs reflect material contract changes.

## Gate 9 — Mandatory pre-merge review

For any PR that will be merged, Claude performs a fresh review of the final head after all fixes:
- complete final diff review;
- Reviewer + AWJ Guardian passes;
- required CI/checks green for the exact Head SHA;
- no unresolved Decision Gate/review finding;
- explicit `PRE_MERGE_REVIEW: PASS` + Head SHA.

Any head change invalidates this gate.

## Gate 10 — Merge verification

When merge authority applies:
- merge using the reviewed head;
- capture actual Merge SHA;
- verify GitHub reports the PR merged.

## Gate 11 — Mandatory post-merge review

Before downstream work may rely on the merge:
- verify target branch contains the intended change;
- inspect integration result for unexpected changes;
- inspect required post-merge checks/workflows where applicable;
- run targeted smoke/regression verification when warranted by risk/integration;
- record `POST_MERGE_REVIEW: PASS` + Merge SHA.

Failure keeps downstream dependencies locked and must be corrected through a new reviewed PR; never rewrite shared main history.

## Gate 12 — Final evidence

Report:
- what changed;
- changed files;
- exact tests/results;
- build/lint/CI;
- accounting impact;
- security/tenant/branch impact;
- backward compatibility;
- migrations/API impact;
- risks/remaining;
- Branch/PR/Base SHA/Head SHA;
- next dependency-ready task.

## Gate 13 — Transition

Only mark a task complete when its Definition of Done is evidenced.

Green tests alone are not completion if acceptance criteria, security negatives, docs or required review remain incomplete.

Proceed automatically to the next authorized dependency-ready task unless:
- Decision Escalation gate;
- owner merge/deploy gate;
- blocker;
- authorized execution horizon complete.

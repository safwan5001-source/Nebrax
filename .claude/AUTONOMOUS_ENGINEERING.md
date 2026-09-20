# Claude Code — AWJ Autonomous Engineering Entrypoint

Use this entrypoint only when Safwan explicitly asks you to run an autonomous/bounded AWJ engineering horizon.

## Bootstrap

Read, in order:

1. `CLAUDE.md`
2. `docs/autonomous-engineering/00-START-HERE.md`
3. `docs/autonomous-engineering/CURRENT-STATE.md`
4. `docs/autonomous-engineering/AUTONOMOUS-ENGINEERING-PROTOCOL.md`
5. `docs/autonomous-engineering/QUALITY-GATES.md`
6. `docs/autonomous-engineering/DECISION-ESCALATION.md`
7. `docs/autonomous-engineering/TASK-QUEUE.md`
8. `docs/autonomous-engineering/MASTER-EXECUTION-PLAN.md`
9. Only the relevant domain docs/reports for the first ready task.

Then verify branch/PR/main state against GitHub/repository reality before acting.

## Do not ask Safwan to repeat repository history

Use durable state, Git history, PRs, reports and tests.

If a state file is stale, update it with evidence.

## Operating mode

Act as:
- Senior Engineer
- Reviewer
- AWJ Guardian
- Researcher/Architect

You have implementation freedom inside the authorized outcome and invariants.

Do not blindly follow stale implementation suggestions. Challenge them when repository or verified external evidence supports a safer/better approach.

## Continuous execution

While an authorized horizon contains dependency-ready work:

1. select the next ready task;
2. mark it in progress;
3. inspect relevant evidence;
4. research externally if useful;
5. implement;
6. run focused tests;
7. self-review under all three review hats;
8. fix findings;
9. run risk-appropriate broader verification;
10. inspect relevant CI;
11. fix task-caused failures;
12. write/update implementation report;
13. update durable state/queue;
14. continue to the next dependency-ready task.

Do not stop merely to announce routine progress.

## Decision gate

Read `DECISION-ESCALATION.md`.

When a material decision is required:
- stop only dependent work;
- produce the complete DECISION REQUIRED packet;
- continue independent authorized work if safe;
- never silently choose a strategic/accounting/security/product-policy answer merely to keep moving.

## Research

For external/platform-sensitive questions prefer current official sources.

Research is encouraged, but AWJ invariants and repository authority remain binding.

## Merge / deploy

Current standing authority:
- create/update PR: allowed inside authorized task;
- merge: allowed without asking Safwan again **only after** applicable review/Quality Gates pass, required CI is observed green, and no unresolved Decision Gate/material scope expansion remains;
- deploy/release/production mutation: **STOP — explicit Safwan approval required**.

Before every merge, perform the mandatory pre-merge review on the final Head SHA and record `PRE_MERGE_REVIEW: PASS`.

After every merge, perform the mandatory post-merge review on the target branch and Merge SHA and record `POST_MERGE_REVIEW: PASS`.

Do not unlock dependent work until the post-merge review passes.

Do not reinterpret merge authority as permission to bypass review/CI or as deploy/production authority.

## End condition

Stop only when:
- authorized horizon is complete;
- a blocking Decision Gate requires owner/reviewer input;
- an external blocker prevents safe progress;
- owner gate is reached and policy requires stopping.

Before stopping, persist exact state so a new session can resume.

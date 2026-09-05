# Active Agent Task

TASK_ID: NONE
STATUS: BLOCKED
OWNER: Safwan
PLANNER_REVIEWER: ChatGPT
IMPLEMENTER: Claude Code

> No implementation task is currently authorized through this workspace. ChatGPT replaces this template with a scoped task before setting `STATUS: READY_FOR_CLAUDE`.

## Objective

Not assigned.

## Context / latest confirmed state

Not assigned. Start from the latest confirmed implementation report/handoff when a task is created; do not re-audit the whole repository without need.

## In scope

- Not assigned.

## Out of scope

- Merge.
- Deploy / production release.
- Unrelated refactoring or fixes.
- Unapproved accounting, API, database, security, tenant-isolation, branch-isolation, or product-policy changes.

## Acceptance criteria

- Not assigned.

## Required verification

- Focused tests related to the change.
- Broader tests proportional to risk.
- Financial/security/tenant/branch-isolation changes must retain strong regression coverage.

## Material decision gate

If repository evidence suggests a better approach or contradicts an assumption, do **not** silently follow this task. Update `CLAUDE_REPORT.md` with `TYPE: PROPOSAL`, `RISK`, `QUESTION`, or `CHALLENGE`, set the task interaction state to `WAITING_FOR_REVIEWER`, and pause only the affected material decision.

## Owner gates

No merge, deploy, production release, destructive operation, or sensitive scope expansion without Safwan's explicit approval.

# Claude Code — AWJ Orchestration Entrypoint

When Safwan or the task explicitly asks you to operate through the ChatGPT ↔ Claude Code orchestration workflow, follow this file.

## Start

1. Read `docs/agent-workspace/PROTOCOL.md`.
2. Read `docs/agent-workspace/TASK.md`.
3. Read the latest relevant entries in `docs/agent-workspace/DECISIONS.md`.
4. Read only the repository files needed for the active task, including applicable architecture/design policy sources.
5. If `TASK.md` is not `STATUS: READY_FOR_CLAUDE` or `STATUS: CHANGES_REQUESTED`, do not begin implementation through this workflow.

## During implementation

- Treat repository evidence as important feedback to the plan.
- Do not blindly implement an inferior or unsafe direction.
- For a material better approach, contradiction, risk, or unresolved choice, update `CLAUDE_REPORT.md` using `PROPOSAL`, `CHALLENGE`, `RISK`, or `QUESTION`, then wait for review on the affected decision.
- Small local implementation decisions inside scope may proceed under `PROTOCOL.md`.
- Do not expand scope or perform unrelated refactors.

## Finish every cycle

Update `docs/agent-workspace/CLAUDE_REPORT.md` with the complete report contract from `PROTOCOL.md`, including observed test/build/CI results and Git metadata when available.

If implementation is ready for review, report `STATUS: READY_FOR_REVIEW` and stop for ChatGPT review.

If reviewer requests changes, read `REVIEW.md`, implement only the bounded requested changes plus existing approved scope, re-test, update the report, and return to `READY_FOR_REVIEW`.

If reviewer marks `APPROVED_FOR_OWNER`, stop. Do not merge or deploy.

## Absolute owner gate

Safwan's explicit approval is required for merge, deploy, production release, destructive operations, and sensitive scope expansion. Reviewer approval does not replace owner approval.

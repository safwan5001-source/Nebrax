# AWJ Autonomous Engineering — Legacy Orchestration Compatibility

## Why this file exists

AWJ already has a proven earlier coordination workflow:

- `.claude/AGENT_ORCHESTRATION.md`
- `docs/agent-workspace/PROTOCOL.md`
- `TASK.md`
- `CLAUDE_REPORT.md`
- `REVIEW.md`
- `DECISIONS.md`

Those files contain valuable pilot evidence and must not be deleted or rewritten as if they never existed.

However, their V1 workflow was intentionally turn-based and contains an older rule requiring Safwan approval for every merge. Safwan has since granted standing merge authority subject to the new autonomous Quality Gates.

## Mode selection

### Autonomous horizon mode — current long-running mode

When Safwan explicitly asks Claude to run an autonomous/bounded engineering horizon, use:

`.claude/AUTONOMOUS_ENGINEERING.md`

and the `docs/autonomous-engineering/` protocol.

For that mode, the current merge authority in the autonomous protocol supersedes the older per-merge owner gate.

### Legacy single-task orchestration mode

When a task explicitly says to use the older ChatGPT ↔ Claude task/review workflow, `.claude/AGENT_ORCHESTRATION.md` and `docs/agent-workspace/` remain the workflow for that task.

Do not mix both state machines inside one task.

## What remains authoritative from legacy material

Historical evidence remains valid, including:
- prior pilot outcomes;
- accepted decisions that have not been superseded;
- implementation reports/reviews;
- lessons about wake-up/events/coordination.

A historical statement about what was authorized **at that time** remains historically true. Do not rewrite history merely because current authority changed.

## Conflict rule

For a new autonomous-horizon task:
1. current explicit Safwan decision;
2. `CLAUDE.md` non-negotiable invariants;
3. accepted non-superseded ADR/decision;
4. current autonomous protocol/queue;
5. current repository/tests;
6. historical orchestration guidance.

If a historical decision is architectural/product/security/accounting and has not been superseded, it remains binding. Only obsolete **workflow mechanics/authority** are superseded by this layer.

## Migration policy

Do not mass-move or delete `docs/agent-workspace/` in V1.

After the autonomous protocol has been proven in real work, a separate documentation-cleanup task may:
- archive obsolete mutable task state;
- preserve accepted decision history;
- link old pilot reports from a historical index;
- simplify duplicate entrypoints.

That cleanup must not erase evidence.

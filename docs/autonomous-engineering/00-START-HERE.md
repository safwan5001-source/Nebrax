# AWJ Autonomous Engineering — Start Here

## Purpose

This directory is the durable operating layer for long-running engineering agents working on AWJ.

It does **not** replace domain architecture, `CLAUDE.md`, the design system, tests, or repository evidence. It tells an autonomous senior engineering agent how to discover the current state, choose the next safe unit of work, research when useful, implement, test, self-review, report, and continue without requiring Safwan to manually say "next" after every routine step.

## Read order

1. `/CLAUDE.md` — non-negotiable AWJ architecture/accounting/tenant rules.
2. `docs/autonomous-engineering/AUTONOMOUS-ENGINEERING-PROTOCOL.md`
3. `docs/autonomous-engineering/QUALITY-GATES.md`
4. `docs/autonomous-engineering/DECISION-ESCALATION.md`
5. `docs/autonomous-engineering/MASTER-EXECUTION-PLAN.md`
6. The relevant domain documentation only.
7. Current repository implementation/tests/CI evidence.

Existing orchestration material under `docs/agent-workspace/` remains historical/operational evidence and is not deleted by this layer.

## Core operating principle

**Autonomous by default. Escalate by significance.**

The agent is expected to behave as:
- senior implementation engineer;
- technical lead;
- reviewer;
- security/tenant/accounting guardian;
- researcher when repository evidence alone is insufficient.

The agent is not a blind checklist executor. Product requirements and invariants are authoritative; stale implementation suggestions may be challenged with evidence.

## Normal loop

```text
Orient
 -> inspect current evidence
 -> select dependency-ready task
 -> research if useful
 -> compare approaches
 -> implement smallest safe solution
 -> focused tests
 -> self-review
 -> fix findings
 -> broader risk-appropriate verification
 -> inspect relevant CI
 -> fix task-caused failures
 -> final verification
 -> update durable state/report
 -> continue to next dependency-ready task
```

The loop stops only at a defined escalation/owner gate, a real blocker, or completion of the authorized execution horizon.

## Source-of-truth precedence

1. Current explicit Safwan decision.
2. Non-negotiable AWJ safety/accounting/security/tenant/backward-compatibility rules.
3. Accepted ADR/decision records and current domain contract.
4. Current repository implementation and tests.
5. Current execution plan/task metadata.
6. External evidence.
7. Agent preference.

Repository evidence can prove that an old implementation assumption is stale. It cannot silently override a product/security/accounting invariant.

## Documentation rule

Do not duplicate domain specifications into this directory. Link to them.

This directory owns only:
- agent operating protocol;
- execution ordering/dependencies;
- quality gates;
- escalation rules;
- durable current execution state;
- report/ADR conventions.

## Current status

This is V1 of the autonomous-engineering layer. It is documentation/orchestration only and grants no production deployment authority by itself.

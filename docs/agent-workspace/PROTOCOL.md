# AWJ Agent Orchestration Protocol — V1

## Purpose

This directory is the durable coordination channel between:

- **Safwan / Owner** — final authority for sensitive decisions, merge, deploy, and production release.
- **ChatGPT / Planner + Architect + Reviewer** — defines scoped work, reviews evidence/results, answers questions, and accepts/rejects implementation proposals.
- **Claude Code / Implementation Engineer** — inspects the real repository, implements approved work, tests it, reports evidence, and challenges the plan when repository evidence supports a better or safer approach.

This protocol does **not** authorize autonomous merge, deploy, production release, destructive operations, or unapproved financial/security/database/API behavior changes.

## Pilot status

This protocol is running its first pilot cycle (`TASK_ID: ORCH-PILOT-001`) on PR #660's isolated branch. During the pilot, `TASK.md`/`CLAUDE_REPORT.md`/`REVIEW.md`/`DECISIONS.md` stay on that branch and are **not** merged to `main` merely to make the pilot convenient. A merge to `main` requires the pilot to succeed and Safwan's explicit approval — that approval covers this documentation/entrypoint set specifically, not a general merge authorization. Mutable task/review state may be redesigned later if keeping it on `main` proves noisy; that redesign is out of scope for the pilot itself.

## Coordination channel

Intended path for this pilot: `Claude Code → GitHub coordination state → ChatGPT review → GitHub coordination state → Claude Code`.

For this pilot, ChatGPT has direct GitHub repository access and reads/writes the coordination files and inspects PR state itself. Safwan is **not** a required relay for routine reviewer messages between ChatGPT and Claude Code — that would collapse the reviewer/owner separation this protocol depends on. Safwan remains the owner gate only for decisions explicitly reserved to the owner (merge, deploy, production release, destructive operations, sensitive scope expansion).

If direct repository access is unavailable to the reviewer in a future session or environment, the workflow must declare itself `BLOCKED` and say so explicitly, or fall back to a documented manual relay recorded in `DECISIONS.md` — it must never silently assume the independent channel exists when it does not.

## Language

Human-facing explanations, reports, findings, questions, and review rationale default to Arabic, consistent with `CLAUDE.md`. Stable machine/state identifiers — `READY_FOR_CLAUDE`, `IN_PROGRESS`, `WAITING_FOR_REVIEWER`, `READY_FOR_REVIEW`, `CHANGES_REQUESTED`, `APPROVED_FOR_OWNER`, `BLOCKED`, `CANCELLED`, `QUESTION`, `PROPOSAL`, `RISK`, `CHALLENGE`, and reviewer decision tokens — and code/file/symbol identifiers stay in English exactly as written. A full translation of every protocol file is not required for V1; this section governs new human-facing content going forward.

## Source-of-truth order

When instructions conflict, use this order:

1. Explicit current decision from Safwan.
2. Non-negotiable architecture/security/accounting/tenant-isolation rules in `CLAUDE.md` and repository policy documents.
3. The active task in `TASK.md` and accepted decisions in `DECISIONS.md`.
4. Repository implementation and tests.
5. Suggestions/proposals from either agent.

For UI work, repository design-system sources remain authoritative. Prototypes and task descriptions do not override design tokens or established design-system rules.

## Files

- `TASK.md` — current approved task contract written/revised by ChatGPT.
- `CLAUDE_REPORT.md` — Claude Code's latest implementation report, question, risk, challenge, or proposal.
- `REVIEW.md` — ChatGPT's latest review decision and requested changes.
- `DECISIONS.md` — append-only durable decision log for material decisions.

The files are state, not a chat transcript. Keep them concise, evidence-based, and current.

## State machine

Allowed task states:

- `READY_FOR_CLAUDE` — task is defined and Claude may inspect/implement.
- `IN_PROGRESS` — Claude is implementing within approved scope.
- `WAITING_FOR_REVIEWER` — Claude has a material question/proposal/risk/challenge; implementation must pause on the affected decision.
- `READY_FOR_REVIEW` — implementation and required tests are complete enough for ChatGPT review.
- `CHANGES_REQUESTED` — reviewer requires bounded changes; Claude may implement only those changes plus the existing task scope.
- `APPROVED_FOR_OWNER` — reviewer considers the task ready; stop and wait for Safwan.
- `BLOCKED` — external dependency or unresolved owner decision prevents progress.
- `CANCELLED` — owner cancelled the task.

Only Safwan can authorize merge/deploy/production release. `APPROVED_FOR_OWNER` is **not** merge approval.

## Claude Code autonomy

Claude is not a blind executor. It must inspect the repository before making material changes and may challenge the proposed approach.

Claude may make small, local, technically necessary implementation choices without stopping when all are true:

- inside the explicit task scope;
- no accounting/financial behavior change;
- no tenant/branch isolation or security-policy change;
- no public API/contract or database-schema change beyond explicitly approved scope;
- no backward-compatibility risk;
- no material UX/product-policy decision;
- no unrelated refactor;
- covered by appropriate tests.

Claude must stop on the affected decision and return `WAITING_FOR_REVIEWER` when it finds any of these:

### `QUESTION`
Required information or a material choice is genuinely unresolved.

### `PROPOSAL`
Claude found a demonstrably better implementation approach than the task's proposed approach.

A proposal must include:
- original instruction/assumption;
- repository evidence;
- proposed alternative;
- benefits;
- risks/trade-offs;
- compatibility impact;
- tests affected;
- Claude's recommendation.

### `RISK`
Continuing as written may harm accounting correctness, data integrity, security, tenant/branch isolation, backward compatibility, production safety, or an established product/design contract.

### `CHALLENGE`
Repository evidence shows a material task assumption or architectural direction is incorrect or inferior. Claude should state this directly and recommend the safer/better path rather than silently following the instruction.

Claude must never treat its own `PROPOSAL` or `CHALLENGE` as approved. Wait for a reviewer/owner decision when the affected work is material.

**Small/local autonomy governs only *when* Claude may proceed without stopping — never *whether* the resulting diff needs review.** It means Claude does not need to pause and escalate before every implementation detail inside approved scope; it does **not** authorize autonomous acceptance of the resulting code. Every implementation cycle that changes code must still return to `READY_FOR_REVIEW`, and the resulting diff/evidence must be reviewed before `APPROVED_FOR_OWNER` is recorded.

## Reviewer decisions

ChatGPT records one of:

- `ACCEPTED` — proceed with the proposal/answer.
- `REJECTED` — keep the original approved direction, with reason.
- `MODIFIED` — proceed with reviewer-specified variation.
- `ESCALATED_TO_OWNER` — Safwan must decide; affected work remains paused.
- `CHANGES_REQUESTED` — implementation is not yet acceptable; bounded corrections follow.
- `APPROVED_FOR_OWNER` — technical review passed; owner gate remains.

Reviewer decisions must reference evidence where practical and must not expand scope casually.

## Safety gates — absolute

Without Safwan's explicit approval, agents must not:

- merge a PR or branch;
- deploy or promote a deployment;
- release to production;
- perform destructive production/data operations;
- change accounting/financial rules outside task scope;
- weaken tests for financial, security, tenant isolation, or branch isolation behavior;
- bypass tenant/branch scopes;
- introduce breaking API behavior;
- make unrelated database/schema migrations;
- expose secrets or credentials.

If a requested implementation requires one of these, stop and escalate.

## Scope discipline

- Start from the current repository and latest confirmed handoff/report; do not re-discover the whole project.
- Inspect only files/dependencies needed to establish correctness.
- Do not fix unrelated issues unless they block the task; report them separately.
- Run focused tests first, then broader tests according to risk.
- Financial/security/tenant-isolation changes require adequate regression coverage; do not reduce testing to save time.
- For CI failures, inspect the failing job/logs first; avoid unnecessary polling.

## Claude final report contract

Every completed implementation cycle must update `CLAUDE_REPORT.md` with:

1. Status.
2. Task ID/title.
3. Summary of what was done.
4. Changed files.
5. Tests run and exact results.
6. Build/lint/CI status, if applicable.
7. Accounting/data/security/tenant-isolation/backward-compatibility assessment.
8. Risks and remaining work.
9. Questions/proposals/challenges, if any.
10. Branch, PR, Base SHA, Head SHA when available.
11. Recommended next step.

Never claim a test/build/CI result that was not actually observed.

For any task that creates, changes, reverses, posts, settles, allocates, or otherwise affects accounting entries, item 7 must include the resulting accounting-entry table (accounts, debit, credit) required by `CLAUDE.md`'s pre-PR protocol. A generic "Accounting correctness: OK" statement is not sufficient on its own for accounting-impacting work. Write `N/A — no accounting impact` only when genuinely applicable.

## Loop termination

The loop must stop when:

- state becomes `APPROVED_FOR_OWNER`, `BLOCKED`, or `CANCELLED`;
- owner approval is required;
- the same unresolved issue repeats without new evidence;
- continuing would exceed scope or violate a safety gate.

No agent should create an endless self-review loop.

# Agent Decision Log

Append material orchestration decisions here. Do not rewrite history except to correct an explicit factual error; add a superseding entry instead.

---

## DEC-0001 — Orchestration authority model

DATE: 2026-09-06
STATUS: ACCEPTED
OWNER: Safwan

### Decision

Use a three-role model:

- Safwan is final owner authority.
- ChatGPT is planner/architect/reviewer.
- Claude Code is implementation engineer with an explicit duty to inspect repository reality and raise better approaches, risks, questions, or challenges.

Claude Code is not a blind executor. A materially better idea must be proposed to ChatGPT with evidence rather than silently substituted.

### Owner gates

No merge, deploy, production release, destructive operation, or sensitive scope expansion without Safwan's explicit approval.

### Rationale

Combine ChatGPT's planning/review role with Claude Code's direct repository implementation context while preserving accounting correctness, data integrity, security, tenant/branch isolation, backward compatibility, and human control.

---

## DEC-0002 — Orchestration pilot correction round 1 (ORCH-PILOT-001)

DATE: 2026-09-06
STATUS: ACCEPTED
OWNER: Safwan (reviewer decisions recorded by ChatGPT in `REVIEW.md`)

### Decision

Five clarifications adopted from the first pilot review cycle, in response to Claude Code's design self-review of PR #660:

1. **Autonomy vs. review.** Small/local autonomy governs only *when* Claude may proceed without stopping; it never authorizes skipping review of the resulting diff. Every code-changing cycle returns to `READY_FOR_REVIEW`, and the diff must be reviewed before `APPROVED_FOR_OWNER`.
2. **Coordination channel.** For this pilot, ChatGPT has direct GitHub repository read/write access to the coordination files and PR state (`Claude Code → GitHub state → ChatGPT review → GitHub state → Claude Code`). Safwan is not a required relay for routine reviewer messages, and remains the owner-gate authority only. If direct repository access is unavailable in a future session, the workflow must declare `BLOCKED` or document an explicit manual-relay fallback — never assume the independent channel exists silently.
3. **File location.** Coordination files stay on the isolated pilot branch during the pilot and are not merged to `main` merely for convenience. A merge requires the pilot to succeed and Safwan's explicit approval.
4. **Language.** Human-facing explanations, reports, findings, questions, and review rationale default to Arabic, consistent with `CLAUDE.md`. Stable machine/state identifiers and code identifiers stay in English. Full translation of every protocol file is not required for V1.
5. **Accounting-entry table.** `CLAUDE_REPORT.md` must include the accounting-entry table (accounts, debit, credit) required by `CLAUDE.md`'s pre-PR protocol for any task that creates, changes, reverses, posts, settles, or allocates accounting entries. `N/A — no accounting impact` is allowed only when genuinely applicable.

### Rationale

Closes gaps surfaced by Claude Code's strict design review of the protocol before its first real task: autonomy language could be read as exempting code from review; the reviewer's actual repository access path was unstated, which would have blurred the reviewer/owner separation the three-role model depends on; the durable-vs-pilot location of the coordination files was ambiguous; language expectations conflicted with `CLAUDE.md`'s Arabic-first rule; and the accounting-table requirement from the existing pre-PR protocol wasn't named explicitly in the new report contract.

---

## DEC-0003 — V1 operational pilot succeeded (ORCH-TEST-001)

DATE: 2026-09-06
STATUS: ACCEPTED
OWNER: Safwan (authorized the operational pilot; final implementation review recorded by ChatGPT)

### Decision

Accept `ORCH-TEST-001` as a successful real operational validation of Orchestration V1.

The tested cycle completed as designed:

`TASK.md (READY_FOR_CLAUDE) → Claude Code reads GitHub → diagnosis + bounded implementation + verification → CLAUDE_REPORT.md (READY_FOR_REVIEW) → ChatGPT reviews repository diff/evidence directly → REVIEW.md (APPROVED_FOR_OWNER)`

The implementation task was not synthetic: it diagnosed and corrected a real `setup.sh` assembly drift that omitted `app/Jobs/Accounting` even though the equivalent CI assembly already included it. The accepted implementation changed only `setup.sh` plus the execution report and did not alter ZATCA/accounting behavior, database schema, API contracts, security, tenant/branch isolation, or production state.

### Verification outcome

- `bash setup.sh` completed successfully from a rebuilt application and its `LedgerTest` step passed `5/5`.
- `App\Jobs\Accounting\SendZatcaSubmission` became loadable in the assembled Laravel app.
- `ZatcaSubmissionRecoveryTest` passed `4/4` with 27 assertions.
- Full suite was reported accurately as `2363 passed / 25 failed / 1 skipped`; it was not represented as Green. Remaining failures are outside `ORCH-TEST-001` and are not silently accepted or fixed here.

### V1 boundary

V1 is accepted as a GitHub-backed task/report/review coordination protocol, subject to the existing owner gates. It is **not autonomous orchestration**.

The pilot still required Safwan to wake the next agent after a turn transition. Safwan did not need to relay task/review content manually, but automatic dispatch/wake-up remains absent.

### V2 follow-up

Automatic dispatch/wake-up is a separate V2 capability. Before implementing V2, the project must verify actual supported invocation mechanisms for both reviewer and implementer. V2 must use explicit turn/state identity, idempotency, bounded rounds, owner gates, and safe failure; it must not rely on aggressive polling or assume this interactive ChatGPT conversation can be awakened by GitHub.

### Merge / deployment gate

This decision records pilot success only. It does not authorize merging PR #660, deployment, or production release. Those remain explicit Safwan owner decisions.

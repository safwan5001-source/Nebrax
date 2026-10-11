# AWJ-TAX-ZATCA-HORIZON — Claude Code Bootstrap / Handoff

> **Owner activation decision (2026-10-11):** Pause Delivery execution and make TAX-ZATCA the active Horizon when PR #1324 is merged. No parallel Delivery task execution. TAX-HZ-00 evidence-only phase may begin after merged activation; stop before code implementation for review and scope selection. Explicit Safwan approval is required for each merge, separately from any Deploy decision.


**Mode:** Evidence-and-planning first, READ-ONLY on product code. Do not implement a remediation task until the owner approves Horizon activation and the first task. No Merge, Deploy, credentials, live ZATCA requests or production migrations.

## Work location
Repository: `safwan5001-source/Nebrax`. Start from latest `origin/main` and inspect narrow paths. Avoid full re-audit of unrelated modules.

Read in order:
1. `CLAUDE.md`.
2. `docs/autonomous-engineering/AWJ-HORIZON-SYSTEM.md`, `00-START-HERE.md`, `AUTONOMOUS-ENGINEERING-PROTOCOL.md`, `QUALITY-GATES.md`, `DECISION-ESCALATION.md`.
3. `docs/autonomous-engineering/CURRENT-STATE.md` and active sections of `TASK-QUEUE.md` — preserve existing Delivery Horizon.
4. `docs/audits/horizon/AWJ-TAX-ZATCA-HORIZON-MASTER-PLAN.md` and `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md`.
5. `docs/audits/AWJ-TAX-ZATCA-AUDIT-1.md`, `AWJ-TAX-ZATCA-GAP-MATRIX.md`, `AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` and the latest relevant reports only.
6. Current verified merged PRs #1290, #1291, #1304, #1315, #1320.

## TAX-HZ-00 deliverable
Create a focused *evidence-only* status/activation report (in a dedicated PR only if directed by owner):
- current main SHA, current active Horizon ownership and safe transition options;
- list 40 REM tasks with `verified done / partial / not started / decision-gated / not verified`, evidence per status; avoid guessing;
- confirm already merged REM-01/02, print follow-up, and outstanding production validation;
- exact external official ZATCA source/version references only where materially needed for next tasks;
- refreshed dependency-ready shortlist, especially REM-03, REM-11, REM-04, with smallest first PR recommendation;
- decision packet: (A) pause Delivery and activate TAX, (B) explicitly parallel independent TAX in a separate agent/branch with capacity and shared-file boundaries. Never silently mark both “single active”;
- production-data/residency, owner accounting policy and regulatory go-live decisions as NOT VERIFIED until proven.

Do not edit the global autonomous `CURRENT-STATE.md` or `TASK-QUEUE.md` without activation authorization. Never use old protocol language suggesting standing merge authority: **every merge requires Safwan's explicit approval**.

## Engineering criteria after authorization
One PR per bounded task; start with focused tests, then full financial/security/tenant cross-boundary tests on SQLite and PostgreSQL, web tests/build when impacted; official offline ZATCA SDK where applicable. Independent Reviewer + AWJ Guardian, CI green on exact head, PRE_MERGE_REVIEW PASS. Ask owner before Merge; verify merge SHA and POST_MERGE_REVIEW before selecting dependents. No auto-deploy or live submission.

## Final response/report
What is verified versus inferred, files changed, tests/CI, risks, unresolved decisions, Branch/PR/Base SHA/Head SHA, first recommended task, and explicit next owner action.

**Stop condition:** activation decision unresolved, a material financial/tax/tenant/API policy choice, actual production credentials or deployment needed. It is permitted to continue independent read-only research while waiting.

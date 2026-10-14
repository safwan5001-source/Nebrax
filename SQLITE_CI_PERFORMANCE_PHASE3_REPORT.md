# SQLite CI Performance — Phase 3 Report (Diagnostic: Phase A gate not passed)

**Outcome:** Phase A (PostgreSQL stability gate) is **inconclusive — insufficient sample**. Per the task rules, Phases B and C were **not executed**. No code, workflow, schema or configuration change is made. This PR contains this report only.
**Observation time:** 2026-10-14 00:39 UTC (GitHub Actions API).
**Not merged, not deployed.**

## 1. Phase A — PostgreSQL stability results

### 1.1 Sample size

| Item | Value |
|---|---|
| Reference merge commit | `f9428876dd460b8c567c020ff4a1d248f1396749` (PR #1407, merged 2026-10-14 00:32:42 UTC) |
| Requested sample | up to 10 completed CI runs after the merge |
| **Completed post-merge runs available** | **0** |
| In-progress post-merge runs | 1 — run `38490787426` (`push` on `main`, head = the merge commit), started 00:32:46 UTC; both jobs were in "تشغيل الاختبارات" (test step) at 00:39 UTC (~5.5 min into a ~12–13 min step) |
| Post-merge PR runs | none (newest PR runs, `38489945838`, `38489913267`, `38489689181`, `38489251130`, were created 00:16–00:24 UTC, i.e. before the merge) |

No result is extrapolated. The pgsql job of run `38490787426` shows the new steps working so far (ParaTest install ✓, lock-limit step ✓ which is fail-closed, DB init ✓); the sqlite job correctly skips both pgsql-only steps.

### 1.2 Why runs on `main` after the merge commit do not help

Runs listed on `main` after 00:00 UTC (`38487479715`, `38487863684`, `38488169940`, `38489481612`, `38490522980`) are push runs of commits that **precede** `f942887`. A push run executes the workflow file at its own commit, so these all ran the **old sequential** pgsql leg. They are useful only as a sequential baseline, not as parallel-stability evidence.

### 1.3 Parallel-config evidence that does exist (pre-merge, from PR #1407)

Source: `POSTGRESQL_CI_PERFORMANCE_PHASE2_REPORT.md` and PR run `38489162671` (head `65e2c74`, conclusion `success`).

| Evidence | Value |
|---|---|
| CI attempts with parallel pgsql leg | 3 (757 s, 759 s, 732 s), all success |
| Local sandbox runs | 6 (4 failed/hung **before** the lock fix; 3/3 clean after it) |
| Test / skipped / assertion counts | 6627 / 2 / 49,069, identical to the sequential baseline |
| `out of shared memory` after fix | 0 occurrences |

Phase 2 itself states this is "encouraging evidence, not a proof". Three same-commit attempts cannot detect a low-rate hang or lock failure; the pre-fix failure rate was 3/4, so the failure mode is timing-dependent and a 10+ run sample across different commits and runner conditions is the right bar.

### 1.4 Failure investigation

No failures to investigate: no completed post-merge run exists, so there is no `out of shared memory`, lock-error or hung-worker signal to examine. The job `timeout-minutes: 60` guard from #1407 would convert a hung worker into a visible failure within an hour.

### 1.5 Gate decision

**Inconclusive (0/10).** No regression confirmed, so no rollback is recommended; but the stability gate is not satisfied, so Phase B/C are held.

## 2. Phase B / C — not executed

Nothing was profiled, no per-worker SQLite isolation was tested, and nothing was changed. The notes below are **desk observations from existing data, not measurements**, to focus the work when the gate is met:

* From Phase 2: the sqlite test step is now the workflow critical path (≈ 12.5–13 min; setup ≈ 40–70 s; job-level `migrate:fresh` ≈ 4–9 s). Setup is therefore not a lever; the test step is.
* Candidate to evaluate first: ParaTest on the sqlite leg with per-worker database files (Laravel's `--parallel` appends `_test_N` to the sqlite path; in-memory databases are the other variant). Must verify, on a clean run: test count 6627, assertions 48,604, skipped 73 unchanged; tenant-isolation, ledger, ZATCA ICV and numbering tests green; any test that writes a fixed file path or uses a shared temp/storage directory (the Phase 2 report notes `tempnam()` signal files in pgsql concurrency tests are safe, but sqlite-specific and storage-disk tests are unreviewed).
* Lower-risk alternatives to compare: running only `--processes=2`; leaving sqlite sequential and accepting the 12–13 min wall-clock.
* Constraints to preserve: job names `php artisan test (L11, sqlite)` / `(L11, pgsql)`, CI Gate guarded step text (no `--filter/--group/--testsuite/--stop-on`, no `|| true`, no step-level `if`), `required-checks.json`.

## 3. Before / after

Not applicable — no change implemented.

## 4. Tests, assertions, CI

No code changed, so no test run was needed for this PR. Existing counts to be preserved by any future change: pgsql 6627 / 2 skipped / 49,069; sqlite 6627 / 73 skipped / 48,604 (from Phase 2 artifacts).

## 5. Risks

| Risk | Note |
|---|---|
| Unproven pgsql parallel stability | Timing-dependent failure mode seen pre-fix; the fix is verified on 3 CI attempts only |
| Starting Phase 3 now | Would stack a second parallelism change on an unvalidated first one and make any failure's cause ambiguous |
| Report-only PR | Zero runtime risk |

## 6. Changed files / refs

| | |
|---|---|
| Changed files | `SQLITE_CI_PERFORMANCE_PHASE3_REPORT.md` (new) |
| Branch | `claude/sqlite-ci-performance-phase3` |
| PR | see PR description (opened after push) |
| Base SHA | `f9428876dd460b8c567c020ff4a1d248f1396749` (`origin/main` at observation time) |
| Head SHA | the head commit of this PR (stated in the PR description; a commit cannot embed its own hash) |

## 7. Recommendation

1. **Wait** for completed post-merge runs. Re-run this Phase A check once ≥ 10 completed runs exist after `f9428876` (on this repo's cadence, a few hours). Include PR-event runs created after 00:32:42 UTC, which also execute the parallel leg.
2. Pass criteria: all pgsql jobs `success`, test/skip/assertion counts 6627 / 2 / 49,069, zero `out of shared memory` / `53200` / deadlock lines, no job near the 60-min timeout, no cancelled-by-timeout.
3. If criteria hold → proceed to Phase B (profile sqlite, test per-worker isolation). If any hang/lock failure appears → stop and prefer the cheap remediation (raise `max_locks_per_transaction` further, or `--processes=2`) before rollback of #1407's single workflow change.

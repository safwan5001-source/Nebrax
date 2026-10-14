# SQLite CI Performance — Phase 3 Report (Phase A gate: PASS after recheck — see §8)

**Outcome (initial, 2026-10-14 00:39 UTC — superseded by §8):** Phase A (PostgreSQL stability gate) is **inconclusive — insufficient sample**. Per the task rules, Phases B and C were **not executed**. No code, workflow, schema or configuration change is made. This PR contains this report only.
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

## 8. Recheck — 2026-10-14 07:25 UTC (supersedes §1.5 and §7)

**Gate result: PostgreSQL stability gate PASS.** No code, workflow, migration, merge or deployment was touched; read-only GitHub Actions analysis.

### 8.1 Sample

87 completed `ci.yml` runs exist after the merge (runs 9338–9427, 2026-10-14 00:32–07:22 UTC; 5 more in progress). Every pgsql job in them executed the parallel workflow (ParaTest install step and lock-limit step `success`, verified per job; SQLite jobs skip both).

| Conclusion | Runs | Note |
|---|---|---|
| success | 71 | 42 PR + 29 push (main) |
| failure | 1 | run 9356 — see §8.3 |
| cancelled | 15 | all 15 superseded by a newer push on the same branch (concurrency); verified one by one |

Gate sample = the 10 most recent completed, non-superseded runs: **9412, 9413, 9414, 9415, 9416, 9417, 9418, 9419, 9422, 9423** (6 push on `main`, 4 PR). Selected by recency, not by outcome; the all-window numbers below confirm the same picture.

### 8.2 Results

| Check | 10-run sample | Whole window (71 successful pgsql jobs) |
|---|---|---|
| pgsql job conclusion | 10/10 success | 71 success / 1 failure (unrelated) / 15 cancelled (superseded) |
| pgsql tests / skipped / assertions | 6717 / 2 / 50,078 in 9 runs; 50,082 in run 9413 | — |
| sqlite tests / skipped / assertions | 6644 passed + 73 skipped = 6717 / 73 / 49,613 in all 10 | — |
| pgsql test-step duration | 441 s – 815 s (7.4 – 13.6 min) | min 7.3, median 12.9, p90 13.4, max 14.0 min |
| sqlite test-step duration | 417 s – 826 s | min 7.0, median 11.8, p90 13.3, max 13.9 min |
| pgsql ÷ sqlite, same run | — | median 1.01 (0.59 – 1.92) |
| `out of shared memory` / `53200` | 0 | 0 in every log inspected |
| Deadlock detected / `40P01` | 0 | 0 |
| Worker hang / timeout | none; longest pgsql step of any run 16.6 min (a superseded-cancel), job limit is 60 min | none |

Notes on the counts: the suite grew from 6627 to 6717 tests since #1407 as other PRs merged; pgsql and sqlite totals agree (6717 each), and skipped counts match the Phase 2 baselines (2 / 73). The one 4-assertion difference (50,082, run 9413) is a single run on a different commit's push and is not a regression signal; assertion totals are otherwise identical across runs.

Each pgsql job log contains 12 `canceling statement due to lock timeout` lines on `tenants` rows (`select … for update`). These are the deliberate lock-timeout assertions of the `*PostgresConcurrencyTest` / lock-order tests; the sequential pre-merge baseline (run 38460084473) shows the same pattern (11 lines, before two later tests were added). They are expected behaviour, not capacity errors, and those tests pass.

### 8.3 Failure investigated: run 9356 (PR `claude/rem-11-zatca-sdk-conformance`)

Both the sqlite and pgsql jobs failed with the same 4 failures in `ZatcaSdkFixtureDriftTest` (`Failed asserting that file …/Fixtures/zatca-sdk/awj/*.xml exists`; "fixture directory has no unlisted files"). Deterministic and identical on both databases, i.e. the PR's fixtures were not present in the CI-assembled app tree. Not a parallelism, lock, hang or timeout issue. The branch's next runs are not part of this sample; the REM-11 PR has since merged per the repo history. No action for this task.

### 8.4 Decision

* **PostgreSQL parallel stability gate: PASS** (10/10 sample clean; 71/71 non-superseded, non-unrelated pgsql jobs clean; 0 lock/shared-memory/deadlock/hang/timeout events).
* Caveat that remains honest: all runs are within one ~7-hour window on one runner pool. That is adequate for the gate as defined; it is not a proof against a rare, timing-dependent failure. The 60-minute job timeout and the fail-closed lock-limit check stay in place as the safety net.

### 8.5 Important finding for Phase B planning

The two legs are now balanced (pgsql median 12.9 min vs sqlite 11.8 min, same-run ratio ≈ 1.0). **The workflow wall-clock is the slower of the two.** Speeding up SQLite alone can therefore save at most the gap to the pgsql leg (≈ 1 min median); a real wall-clock gain needs both legs faster. Phase B should be planned with that ceiling in mind.

### 8.6 Scoped SQLite profiling plan (Phase B, not started)

1. **Baseline, no CI cost:** use the 73 existing successful sqlite jobs (median 11.8 min, p90 13.3). Setup is ≈ 1 min and not a lever (§2 of Phase 2).
2. **Local profile (one run):** `php artisan test --log-junit` on a CI-like app build; rank per-class time, check whether the distribution is flat (as it was for pgsql) and how much is bootstrap/`RefreshDatabase` cost (the sqlite DB is created per test run, migrations run in the test setup).
3. **Isolation audit (read-only grep) before any parallel run:** tests that use a fixed sqlite path, `database_path()`, `storage_path()`/real disks without `Storage::fake`, fixed temp files, shared cache/queue files, `tempnam` signal files, and ordering/global static state. SQLite-specific: whether the CI database is a file or `:memory:` (Laravel's `--parallel` suffixes a per-worker file name, in-memory is per process).
4. **Experiment (only if 2–3 find no blocker):** one throwaway PR, `--parallel --processes=2`, then `4` if 2 is clean, 3 runs each. Acceptance: tests 6717 / skipped 73 / assertions 49,613 exactly, all tenant-isolation, ledger, ZATCA ICV and numbering tests green, job names and CI Gate guarded-step text unchanged, same-run sqlite step ≥ 25 % faster than the concurrent pgsql step baseline.
5. **Decide with the §8.5 ceiling:** if the wall-clock gain would be < 2 min, recommend leaving the workflow as is, or considering a joint change (more processes on both legs) instead.
6. Stop conditions: any count mismatch, cross-worker data leak, new flake, or lock/hang event → revert the experiment, no merge.

### 8.7 Refs for this update

Reference merge `f9428876dd460b8c567c020ff4a1d248f1396749`; PR #1412 base unchanged; this update adds only this section and the header edits (new head SHA in the PR).

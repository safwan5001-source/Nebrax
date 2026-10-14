# PostgreSQL CI Performance — Phase 2 Report

**Scope:** `.github/workflows/ci.yml` only (PostgreSQL leg). No application, accounting, API, migration or schema change. Not merged, not deployed.
**Observation date:** 2026-10-13/14 (GitHub Actions API + a local PostgreSQL 16 sandbox, 4 vCPU).

## 1. Result in one paragraph

The PostgreSQL leg's `php artisan test` step is now executed **in parallel (4 ParaTest workers, one isolated database per worker)**. Measured on GitHub Actions, three runs of the same commit: **12m12s – 12m39s** (757 s, 759 s, 732 s) versus a pre-change baseline of **17m32s – 30m30s, median 28m06s** over 33 runs. Normalised against the SQLite leg of the same run (which cancels runner-speed luck) the PostgreSQL step went from a **2.24×** median ratio to **0.95 / 0.99 / 0.98×**. Test count, skipped count and assertion count are identical to the sequential baseline (6627 / 2 skipped / 49,069). Parallelism was **not** safe as first tried: it failed or hung in 3 of 4 local runs until the Postgres lock limit was raised (§4). With that fix, 3/3 local and 3/3 CI runs were clean. That is encouraging evidence, **not a proof** (§8).

## 2. Profile — where the time goes

Source: job step timestamps (baseline run 38460084473 and 33 completed `ci.yml` runs of 2026-10-13).

| Phase | pgsql leg | Share |
|---|---|---|
| Runner + containers start | ~23 s | 2 % |
| Checkout, PHP, APT, composer (Laravel + Sanctum + S3) | ~40 s | 3 % |
| `migrate:fresh` (job-level) | 4 s | <1 % |
| **`php artisan test`** | **17.5 – 30.5 min** | **>93 %** |

Setup is not a lever (confirmed again; Phase 1 reached the same conclusion). The test step is the only meaningful target.

Test-time profile (local PostgreSQL, junit per test, 6627 tests, 597 classes): **flat** — mean 165 ms/test, top 20 classes ≈ 30 % of time, top 60 ≈ 44 %. No hot test to fix. PostgreSQL is ≈ 2× SQLite (1090 s vs 571 s summed test time) and the delta is spread evenly (top 50 classes = 42 % of the delta). That points to per-query round-trip cost × many tests, not a defect in any test.

## 3. Optimisations evaluated

| Candidate | Evidence | Decision |
|---|---|---|
| Dependency/APT/composer caching | Setup ≈ 40–70 s total; at most a few seconds saved | Rejected (no measurable gain) |
| Redundant `migrate:fresh` in CI (job step + RefreshDatabase) | Job-level migrate = 4 s | Rejected (negligible) |
| PostgreSQL durability off (`fsync`, `synchronous_commit`, `full_page_writes`) | Local A/B on the full suite: **1095 s → 1120 s** (no gain; most tests run in rolled-back transactions and never pay commit cost) | **Rejected by measurement** |
| `PDO::ATTR_EMULATE_PREPARES` / DB-config changes | Would change application DB behaviour vs production | Rejected (violates scope) |
| Matrix sharding into more jobs | Would change required check names / CI Gate | Rejected (forbidden) |
| **ParaTest, per-worker databases** | Local 333 s vs 1095 s (3.3×); CI 12.4 min vs 28.1 min median | **Adopted, with the lock-limit fix** |

## 4. Root cause of the parallel failures (and the fix)

First parallel run (4 workers, stock Postgres): passed. Next three failed or hung:

* run `b`: hung at 6588/6627 — one worker idle, master polling, PG log full of `out of shared memory`;
* runs `d1`, `d2`: thousands of errors `SQLSTATE[53200] out of shared memory — increase max_locks_per_transaction`.

Cause: Laravel's parallel bootstrap runs `migrate:fresh` in each worker database, and `RefreshDatabase` runs it again on the worker's first test. Each `DROP TABLE` statement covers **327 tables + 1,146 indexes ≈ 1,470 locks**. Four workers doing this simultaneously need ≈ 5,900 of the **6,400** default lock slots (`max_locks_per_transaction=64 × max_connections=100`). The first run passed only by timing.

Fix (CI only): step "raise PostgreSQL lock limit" — `ALTER SYSTEM SET max_locks_per_transaction = 1024`, restart the postgres service container, wait for `pg_isready`, **verify `SHOW` returns 1024 or fail the job**. Capacity becomes ≈ 102,400 slots (≈ 17× headroom). The setting needs a server restart; it cannot be applied by reload.

With the fix: local 3/3 clean (333 s, 326 s, 339 s); CI 3/3 clean (§6); `out of shared memory` occurrences: 0 in every run.

## 5. Changes — `.github/workflows/ci.yml` (+39 / −1)

1. Job `timeout-minutes: 60` (max observed job ≈ 31 min; protects against a hung worker holding a runner for the 360-minute default; a timeout fails the job).
2. New step *ParaTest (pgsql only)* — `composer require --dev brianium/paratest:^7.4` (`if: matrix.db == 'pgsql'`).
3. New step *raise PostgreSQL lock limit (pgsql only)* — as in §4, fail-closed.
4. Test step (the single CI-Gate-guarded step; no step-level `if`, `set -o pipefail` kept):
   * pgsql: `php artisan test --parallel --processes=min(nproc,4)`
   * sqlite: `php artisan test` — **unchanged**.

Not changed: job name, matrix, services, `fail-fast`, triggers, concurrency block, artifact step, any test/PHP/migration file, `required-checks.json`.

## 6. Before / after

### Baseline (pre-change, 33 completed successful `ci.yml` runs, 2026-10-13)

| Metric | min | p25 | median | mean | p75 | max |
|---|---|---|---|---|---|---|
| pgsql test step | 17.5 m | 24.6 m | **28.1 m** | 26.8 m | 29.1 m | 30.5 m |
| pgsql job | 18.8 m | 26.1 m | 29.4 m | 28.1 m | 30.5 m | 31.8 m |
| sqlite test step | 7.5 m | 10.1 m | 12.5 m | 11.7 m | 13.0 m | 13.9 m |
| workflow wall-clock | 18.9 m | 26.2 m | 29.6 m | 28.7 m | 30.7 m | 34.6 m |
| pgsql ÷ sqlite step ratio | 1.35 | 2.02 | **2.24** | — | 2.52 | 4.08 |

The wide baseline spread is runner contention (many concurrent runs that day), which is why the same-run ratio is also reported.

### After (PR #1407, run 38484651588, same commit `ba5636b`, three attempts)

| Attempt | pgsql step | pgsql job | sqlite step | sqlite job | workflow wall | pgsql ÷ sqlite |
|---|---|---|---|---|---|---|
| 1 | 757 s (12m37s) | 834 s | 796 s | 873 s | 878 s | 0.95 |
| 2 | 759 s (12m39s) | 836 s | 768 s | 848 s | 854 s | 0.99 |
| 3 | 732 s (12m12s) | 817 s | 745 s | 820 s | 825 s | 0.98 |
| **mean** | **749 s (12m29s)** | 829 s | 770 s | 847 s | 852 s (14m12s) | 0.97 |

### Comparison

| | Before | After | Change |
|---|---|---|---|
| pgsql test step, vs baseline median | 28m06s | 12m29s | **−56 %** |
| pgsql test step, vs *best* baseline run | 17m32s (run 38460084473) | 12m29s | −29 % |
| pgsql ÷ sqlite, same-run | 2.24 | 0.97 | **≈ 2.3× faster, runner-independent** |
| workflow wall-clock, vs baseline median | 29m36s | 14m12s | −52 % |
| sqlite test step | median 12m30s | 12m50s (mean of 3) | no change (within noise) |

Local sandbox, same machine (4 vCPU, PG 16): sequential 1095 s → parallel 333 / 326 / 339 s (3.3×). CI gain is smaller (runner shares 4 vCPU between PHP workers, Postgres, Docker overlay) but is consistent.

Observed vs noise: the three after-runs span 12m12s–12m39s (±1.8 %), every one is below the *fastest* of 33 baseline samples, and the same-run ratio moved from ≥ 1.35 (never below) to < 1.0. SQLite did not move, which shows the runner pool was not simply faster. **Critical path is now the SQLite leg**, so further PostgreSQL gains no longer shorten the workflow.

## 7. Test coverage confirmation

| | Tests | Skipped | Assertions | Source |
|---|---|---|---|---|
| Sequential pgsql baseline (3 main runs) | 6627 | 2 | 49,069 | CI artifacts, runs 38481417545, 38480846349, 38460084473 |
| Parallel pgsql (attempts 2, 3) | 6627 | 2 | 49,069 | CI artifact `test-output-pgsql` |
| SQLite (attempts 2, 3) | 6627 | 73 | 48,604 | CI artifact `test-output-sqlite` |

No test, filter, group, testsuite or exclusion was added. Local cross-check: in 4 clean parallel runs the set of failing tests was **identical by name** to the sequential run (13 sandbox-only failures caused by the sandbox app lacking the `App\Mail` classes that CI copies in); counts 6627 tests.

## 8. CI Gate and required checks

* Required check names unchanged: `php artisan test (L11, sqlite)` and `php artisan test (L11, pgsql)` — both reported and **success** on all three attempts.
* `ci_gate.validate()` → 0 errors, 0 warnings. `ci_gate.compare_baseline(main, PR)` → 0 errors. `scripts/ci-gate` unit tests 72/72.
* The guarded step keeps `php artisan test`, `set -o pipefail`, and none of `--filter --group --exclude-group --testsuite --stop-on || true`; no step-level `if`, no `continue-on-error`.

## 9. Financial / security / tenant-isolation risk assessment

| Area | Assessment |
|---|---|
| Tenant isolation | Each worker has its **own database** (`nibras_test_N`); no row is shared across workers. Tenant-isolation tests still run in full on both DBs. |
| Ledger, journal, invoice numbering, ZATCA ICV | Counters and uniqueness constraints are per database; workers cannot collide. Accounting/ZATCA tests unchanged and green. |
| Inventory / payments | Same: DB-local state; no cross-worker rows. |
| Real-concurrency PostgreSQL tests (`*PostgresConcurrencyTest`, fork-based lock tests) | They derive their second connection from `config('database.connections.pgsql')`, which ParaTest/Laravel rewrites per worker, and use `tempnam()` signal files → no cross-worker contention. All passed (6/6 runs with the lock fix). |
| Redis / cache / queue / session | `phpunit.xml`: `CACHE_STORE=array`, `QUEUE_CONNECTION=sync`, `SESSION_DRIVER=array`; no `Redis::` use in tests → nothing shared. |
| Filesystem | Every class using `Storage::disk('local')` fakes it (Laravel suffixes the faked root with the worker token); other writes use `tempnam`/unique names. No fixed shared path found by static scan. |
| Production behaviour | No application or config file changed. The lock-limit change applies only to the ephemeral CI service container. |

## 10. Remaining risks / limitations

1. **Not a proof of parallel safety.** Evidence is 4 clean local + 3 clean CI parallel runs after the fix, plus static analysis. The earlier failures show the harness can break non-obviously; a hang is possible in principle. Mitigation: 60-minute timeout (fails closed), fail-closed lock verification, and a one-commit rollback.
2. Rare or new tests that rely on process-global state (fixed paths, static caches across classes, `Storage` without `fake`) would only fail under parallelism. Tests added in future must follow the existing isolation habits.
3. Lock headroom depends on schema size (≈ 1,470 locks per worker now; 1024 limit gives ≈ 17×). A table count that grows >10× would need review; the fail-closed `SHOW` check protects only the setting, not future growth.
4. The restart step relies on exactly one container with image `postgres:16`; it fails closed (job red) if that assumption breaks.
5. Local assertion counts varied by +4 in one local run (49,026 vs 49,022) in the sandbox only; CI counts are identical across modes and attempts (49,069). Cause not isolated; no failure resulted.
6. Three CI attempts are the same commit, run within ~45 minutes; same-run ratio normalisation mitigates, but a multi-day sample (as in Phase 1's recommendation) is still the proper confirmation.
7. SQLite leg was deliberately left sequential and unmeasured in parallel (file database per worker was not analysed).
8. Deprecation notices appear 2× in the output (one set per worker) — cosmetic.

## 11. Delivery

* Branch: `claude/postgresql-ci-performance-phase2-6erhe6`
* PR: https://github.com/safwan5001-source/Nebrax/pull/1407 (open, not merged)
* Base SHA (main): `073e102ac9334a4f80f368a64d1a3762bb701350`
* Head SHA, workflow change (the code that was measured): `ba5636bfdfd5b26d64306eed9dfe45834082f0f4`
* Head SHA, final: this report is a docs-only commit on top; its SHA is recorded in the PR description.

## 12. Recommended next step

1. Review and merge PR #1407 (revert = one commit), then watch the next ~10 `main`/PR runs: expect pgsql step ≈ 12–13 min and zero red runs from `out of shared memory`, hung workers, or timeouts. A single flake attributable to parallelism is a reason to revert and revisit, not to retry.
2. After that, the critical path is the SQLite leg (≈ 12.5 min, sequential). Evaluate parallelising it separately (per-worker SQLite files; the same isolation audit).
3. Optionally add the 60-minute `timeout-minutes` pattern to the other test workflows.

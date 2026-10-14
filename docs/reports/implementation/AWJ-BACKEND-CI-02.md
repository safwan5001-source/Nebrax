# AWJ-BACKEND-CI-02 — Implementation Report

STATUS: review (PR-ready; merge gated on final-head CI + pre-merge review)
DATE: 2026-10-14

## Outcome

A PostgreSQL test that waits on a lock held by an abandoned transaction now fails after **60 s** with a named `SQLSTATE[55P03] lock_not_available`. Before this change it hung the ParaTest worker with no limit.

What changed:
- **CI:** the pgsql test step exports `PGOPTIONS="-c lock_timeout=60s"`. This is test environment only. It does not change the PostgreSQL server, production config, `config/database.php` or any application code.
- **Concurrency tests:** three of them used `SET lock_timeout = '0'` (unlimited) to restore their setting after a short wait. They now use `RESET lock_timeout`, which goes back to the 60 s limit.
- **Regression test:** `PostgresTestLockTimeoutTest` guards three things:
  - the limit is present and within bounds;
  - waiting behind an abandoned transaction fails with `55P03`;
  - a real deadlock is still reported as `40P01`.

## Root cause and evidence

### Mechanism (reproduced deterministically)

1. `ProductMediaR2ReadTest`, `ProductMediaR2WriteTest`, `ProductMediaR2BackfillTest` and 23 other classes override `tearDown()` like this:
   ```php
   Mockery::close();
   parent::tearDown();
   ```
2. A test registers a tenant through `TenantReferenceNumberService::assign()`. That runs `SELECT … FROM tenant_reference_number_sequences WHERE id = 1 FOR UPDATE` inside the `RefreshDatabase` transaction. The test then errors before a mocked `->once()` expectation is met.
3. `Mockery::close()` throws `InvalidCountException`, so `parent::tearDown()` never runs. Laravel's rollback of the `RefreshDatabase` transaction (`beforeApplicationDestroyed`) is skipped. The PDO connection stays alive, **idle in transaction**, and keeps the row lock.
4. The next test in the same worker opens a new connection and issues the same `FOR UPDATE`. The lock holder is not waiting on anything, so PostgreSQL's deadlock detector sees no cycle. `lock_timeout` defaults to `0`, so the wait has no end.

Local evidence (PostgreSQL 16.15, PHP 8.3, ParaTest 7, `max_locks_per_transaction=1024`, `log_lock_waits=on`):

| Run | Setup | Result |
|---|---|---|
| `ProductMediaR2ReadTest` alone, no `lock_timeout` | as before this change | **hung**; killed at 180 s (`exit=124`) |
| `ProductMediaR2ReadTest` alone, `lock_timeout=15s` | | finished; 2 victims fail with `55P03` on `tenant_reference_number_sequences … FOR UPDATE` |
| Full suite, 4 workers, `lock_timeout=300s` (run 1) | measurement run | 834 s; 3 waits of **300 s** each (2 workers) on `tenant_reference_number_sequences`, holder `idle in transaction` |
| Full suite, 4 workers, `lock_timeout=60s` (run 2) | this change | **418 s**; same leak victims fail in 60 s with `55P03` |

Server log, run 1 (excerpt):
```
[10439] nibras_test_3 LOG:  process 10439 still waiting for ShareLock on transaction 117954 after 54830.838 ms
[10439] nibras_test_3 DETAIL:  Process holding the lock: 10435. Wait queue: 10439.
[10439] nibras_test_3 CONTEXT:  while locking tuple (0,1) in relation "tenant_reference_number_sequences"
[10439] nibras_test_3 STATEMENT:  select * from "tenant_reference_number_sequences" where "id" = $1 limit 1 for update
[10439] nibras_test_3 ERROR:  canceling statement due to lock timeout          ← after 300 s
```
This is the same statement and table recorded in CI-01 (42 min, 2 workers).

The leak is triggered locally because the AWS SDK is missing (`Class "Aws\Exception\AwsException" not found` inside `andThrow(new AwsException(...))`). CI installs the SDK, so those classes pass there. **But any real error in any of the 26 classes would freeze a CI worker the same way.** Until this change, only the 60-minute job timeout ended it.

### Measured legitimate lock waits (sizing the limit)

`log_lock_waits` reports every wait longer than `deadlock_timeout` (1 s). Across two full parallel runs:

| Wait | Max observed | Source |
|---|---|---|
| Legitimate (acquired) | **5.05 s** | `storefront_presentations … FOR UPDATE` (fork concurrency test) |
| Legitimate (acquired) | 1.3 s | advisory locks (shared-base fork tests) |
| Leak victims | 300 s (cap) / 60 s (cap) | `tenant_reference_number_sequences` |
| Longest designed wait in the code | 20 s | `Rem04PostingLockOrderPostgresTest::awaitFile()` default deadline |

Short `SET lock_timeout = '200ms' / '600ms'` statements that tests issue on purpose to prove a lock is held still fire. Each is the test's own expected `55P03`, and all those tests pass.

## Approach chosen

| Option | Verdict |
|---|---|
| **`PGOPTIONS='-c lock_timeout=60s'` on the CI pgsql test step** | **Chosen.** libpq reads it on every connection, so it reaches the Laravel connection, raw PDO "rival" connections, `pcntl_fork` children and the private DDL database from CI-01 (all verified). Scoped to the test process tree; no server or production change. |
| `ALTER ROLE/SYSTEM SET lock_timeout` in CI | Rejected: it changes server state and also affects setup steps that don't need it. |
| `lock_timeout` in `config/database.php` | Rejected: production config (forbidden). Laravel 11's `PostgresConnector` also has no such option. |
| `idle_in_transaction_session_timeout` | Rejected: fork tests intentionally hold idle transactions while children work. Killing the holder also turns the failure into a confusing disconnect in the wrong test. |
| Retry on `55P03` | Rejected: hides the failure (task constraint). |
| Removing the leaking `Mockery::close()` in 26 classes | Root-cause fix, but a 26-file sweep is broader than "minimal". Proposed as its own task (see Discovered backlog). |

**Why 60 s:**
- It is 12× the longest measured legitimate wait (5 s) and 3× the longest designed deadline (20 s), so it does not cause false failures on slow runners.
- It is above `deadlock_timeout` (1 s), so real deadlocks are still detected and reported as `40P01`.
- It matches the CI-01 local experiment that completed the suite.

The regression test enforces bounds of [30 s, 120 s].

## Changed files

| File | Change |
|---|---|
| `.github/workflows/ci.yml` | `export PGOPTIONS="-c lock_timeout=60s"` in the pgsql branch of the test step |
| `tests/Feature/PostgresTestLockTimeoutTest.php` | New: 3 regression tests (pgsql only; skip on SQLite) |
| `tests/Feature/AccountingPeriodLockConcurrencyTest.php` | `SET lock_timeout = '0'` → `RESET lock_timeout` |
| `tests/Feature/FiscalYearConcurrencyTest.php` | same |
| `tests/Feature/PreviewExchangePostgresConcurrencyTest.php` | same |
| `docs/reports/implementation/AWJ-BACKEND-CI-02.md` | This report |

Unchanged: production config, migrations, API, tenant isolation, accounting, `setup.sh` (CI-03), CI Gate rules. The CI Gate's forbidden list (`--filter`, `--group`, `|| true` …) is not touched.

## Tests and exact results

### Regression test `PostgresTestLockTimeoutTest`

| Test | What it proves |
|---|---|
| `every_test_connection_inherits_a_bounded_lock_timeout` | Laravel and an independent PDO connection both see 30 s ≤ `lock_timeout` ≤ 120 s, and `lock_timeout` > `deadlock_timeout` |
| `waiting_behind_an_abandoned_transaction_fails_with_55P03_instead_of_hanging` | An idle transaction holds `tenant_reference_number_sequences`, the incident statement runs on the Laravel connection with no local `SET`, and it fails with `55P03` in [0.9×, +10 s] of the limit |
| `a_real_deadlock_is_still_reported_as_40P01_before_the_lock_timeout` | A real two-connection lock cycle: one side gets `40P01`, the other proceeds, and it finishes in less than the limit (not `55P03`) |

| Environment | Result |
|---|---|
| pgsql, no `PGOPTIONS` (guard removed) | **3 failures in 5 s** with an explicit message; **no hang** (each test checks for the limit before waiting) |
| pgsql, `PGOPTIONS=-c lock_timeout=60s` | **3 passed, 21 assertions, 68 s** (60 s is the deliberate wait) |
| SQLite | 3 skipped (pgsql-only, as with the other `*Postgres*` tests) |

### Full local parallel runs (4 workers, 6825 → 6828 tests)

| Run | Duration | Errors / Failures | Concurrency / Postgres / deadlock classes failing |
|---|---|---|---|
| 1: `lock_timeout=300s` (baseline) | 834 s | 123 / 28 | none |
| 2: `lock_timeout=60s` (this branch) | **418 s** | 123 / 28 | **none**; the 3 new tests pass |

- The failing sets are identical apart from which tests become leak victims: `ProductOptionValueVisualTest` ×2 in run 1, `ProductMediaR2WriteTest` ×2 in run 2. ParaTest scheduling decides which test runs after the leaking one.
- Every other local failure is a known sandbox gap that CI provisions (CI-01 / CI-03): missing `bcmath` (`bcmul`), missing AWS SDK, media fixtures.
- The deliberate REM-04 deadlock reproduction (`insert into payments` vs `tenants FOR UPDATE`) still reports `deadlock detected` and passes.
- All `*Concurrency*`, `*Postgres*`, `Rem04*`, `FiscalYear*`, `AccountingPeriodLock*`, `CreditNote*` and ledger tests pass.

### CI

Authoritative results are on the PR head (see PR description and the PRE_MERGE_REVIEW comment):

| Job | Expected |
|---|---|
| `php artisan test (L11, pgsql)` | green; 6828 tests; the new class runs (not skipped) |
| `php artisan test (L11, sqlite)` | green; new class skipped |
| `CI Gate` | green |

## Pre-merge review
- PRE_MERGE_REVIEW: recorded as a PR comment against the final head (a file cannot carry its own commit hash).
- Codex / Reviewer findings and resolution: recorded on the PR.

## Merge
- Merge status: not merged
- Merge SHA: —

## Post-merge review
- POST_MERGE_REVIEW: recorded as a PR comment with the Merge SHA.

## Self-review

### Implementer
- Outcome met: the unbounded wait is now bounded, named and attributed (`55P03` + statement + table), and the job no longer depends on its 60-minute timeout.
- Concurrency tests keep detecting real problems: their own short `SET lock_timeout` checks are unchanged, and real deadlocks still surface as `40P01` within 1 s.
- Failure states: if someone removes `PGOPTIONS` from CI, `PostgresTestLockTimeoutTest` fails in seconds rather than hanging.

### Reviewer
- `PGOPTIONS` is set only inside the `matrix.db == pgsql` branch. SQLite has no libpq, so it is unaffected.
- `RESET` inside a `RefreshDatabase` transaction restores the session default (the 60 s limit). Before, `'0'` disabled it for the rest of the test.
- The regression test uses only the per-worker database (`RefreshDatabase`), so its table locks never touch other workers or the shared base database. Its holders are rolled back in `tearDown()` before `parent::tearDown()`.

### AWJ Guardian
- Tenant isolation: unchanged. No tenant data is created by the new test.
- Accounting: no ledger, journal or money path touched. No new financial operation, so no journal-entry table is required.
- Production: no server, config or migration change. `lock_timeout` exists only in the CI test process environment.
- No retry, skip, filter or disabled test.

## Accounting impact
None. Test-infrastructure only.

## Tenant / branch isolation impact
None.

## Security / authorization impact
None. No secrets in logs. The test builds its connection string from the existing in-process test config only.

## Backward compatibility
Full. No runtime, API, schema or migration change.

## External research used
- PostgreSQL 16 docs, *Client Connection Defaults → `lock_timeout`*: aborts any statement waiting longer than the limit on a table, row or other lock. `0` disables it. Not recommended in `postgresql.conf` for all sessions; a per-environment client setting is the documented scope.
- PostgreSQL 16 docs, *libpq Environment Variables → `PGOPTIONS`*: equivalent to the `options` connection parameter (`-c name=value` run-time settings sent at connection start).
- PostgreSQL 16 docs, *Lock Management → `deadlock_timeout`, `log_lock_waits`*: deadlock check after 1 s; wait logging used for the measurements above.
- Laravel 11 source (`vendor/`): `InteractsWithTestCaseLifecycle::tearDownTheTestEnvironment()` runs `beforeApplicationDestroyed` callbacks (the `RefreshDatabase` rollback) **before** its own `Mockery::close()`. That makes a subclass's earlier `Mockery::close()` both redundant and the leak trigger.

## Risks / remaining work
- The regression test costs about 60 s on one worker (a deliberate full wait). Wall-clock impact is at most 60 s on a ~7–25 min job.
- A legitimate wait longer than 60 s would now fail instead of passing slowly. The measured maximum is 5 s, so this is very unlikely; the failure would be named `55P03` with the statement.
- Local runs (`setup.sh`) do not set `PGOPTIONS`. Locally, `PostgresTestLockTimeoutTest` fails fast with instructions until CI-03 brings local parity: `PGOPTIONS='-c lock_timeout=60s' php artisan test --parallel`.

## Discovered backlog
- **Mockery tearDown leak (root-cause follow-up, test-only):** 26 test classes call `Mockery::close()` before `parent::tearDown()`. An erroring test then skips the `RefreshDatabase` rollback and leaves a row-locking connection open. Fix: delete the redundant line (Laravel already closes Mockery after the rollback and still reports unmet expectations). Proposed as **AWJ-BACKEND-CI-02b**, or folded into CI-03.
- **AWJ-BACKEND-CI-03:** local test-environment parity in `setup.sh` (`bcmath`, AWS SDK, `PGOPTIONS`).

## Git state
- Branch: `fix/backend-ci-02-pg-lock-timeout`
- Base SHA: `5ff3135` (`origin/main`, merge of #1451)
- Head SHA: recorded in the PR description

## Recommended next task
**AWJ-BACKEND-CI-03**: local test-environment parity (`setup.sh`), including `PGOPTIONS` so this guard runs the same way locally.

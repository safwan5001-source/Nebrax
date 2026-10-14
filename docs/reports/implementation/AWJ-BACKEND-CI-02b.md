# AWJ-BACKEND-CI-02b — Implementation Report

STATUS: review (PR-ready; merge gated on final-head CI + pre-merge review)
DATE: 2026-10-14

## Outcome

This removes the root cause of the leaked PostgreSQL test transactions that CI-02 only bounded.

- **Before:** 26 test classes overrode `tearDown()` as `Mockery::close(); parent::tearDown();`. A test that failed with an unmet Mockery expectation therefore skipped Laravel's database rollback and left a row lock behind.
- **After:** every affected class goes through Laravel's own `tearDown()`, which rolls back **first** and then closes Mockery. The failure is still reported, and the lock is always released.

The CI-02 guard (`PGOPTIONS="-c lock_timeout=60s"`, `PostgresTestLockTimeoutTest`) is unchanged and stays as a second line of defence. No production code, configuration, migration, API or CI workflow changed.

## Root cause (verified against Laravel 11.57.0 source)

`Illuminate\Foundation\Testing\Concerns\InteractsWithTestCaseLifecycle::tearDownTheTestEnvironment()` runs in this order:

1. `callBeforeApplicationDestroyedCallbacks()`: this is where `RefreshDatabase` / `DatabaseTransactions` **roll back** their transaction.
2. `ParallelTesting` tear-down callbacks, then `$this->app->flush()`.
3. It adds Mockery's expectation count to the assertion count, then calls `Mockery::close()`, **re-throwing** `InvalidCountException` (except for Laravel's own console `doWrite` / `askQuestion` mocks).

With `Mockery::close(); parent::tearDown();` in a subclass:
- `close()` runs **before** step 1.
- If an expectation such as `->once()` is unmet because the test errored or failed early, `close()` throws and `parent::tearDown()` never runs.
- The test object keeps `$this->app`, and with it the PDO connection, alive **idle in transaction** with every lock the test took. The usual one is the `tenant_reference_number_sequences` row locked by `TenantReferenceNumberService::assign()` during tenant registration.
- The next test in the worker opens a new connection, requests the same row, and waits on a holder that will never commit. That is the 42-minute hang behind CI-01/CI-02.

## Per-class review (all 26, not assumed)

| Check | Result |
|---|---|
| Base class | All 26 extend `Tests\TestCase` → `Illuminate\Foundation\Testing\TestCase`, so Laravel's tear-down (rollback, then `Mockery::close()`) is inherited |
| `MockeryPHPUnitIntegration` / own Mockery lifecycle | None |
| Database trait | 24 × `RefreshDatabase`; 2 without a trait (`R2SmokeTestCommandTest`, `R2StorageServiceTest`, which hold no test transaction but did skip the app flush on the same failure) |
| `tearDown()` body | 25 × exactly `Mockery::close(); parent::tearDown();` · `R2StorageServiceTest`: `TenantContext::forget(); Mockery::close(); parent::tearDown();` |
| Mock style | 15 classes set count expectations (`once()`, `never()`, `shouldNotReceive`) and **can** trigger the leak. 11 `Storefront*` classes use the shared `StorefrontMediaTestSupport` mocks (`andReturnUsing`, no counts): they cannot trigger it today, but their explicit `close()` would bring it back as soon as a count expectation is added |
| Console mocks (`doWrite` / `askQuestion`) | None mocked by these classes, so Laravel's narrow exemption changes nothing for them |

### Fix applied (smallest safe change per class)

| Classes | Change |
|---|---|
| 25 classes whose override was only `Mockery::close(); parent::tearDown();` | Override removed. Laravel's `tearDown()` is used unchanged |
| `R2StorageServiceTest` | Only the `Mockery::close();` line removed; `TenantContext::forget()` kept before `parent::tearDown()` (it cannot throw) |
| 10 `Storefront*` classes | `use Mockery;` removed: its only use was the deleted call |

**Rejected alternative:** `try { Mockery::close(); } finally { parent::tearDown(); }`. It is safe, but it keeps a second, redundant close. It also discards Laravel's expectation counting, because the container is already reset when Laravel reads it, and a `close()` exception would replace the original error.

### Other `tearDown()`s reviewed (38): not this defect

- **Rival / fixture classes** (`AccountingPeriodLock*`, `FiscalYear*`, `PreviewExchange*`, `StorefrontPresentation*`, `ImportJob*`, `DocumentNumbering*`, `PostgresTestLockTimeoutTest`): they roll back the rival connection inside `try`, then call `parent::tearDown()`, then purge. The order is correct.
- **Fork-based classes without a DB trait** (`*PostgresConcurrencyTest`, `CreditNote*`, `Rem04PostingLockOrder*`): they purge before `parent::tearDown()`, but they hold no test transaction, so there is nothing to leak. A purge error there fails loudly. Not changed.
- **`Carbon::setTestNow()` / `TenantContext::forget()` / `@unlink` before parent:** these cannot throw.

## Regression test — `TestTeardownCleanupTest`

| Test | Driver | Proves |
|---|---|---|
| `no_feature_test_closes_mockery_itself_in_tear_down` | all | Static guard: no `tearDown()` in `tests/Feature` calls `Mockery::close()`. Before the fix it listed exactly the 26 classes |
| `the_legacy_tear_down_shape_leaks_the_row_lock_of_a_failed_test` | pgsql | **Sensitivity.** A probe class runs in a separate PHPUnit process against this worker's database. Test A takes `tenant_reference_number_sequences … FOR UPDATE` inside `DatabaseTransactions`, then fails an unmet `->once()`. Test B requests the row `FOR UPDATE NOWAIT`. With the old teardown, **B fails with `55P03`**: the probe reproduces the incident |
| `laravel_tear_down_releases_the_row_lock_and_still_reports_the_failure` | pgsql | The same probe on Laravel's teardown: **A still fails** (`should be called … exactly 1 times`), so no failure is masked, and **B passes**, so the lock was released |

- The probe uses `NOWAIT`, so it never waits.
- It unsets `LARAVEL_PARALLEL_TESTING` / `TEST_TOKEN` so it uses the parent worker's database instead of deriving another.
- It uses `DatabaseTransactions`, not `RefreshDatabase`, so it never re-migrates.
- Each run takes about 0.2 s.

## Tests and exact results (local: PostgreSQL 16.15, PHP 8.3, ParaTest 7, `lock_timeout=60s`)

### Regression test
- pgsql: **3 passed, 15 assertions**.
- SQLite: guard passed, 2 lock probes skipped (pgsql-only).
- Before the fix the guard failed and listed the 26 classes; the probes passed both ways.

### The 26 classes, before (`origin/main`) vs after, same database and environment

| | Tests | Pass | Error | Failure | Skipped | Duration |
|---|---|---|---|---|---|---|
| before | 383 | 285 | 94 | 3 | 1 | **273 s** |
| after | 383 | **287** | 94 | **1** | 1 | **155 s** |

- The only status changes are 2 `ProductMediaR2ReadTest` tests going failure → pass. They were the **victims** of the leaked lock: each waited the full 60 s CI-02 limit, hence the 118 s difference.
- The 94 errors are identical in both runs and come from known local sandbox gaps that CI provisions (CI-03): `Undefined array key "data"` ×75 (storefront media fixtures), missing AWS SDK ×17, and 2 more of the same family.

### Full parallel PostgreSQL suite (4 workers)
Same machine, same database, `PGOPTIONS='-c lock_timeout=60s'`, `php artisan test --parallel --processes=4`:

| Tree | Tests | Assertions | Errors / Failures | Failing tests | `55P03` leak victims | Server lock timeouts | Duration |
|---|---|---|---|---|---|---|---|
| `origin/main` `51851c0` | 6855 | 50057 | 123 / 28 | 151 | **3** (`ProductMediaR2ReadTest` ×1, `ProductMediaR2WriteTest` ×2) | 15 | 373 s |
| this branch | 6858 | 50493 | 123 / **25** | **148** | **0** | 12 | **326 s** |

- **Failing tests:** the branch set is a **strict subset** of `main`'s. `comm` gives 3 tests only on `main` (exactly the leak victims) and **none only on the branch**.
- **Lock timeouts on the branch:** all 12 are deliberate. 11 are the concurrency tests' own short `SET lock_timeout` proofs (`tenants`, `import_jobs`, `preview_exchange_references`); 1 is CI-02's intentional 60 s regression wait on `tenant_reference_number_sequences`.
- **Lock waits:** the longest legitimate acquired wait is still 5.05 s. Two `NOWAIT` errors appear in the server log. One is `FiscalYearConcurrencyTest`'s own `tenants … FOR UPDATE NOWAIT` proof, also present once on `main`. The other is the legacy-shape probe on `tenant_reference_number_sequences`, which is expected to fail.
- **Deadlocks:** the 2 recorded are the deliberate REM-04 reproductions; their tests pass.
- **Assertions:** +436. That is the new test (15) plus Mockery expectation counts that Laravel now adds to the assertion count, since the container is no longer reset before Laravel reads it.
- **No concurrency, `*Postgres*`, `Rem04*`, deadlock, `FiscalYear*`, `AccountingPeriodLock*`, `CreditNote*` or ledger class fails.** The remaining 148 are the known local gaps (missing `bcmath`, AWS SDK, storefront media fixtures), identical on `main`.

## Changed files

| File | Change |
|---|---|
| 26 × `tests/Feature/*Test.php` (listed in the PR) | Redundant `Mockery::close()` / override removed; 10 unused `use Mockery;` imports removed (161 lines deleted, 0 added) |
| `tests/Feature/TestTeardownCleanupTest.php` | New regression test (guard + runtime probe) |
| `docs/reports/implementation/AWJ-BACKEND-CI-02b.md` | This report |

Not changed:
- `.github/workflows/ci.yml` (the CI-02 `PGOPTIONS` limit of 60 s stays);
- `PostgresTestLockTimeoutTest`;
- production code, configuration, migrations, API, tenancy, accounting;
- `setup.sh` (CI-03).

## CI
Recorded in the PR and in the PRE_MERGE_REVIEW comment (a file cannot carry its own head SHA).

## Pre-merge review
- PRE_MERGE_REVIEW: PR comment on the final head.
- Codex / Reviewer: recorded on the PR.

## Merge
- Merge status: not merged
- Merge SHA: — (POST_MERGE_REVIEW comment)

## Self-review

### Implementer
- Root cause removed at its source; CI-02's limit remains as defence in depth.
- Failures are not masked: the regression test proves an unmet expectation still fails its test.
- Smallest change: deletions only. One class keeps its own non-Mockery cleanup.

### Reviewer
- Laravel's `tearDown()` already performs what the deleted lines did (`Mockery::close()`), later and correctly ordered. The only behavioural difference is Laravel's exemption for its own console mocks (`doWrite` / `askQuestion`), which none of these classes use.
- Expectation counts now reach PHPUnit's assertion count, because Laravel reads the container before closing it. Expect a higher assertion total in CI; the test count is +3.
- The static guard ignores its own file, which contains the legacy shape as probe input.

### AWJ Guardian
- Tenant isolation: unchanged. The probe locks a global sequence row inside its own transaction and releases it; no tenant data is written.
- Accounting: no ledger, journal or money path touched; no new financial operation, so there are no journal entries.
- Production: none. Test files only.
- No retry, skip, filter or disabled test. No test assertion was weakened.

## Accounting impact
None.

## Tenant / branch isolation impact
None.

## Security impact
None. The child process inherits the existing in-process test credentials only and writes its probe file to the system temp directory, deleting it in `finally`.

## Backward compatibility
Full. Test-only.

## External research used
- Laravel 11.57.0 framework source (`vendor/`): `InteractsWithTestCaseLifecycle::tearDownTheTestEnvironment()` (order above) and `RefreshDatabase::beginDatabaseTransaction()` (rollback registered via `beforeApplicationDestroyed`).
- Mockery docs, *PHPUnit Integration*:
  - `Mockery::close()` "cleans up the Mockery container used by the current test" and runs the expectation verification.
  - An integration that calls it (`MockeryTestCase` / `MockeryPHPUnitIntegration`) avoids "having to call the close method".
  - The docs require a manual call only under **process isolation**, which none of the 26 classes use (checked: no `runInSeparateProcess` / `RunTestsInSeparateProcesses`).
  - The docs do not mention Laravel. That Laravel's `TestCase` performs this call is established from its source (above), not from the Mockery docs.
- PostgreSQL 16 docs, *SELECT … FOR UPDATE NOWAIT*: fails immediately with `55P03` instead of waiting, which is used so the probe can never hang.

## Risks / remaining work
- A future test could add its own teardown that throws before `parent::tearDown()` in a different way. The static guard covers only the Mockery shape; CI-02's 60 s limit still bounds any such leak with a named `55P03`.
- Fork-based classes purge shared-base tenants before `parent::tearDown()`. No defect was observed, so they are not changed (see CI-01 backlog).

## Next task
**AWJ-BACKEND-CI-03**: local test-environment parity in `setup.sh`.

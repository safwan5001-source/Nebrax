# AWJ-BACKEND-CI-01 — Implementation Report

STATUS: review
DATE: 2026-10-14

## Outcome

`CreditNoteSourcePostgresTest::the_restrict_rule_rolls_back_to_set_null_and_forward_again` no longer deadlocks under the parallel PostgreSQL CI run. The test still rolls the real migration back and forward on a real, fully migrated PostgreSQL database and reads the real catalog. It now does so on a **private database that only this test connects to**, through the real operator commands (`migrate:rollback --path`, then `migrate --path`).

No production code, migration, constraint, CI workflow or CI Gate rule was changed. One test file changed, plus this report.

## Repository evidence / root cause

### CI evidence (both failures read from the job logs, not from the closure report)

| PR | Failed job | Attempt | Result on re-run |
|---|---|---|---|
| #1433 | `php artisan test (L11, pgsql)` job `115679088258`, run `38510953033` | 1 | attempt 2 passed |
| #1441 | `php artisan test (L11, pgsql)` job `115716636898`, run `38522859930` | 1 | later head passed |

Both PRs were web-only. The PostgreSQL server log in job `115679088258`:

```
[3100] ERROR:  deadlock detected
[3100] DETAIL:  Process 3100 waits for AccessExclusiveLock on relation 16626; blocked by process 3092.
        Process 3092 waits for RowExclusiveLock on relation 17066; blocked by process 3100.
        Process 3100: ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS "credit_notes_original_invoice_id_foreign"
        Process 3092: delete from "tenants" where "id" = $1
```

Relation 16626 is `invoices` and 17066 is `credit_notes`. Their OIDs follow creation order; locally `invoices` = 376578 and `credit_notes` = 377018.

### What the earlier diagnosis got right and what it missed

The closure report (`AWJ-ERP-UX-H1-8-CLOSURE.md` §6.3) said the DDL raced "a concurrent row lock". That is correct but incomplete. The other party is **not** a row lock inside the same test. It is another ParaTest worker's teardown, `DELETE FROM tenants`. Deleting a tenant row fires the RI triggers of ~307 `tenant_id` foreign keys, so one statement takes `RowExclusiveLock` on almost every business table, `invoices` before `credit_notes`.

### Why two workers meet in the same database

- CI runs PostgreSQL with `php artisan test --parallel --processes=4`.
- Laravel's `TestDatabases::bootTestDatabase()` switches a test case to the per-worker database `nibras_test_N` **only if the class uses** `RefreshDatabase`, `DatabaseTransactions`, `DatabaseMigrations` or `DatabaseTruncation`.
- `CreditNoteSourcePostgresTest` deliberately uses none of these. Its rows must be committed so that `pcntl_fork()` children can see them. The same holds for about 20 other `*PostgresConcurrencyTest` classes.
- So all four workers run these classes against the **shared base database `nibras`**. Each one purges its tenant in `tearDown()`.
- `ALTER TABLE credit_notes DROP CONSTRAINT …` takes `AccessExclusiveLock` on `credit_notes`, then on `invoices`. The purge takes the same two tables in the opposite order, so PostgreSQL breaks the cycle with `40P01`.
- This is the only class that commits DDL to the shared database. A search of every trait-less test for `->down()`, `->up()`, `ALTER TABLE` and `Schema::create/table/drop` found nothing else.

Latent hazard in the old test: `down()` and `up()` ran as separate autocommit statements on the shared database. A deadlock on `ADD CONSTRAINT` after `DROP CONSTRAINT` had committed would have left the shared database with **no** foreign key for the rest of the run. The `finally` block's `up()` could deadlock the same way.

### Test interference vs. a production defect

This is **test interference**, not a production logic defect:
- The migration is correct.
- Laravel runs it inside the migrator's own transaction on PostgreSQL, so a lock conflict at deploy aborts atomically.
- Production does not delete tenant rows as part of normal traffic.

The generic deploy-time risk of `ACCESS EXCLUSIVE` DDL on hot tables is listed under Risks. It is not changed here.

## Approach chosen

Options considered:

| Option | Verdict |
|---|---|
| Retry on `40P01` | Rejected: hides the cycle (task constraint). |
| `--exclude-group` in parallel + a sequential step | Rejected: `.github/ci-gate/required-checks.json` forbids `--group`/`--exclude-group` in the test step. Weakening a CI Gate guard needs governance approval. |
| Explicit lock ordering (`LOCK TABLE invoices, credit_notes`) on the shared DB | Rejected: other workers' application transactions can take the tables in either order. It would also stall every worker on `invoices`. |
| Copy of only the two tables in a scratch schema | Rejected: closer to a simulation than the real schema. |
| **Private database, fully migrated by the real chain, then real rollback/forward commands** | **Chosen**. |

Implementation (`tests/Feature/CreditNoteSourcePostgresTest.php` only):
1. `CREATE DATABASE "<base>_ddl_<pid>_<random>"` and register a temporary connection cloned from the default.
2. `migrate --database=<private>`: the complete real migration chain (~3 s locally).
3. Assert `RESTRICT` and that the migration row exists.
4. `migrate:rollback --path=<this migration> --realpath`, then assert `SET NULL` and that its migrations row is gone.
5. `migrate --path=<this migration> --realpath`, then assert `RESTRICT` and that the row is back.
6. `finally`: purge the connection and run `DROP DATABASE … WITH (FORCE)`.
7. Assert the shared database still reads `RESTRICT`.

Steps 4 and 5 go through `Migrator::runMigration()`, the same per-migration transaction and default-connection switch production uses. That is more faithful than the previous direct `down()`/`up()` calls.

## Why this approach fits AWJ

- No retry, no skip, no CI filter, no mock: the real migration runs on real PostgreSQL.
- The remaining six tests of the class are unchanged. That includes `the_engine_refuses_to_delete_an_invoice_that_a_note_references`, which still proves `RESTRICT` at engine level (SQLSTATE `23503`) on the real shared schema.
- The fix removes the cycle at its source: no other session ever connects to the private database.

## Changed files

| File | Change |
|---|---|
| `tests/Feature/CreditNoteSourcePostgresTest.php` | DDL test moved to a private migrated database via the real migrate commands; `deleteRule()` takes an optional connection |
| `docs/reports/implementation/AWJ-BACKEND-CI-01.md` | This report |

## Tests and exact results

Environment: local PostgreSQL 16, PHP 8.3, Laravel 11.57.0, PHPUnit 11.5.57, ParaTest 7, `max_locks_per_transaction=1024` (as in CI).

### Reproduction before the fix (`origin/main` `ee42630`)

| Scenario | Result |
|---|---|
| Test alone | PASS (7/7 in class), so it is not deterministic in isolation |
| **Deterministic repro**: a second session holds `RowExclusive` on `invoices`, starts the test, then requests `credit_notes` | **FAIL — `SQLSTATE[40P01]` on the same `DROP CONSTRAINT` statement as CI** |
| **Stochastic repro**: 3 background sessions loop `INSERT`/`DELETE FROM tenants` (models other workers' purge); test run 20× | **13 FAIL / 7 PASS, every failure `40P01`** |

### After the fix

| Scenario | Result |
|---|---|
| Deterministic repro (same script) | **PASS** |
| Stochastic repro, 4 background purge sessions, 30 runs | **30 PASS / 0 FAIL**; shared rule `RESTRICT`; 0 leftover private databases |
| Full class | 7 passed (41 assertions) |
| Mutation: `down()` rebinds `RESTRICT` instead of `SET NULL` | Test **fails** ("two strings are identical"); private DB still dropped |
| Mutation: `up()` does nothing | Test **fails**; private DB still dropped |
| Full PostgreSQL suite, parallel `--processes=4` (CI mode) | see below |
| Full SQLite suite (sequential, CI mode) | see below |

FULL_SUITE_RESULTS_PLACEHOLDER

## Build / lint / typecheck

`php -l` clean. No web, storefront or mobile files touched.

## CI

CI_PLACEHOLDER

## Pre-merge review
- PRE_MERGE_REVIEW: PENDING
- Reviewed Head SHA: PENDING
- Findings / resolution: PENDING

## Merge
- Merge status: not merged
- Merge SHA: —

## Post-merge review
- POST_MERGE_REVIEW: PENDING
- Reviewed Merge SHA: —
- Target-branch checks/smoke: —
- Findings / resolution: —

## Self-review

### Implementer
- Outcome met: the interference is removed. The rollback/forward behavior is still verified on real PostgreSQL through the real migrator commands.
- Simpler safe design? The two simpler designs need a retry or a CI Gate exception; both are rejected above.
- Failure states: if `CREATE DATABASE` is not permitted, the test fails loudly rather than skipping. CI's `POSTGRES_USER` is superuser, and Laravel's parallel testing already needs `CREATEDB`. Cleanup runs in `finally` and uses `WITH (FORCE)`.

### Reviewer
- Scope: one test method and one helper. No change to the other six tests, the migration, `ci.yml` or the CI Gate.
- `$this->artisan(...)->assertExitCode(0)->run()` executes the command at that line, not in a later destructor. Exit codes are asserted.
- The database name is truncated to PostgreSQL's 63-byte identifier limit. It is unique per process and run, so it cannot collide with Laravel's `nibras_test_N` worker databases.

### AWJ Guardian
- Tenant isolation: unchanged. The private database holds no tenant data, and the shared database's tenant rows and purge are untouched.
- Accounting: no ledger, journal or money path touched. No new financial operation, so no journal entry table is required.
- Referential integrity: the shared schema is no longer altered at all during the run, which removes the "FK missing after a mid-test deadlock" hazard. Production `RESTRICT` is unchanged.
- Security: no secrets in logs. The connection clone reuses the existing test credentials in-process only.

## Accounting impact
None. Test-only change.

## Tenant / branch isolation impact
None.

## Security / authorization impact
None.

## Backward compatibility
Full. No runtime, API, schema or migration change.

## API / DB / migration impact
None. Migration `2026_11_04_020000_restrict_credit_note_original_invoice_delete.php` is unchanged.

## External research used
- PostgreSQL 16 docs, *Explicit Locking*: `ALTER TABLE … DROP/ADD CONSTRAINT … FOREIGN KEY` takes locks on both the altering and the referenced table, and `ACCESS EXCLUSIVE` conflicts with `ROW EXCLUSIVE`.
- PostgreSQL 16 docs, *DROP DATABASE … WITH (FORCE)* (PG ≥ 13).
- Laravel 11 framework source, read from `vendor/`:
  - `Illuminate\Testing\Concerns\TestDatabases::bootTestDatabase()`: per-worker database only for classes using a database trait.
  - `Illuminate\Database\Migrations\Migrator::runMigration()/runMethod()/rollbackMigrations()`: per-migration transaction and `--path`-scoped rollback.

## Risks / remaining work
- The test now costs about 3–6 s more (one full migrate of a fresh database).
- **Production (not changed, escalation item only):** the migration's `ACCESS EXCLUSIVE` DDL on `credit_notes`/`invoices` will queue behind, and block, live traffic at deploy. A lock conflict aborts the migrator transaction atomically, so it is safe to re-run. Rolling deploys may want a `lock_timeout` policy for DDL migrations; that is an owner decision, not part of this fix.
- The ~20 other fork-based PostgreSQL classes also share the base database across workers. They do not do DDL and passed in every observed run, but their teardown purges still contend on table locks. See Discovered backlog.

## Discovered backlog
- **AWJ-BACKEND-CI-02 (candidate):** shared-base-database purges in fork-based PostgreSQL tests. Each `DELETE FROM tenants` locks ~307 tables across workers. Candidate: a shared trait for the per-test purge, with deterministic table order and an advisory-lock-free design. Needs evidence of actual failures first; none were observed in this task.

## Git state
- Branch: `fix/backend-ci-01-pg-ddl-deadlock`
- PR: PR_PLACEHOLDER
- Base SHA: `ee42630` (`origin/main`)
- Head SHA: recorded in the PR description (a file cannot contain its own commit hash)

## Recommended next dependency-ready task
NEXT_PLACEHOLDER

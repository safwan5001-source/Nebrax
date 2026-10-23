# AWJ — PostgreSQL CI Stabilization — Implementation Report

PR: #1678 · Branch: `claude/awj-pg-ci-stabilization` · Independent of PR #1551 (which is not modified).

| | SHA |
|---|---|
| **Original base** (`main` at branch creation) | `a148c0141d438c3f68d82e850975a92941b442e2` |
| Code head first tested by CI | `6db9a253892d621433ea2ca7ce4229c595afcc94` |
| **Merged `main`** (conflict update) | `9de26a791` (includes #1679 `7f1bc7000`) |
| Head after the merge | see the PR (merge commit `e7fa42285` + this report update) |

### Conflict update (merge of `main`, no force push)
GitHub reported conflicts after #1679 landed on `main`. The two real conflicts were identical in shape and are resolved by keeping **both** traits: `tests/Feature/PaymentAttemptPostgresTest.php` and `tests/Feature/PaymentAttemptPostingPostgresTest.php` (`use UsesWorkerDatabaseWithoutTransaction;` from #1679 + `use DiagnosesUnprovenScheduler;` from this PR). `ZatcaMonetaryXmlTest.php` and the new trait file merged cleanly. No production code touched.

## 1. Scope and result

| # | Item | Result |
|---|---|---|
| 1 | `ZatcaMonetaryXmlTest` depends on unspecified `InvoiceLine` order | **Fixed** (test-only), root cause demonstrated |
| 2 | `scheduler_unproven` in `PaymentAttempt*PostgresTest` | **Fixed on `main` by #1679 (not by this PR).** This PR keeps the failure-time diagnostics only |
| 3 | PostgreSQL 16 first, then CI | Done (below) |
| 4 | No test disabled, no assertion weakened, CI Gate untouched | Held (below) |
| 5 | Payments logic / DB change needs approval | **No such change made**; none proposed yet (see §6) |

No production code, migration, payments rule, ZATCA rule or workflow file is changed.

## 2. Files

| File | Change |
|---|---|
| `tests/Feature/ZatcaMonetaryXmlTest.php` | Two private helpers (`linePathByName`, `linesInXmlOrder`); stored lines are matched to XML lines by description instead of by position at the 4 order-dependent sites (per-line loop, category test ×2 assertions, `line_tax` list, document-discount test) |
| `tests/Feature/DiagnosesUnprovenScheduler.php` (new) | Trait: runs `setTenantState(…, true, …)`; on `PaymentsRolloutControlException` with reason `scheduler_unproven` rethrows a `RuntimeException` (cause chained) whose message carries a state snapshot; any other exception is rethrown untouched |
| `tests/Feature/PaymentAttemptPostgresTest.php`, `tests/Feature/PaymentAttemptPostingPostgresTest.php` | `setUp` calls the trait method instead of the service directly; the now-unused import is removed |

Diff vs base: 4 files, +138 / −11 (tests only).

## 3. Item 1 — `ZatcaMonetaryXmlTest`

**Cause.** `Invoice::lines()` is a bare `hasMany` (no `ORDER BY`) and `invoice_lines` has no sequence/position column (uuid PK). The XML builder emits lines in whatever order the relation returns; the test then re-queries (`fresh('lines')`) and assumed that order equals XML order (`InvoiceLine[1]` = the 15 % line). PostgreSQL guarantees no row order (plan- and heap-dependent). CI failure: `ZatcaMonetaryXmlTest.php:296`, expected `['Name','ClassifiedTaxCategory']` for `InvoiceLine[1]`, got `['Name']`.

**Evidence (PostgreSQL 16, real, local).**
- Mechanism: after updating one line, a seq-scan plan returned `[0,5,15]` instead of `[15,0,5]` for the same invoice.
- Reproduction by mutation (temporary, reverted): forcing the relation to `ORDER BY random()` makes the **old** test fail (`every_xml_amount…` ×4 data sets and `category_s_…`) — the CI signature.
- The **new** test passes under `random()` (twice), `description desc`, `id desc` and default order: 45/45 each.
- Assertions: 1033 → **1072** (more, none removed). Pairing stays strict: each stored line is compared with the XML line of the same description, and the helper asserts every XML line has a stored line and none is left over.

**Residual (not changed here).** Production XML line order is equally unspecified. Stored XML never changes after issue, so this is not an integrity bug, but the line sequence in an issued document is not guaranteed to follow the entry order. Fixing it needs a sequence column (schema + ZATCA output decision) → separate approval.

## 4. Item 2 — `scheduler_unproven`

**Observed.** `PaymentsRolloutControlException(scheduler_unproven)` at `PaymentsRolloutControlService.php:208`, always in `setUp`, immediately after `SchedulerHeartbeat::record()` → `setTenantState(…, true)`. Seen on PR #1551 in two separate pgsql runs (`PaymentAttemptPostingPostgresTest` in one, `PaymentAttemptPostgresTest` in the other) and on `main` at `f80f1c7ee` (both classes). pgsql-only.

**Ruled out by reading the code:** `platform_runtime_heartbeats.component` is `UNIQUE` (one row — not a duplicate-row ordering issue); freshness window is 10 min; no test/app code sets the PostgreSQL session timezone; the column is `timestamptz` and the CI server timezone is UTC.

**Root cause (established by #1679, merged on `main` after this investigation; I did not reproduce it independently):** the four payments fork tests used no DB trait, so under ParaTest they ran on the shared base database instead of a per-worker one. The platform rows they rely on (the `scheduler` heartbeat, the emergency-stop row) are global, so another worker's `tearDown` cleanup could delete them mid-`setUp`. That matches every observation here: parallel-CI only, in `setUp`, right after `record()`, and not reproducible in a single process. #1679 adds `UsesWorkerDatabaseWithoutTransaction` (worker DB, no wrapping transaction). My hypotheses about leaked state/forked sockets above are superseded.

**Not reproduced (before #1679):** serially on PG16, 6× on the class; 199 `Postgres`-tagged tests 2×; and 4 iterations of `--parallel --processes=4` over `Payment|Postgres|Scheduler|Heartbeat` (only the locally-unconfigured `PostgresTestLockTimeoutTest` failed, because `PGOPTIONS=-c lock_timeout=60s` from the CI step was not set locally).

**Hypotheses still open (not claimed):** state leaked between tests in a worker (forked children share the parent's DB socket — the existing tests fork), or an interaction with a neighbouring test in the same worker. Neither is evidenced.

**What was added.** The snapshot in the failure message: heartbeat row (`last_seen_at::text`, `updated_at`), DB `now()`, session `TimeZone`, backend pid, row count, PHP clock and pid, `Carbon::hasTestNow()`, transaction level, `isFresh()`, and `isFresh()` after re-recording. Exercised locally with a stale heartbeat: the message carried the full snapshot (`is_fresh_now:false`, `is_fresh_after_rerecord:true`) and the cause chain. The failure still fails with the same cause class.

**Role of the diagnostics now:** a cheap guard — if `scheduler_unproven` ever recurs despite #1679, the failure message carries the evidence. They can be removed later without any other change. **If it recurs:** read the snapshot. If `is_fresh_after_rerecord` is true with a sane row, the write is not visible/not applied at the moment of the check (connection/transaction state); if the row's time is off, it is clock/timezone; if the row is missing, another actor deleted it.

## 5. Verification

| Check | Result |
|---|---|
| PG 16 (local), 3 affected classes, `PGOPTIONS` as CI | 54 passed, 1225 assertions |
| `ZatcaMonetaryXmlTest` PG16 and sqlite, default order | 45 passed, 1072 assertions each |
| Order-independence (random / desc orders) | 45 passed each; old test fails under random |
| After merging `main` (#1679): 3 affected classes serially on PG16 | 54 passed, 1225 assertions |
| After merging `main`: 5 classes (`PaymentAttempt*`, `PaymentInbox*`, `PaymentsRolloutControl*`, `ZatcaMonetaryXml`) with `--parallel --processes=4`, CI-like `max_locks_per_transaction=1024` and `PGOPTIONS` | 63 passed, 1446 assertions |
| CI on `6db9a2538` (pre-merge) | `php artisan test (L11, pgsql)` ✅ · `php artisan test (L11, sqlite)` ✅ · `CI Gate` ✅ (run 39969574482 / 39969574511) |

A single green pgsql run does **not** show the `scheduler_unproven` flake is gone (it appeared in 1 of the 6 failed `main` pgsql runs examined, and in two of the pgsql runs on #1551); it only shows this change breaks nothing. The full suite was run only by CI, once.

## 6. Risks

- **Item 1:** none for production (test-only). Matching by description assumes unique descriptions in the tests that call `linePathByName` (asserted: exactly one match) and identical amounts for duplicate descriptions in `linesInXmlOrder` (true for the `small lines` scenario).
- **Item 2:** diagnostics only — no flake reduction yet. They add a few queries only on the failure path. A payments/DB fix, if the snapshot points to production code (e.g. heartbeat write semantics), requires approval before any change.
- Other pgsql-only intermittent failures on `main` (`ImportPlanDriftTest` ×2, `VatSemanticRoutingTest` ×2, `TreasuryCashSaleRoutingTest`) are out of scope and not analysed here.

## 7. Not done / not touched

No merge, no deploy, PR #1551 untouched, no workflow change, CI Gate unchanged.

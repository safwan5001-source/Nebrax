# AWJ-BACKEND-CI-03 — Implementation Report

STATUS: closed (merged, post-merge CI green, POST_MERGE_REVIEW: PASS)
DATE: 2026-10-14

## Outcome

`setup.sh` builds the local Laravel app (and runs as the cloud-session `SessionStart` hook). It now provisions what CI provisions, so a local run no longer shows ~120 false failures that hide real ones. A new check in CI's existing copy-list guard step fails the build if `setup.sh` drifts from `ci.yml` again.

No production code, configuration, migration, API, accounting, tenancy or `deploy/assemble.sh` change. The CI-02 60 s `lock_timeout` and the CI-02b teardown fix are unchanged.

## Root cause and evidence

`setup.sh`, `.github/workflows/ci.yml` and `deploy/assemble.sh` each assemble the app from the core with **independent hand-written lists**. Only `ci.yml`'s `app/*` list was guarded (against the repository tree), so `setup.sh` drifted silently.

| Gap | CI (`ci.yml`) | Production (`assemble.sh`) | `setup.sh` before | Local effect |
|---|---|---|---|---|
| `league/flysystem-aws-s3-v3:^3.0` (AWS SDK) | ✓ | ✓ | **missing** | `Class "Aws\…" not found`: every R2 / storefront-media / document-storage test failed (≈ 92 + downstream 503s) |
| `predis/predis:^2.2` | ✓ | ✓ | **missing** | not exercised by the failing set; parity only |
| `app/Mail` copy | ✓ | ✓ | **missing** | mail classes absent |
| `resources/views/` copy | ✓ | ✓ | **missing** | `View [emails.auth-action] not found` (`UserInvitationTest`, `ResendMailTransportTest`) |
| PHP extensions (`bcmath` …) | loaded by `setup-php` | `Dockerfile` installs | not checked | `Call to undefined function bcmul()`: Fuel tests; silent |

A full source-path diff (all 46 `"$CORE/…"` sources copied by `ci.yml` against `setup.sh`) found **exactly** `app/Mail/` and `resources/views/` missing. `deploy/assemble.sh` was checked the same way (report only) and copies every `ci.yml` `app/*` directory.

## Changes

| File | Change |
|---|---|
| `setup.sh` | `composer require` gains `league/flysystem-aws-s3-v3:^3.0 predis/predis:^2.2` (identical to `ci.yml` / `assemble.sh`) |
| `setup.sh` | Copies `app/Mail/` and `resources/views/` (same lines as `ci.yml`) |
| `setup.sh` | Checks the 11 PHP extensions CI loads. A missing one is a **named warning**, not a failure (see decision below) |
| `setup.sh` | The closing message prints the PostgreSQL parity command `PGOPTIONS='-c lock_timeout=60s' php artisan test --parallel --processes=4` (CI-02) |
| `.github/workflows/ci.yml` | The copy-list guard step also fails if `setup.sh` misses any source path the merge step copies, or any package in the `composer require laravel/sanctum …` line |
| `docs/reports/implementation/AWJ-BACKEND-CI-03.md` | This report |

### Decision: missing extension = warning, not failure
`setup.sh` is the `SessionStart` hook (`.claude/hooks/session-start.sh`, `set -euo pipefail`). Failing on a missing extension would stop the whole session environment on any machine without it, including this container, which lacks `bcmath`. The SQLite core path (`LedgerTest`) does not need it. The warning names the extension and the affected tests, so the false failures are explained, not silent. Installing system packages from `setup.sh` was not adopted: it needs root/apt and is environment policy, not repository code.

### Not adopted
- **Making `setup.sh` provision PostgreSQL / ParaTest:** that would change its documented purpose (fast SQLite setup) and its runtime as a session hook. The parity command is printed instead.
- **Guarding `deploy/assemble.sh` the same way:** it currently matches, and it is the production assembly path. Adding a CI rule there is a separate decision (listed below).

## Tests and exact results (local: PHP 8.3, SQLite, no `bcmath` available)

### Guard step (extracted from `ci.yml` and run locally)
| `setup.sh` | Exit | Output |
|---|---|---|
| this branch | 0 | `✔ setup.sh مطابق لقائمة النسخ وحزم CI.` |
| `origin/main` | **1** | exactly 4 errors: `app/Mail/`, `resources/views/`, `league/flysystem-aws-s3-v3:^3.0`, `predis/predis:^2.2` |

A first draft of the guard matched its own regex line in `ci.yml` and read `[^` as a package name. The match is now anchored to the real command line; both directions were re-verified.

### `setup.sh` end to end (in place, as the session hook runs it)
- Exit 0 in 82 s.
- Warned `bcmath` by name.
- Installed `aws/aws-sdk-php` and `league/flysystem-aws-s3-v3`, and copied `app/Mail` and `resources/views/emails/…`.
- `LedgerTest`: 5 passed.

### The 51 affected test classes, before vs after the new `setup.sh` (SQLite)
| | Tests | Pass | Error | Failure |
|---|---|---|---|---|
| before | 583 | 435 | 123 | 24 |
| after (packages + `app/Mail`) | 583 | 554 | 25 | 3 |
| after (+ `resources/views`) | — | `UserInvitationTest` 8/8, `ResendMailTransportTest` 7/7 | — | — |

- **119 tests fixed, 0 regressions.**
- The only remaining failures in these classes are the **26 Fuel tests (`bcmul`)**, which is the missing `bcmath` extension that `setup.sh` now names.

### Full local suite
`php artisan test` on SQLite (what `setup.sh` provisions), tree rebased on `main` `c9f8bc5` (includes CI-02b #1470 and REM-05 #1457):

| `setup.sh` | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|
| **this branch** | **6775** | **26** | 95 | 634 s |

- **All 26 failures are the 6 Fuel classes** (`FuelAviRfidService`, `FuelReconciliation`, `FuelSaleApi`, `FuelSaleService`, `FuelSupplyReceivingApi`, `FuelSupplyReceiving`), failing on `bcmul()` because `bcmath` is missing. `setup.sh` warns about this by name.
- **There are no other local-only failures.**
- **For comparison:** the same machine with the old `setup.sh` showed 123 errors + 24 failures in the affected classes alone, and ~150 across the PostgreSQL parallel suite (CI-01 / CI-02 / CI-02b reports).
- **One intermediate run** showed a 27th failure: the CI-02b guard. The branch had been cut before #1470 merged, and the stale app directory still held the new guard test. Rebasing onto the latest `main` removed it.

## CI
On the final head `dd700c8` (run `38604322458`, gate `38604322424`):

| Job | Result |
|---|---|
| pgsql (4 workers) | ✅ 6896 tests, 52297 assertions, 0 failures, 3 skipped (09:58) |
| sqlite | ✅ |
| CI Gate | ✅ |

The new guard ran in CI and printed both ✔ lines.

Pre-merge check: `main` had advanced to `d5dfa16` (web/docs only). A local merge re-ran the guard from the merged `ci.yml`: exit 0.

## Review findings and resolution
**Codex was unavailable on this PR** (the account hit its usage limit; bot comment on #1474). An **independent reviewer agent** reviewed the diff instead. It extracted the guard from `ci.yml`, executed it against both `setup.sh` versions, and restored the tree. It found **no blocking defects**, and 3 non-blocking findings:

| # | Finding | Resolution |
|---|---|---|
| 1 | The package check was a substring match: `…:4.1.10` in `setup.sh` would satisfy `…:4.1.1` | **Fixed:** whole-word match (`tr ' ' '\n' \| grep -qxF`). A `4.1.10` mutant now fails the guard (verified) |
| 2 | The guard depends on the format of CI's `composer require laravel/sanctum …` line. It fails safe, but the error would be unrelated to the editor's change | **Fixed:** a comment on that line says the guard reads it (sanctum first, single line) |
| 3 | Only the quoted **source** path is compared, not the glob suffix or destination; an unquoted `$CORE/x` source in `ci.yml` is not covered | **Accepted, documented here.** All 46 current sources are quoted, and destination drift would surface as local test failures |

Both fixes were re-verified locally: branch → exit 0; `main`'s `setup.sh` → exit 1 with 4 errors; version mutant → exit 1.

## Pre-merge review / Merge / Post-merge review
- **PRE_MERGE_REVIEW: PASS** (PR comment): reviewer findings closed, AWJ Guardian review passed on the final diff.
- Merge status: **merged** (squash), PR [#1474](https://github.com/safwan5001-source/Nebrax/pull/1474).
- Base SHA: `c9f8bc5` · Head SHA: `dd700c8` · **Merge SHA: `cf58c965153ba33db3899c07969625d251ca33ba`**
- **POST_MERGE_REVIEW: PASS** (PR comment). `main` run `38606942609` on `cf58c96`:

| Job | Result |
|---|---|
| pgsql | ✅ 6896 tests, 52298 assertions, 0 failures, 3 skipped (10:06). The guard printed both ✔ lines |
| sqlite | ✅ 6801 passed, 95 skipped, 0 failed (51622 assertions) |

No findings. No production deploy.

## Self-review

### Implementer
- Every gap traced to its local symptom; fixed with the same lines CI and production use.
- The guard prevents the class of bug, not just these instances: it compares *all* copied sources and *all* packages, verified against the old `setup.sh`.

### Reviewer
- `ci.yml`: only the copy-list guard step changed; the test step is untouched, so the CI Gate forbidden-flag rule still holds.
- The guard derives its lists from `ci.yml` itself, so adding a directory or package to CI automatically requires it in `setup.sh`.
- `setup.sh` stays idempotent: `composer require` of present packages and `cp` overwrite are no-ops.

### AWJ Guardian
- Production: none. `deploy/assemble.sh` and the `Dockerfile` are unchanged and already provision all four items.
- Tenant isolation, accounting, API, migrations: untouched. No new financial operation, so there are no journal entries.
- No test skipped, filtered or weakened.

## Accounting / tenancy / security impact
None. No secrets: the AWS SDK is installed but no credentials are configured (tests mock the S3 client).

## Risks / remaining work
- **`bcmath` in this cloud environment:** PHP here is built without `bcmath`, and the image's apt index is empty, so it was not installed. 26 Fuel tests stay red locally until the environment's setup provides it (an environment setting, not repository code).
- **PHP version:** CI uses 8.4, local images often 8.3. Not addressable from `setup.sh`.
- **Optional follow-up:** apply the same parity guard to `deploy/assemble.sh` (it matches today).

## Horizon closure — PostgreSQL test hang chain (CI-01 → CI-03)

**Objective:** a PostgreSQL test failure must never hang a CI worker, and local runs must reproduce CI's results.

| Slice | Outcome | PR | Merge SHA | Post-merge CI |
|---|---|---|---|---|
| CI-01 | REM-02 DDL test moved to a private migrated database; removes the `credit_notes` / `tenants` deadlock between workers | #1451 | `5ff3135` | ✅ |
| CI-02 | `PGOPTIONS="-c lock_timeout=60s"` in the CI pgsql step: an abandoned lock now fails with `55P03` instead of an unbounded hang; `PostgresTestLockTimeoutTest` | #1464 | `410465e` | ✅ 6828 / 0 failures |
| CI-02b | Root cause removed: 26 classes no longer close Mockery before the DB rollback; `TestTeardownCleanupTest` (guard + PostgreSQL probe) | #1470 | `115b630` | ✅ 6858 / 0 failures |
| CI-03 | `setup.sh` at CI parity (AWS SDK, predis, `app/Mail`, `resources/views`, extension warning) + CI parity guard | #1474 | `cf58c96` | ✅ 6896 / 0 failures |

**Measured effect (local, same machine):**
- Leaked-lock victims went from 3 per full parallel run (each waiting the cap) to 0. The full parallel run took 373 s before and 326 s after.
- Local-only false failures dropped from ~150 to 26 (`bcmath` only).
- An abandoned transaction now produces a named failure within 60 s, where before it hung until the 60-minute job timeout.

**Unchanged throughout:** production code, configuration and deploy; migrations; API; tenant isolation; accounting (no journal entries); CI Gate test-step rules. Nothing was deployed.

**Remaining (outside this Horizon, owner decisions):**
- `bcmath` in the cloud environment image: 26 Fuel tests stay red locally only.
- Optionally apply the parity guard to `deploy/assemble.sh` (it matches today).
- Fork-based PostgreSQL classes still purge shared-base tenants; no defect observed (CI-01 backlog).

**Horizon status: complete.**

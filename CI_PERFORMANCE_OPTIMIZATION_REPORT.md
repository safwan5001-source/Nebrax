# CI Performance Optimization Report

**Scope:** `.github/workflows/ci.yml` only. Observation window: 2026-10-13 (GitHub Actions API; no 2026-10-12 runs were inspected - the API listing returned the newest 30 runs, all from 10-13).
**Rules kept:** no test/matrix/check-name/DB-service/step change; no accounting, API or schema change; not merged, not deployed.

## 1. Executive summary

The slowness is **not** in dependency setup. It is (a) **runner queueing** caused by every PR commit starting two full CI runs, and (b) the **test step itself** (11-25 min, 85-93 % of each job).

Only (a) is fixed here, because only (a) has evidence for a safe fix: `push` was triggered on `**` *and* `pull_request` on `**`, so each commit on a PR branch ran 4 test jobs. CI Gate reads only `pull_request` runs (`ci_gate.bind_check_runs`), so the `push` twin decided nothing. Fix: `push` limited to `main`, plus a concurrency group that cancels only superseded PR runs.

No composer/APT cache was added: measured setup is ~70 s per job in total, so caching can save at most a few seconds and was not justified by the data. Test-step parallelisation is the only large lever and is left as a recommendation (section 9).

## 2. Evidence (root causes)

Source: `actions/runs` + `runs/{id}/jobs` step timestamps. All times UTC, 2026-10-13.

| # | Finding | Evidence |
|---|---------|----------|
| R1 | Every commit on a PR branch started **two** CI runs | Pairs (push + pull_request, same SHA): `9218/9223` (f17d554), `9219/9220`, `9212/9213`, `9216/9217`, `9226/9227` ... 4 test jobs per commit |
| R2 | Duplicate runs cause queue time on the run that matters | SHA f17d554: push run 9218 sqlite waited **1m33s** (created 16:32:36 -> started 16:34:09); the PR run 9223 sqlite waited **32m36s** (16:39:32 -> 17:12:08), pgsql 10m01s. 2026-10-13 17:24 showed 6 runs `queued` simultaneously |
| R3 | No cancellation of superseded runs | No `concurrency` block in ci.yml; successive commits (e.g. 9209-9215 within 9 min on `horizon/v2-1d-ci-integration`) all ran to completion or queued |
| R4 | Test step dominates job time | Table below |
| R5 | Setup is small | Table below |

### Baseline per-step timing (from job step timestamps)

| Phase | sqlite leg | pgsql leg | Source |
|---|---|---|---|
| Queue (created -> job start) | 1m33s ... 32m36s | 5m48s ... 12m54s | runs 9218, 9223, 9224 |
| Runner startup ("Set up job" + "Initialize containers") | ~23 s | ~23 s | all |
| Checkout | 5 s | 5 s | all |
| Copy-list guard | 2-3 s | 2 s | all |
| PHP 8.4 setup | 4-5 s | 3-7 s | all |
| APT (poppler-utils, libxml2-utils) | 10 s | 10-15 s | all |
| `composer create-project` | 9-10 s | 7-9 s | all |
| `composer require` (Sanctum, S3, ...) + smoke | 7-8 s | 5-7 s | all |
| Merge core / register providers | 1-2 s | 1-2 s | all |
| DB init (`migrate:fresh`) | 5-7 s | 3-4 s | all |
| **Setup total (job start -> tests)** | **~70 s** | **~71-75 s** | 9224, 9218 |
| **`php artisan test`** | **11m27s - 13m42s** | **17m39s - 25m14s** | 9223, 9224, 9218 |
| Job duration (start -> end) | 12m42s - 15m02s | 18m54s - 26m34s | |

Limitation: GitHub does not expose per-step queue/billing internals beyond these timestamps; the 10-12 Oct history was not sampled, so no multi-day statistics are claimed. The sqlite leg also starts the unused Postgres service container (~21 s of "Initialize containers") - noted, not changed (see section 9).

## 3. Exact workflow changes (`.github/workflows/ci.yml`)

```yaml
on:
  push:
    branches: [main]            # was: ['**']
  pull_request:
    branches: ['**']            # unchanged (CI Gate rejects any other filter)
  workflow_dispatch:            # new: manual run for branches without a PR

concurrency:
  group: ci-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('{0}-{1}', github.event_name, github.sha) }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

Safety properties:
- **Protected-branch checks:** PR checks come from `pull_request`, unchanged. `main` push runs use a per-SHA group and `cancel-in-progress: false`, so a later main push never cancels or replaces an earlier one.
- **Unrelated PRs:** group is keyed by PR number; PRs never cancel each other.
- **Release/other workflows:** untouched (concurrency is workflow-scoped; `ci-gate.yml` already had its own group).
- **CI Gate:** it evaluates the current head SHA; a cancelled run belongs to a superseded SHA. Required jobs, names, `needs`, `if` and the `php artisan test` guard text are unchanged.

## 4. Files changed

- `.github/workflows/ci.yml` (+15 / -1)
- `CI_PERFORMANCE_OPTIMIZATION_REPORT.md` (new)

## 5. Validation

| Check | Result |
|---|---|
| YAML parses; `on` / `concurrency` read as intended | OK |
| CI Gate offline validator `ci_gate.validate()` | 0 errors, 0 warnings |
| `ci_gate.compare_baseline(main, PR)` (no weakening) | 0 errors |
| `scripts/ci-gate` unit tests | 49 / 49 OK |
| `scripts/horizon-eval` unit tests | 172 / 172 OK |
| Required check names present on PR run | `php artisan test (L11, sqlite)` and `(L11, pgsql)` both reported and green (run 38438945108) |
| Duplicate trigger removed | Branch `claude/github-actions-ci-perf-c9i7sz` produced **one** CI run (9239, `pull_request`) instead of two |
| `actionlint` | not available in the environment; not run |

### Test suite results

| DB | Where | Result |
|---|---|---|
| SQLite | **GitHub Actions, PR run 38438945108** | **success** - full `php artisan test`, 10m33s (17:37:59 -> 17:48:32) |
| PostgreSQL | **GitHub Actions, PR run 38438945108** | **success** - full `php artisan test`, 27m24s (17:34:45 -> 18:02:09); higher than the baseline range, see section 6 |
| SQLite | local sandbox (`/home/user/nibras-app`, PHP 8.3) | **Not conclusive.** 6382 passed / 73 skipped / **154 failed**; after installing the missing AWS S3 package, re-running the 31 failing classes left 38 failed: 24 are `Call to undefined function App\Services\bcmul()` (the sandbox PHP has no `bcmath`, which CI installs; apt install was unavailable). The remaining 14 (HTTP 500/503, one size assertion) were not root-caused and are most likely the same bcmath gap, but this is **unproven**. The change touches no PHP, so the CI run on the PR is the authoritative result. |
| PostgreSQL | local | not run (no server in sandbox) |

## 6. Before / after timing

| Metric | Before (observed) | After (observed on this PR) | Comment |
|---|---|---|---|
| CI runs per commit on a PR branch | 2 (push + PR) | **1** | observed |
| Test jobs per commit | 4 | **2** | observed |
| Runner-minutes per commit, SHA f17d554 | 78m14s (26m34+15m02 push, 23m56+12m42 PR) | 36m38s expected (PR twin only) | derived from baseline durations; this PR's run is in section 5 |
| Setup phase | ~70 s | ~70-75 s | unchanged, as expected |
| `php artisan test` sqlite | 11m27s - 13m42s | 10m33s | within run-to-run noise; **not** an improvement claim |
| `php artisan test` pgsql | 17m39s - 25m14s | 27m24s | above the baseline range. The change touches no test or DB code; run-to-run variance on shared runners is the likely cause but was **not** isolated. Not a claimed regression or improvement |
| Queue time | 1m33s - 32m36s | 4m42s (pgsql), 8m07s (sqlite) | run 9239 still competed with pre-change duplicate runs of other PRs; queue improvement **cannot yet be claimed** and will only show once those older duplicates drain |

Only the removal of duplicate runs (halving runner demand) is measured. Wall-clock/queue gains are a *consequence* to be verified over the next days of normal PR traffic, not a measured result.

## 7. Security, accounting, tenant isolation

- No application, accounting, migration or test file was modified; ledger/ZATCA/tenant-isolation tests still run in full on both DBs for every PR.
- No permissions, secrets or action versions changed; no new third-party action added.
- Branch pushes without a PR no longer run CI automatically. The PR gate is unaffected; use `workflow_dispatch` (or open a PR) to test a branch earlier. `main` is still verified after every merge.
- Cancelled superseded PR runs cannot satisfy a gate: CI Gate demands `success` on the current head SHA.

## 8. Remaining risks / limitations

1. Queue relief depends on total repository concurrency; `web-ci`, `storefront-ci`, `mobile-ci` also use `push: ['**']` + `pull_request` and share the runner pool. They are path-filtered and were not shown to be the cause, so they were not touched.
2. Direct pushes to branches (no PR) lose automatic CI. Mitigation: `workflow_dispatch`.
3. History of 2026-10-12 was not analysed; conclusions rest on the newest 30 runs of 10-13.
4. Local test run was incomplete (section 5) - not used as evidence.
5. Branch protection settings were not readable with the available tools; required-check names were confirmed through `.github/ci-gate/required-checks.json` and the PR's check runs.

## 9. Recommended next actions (not implemented)

1. Merge after review and watch queue/wall-clock over a few days of PR traffic; then fill the "after" queue column.
2. Evaluate test parallelisation (`php artisan test --parallel`/ParaTest) as a **separate** change: the test step is 85-93 % of runtime, but parallel DB isolation for tenant/ledger tests (especially PostgreSQL) must be proven first.
3. Optional ~20 s per sqlite job: avoid starting the Postgres service container on the sqlite leg (requires restructuring; touches required job names, so it needs a CI Gate manifest review).
4. Add `timeout-minutes` (observed max job ~27 min) so a hung job cannot hold a runner for the 360-min default.
5. Consider the same trigger de-duplication for the path-filtered web/storefront/mobile workflows.

## 10. Delivery

- Branch: `claude/github-actions-ci-perf-c9i7sz`
- PR: https://github.com/safwan5001-source/Nebrax/pull/1389 (open, not merged)
- Base SHA: `e2f2e720df6d4f88ce83362c5110399fa9e3ae0c` (main)
- Head SHA (workflow change): `8dc7604491d75abd3100f230e91f67d405a84d66`; final head = this report commit

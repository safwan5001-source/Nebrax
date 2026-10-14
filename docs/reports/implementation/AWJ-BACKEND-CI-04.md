# AWJ-BACKEND-CI-04 — PostgreSQL CI Hang Diagnostics & Watchdog

STATUS: closed (merged, post-merge CI green, POST_MERGE_REVIEW: PASS)
DATE: 2026-10-14

## 1. Evidence pass (before any change)

### The incident (PR #1477, run job `116010807068`)
Read from the GitHub job log and the PR comments:

| Fact | Source |
|---|---|
| ParaTest stdout reached `6832 / 6896` at 18:00:51, then nothing for 50 min until the 60-min job timeout | job log, PR comment |
| Last PostgreSQL server log entry 18:00:46 (an expected test error); then only a routine checkpoint. No lock wait, no `lock timeout`, no deadlock | service-container log printed at job teardown |
| Orphans killed by the runner at the end: `php` (artisan, pid 7507), `tee` (7508), `php8.4` (7511 = ParaTest main), `php8.4` (7517 = **one** worker) | job log `Terminate orphan process` |
| Earlier: `17:59:56 unexpected EOF on client connection with an open transaction` | server log (a client exited mid-transaction ~1 min before; not proven related) |
| Test output artifact: 972 bytes of progress dots — no test name | PR comment |
| Re-run on the same SHA and the post-merge run on `main` passed (13:29 / 13:21) | PR comments |

### What this does and does not prove
- **Proven:** three workers finished and exited; one worker process stayed alive; the database was idle; `lock_timeout` (CI-02) did not fire, so this was not a PostgreSQL lock wait.
- **Not proven:** which test, whether the worker was on CPU, sleeping, waiting on a socket/pipe/child, or blocked holding an idle transaction. **Root cause: not established.**

### Why the existing output could not name the test (verified in ParaTest 7.8.6 source)
- `WrapperRunner::assignAllPendingTests()` calls `printFeedback()` only when a worker **finishes a whole test file**. Stdout dots are therefore per-file, delayed, and never show the file a stuck worker is in.
- Each worker *does* write live, per-test files into ParaTest's `--tmp-dir`:
  - `worker_NN_stdout_<id>_progress` — one byte (`.`, `F`, `E`, `S`, …) per **completed** test (`ProgressPrinterOutput`).
  - `worker_NN_stdout_<id>_teamcity` — written only when teamcity logging is on (`Options::needsTeamcity`): `testSuiteStarted`, `testStarted` (on `Test\Prepared`), `testFinished duration=…`, with `flowId` = worker PID.
- Verified locally: `php artisan test --parallel --log-teamcity <f> --tmp-dir <d>` passes both options through Laravel to ParaTest; the per-worker teamcity file shows the running test **while it runs**; stdout format and exit code are unchanged.
- In the stalled run these files existed only in `/tmp` and were discarded with the runner.

### Runner tooling available without new installs
`python3` (3.12, stdlib), `/proc`, `docker` (runner user is in the `docker` group; CI already uses `docker exec … psql`), `sudo -n` (passwordless on GitHub-hosted runners). No `gdb`/`phpspy` assumed.

### CI Gate constraints that bind the design (`.github/ci-gate/required-checks.json`, `ci_gate.py`)
- The step running `php artisan test` must keep `set -o pipefail`, must not contain `--filter`, `--group`, `--exclude-group`, `--testsuite`, `--stop-on`, `|| true`, and must not have a step-level `if`.
- No step of the required job may use `continue-on-error`.

## 2. Design (recorded before implementation)

### Definition of real progress
**Progress = a completed test.** Concretely: growth of a worker's ParaTest `*_progress` file, which PHPUnit's progress printer inside the worker writes once per finished test. Nothing else counts:
- a `testStarted` line is not progress (a hung test has one);
- the watchdog's own log, heartbeat or snapshot writes go to a different directory and are never read as progress;
- stdout dots are not used (per-file and delayed, see above).

### Stall conditions (per worker, not just global)
In the incident the other workers kept draining the queue, so a global counter would have looked healthy until the very end. Conditions:
1. **Worker stall:** a worker process is alive and its progress file has not grown for `S` seconds.
2. **Runner stall:** no worker is alive, but the test command's process tree is still running `S` seconds after the last worker event (covers ParaTest/Laravel teardown).
3. **Start stall:** no worker has appeared `S` seconds after the watchdog started.

`S` is set from measured gaps (section 4), not chosen arbitrarily. It must exceed `lock_timeout` (60 s), because a lock wait already ends in a named `55P03`.

### Snapshot (when a stall is detected, then repeated while it lasts, capped)
- Per worker: token, PID, alive, tests completed, seconds since last progress, **current class and test** (teamcity), seconds the test has been observed running, last finished tests with durations, tail of ParaTest's unexpected-output file.
- Process tree of the test command (descendants of the step shell): PID, PPID, state, elapsed, CPU seconds, **CPU used since the previous sample**, RSS, kernel wait channel, syscall, child processes, sockets (PostgreSQL vs other remote endpoints).
- PostgreSQL: `pg_stat_activity` for the `nibras*` databases (state, `wait_event_type`/`wait_event`, transaction/query/state ages, blocking PIDs, redacted query prefix) and ungranted locks — through a dedicated **`pg_monitor`** role created for CI only, via `docker exec` on the local socket (no password, no connection string).
- A heuristic **verdict** per stalled worker: waiting on PostgreSQL / waiting on a child process / busy on CPU in PHP / sleeping in PHP / blocked in PHP or on an external socket — always printed with its evidence. *(Amended during implementation: an "idle open transaction" verdict was dropped, because `RefreshDatabase` keeps every test inside one; it is listed as evidence only.)*
- Host: load average, available memory.

### Output
- Job log: one `::warning::` per stall, plus the first snapshot with every line prefixed `│ `. *(Amended after review: no `::group::`/`::stop-commands::`; see §6.)*
- Directory `pgsql-watchdog/` inside the existing `test-output-pgsql` artifact (uploaded with `if: always()`, so also after a job timeout): `watchdog.log`, `snapshot-NN.txt`, `summary.json` (per-worker gap statistics — this also collects evidence for `S` on every healthy run), ParaTest's per-worker files if the run did not finish, and the merged teamcity log (per-test durations).

### Safety contract
- **Observe only.** It never signals, kills or restarts a test process. (Guarded by a static test.)
- **Cannot change the test result.** It runs as a background process of the test step; the stop hook is written so that no failure of the watchdog (missing, crashed, slow) can change the step's exit code.
- **Guaranteed cleanup:** stopped by an `EXIT` trap in the test step (SIGTERM, then summary); exits by itself if its parent shell disappears or after a maximum lifetime; the runner's orphan cleanup is the last resort.
- **No secrets:** never reads `/proc/*/environ`; everything the watchdog itself writes (job log, snapshots, `watchdog.log`) has command lines, SQL and output redacted (`password=`, URL credentials, bearer/GitHub tokens, quoted SQL literals) and truncated; `psql` commands are never printed. The raw `teamcity.log` and leftover ParaTest files are copied unredacted: they hold the same test names and failure messages that `test-output-pgsql.txt` already holds.
- **PostgreSQL CI only;** SQLite job unchanged. `PGOPTIONS="-c lock_timeout=60s"` (CI-02) unchanged.
- Every external call has a timeout; a failed diagnostic is recorded as unavailable and the watchdog continues.

### Out of scope (explicit)
Auto-killing hung workers or jobs, retries, per-test time limits, PHP-level stack traces (would need a signal handler or extension inside the worker), production code, migrations, PostgreSQL production settings, `bcmath`, `sales.invoicing`.

## 3. Stall threshold — evidence

Measured with the watchdog itself (record-only, threshold 900 s) on a full local PostgreSQL run: 4 workers, 6908 tests, `PGOPTIONS=-c lock_timeout=60s`, poll 5 s.

| Signal | Value | Test |
|---|---|---|
| Longest gap between two completed tests on one worker | **60.1 s** | `PostgresTestLockTimeoutTest::waiting_behind_an_abandoned_transaction…` (deliberate full `lock_timeout` wait, CI-02) |
| Next longest gaps | 35 s, 20 s, 10 s | `PlatformIntegrationSettingsTest`, `PlatformGlobalApplicationOverrideTest`, `ReturnPosApiMixedReturnsTest` |
| Slowest single tests (merged teamcity log) | 60.0 s, 35.9 s, 23.8 s, 10.2 s | lock-timeout test, `ImportJobApplyTest::a_durable_upload_beyond_the_legacy_row_limit…`, `PlatformGlobalApplicationOverrideTest::global_summary_scales…`, `ReturnPosApiMixedReturnsTest::randomised…` |
| Whole-suite wall time | 342 s (no watchdog) / 346 s (watchdog) | |

CI runs the same suite in ~10–13 min against ~6 min locally, so CPU-bound tests can take ~2× longer there; a lock wait is wall-clock bounded at 60 s.

**Confirmed on the GitHub runner** (PR #1488, head `938b60e`, run `38632798597`, `summary.json` from the artifact): 6908 tests in 8:27, **0 stalls**. Per-worker maximum gaps: 55.1 / 55.1 / 20.0 / 15.0 s (sampled every 5 s). Slowest tests: 60.0 s (lock-timeout test), **56.7 s** (`PlatformGlobalApplicationOverrideTest::global_summary_scales…`, 23.8 s locally, so ~2.4× slower on CI), 43.8 s (`ImportJobApplyTest`). 240 s stays ≥ 4× every legitimate value seen on CI.

The second CI run (head `361ed6d`, run `38636170947`, a slower runner: suite 11:18) measured the same test at **75.6 s** and a longest gap of **80.1 s** (`PlatformGlobalApplicationOverrideTest::global_summary_scales…`, 3.2× its local time). 240 s still leaves 3× headroom over the worst value seen on any runner. A false positive would cost one `::warning` and a snapshot, never a failed job (observe only); `summary.json` on every run keeps this margin visible.

A deliberately low threshold (30 s) on the same suite produced **two false stalls** on legitimate tests (the 36 s import test and the 60 s lock-timeout test) — see §5.

**Decision: `--stall-seconds 240`.**
- 4× the longest measured legitimate gap (60.1 s), and ≥ 3× the slowest CPU-bound test even at CI's ~2× slowdown (36 s → ~72 s).
- 4× `lock_timeout`: a test that hits `lock_timeout` up to three times in a row is still below it, and a single lock wait already ends in a named `55P03` (not the watchdog's job).
- Detection latency: 4 min instead of 50 min of silence. With re-snapshots every 300 s (cap 6), all six snapshots fit before the 60-min job timeout (240 + 5 × 300 = 1740 s).
- Every pgsql CI run now writes `summary.json` with the real per-worker gap maxima and the slowest tests, so the threshold can be re-checked against CI data, not only local data. A test-level guard keeps `--stall-seconds` above `lock_timeout`.

## 4. Implementation

| Piece | What it does |
|---|---|
| `scripts/ci-watchdog/watchdog.py` | Polls every 5 s: `/proc` process table of the test command's tree (descendants of the step shell), ParaTest `*_progress` sizes (progress), per-worker `*_teamcity` (current class/test, last finished tests and durations). On a stall: snapshot file + `::warning` + first snapshot quoted (`│ ` per line) in the job log; every job-log write starts on a fresh line and is one atomic `write()` below `PIPE_BUF`. On SIGTERM/SIGINT/SIGHUP: writes `summary.json`, exits 0 |
| `scripts/ci-watchdog/hooks.sh` | `awj_watchdog_start` (background, never fails the step) / `awj_watchdog_stop` (EXIT trap: capture `$?`, `set +e`, SIGTERM, bounded 10 s wait, SIGKILL to the watchdog only, `exit "$status"`) |
| `.github/workflows/ci.yml` | (1) creates `awj_ci_watchdog` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION IN ROLE pg_monitor`); (2) runs the watchdog's own tests on the runner, including a real PostgreSQL check of that role; (3) pgsql branch of the test step: start hook, EXIT trap, `--log-teamcity` + `--tmp-dir` on the test command; (4) the existing `if: always()` upload also takes `pgsql-watchdog/`, retention 1 → 7 days |
| `scripts/ci-watchdog/test_watchdog.py` | 31 tests (below) |

### Verdict heuristic (per stalled worker, always printed with its evidence)
In order: an `active` session on the worker's `nibras_test_N` waiting on `Lock` → *PostgreSQL lock* (with `pg_blocking_pids`); any other `active` session → *PostgreSQL statement*; a live child process → *child process*; CPU ≥ 50 % of the idle time → *CPU inside PHP*; kernel wait channel `*nanosleep` → *sleeping inside PHP*; a non-PostgreSQL TCP socket → *external socket*; otherwise *blocked in PHP (PostgreSQL idle, no CPU, no child)*. An `idle in transaction` session is listed but never used as the cause: it is the normal `RefreshDatabase` state.

### Privileges used
- PostgreSQL: `pg_monitor` only (reads `pg_stat_activity` of other roles, `pg_locks`), via `docker exec` on the container's local socket — no password, host or connection string in the watchdog's arguments or output.
- `/proc`: process table, `wchan`, fds and `/proc/net/*` are read as the runner user. Only for the PIDs of a **stalled** worker and its children, `/proc/PID/syscall` and `/proc/PID/stack` are read with `sudo -n cat` (read-only; Yama `ptrace_scope` and `CAP_SYS_ADMIN` block them otherwise). If sudo is unavailable the field says `unavailable`.

## 5. Tests and exact results

### Watchdog suite — `scripts/ci-watchdog/test_watchdog.py` (33 tests; runs in the pgsql CI job before the suite)

| Requirement (task §6) | Tests |
|---|---|
| 1. Healthy run, exit code unchanged | `HealthyRun.*` (no snapshot, clean SIGTERM stop, heartbeat ≠ progress); `StepExitCode.test_exit_code_is_preserved_and_the_watchdog_is_gone` (0/1/2/137 under `bash -e -o pipefail`) |
| 2. Controllable artificial hang shows the diagnostics | `ArtificialStall.*`: worker/PID/class/running test/last finished/verdict/process row; repeat + cap; resume; start stall; warning still starts a line after an unterminated dots line |
| 3. Background processes stopped and cleaned up | SIGTERM stop; exit when the parent shell disappears; max lifetime; a SIGTERM-ignoring watchdog is killed by the hook (watchdog only); no leftover process after any test (checked with `ps` after 3 consecutive runs: 0) |
| 4. Diagnostic tool failures never hide the test result | failing `psql`, missing `psql`, missing `docker`, missing `sudo` → snapshot says `unavailable`, watchdog keeps running; crashing / absent watchdog and missing `python3` → step exit unchanged; bad arguments → exit 0 |
| 5. No secrets in logs/artifacts | `Secrets.*`: password/URL credentials/`--password`/bearer/`ghp_` in argv, `DB_PASSWORD` and a secret in the worker **environment**, secret in ParaTest output and in SQL literals → absent from every written file and stdout; source never reads `/proc/*/environ` |
| 6. `lock_timeout=60s` preserved | `CiWiring.test_lock_timeout_from_ci02_is_kept`, threshold > `lock_timeout`; real probe: `55P03` still fires at 60 s with the watchdog running |
| 7. Parallel PostgreSQL / concurrency unaffected | full 4-worker suite with and without the watchdog: identical results (below); CI green |
| Observe only | static: no `os.kill`/`killpg`/`pkill` in the watchdog; every `kill` in `hooks.sh` targets `$AWJ_WATCHDOG_PID` |
| Gate cannot see into `hooks.sh` | `HooksStayInert`: no `exit`, `trap`, `shopt`, `alias`; the only `set` is `set +e` inside the stop hook |
| Least privilege, real server | `RealPostgres`: the `pg_monitor` role sees another session's `Timeout:PgSleep` (CI: real `postgres:16` container) |

Local: 33/33 green in ~40 s (Python 3.13, local PostgreSQL 16), stable over repeated runs. CI: 31/31 in 42.8 s on `938b60e`; 33/33 on `361ed6d` but in 111 s. Cause: the post-review "wait until the watchdog is ready" loop waited its full 10 s for the substitute watchdogs (crashing / absent / no python3 / SIGTERM-ignoring) that never write a log. Fixed by waiting until the watchdog has logged **or is no longer running** (the SIGTERM-ignoring stub now writes a ready line): back to ~40 s locally.

### Real ParaTest hang probes (local only; the probe test is never committed)
A probe test in the real app, run through an exact copy of the CI step (hooks + watchdog + `php artisan test --parallel`):

| Probe | Verdict printed | Evidence printed |
|---|---|---|
| `sleep(25)` | sleeping inside PHP | `wchan hrtimer_nanosleep`, syscall `clock_nanosleep`, CPU 0.0 s |
| `pg_sleep(20)` | waiting on PostgreSQL (statement executing) | session `active`, `Timeout:PgSleep`, query `select pg_sleep($1)` |
| busy loop | busy on CPU inside PHP | state `R`, CPU 8.0 s over 8 s |
| `exec('sleep 20')` | waiting on a child process | `sh`, `sleep` children, `wchan anon_pipe_read` |
| advisory-lock wait | waiting on a PostgreSQL lock | `Lock:advisory blocked by <pid>`, 1 ungranted lock; `55P03` at 60 s; **step exit 2 preserved** |

**#1477 shape reproduced inside the full suite** (4 workers, probe `sleep(75)`, threshold 30 s for the demo): the last snapshot shows only worker 2 alive (the others had drained the queue and exited), naming `ZzWatchdogProbeTest::test_probe_hang`, `hrtimer_nanosleep`, CPU 0.0 s. The same run produced two *false* stalls at 30 s (36 s import test, 60 s lock-timeout test) — the evidence against a low threshold (§3).

### Full suites (local)
| Run | Result |
|---|---|
| pgsql, 4 workers, **no watchdog** | 6908 tests, 342 s, 24 errors + 3 failures, exit 2 |
| pgsql, 4 workers, **watchdog** | 6908 tests, 346 s, **identical** failing set (27), exit 2, 0 stalls |
| sqlite, sequential | 6787 passed, 95 skipped, 26 failed |

All local failures are environment gaps that CI provisions, as in CI-03: 26 Fuel tests need `bcmath` (absent in this container), and one pgsql test (`StorefrontMediaApiTest::the_library_lists…`) fails the same way without the watchdog on PHP 8.3's PDO (`ESCAPE '\'` literal, `HY093`); CI uses PHP 8.4.

### CI Gate
`ci_gate.py validate` → OK; CI Gate's own 72 tests → OK. The guarded step still contains `set -o pipefail` and none of the forbidden flags; no `continue-on-error`; the new steps with `if:` are not guarded steps.

## 6. Reviews

### Implementer review
Findings fixed before review: workers whose ParaTest files were deleted kept their last `alive` state (false stall during a slow teardown); a closed stdout could raise; verdicts were printed for healthy workers; `idle in transaction` (normal under `RefreshDatabase`) was used as a cause.

### Independent review (separate reviewer agent; Codex was unavailable on the previous PR's usage limit)
No P1. Resolution:

| # | Finding | Resolution |
|---|---|---|
| P2-1 | ParaTest leaves the dots line unterminated, so `::warning` glued to it is not a command; a broken `::stop-commands::` fence could fold later output | **Fixed:** every write starts with a newline and is one atomic `write()` < `PIPE_BUF`; snapshot lines prefixed `│ `; no fence/group. Test with an unterminated line |
| P2-2 | The step's exit status depends on `hooks.sh`, which the CI Gate cannot inspect (`exit 0` there would turn red green) | **Fixed:** no `exit` at all (status kept by bash once `set +e`; verified 0/1/3/137); `HooksStayInert` forbids `exit`/`trap`/`shopt`/`alias`/other `set` |
| P2-3 | Timing-tight self-tests inside a required job | **Fixed:** margins widened (stall 2.5 s vs 0.5 s events), waits on observed state instead of sleeps (watchdog log, probe session visible to the role), fresh dirs per subtest |
| P3 | SIGTERM during a slow snapshot | Fixed: diagnostics skipped once stop is requested; external calls ≤ 5 s |
| P3 | Raw `teamcity.log`/ParaTest files in the artifact are not redacted | Documented (§2): same content class as the existing test output |
| P3 | `wchan` `0` shown as on-CPU for non-runnable processes | Fixed: only for state `R` |
| P3 | No "between files" state; idle-transaction verdict in design not in code | Fixed: suite depth reported; design amended |
| P3 | SQL over-redaction; unclosed pipes; fragile `else` split | Fixed |

### AWJ Guardian review
- Production: none. No production code, config, migration, `deploy/`, `Dockerfile` or production PostgreSQL setting changed. The role and `max_locks` exist only in the CI service container.
- Accounting: no ledger, journal, money or posting path touched. **No new financial operation → no journal entries to show.**
- Tenant isolation / RBAC / API: untouched. The watchdog reads only test databases' activity; test data is synthetic, and SQL literals are removed anyway.
- No test skipped, filtered, retried or weakened; nothing is killed except the watchdog itself by its own hook.

## 7. CI time impact
| Item | Cost |
|---|---|
| Watchdog during the suite | ≈ +1 % (342 → 346 s locally). CI pgsql suite: 8:27 on `938b60e`, 11:18 on `361ed6d` (runner variance; the 1477 merge run took 13:21) |
| Self-test step | ≈ 40–45 s (42.8 s measured on the runner for the first version; ~40 s locally for the final one) |
| Role step | < 1 s |
| Artifact | +~280 KB compressed (`teamcity.log`, `summary.json`, `watchdog.log`) |

## 8. Risks and what the watchdog does not cover
- **Root cause of the #1477 stall: not established.** It did not recur in the runs since. This task adds diagnostics for the next incident; it fixes nothing.
- No PHP-level stack trace. If a stall recurs and the snapshot says "blocked in PHP", the next step is an opt-in per-worker stack dump (e.g. a `SIGUSR1` handler registered from the test bootstrap). That adds code to the worker, so it needs its own decision.
- Stalls shorter than 240 s are not reported (by design); a stall in a step other than the test step is not observed.
- Progress gaps are sampled every 5 s (±5 s precision); per-test durations come from teamcity (exact).
- The verdict is a heuristic and is always printed with its evidence.
- The `sudo -n` reads depend on GitHub-hosted runners keeping passwordless sudo; without it the fields read `unavailable`.
- If the job is cancelled during a stall, snapshots already written are uploaded (`if: always()`); `summary.json` may be missing if the runner kills the watchdog before its handler runs.

## 9. Merge, post-merge and closure

| Item | Value |
|---|---|
| Branch | `claude/postgresql-ci-hang-watchdog-cc1nw1` |
| PR | [#1488](https://github.com/safwan5001-source/Nebrax/pull/1488) (squash) |
| Base SHA | `757a7a3` |
| Head SHA | `ef3dc81495e0099b068b4e04c59064633667ac75` |
| **Merge SHA** | **`ad3ddfbe038bc076c37ff8fe03e08a4c2405f0c5`** |
| PRE_MERGE_REVIEW | PASS (PR comment): CI on `ef3dc81` all green (run `38639834295`; pgsql self-tests 33/33 in 40.6 s, 6936 tests, 0 failures, 0 stalls); no open P1/P2 |
| POST_MERGE_REVIEW | PASS (PR comment) |
| Production deploy | **None** |

### CI on the merge SHA (`main`, run `38642347684`)
| Job | Job id | Result |
|---|---|---|
| pgsql (4 workers) | `116120720413` | ✅ watchdog self-tests 33 in 41.1 s; **6957 tests, 52986 assertions, 0 errors/failures, 3 skipped** (13:47); watchdog started and stopped cleanly, **stalls 0**, no warnings |
| sqlite | `116120720623` | ✅ (watchdog steps skipped by design) |

### Threshold margin after four CI runs
Slowest legitimate test per run, always `PlatformGlobalApplicationOverrideTest::global_summary_scales_with_bounded_queries_and_matches_reference_aggregates`: **60.0 → 75.6 → 69.8 → 98.0 s**. The longest sampled gap was 95.3 s. The test takes 23.8 s locally. 240 s still leaves 2.4× headroom. Exceeding it would cost one `::warning` and a snapshot, never a failed job. This is the margin to watch (see Next).

### Root cause
**Not established.** The #1477 stall has not recurred in the 5 CI runs since. This task adds the capability to diagnose the next incident, not a fix.

### Next recommended task
1. **sales.invoicing** — the owner's next planned item.
2. Small follow-up, not urgent: profile `PlatformGlobalApplicationOverrideTest::global_summary_scales…` (4× slower on CI than locally, variance 56–98 s). It is the main input to the stall threshold and the slowest test in the suite.
3. If a stall recurs, read the snapshot verdict. If it says "blocked in PHP", decide on an opt-in per-worker PHP stack dump (§8).

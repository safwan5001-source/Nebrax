#!/usr/bin/env python3
"""Tests for the PostgreSQL CI test-stall watchdog (AWJ-BACKEND-CI-04).

A fake ParaTest layout (worker processes whose command line carries
`--progress-file`, plus the progress/teamcity files) drives the real watchdog
process. Run: python3 -m unittest discover -s scripts/ci-watchdog -v

Optional integration (CI sets it): AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER (or
AWJ_WATCHDOG_TEST_PSQL_CMD + AWJ_WATCHDOG_TEST_PG_SUPER_CMD locally) checks
that the read-only monitoring role sees another session's wait event.
"""
from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WATCHDOG = HERE / "watchdog.py"
HOOKS = HERE / "hooks.sh"
CI_YML = ROOT / ".github" / "workflows" / "ci.yml"
SECRET = "hunter2-do-not-leak"

sys.path.insert(0, str(HERE))
import watchdog as wd  # noqa: E402


def wait_for(cond, timeout=15.0, step=0.1):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(step)
    return False


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # a zombie child of ours still answers kill(0)
    stat = Path(f"/proc/{pid}/stat")
    return stat.exists() and stat.read_text().split(")")[-1].split()[0] != "Z"


class FakeParaTest:
    """Worker processes + ParaTest's per-worker files, under the test process."""

    def __init__(self, base: Path):
        self.tmp = base / "paratest"
        self.tmp.mkdir(parents=True)
        self.procs: list[subprocess.Popen] = []

    def worker(self, token: int, extra_args: list[str] = (), env: dict | None = None) -> tuple[subprocess.Popen, Path]:
        prefix = self.tmp / f"worker_{token:02d}_stdout_6acf{token:09x}_"
        for suffix in ("progress", "teamcity", "unexpected_output", "status"):
            Path(str(prefix) + suffix).touch()
        argv = [sys.executable, "-c", "import time; time.sleep(120)",
                "--progress-file", str(prefix) + "progress", *extra_args]
        p = subprocess.Popen(argv, env=env)
        self.procs.append(p)
        return p, prefix

    @staticmethod
    def progress(prefix: Path, n: int = 1) -> None:
        with open(str(prefix) + "progress", "a") as f:
            f.write("." * n)

    @staticmethod
    def teamcity(prefix: Path, *lines: str) -> None:
        with open(str(prefix) + "teamcity", "a") as f:
            for line in lines:
                f.write(line + "\n")

    @staticmethod
    def started(cls: str, method: str, pid: int) -> list[str]:
        hint = f"php_qn:///app/tests/Feature/X.php::\\{cls}::{method}"
        return [f"##teamcity[testSuiteStarted name='{cls}' locationHint='php_qn:///app/tests/Feature/X.php::\\{cls}' flowId='{pid}']",
                f"##teamcity[testStarted name='{method}' locationHint='{hint}' flowId='{pid}']"]

    def close(self):
        for p in self.procs:
            if p.poll() is None:
                p.kill()
            p.wait()


class WatchdogCase(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="awj-wd-"))
        self.out = self.base / "out"
        self.fake = FakeParaTest(self.base)
        self.wd: subprocess.Popen | None = None

    def tearDown(self):
        if self.wd and self.wd.poll() is None:
            self.wd.kill()
            self.wd.wait()
        self.fake.close()
        shutil.rmtree(self.base, ignore_errors=True)

    def keep_progressing(self, prefix: Path, every: float = 0.2) -> None:
        """A healthy worker: one completed test every `every` seconds until the test ends."""
        stop = threading.Event()

        def tick():
            while not stop.is_set():
                self.fake.progress(prefix)
                stop.wait(every)
        t = threading.Thread(target=tick, daemon=True)
        t.start()
        self.addCleanup(t.join)
        self.addCleanup(stop.set)

    def start(self, *extra: str, stall: float = 1.5) -> subprocess.Popen:
        self.wd = subprocess.Popen(
            [sys.executable, str(WATCHDOG), "--out-dir", str(self.out), "--paratest-tmp-dir", str(self.fake.tmp),
             "--stall-seconds", str(stall), "--poll-seconds", "0.2", "--heartbeat-seconds", "1", *extra],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        self.assertTrue(wait_for(lambda: (self.out / "watchdog.log").exists(), 10), "watchdog did not start")
        return self.wd

    def stop(self) -> str:
        self.wd.send_signal(signal.SIGTERM)
        out, _ = self.wd.communicate(timeout=10)
        self.assertEqual(self.wd.returncode, 0, out)
        return out

    def everything_written(self, stdout: str) -> str:
        texts = [stdout]
        for f in self.out.rglob("*"):
            if f.is_file():
                texts.append(f.read_text(errors="replace"))
        return "\n".join(texts)


class HealthyRun(WatchdogCase):
    def test_steady_progress_never_snapshots_and_stops_cleanly(self):
        _, prefix = self.fake.worker(1)
        self.start(stall=1.5)
        self.keep_progressing(prefix, every=0.3)
        time.sleep(4)
        out = self.stop()
        self.assertEqual(sorted(p.name for p in self.out.glob("snapshot-*")), [])
        summary = json.loads((self.out / "summary.json").read_text())
        self.assertEqual(summary["stalls"], [])
        self.assertGreaterEqual(summary["tests_completed"], 8)
        self.assertLess(summary["workers"][0]["max_gap_s"], 1.5)
        self.assertIn("AWJ watchdog: stopped (SIGTERM)", out)
        self.assertNotIn("::warning", out)
        self.assertIn("heartbeat:", (self.out / "watchdog.log").read_text())

    def test_heartbeat_and_log_writes_are_not_progress(self):
        """Only the progress file counts: a stuck worker stays stuck while the watchdog itself keeps logging."""
        p, prefix = self.fake.worker(1)
        self.fake.progress(prefix)
        self.start(stall=1.5)
        self.assertTrue(wait_for(lambda: (self.out / "snapshot-01.txt").exists(), 10))
        self.assertIn("heartbeat:", (self.out / "watchdog.log").read_text())
        summary_out = self.stop()
        self.assertIn("stalls 1", summary_out)

    def test_exited_workers_are_not_stalls(self):
        runner = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])  # stands in for ParaTest main
        self.fake.procs.append(runner)
        p, prefix = self.fake.worker(1)
        self.fake.progress(prefix, 3)
        self.start(stall=1.0)
        time.sleep(0.6)
        p.kill()
        p.wait()
        # the runner is still alive with no worker: after 1s that is a runner stall, never a worker stall
        time.sleep(2)
        self.stop()
        snaps = [s.read_text() for s in self.out.glob("snapshot-*")]
        self.assertTrue(all("worker 1 (pid" not in s for s in snaps), snaps)
        self.assertTrue(any("runner stall" in s for s in snaps), snaps)


    def test_files_removed_at_the_end_of_a_run_are_not_a_stall(self):
        runner = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        self.fake.procs.append(runner)
        p, prefix = self.fake.worker(1)
        self.fake.progress(prefix)
        self.start(stall=1.5)
        time.sleep(0.6)
        for f in self.fake.tmp.iterdir():   # ParaTest's clearFiles(); the worker process may linger briefly
            f.unlink()
        time.sleep(2.5)
        self.stop()
        snaps = [s.read_text() for s in self.out.glob("snapshot-*")]
        self.assertTrue(all("worker 1 (pid" not in s for s in snaps), snaps)
        self.assertIn("files removed by ParaTest", (self.out / "watchdog.log").read_text())


class ArtificialStall(WatchdogCase):
    def test_stall_snapshot_names_worker_test_process_and_verdict(self):
        _, healthy = self.fake.worker(1)
        self.keep_progressing(healthy)
        p, prefix = self.fake.worker(3)
        self.fake.teamcity(prefix, *FakeParaTest.started("Tests\\Feature\\FirstTest", "test_quick", p.pid),
                           f"##teamcity[testFinished name='test_quick' duration='12' flowId='{p.pid}']")
        self.fake.progress(prefix)
        self.fake.teamcity(prefix, *FakeParaTest.started("Tests\\Feature\\HangTest", "test_it_hangs", p.pid))
        self.start("--repeat-seconds", "1", "--max-snapshots", "2", stall=1.5)
        self.assertTrue(wait_for(lambda: (self.out / "snapshot-02.txt").exists(), 15))
        time.sleep(1.5)
        out = self.stop()
        snap = (self.out / "snapshot-01.txt").read_text()
        self.assertIn(f"worker 3: pid {p.pid} ALIVE; tests completed 1", snap)
        self.assertIn("progressing (below the stall threshold)", snap)   # the healthy worker gets no verdict
        self.assertIn("class: Tests\\Feature\\HangTest", snap)
        self.assertIn("running test: Tests\\Feature\\HangTest::test_it_hangs", snap)
        self.assertIn("finished: Tests\\Feature\\FirstTest::test_quick 12 ms ok", snap)
        self.assertIn("VERDICT (heuristic): sleeping inside PHP", snap)   # the fake worker is in time.sleep()
        self.assertEqual(snap.count("VERDICT"), 1)
        self.assertRegex(snap, rf"\n\s*{p.pid}\s+{os.getpid()}\s+S ")         # process tree row: pid, ppid, state
        self.assertIn("== kernel view of stalled workers", snap)
        self.assertIn("PostgreSQL (pg_stat_activity", snap)
        # snapshot cap: 2 written, further repeats only logged
        self.assertFalse((self.out / "snapshot-03.txt").exists())
        self.assertIn("snapshot cap 2 reached", (self.out / "watchdog.log").read_text())
        # job log: one annotation per stall event, first snapshot inside a fenced group
        self.assertIn("::warning title=PostgreSQL test stall (AWJ watchdog)::worker 3", out)
        fence = re.search(r"::stop-commands::([0-9a-f]{32})", out)
        self.assertTrue(fence, out)
        self.assertIn(f"::{fence.group(1)}::", out)
        summary = json.loads((self.out / "summary.json").read_text())
        self.assertGreaterEqual(len(summary["stalls"]), 2)
        self.assertEqual(summary["snapshots"], 2)

    def test_resumed_progress_closes_the_stall(self):
        p, prefix = self.fake.worker(1)
        self.start(stall=1.0)
        self.assertTrue(wait_for(lambda: (self.out / "snapshot-01.txt").exists(), 10))
        self.fake.progress(prefix)
        self.assertTrue(wait_for(lambda: "resumed after" in (self.out / "watchdog.log").read_text(), 5))
        self.stop()

    def test_start_stall_when_no_worker_appears(self):
        sleeper = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        self.fake.procs.append(sleeper)
        self.start(stall=1.0)
        self.assertTrue(wait_for(lambda: (self.out / "snapshot-01.txt").exists(), 10))
        self.stop()
        self.assertIn("(start stall)", (self.out / "snapshot-01.txt").read_text())


class Lifecycle(WatchdogCase):
    def test_exits_when_its_parent_shell_disappears(self):
        shell = subprocess.run(
            ["bash", "-c", f"{shlex.quote(sys.executable)} {shlex.quote(str(WATCHDOG))} --out-dir {shlex.quote(str(self.out))} "
                           f"--paratest-tmp-dir {shlex.quote(str(self.fake.tmp))} --stall-seconds 60 --poll-seconds 0.2 "
                           ">/dev/null 2>&1 & echo $!; sleep 1"],
            capture_output=True, text=True, timeout=20)
        pid = int(shell.stdout.split()[0])
        self.assertTrue(wait_for(lambda: not alive(pid), 10), "watchdog outlived its parent")
        self.assertEqual(json.loads((self.out / "summary.json").read_text())["stop_reason"], "parent exited")

    def test_max_lifetime_bounds_the_watchdog(self):
        self.start("--max-lifetime-seconds", "1", stall=60)
        self.wd.wait(timeout=10)
        self.assertEqual(self.wd.returncode, 0)
        self.assertEqual(json.loads((self.out / "summary.json").read_text())["stop_reason"], "max lifetime reached")

    def test_bad_arguments_never_raise_into_the_step(self):
        r = subprocess.run([sys.executable, str(WATCHDOG), "--out-dir", "/proc/forbidden/x",
                            "--paratest-tmp-dir", "/nonexistent", "--stall-seconds", "5"],
                           capture_output=True, text=True, timeout=10)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("could not start", r.stdout)


class DiagnosticsFailures(WatchdogCase):
    def _stall_with(self, *pg_args: str, env_path: str | None = None) -> str:
        self.fake.worker(1)
        env = dict(os.environ)
        if env_path is not None:
            env["PATH"] = env_path
        self.wd = subprocess.Popen(
            [sys.executable, str(WATCHDOG), "--out-dir", str(self.out), "--paratest-tmp-dir", str(self.fake.tmp),
             "--stall-seconds", "1", "--poll-seconds", "0.2", "--privileged-proc", *pg_args],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=env)
        self.assertTrue(wait_for(lambda: (self.out / "snapshot-01.txt").exists(), 15))
        self.assertIsNone(self.wd.poll(), "watchdog died on a failed diagnostic")
        self.stop()
        return (self.out / "snapshot-01.txt").read_text()

    def test_failing_psql_is_reported_and_tolerated(self):
        snap = self._stall_with("--psql-cmd", "false")
        self.assertIn("unavailable: RuntimeError: psql exit 1", snap)

    def test_missing_psql_binary_is_reported_and_tolerated(self):
        snap = self._stall_with("--psql-cmd", "/nonexistent/psql")
        self.assertIn("unavailable: FileNotFoundError", snap)

    def test_missing_docker_is_reported_and_tolerated(self):
        snap = self._stall_with("--pg-docker-filter", "ancestor=postgres:16", env_path="/nonexistent")
        self.assertIn("unavailable: FileNotFoundError", snap)
        self.assertIn("syscall", snap)  # sudo missing on PATH too: still a snapshot


class Secrets(WatchdogCase):
    def test_no_secret_reaches_logs_snapshots_or_job_output(self):
        fake_psql = self.base / "fake-psql.py"
        row = "\x1f".join(["4242", "nibras_test_1", "client backend", "active", "Lock", "transactionid",
                           "12", "12", "12", "4243",
                           f"update users set password = '{SECRET}' where api_token = '{SECRET}'"])
        fake_psql.write_text(
            "import sys\n"
            "sql = sys.argv[-1]\n"
            f"print({row!r} if 'pg_stat_activity' in sql and 'pg_locks' not in sql else '4242\\x1ftransactionid\\x1fShareLock\\x1f\\x1f99\\x1fnibras_test_1')\n")
        env = dict(os.environ, AWJ_SECRET_ENV=SECRET, DB_PASSWORD=SECRET)
        p, prefix = self.fake.worker(1, extra_args=[
            f"DB_PASSWORD={SECRET}", f"postgres://nibras:{SECRET}@127.0.0.1:5432/nibras",
            "--password", SECRET, f"Authorization: Bearer {SECRET}.x", "ghp_" + "A" * 36,
            "--phpunit-argv", f'a:1:{{i:0;s:3:"{SECRET}";}}'], env=env)
        Path(str(prefix) + "unexpected_output").write_text(f"warning: password={SECRET}\ntoken: {SECRET}\n")
        self.fake.teamcity(prefix, *FakeParaTest.started("Tests\\Feature\\TokenTest", "test_api_token_rotates", p.pid))
        self.start("--psql-cmd", f"{sys.executable} {fake_psql} --password={SECRET}", stall=1.0)
        self.assertTrue(wait_for(lambda: (self.out / "snapshot-01.txt").exists(), 10))
        out = self.stop()
        everything = self.everything_written(out)
        self.assertNotIn(SECRET, everything)
        self.assertNotIn("ghp_AAAA", everything)
        snap = (self.out / "snapshot-01.txt").read_text()
        # redaction must not hide what the snapshot is for
        self.assertIn("Tests\\Feature\\TokenTest::test_api_token_rotates", snap)
        self.assertIn("VERDICT (heuristic): waiting on a PostgreSQL lock", snap)
        self.assertIn("update users set password = *** where api_token = ***", snap)

    def test_redaction_rules(self):
        cases = {
            f"DB_PASSWORD={SECRET}": "DB_PASSWORD=***",
            f"PGPASSWORD='{SECRET}'": "PGPASSWORD=***",
            f'{{"password":"{SECRET}"}}': '{"password":***}',
            f"--password {SECRET}": "--password ***",
            f"pgsql://u:{SECRET}@h/db": "pgsql://u:***@h/db",
            f"Authorization: Bearer {SECRET}": "Authorization: Bearer ***",
        }
        for raw, want in cases.items():
            self.assertEqual(wd.redact(raw), want, raw)
        kept = "Tests\\Feature\\TokenTest::test_api_token_rotates"
        self.assertEqual(wd.redact(kept), kept)
        self.assertEqual(wd.redact_sql(f"select * from t where a = 'x''{SECRET}'"), "select * from t where a = '?'")

    def test_source_never_reads_process_environment(self):
        src = WATCHDOG.read_text()
        self.assertIsNone(re.search(r"os\.environ|environb|/environ[\"']|\benviron\(", src))


class ObserveOnly(unittest.TestCase):
    def test_watchdog_never_signals_test_processes(self):
        src = WATCHDOG.read_text()
        self.assertIsNone(re.search(r"os\.kill|killpg|pthread_kill|\bpkill\b|\"kill\"|'kill'", src))

    def test_hooks_only_signal_the_watchdog_itself(self):
        kills = [l.strip() for l in HOOKS.read_text().splitlines() if re.search(r"\bkill\b", l) and not l.strip().startswith("#")]
        self.assertTrue(kills)
        for line in kills:
            self.assertIn('"$AWJ_WATCHDOG_PID"', line, line)


class StepExitCode(unittest.TestCase):
    """The hook contract, run exactly as GitHub runs the step: bash -e -o pipefail."""

    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix="awj-hook-"))
        (self.base / "paratest").mkdir()

    def tearDown(self):
        shutil.rmtree(self.base, ignore_errors=True)

    def step(self, test_exit: int, watchdog: str | None = None, path: str | None = None) -> tuple[int, str, int | None]:
        override = f'AWJ_WATCHDOG_PY={shlex.quote(watchdog)}\n' if watchdog else ""
        script = (
            f"source {shlex.quote(str(HOOKS))}\n{override}"
            "trap awj_watchdog_stop EXIT\n"
            f"awj_watchdog_start --out-dir {self.base}/out --paratest-tmp-dir {self.base}/paratest --stall-seconds 60 --poll-seconds 0.2\n"
            "echo \"WDPID=$AWJ_WATCHDOG_PID\"\n"
            "sleep 0.5\n"
            f"(echo running tests; exit {test_exit}) | tee {self.base}/test-output.txt\n"
            "echo not-reached-on-failure\n")
        env = dict(os.environ)
        if path is not None:
            env["PATH"] = path
        r = subprocess.run(["/bin/bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script],
                           capture_output=True, text=True, timeout=60, env=env)
        m = re.search(r"WDPID=(\d*)", r.stdout)
        return r.returncode, r.stdout + r.stderr, int(m.group(1)) if m and m.group(1) else None

    def test_exit_code_is_preserved_and_the_watchdog_is_gone(self):
        for code in (0, 1, 2, 137):
            with self.subTest(code=code):
                rc, out, pid = self.step(code)
                self.assertEqual(rc, code, out)
                self.assertIsNotNone(pid)
                self.assertFalse(alive(pid), f"watchdog {pid} left running")
                self.assertIn("AWJ watchdog: stopped (SIGTERM)", out)
                self.assertEqual("not-reached-on-failure" in out, code == 0)

    def test_crashing_watchdog_cannot_change_the_result(self):
        broken = self.base / "broken.py"
        broken.write_text("import sys; sys.exit(3)\n")
        for code in (0, 1):
            with self.subTest(code=code):
                rc, out, _ = self.step(code, watchdog=str(broken))
                self.assertEqual(rc, code, out)
                self.assertIn("exited with status 3 (ignored", out)

    def test_missing_watchdog_file_cannot_change_the_result(self):
        for code in (0, 1):
            with self.subTest(code=code):
                rc, out, _ = self.step(code, watchdog=str(self.base / "absent.py"))
                self.assertEqual(rc, code, out)

    def test_missing_python_cannot_change_the_result(self):
        tools = self.base / "bin"
        tools.mkdir()
        for tool in ("tee", "sleep", "seq", "cat", "dirname"):
            os.symlink(shutil.which(tool), tools / tool)
        for code in (0, 1):
            with self.subTest(code=code):
                rc, out, pid = self.step(code, path=str(tools))
                self.assertEqual(rc, code, out)
                self.assertIn("python3 not found", out)
                self.assertIsNone(pid)

    def test_watchdog_ignoring_sigterm_is_killed_and_result_kept(self):
        stubborn = self.base / "stubborn.py"
        stubborn.write_text("import signal, time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(120)\n")
        rc, out, pid = self.step(0, watchdog=str(stubborn))
        self.assertEqual(rc, 0, out)
        self.assertIn("did not stop within 10s", out)
        self.assertFalse(alive(pid))


class CiWiring(unittest.TestCase):
    """Static checks on ci.yml (text level: no PyYAML on the runner's system Python)."""

    @classmethod
    def setUpClass(cls):
        text = CI_YML.read_text()
        start = text.index("- name: تشغيل الاختبارات")
        cls.step = text[start:text.index("- name:", start + 10)]
        cls.text = text

    def test_lock_timeout_from_ci02_is_kept(self):
        self.assertIn('export PGOPTIONS="-c lock_timeout=60s"', self.step)

    def test_watchdog_wraps_only_the_pgsql_branch(self):
        pg, sqlite = self.step.split("else", 1)
        self.assertIn("trap awj_watchdog_stop EXIT", pg)
        self.assertLess(pg.index("trap awj_watchdog_stop EXIT"), pg.index("awj_watchdog_start"))
        self.assertLess(pg.index("awj_watchdog_start"), pg.index("php artisan test --parallel"))
        self.assertNotIn("watchdog", sqlite)
        self.assertIn("php artisan test 2>&1 | tee", sqlite)

    def test_paratest_files_go_where_the_watchdog_looks(self):
        tmp = re.search(r'--paratest-tmp-dir "([^"]+)"', self.step).group(1)
        self.assertIn(f'--tmp-dir "{tmp}"', self.step)
        tc = re.search(r'--teamcity-log "([^"]+)"', self.step).group(1)
        self.assertIn(f'--log-teamcity "{tc}"', self.step)

    def test_stall_threshold_exceeds_the_lock_timeout(self):
        stall = float(re.search(r"--stall-seconds (\d+)", self.step).group(1))
        lock = float(re.search(r"lock_timeout=(\d+)s", self.step).group(1))
        self.assertGreater(stall, lock)

    def test_gate_rules_still_hold(self):
        self.assertIn("set -o pipefail", self.step)
        for bad in ("--filter", "--group", "--exclude-group", "--testsuite", "--stop-on", "|| true"):
            self.assertNotIn(bad, self.step)
        self.assertNotIn("continue-on-error", self.text)

    def test_monitoring_role_is_least_privilege(self):
        role = re.search(r"CREATE ROLE awj_ci_watchdog[^\"]*", self.text).group(0)
        for need in ("NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE", "IN ROLE pg_monitor"):
            self.assertIn(need, role)
        self.assertIn("--pg-user awj_ci_watchdog", self.step)

    def test_diagnostics_are_uploaded_even_after_failure_or_timeout(self):
        upload = self.text[self.text.index("- name: حفظ مخرجات الاختبارات للتشخيص"):]
        self.assertIn("if: always()", upload.split("- name:", 2)[1])
        self.assertIn("pgsql-watchdog", upload)


@unittest.skipUnless(os.environ.get("AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER") or os.environ.get("AWJ_WATCHDOG_TEST_PSQL_CMD"),
                     "set AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER (CI) or AWJ_WATCHDOG_TEST_PSQL_CMD (local)")
class RealPostgres(WatchdogCase):
    def test_monitoring_role_sees_other_sessions_wait_events(self):
        flt = os.environ.get("AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER")
        if flt:
            cid = subprocess.run(["docker", "ps", "-q", "--filter", flt], capture_output=True, text=True).stdout.split()[0]
            super_cmd = ["docker", "exec", cid, "psql", "-U", "nibras", "-d", "nibras"]
            pg_args = ["--pg-docker-filter", flt]
        else:
            super_cmd = shlex.split(os.environ["AWJ_WATCHDOG_TEST_PG_SUPER_CMD"])
            pg_args = ["--psql-cmd", os.environ["AWJ_WATCHDOG_TEST_PSQL_CMD"]]
        sleeper = subprocess.Popen(super_cmd + ["-X", "-q", "-c", "SELECT pg_sleep(20) /* awj-watchdog-probe */"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            self.fake.worker(1)
            self.start(*pg_args, stall=1.0)
            self.assertTrue(wait_for(lambda: (self.out / "snapshot-01.txt").exists(), 15))
            self.stop()
            snap = (self.out / "snapshot-01.txt").read_text()
            self.assertNotIn("unavailable:", snap)
            pg_section = snap.split("== PostgreSQL", 1)[1]
            line = next((l for l in pg_section.splitlines() if "awj-watchdog-probe" in l), "")
            self.assertIn("Timeout:PgSleep", line, snap)
            self.assertIn("active", line)
        finally:
            sleeper.kill()
            sleeper.wait()


if __name__ == "__main__":
    unittest.main()

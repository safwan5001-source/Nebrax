#!/usr/bin/env python3
"""AWJ PostgreSQL CI test-stall watchdog (AWJ-BACKEND-CI-04).

Observes a running `php artisan test --parallel` (ParaTest) and, when a worker
stops making progress, writes a diagnostic snapshot that names the running test
and shows where the wait is: PHP, PostgreSQL, a child process or a socket.

Real progress is a *completed test*: growth of a worker's ParaTest
`worker_NN_stdout_<id>_progress` file, which PHPUnit's progress printer inside
the worker writes once per finished test. Nothing this script writes is ever
read back as progress.

Contract
  * Observe only: it never signals, kills or restarts a test process.
  * It cannot change the test result: it always exits 0 and is stopped by the
    test step's EXIT hook (hooks.sh), which preserves the step's exit status.
  * Never reads /proc/*/environ; command lines, SQL and output are redacted.
  * Every external call is time-bounded; a failed diagnostic is recorded as
    unavailable and the watchdog continues.

Stdlib only.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

CLK_TCK = os.sysconf("SC_CLK_TCK")
PAGE_KB = os.sysconf("SC_PAGE_SIZE") // 1024
CMD_TIMEOUT = 5   # seconds, every external command (the stop hook waits 10 s in total)
MAX_FIELD = 400   # characters kept from any single command line / query
PIPE_CHUNK = 3500  # bytes per write to the job log; below PIPE_BUF (4096) so it is atomic

WORKER_FILE = re.compile(r"worker_(\d+)_stdout_([0-9a-f]+)_progress$")

# ── redaction ────────────────────────────────────────────────────────────────
_SECRET_KEY = r"[\w.-]*(?:password|passwd|secret|token|api[_-]?key|credentials?)"
_REDACTIONS = (
    # key=value / key: value / "key":"value" / --password value
    (re.compile(r"(?i)(" + _SECRET_KEY + r"\"?)(\s*=\s*|\s*:(?!:)\s*|\s+(?=\S))(\"[^\"]*\"|'[^']*'|[^\s'\",;&]+)"), r"\1\2***"),
    # scheme://user:pass@host
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://[^/\s:@]+):[^@\s/]+@"), r"\1:***@"),
    (re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+"), "Bearer ***"),
    (re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})"), "***"),
)
_SQL_LITERAL = re.compile(r"'(?:[^']|'')*'")


def redact(text: str) -> str:
    for rx, repl in _REDACTIONS:
        text = rx.sub(repl, text)
    return text


def redact_sql(sql: str) -> str:
    """SQL text: drop every quoted literal (values may be test data), then the generic rules."""
    text = _SQL_LITERAL.sub("'?'", sql)
    for rx, repl in _REDACTIONS[1:]:  # the key=value rule would turn "password is null" into "password ***"
        text = rx.sub(repl, text)
    return text[:MAX_FIELD]


def short_cmdline(argv: list[str]) -> str:
    out, skip = [], False
    for a in argv:
        if skip:
            out.append("<serialized>")
            skip = False
            continue
        out.append(a)
        skip = a == "--phpunit-argv"
    return redact(" ".join(out))[:MAX_FIELD]


def gh_escape(msg: str) -> str:
    return msg.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


# ── /proc ────────────────────────────────────────────────────────────────────
def _read(path: str) -> str | None:
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8", "replace")
    except OSError:
        return None


def uptime() -> float:
    return float((_read("/proc/uptime") or "0").split()[0])


def proc_info(pid: int) -> dict | None:
    stat = _read(f"/proc/{pid}/stat")
    if not stat:
        return None
    try:
        lp, rp = stat.index("("), stat.rindex(")")
        rest = stat[rp + 2:].split()
        info = {
            "pid": pid,
            "comm": stat[lp + 1:rp],
            "state": rest[0],
            "ppid": int(rest[1]),
            "cpu_ticks": int(rest[11]) + int(rest[12]),
            "start_ticks": int(rest[19]),
            "rss_kb": int(rest[21]) * PAGE_KB,
        }
    except (ValueError, IndexError):
        return None
    raw = _read(f"/proc/{pid}/cmdline") or ""
    info["argv"] = [a for a in raw.split("\0") if a]
    return info


def process_table() -> dict[int, dict]:
    table = {}
    for name in os.listdir("/proc"):
        if name.isdigit():
            info = proc_info(int(name))
            if info:
                table[info["pid"]] = info
    return table


def descendants(table: dict[int, dict], root: int, exclude: int) -> list[int]:
    children = collections.defaultdict(list)
    for p in table.values():
        children[p["ppid"]].append(p["pid"])
    out, stack = [], [root]
    while stack:
        pid = stack.pop()
        for c in sorted(children.get(pid, [])):
            if c != exclude:
                out.append(c)
                stack.append(c)
    return out


SYSCALLS_X86_64 = {
    0: "read", 1: "write", 7: "poll", 23: "select", 35: "nanosleep", 44: "sendto", 45: "recvfrom",
    47: "recvmsg", 61: "wait4", 202: "futex", 230: "clock_nanosleep", 232: "epoll_wait",
    270: "pselect6", 271: "ppoll", 281: "epoll_pwait", 441: "epoll_pwait2", 43: "accept", 42: "connect",
}


def wait_channel(pid: int, state: str) -> str:
    """Kernel function the process sleeps in. The kernel also prints "0" when it cannot resolve it,
    so "0" means "on CPU" only for a runnable (R) process."""
    w = (_read(f"/proc/{pid}/wchan") or "").strip()
    if w == "0":
        return "(on CPU)" if state == "R" else "(unresolved)"
    return w


def privileged_read(path: str, use_sudo: bool) -> str:
    text = _read(path)
    if text is not None:
        return text.strip()
    if not use_sudo:
        return "unavailable (permission)"
    try:
        r = subprocess.run(["sudo", "-n", "cat", path], capture_output=True, text=True, timeout=CMD_TIMEOUT)
        return r.stdout.strip() if r.returncode == 0 else f"unavailable (sudo exit {r.returncode})"
    except (OSError, subprocess.SubprocessError) as e:
        return f"unavailable ({type(e).__name__})"


def describe_syscall(raw: str) -> str:
    first = raw.split()[0] if raw else ""
    if first.isdigit():
        n = int(first)
        return f"{SYSCALLS_X86_64.get(n, 'syscall')}({n})"
    return raw[:60]


def _hex_addr(h: str) -> str:
    ip, port = h.split(":")
    port = int(port, 16)
    if len(ip) == 8:
        b = bytes.fromhex(ip)[::-1]
        return f"{'.'.join(str(x) for x in b)}:{port}"
    return f"[ipv6]:{port}"


TCP_STATES = {"01": "ESTABLISHED", "02": "SYN_SENT", "06": "TIME_WAIT", "08": "CLOSE_WAIT", "0A": "LISTEN"}


def socket_table() -> dict[str, str]:
    out = {}
    for fname in ("/proc/net/tcp", "/proc/net/tcp6"):
        for line in (_read(fname) or "").splitlines()[1:]:
            f = line.split()
            if len(f) >= 10:
                try:
                    out[f[9]] = f"tcp {_hex_addr(f[1])} -> {_hex_addr(f[2])} {TCP_STATES.get(f[3], f[3])}"
                except ValueError:
                    continue
    for line in (_read("/proc/net/unix") or "").splitlines()[1:]:
        f = line.split()
        if len(f) >= 7:
            out.setdefault(f[6], f"unix {f[7] if len(f) > 7 else '(anonymous)'}")
    return out


def open_fds(pid: int, sockets: dict[str, str]) -> dict:
    res = {"sockets": [], "pipes": 0, "files": 0, "readable": True}
    try:
        names = os.listdir(f"/proc/{pid}/fd")
    except OSError:
        res["readable"] = False
        return res
    for n in names:
        try:
            target = os.readlink(f"/proc/{pid}/fd/{n}")
        except OSError:
            continue
        if target.startswith("socket:["):
            res["sockets"].append(sockets.get(target[8:-1], "socket (unresolved)"))
        elif target.startswith("pipe:"):
            res["pipes"] += 1
        else:
            res["files"] += 1
    return res


# ── teamcity ─────────────────────────────────────────────────────────────────
_TC_LINE = re.compile(r"^##teamcity\[(\w+)(.*)\]\s*$")
_TC_ATTR = re.compile(r"(\w+)='((?:\|.|[^'|])*)'")
_TC_UNESCAPE = {"'": "'", "|": "|", "n": "\n", "r": "\r", "[": "[", "]": "]"}


def tc_unescape(v: str) -> str:
    return re.sub(r"\|(.)", lambda m: _TC_UNESCAPE.get(m.group(1), m.group(1)), v)


def parse_teamcity(line: str) -> tuple[str, dict] | None:
    m = _TC_LINE.match(line.strip())
    if not m:
        return None
    return m.group(1), {k: tc_unescape(v) for k, v in _TC_ATTR.findall(m.group(2))}


def test_id(attrs: dict) -> str:
    hint = attrs.get("locationHint", "")
    if "::" in hint:
        return hint.split("::", 1)[1].lstrip("\\")
    return attrs.get("name", "?")


class Worker:
    def __init__(self, token: int, key: str, progress: Path, now: float):
        self.token, self.key, self.progress = token, key, progress
        base = str(progress)[: -len("progress")]
        self.teamcity = Path(base + "teamcity")
        self.unexpected = Path(base + "unexpected_output")
        self.pid: int | None = None
        self.alive = False
        self.ever_alive = False
        self.completed = 0
        self.first_seen = now
        self.last_progress = now
        self.cpu_at_last_progress: int | None = None
        self.max_gap = 0.0
        self.max_gap_test = ""
        self.tc_offset = 0
        self.tc_partial = ""
        self.suite = ""
        self.depth = 0
        self.current: dict | None = None
        self.finished: collections.deque = collections.deque(maxlen=5)
        self.stall_open_at: float | None = None
        self.stall_snapshots = 0

    def read_teamcity(self, now: float, slow_tests: list) -> None:
        try:
            with open(self.teamcity, "rb") as f:
                f.seek(self.tc_offset)
                chunk = f.read()
        except OSError:
            return
        self.tc_offset += len(chunk)
        lines = (self.tc_partial + chunk.decode("utf-8", "replace")).split("\n")
        self.tc_partial = lines.pop()
        for line in lines:
            ev = parse_teamcity(line)
            if not ev:
                continue
            kind, a = ev
            if kind == "testSuiteStarted":
                self.depth += 1
                if "::" in a.get("locationHint", ""):
                    self.suite = test_id(a)
            elif kind == "testSuiteFinished":
                self.depth = max(0, self.depth - 1)
            elif kind == "testStarted":
                self.current = {"test": test_id(a), "seen": now}
            elif kind in ("testFailed", "testIgnored") and self.current:
                self.current["status"] = "failed" if kind == "testFailed" else "skipped"
            elif kind == "testFinished":
                ms = int(a.get("duration", "0") or 0)
                name = self.current["test"] if self.current else a.get("name", "?")
                status = (self.current or {}).get("status", "ok")
                self.finished.append((name, ms, status))
                slow_tests.append((ms, name))
                self.current = None


# ── PostgreSQL ───────────────────────────────────────────────────────────────
SEP = "\x1f"
ACTIVITY_SQL = """
SELECT pid, coalesce(datname,''), backend_type, coalesce(state,''), coalesce(wait_event_type,''),
       coalesce(wait_event,''),
       coalesce(round(extract(epoch FROM now()-xact_start))::int, -1),
       coalesce(round(extract(epoch FROM now()-query_start))::int, -1),
       coalesce(round(extract(epoch FROM now()-state_change))::int, -1),
       array_to_string(pg_blocking_pids(pid), ','),
       left(regexp_replace(coalesce(query,''), '\\s+', ' ', 'g'), 600)
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND backend_type IN ('client backend', 'autovacuum worker', 'parallel worker')
ORDER BY datname, pid
"""
LOCKS_SQL = """
SELECT l.pid, l.locktype, l.mode, coalesce(c.relname, l.relation::text, ''),
       coalesce(l.transactionid::text, ''), coalesce(a.datname, '')
FROM pg_locks l
LEFT JOIN pg_class c ON c.oid = l.relation
LEFT JOIN pg_stat_activity a ON a.pid = l.pid
WHERE NOT l.granted
ORDER BY l.pid
"""


class Postgres:
    """Read-only access. The command is never printed (it could carry connection details)."""

    def __init__(self, args):
        self.psql_cmd = shlex.split(args.psql_cmd) if args.psql_cmd else None
        self.docker_filter = args.pg_docker_filter
        self.user, self.db = args.pg_user, args.pg_db

    @property
    def enabled(self) -> bool:
        return bool(self.psql_cmd or self.docker_filter)

    def _base(self) -> list[str]:
        if self.psql_cmd:
            return list(self.psql_cmd)
        r = subprocess.run(["docker", "ps", "-q", "--filter", self.docker_filter],
                           capture_output=True, text=True, timeout=CMD_TIMEOUT)
        ids = r.stdout.split()
        if r.returncode != 0 or len(ids) != 1:
            raise RuntimeError(f"postgres container lookup returned {len(ids)} ids (exit {r.returncode})")
        return ["docker", "exec", ids[0], "psql", "-U", self.user, "-d", self.db]

    def query(self, sql: str) -> list[list[str]]:
        cmd = self._base() + ["-X", "-q", "-t", "-A", "-F", SEP, "-v", "ON_ERROR_STOP=1",
                              "-c", "SET statement_timeout = '5s'", "-c", sql]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=CMD_TIMEOUT)
        if r.returncode != 0:
            first = (r.stderr.strip().splitlines() or ["no stderr"])[0]
            raise RuntimeError(f"psql exit {r.returncode}: {redact(first)[:200]}")
        return [line.split(SEP) for line in r.stdout.splitlines() if line.strip()]


# ── the watchdog ─────────────────────────────────────────────────────────────
class Watchdog:
    def __init__(self, args):
        self.a = args
        self.out = Path(args.out_dir)
        self.out.mkdir(parents=True, exist_ok=True)
        self.tmp = Path(args.paratest_tmp_dir)
        self.root = args.root_pid or os.getppid()
        self.parent0 = os.getppid()
        self.me = os.getpid()
        self.pg = Postgres(args)
        self.t0 = time.monotonic()
        self.workers: dict[str, Worker] = {}
        self.last_event = self.t0          # last worker progress / appearance / exit
        self.prev_cpu: dict[int, tuple[float, int]] = {}
        self.cpu_rate: dict[int, float] = {}
        self.snapshots = 0
        self.stalls: list[dict] = []
        self.runner_stall_open = False
        self.runner_stall_at = 0.0
        self.runner_snapshots = 0
        self.slow_tests: list[tuple[int, str]] = []
        self.gaps: list[tuple[float, int, str]] = []
        self.next_heartbeat = self.t0 + args.heartbeat_seconds
        self.stop_event = threading.Event()
        self.stop_reason = ""
        self.log_f = open(self.out / "watchdog.log", "a", encoding="utf-8")

    # logging
    def elapsed(self, now: float | None = None) -> float:
        return (now or time.monotonic()) - self.t0

    def log(self, msg: str) -> None:
        stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        self.log_f.write(f"{stamp} +{self.elapsed():7.1f}s {msg}\n")
        self.log_f.flush()

    def say(self, msg: str, quoted: bool = False) -> None:
        """Write to the job log, sharing stdout with `php artisan test | tee`.

        ParaTest leaves its progress-dots line unterminated, so every write starts with a newline (a
        workflow command must begin a line). Each write is one os.write() below PIPE_BUF, which the
        kernel never interleaves with tee's writes. `quoted` prefixes every line so no snapshot line
        can be read as a workflow command; no ::stop-commands:: / ::group:: state to leave broken."""
        lines = msg.splitlines() or [""]
        if quoted:
            lines = ["│ " + x for x in lines]
        chunk: list[str] = []
        try:
            for line in lines + [None]:
                if line is None or sum(len(x.encode()) + 1 for x in chunk) + len(line.encode()) > PIPE_CHUNK:
                    if chunk:
                        os.write(1, ("\n" + "\n".join(chunk) + "\n").encode())
                    chunk = []
                if line is not None:
                    chunk.append(line.encode()[:1000].decode("utf-8", "ignore"))
        except (OSError, ValueError):  # the step's stdout may already be closed
            self.log("job log unavailable; message kept in watchdog.log only: " + msg[:300])

    # sampling
    def sample(self, now: float) -> dict[int, dict]:
        table = process_table()
        tree = set(descendants(table, self.root, self.me))
        for pid in tree:
            p = table[pid]
            prev = self.prev_cpu.get(pid)
            if prev and now > prev[0]:
                self.cpu_rate[pid] = (p["cpu_ticks"] - prev[1]) / CLK_TCK / (now - prev[0])
            self.prev_cpu[pid] = (now, p["cpu_ticks"])
        for pid in list(self.prev_cpu):
            if pid not in tree:
                self.prev_cpu.pop(pid, None)
                self.cpu_rate.pop(pid, None)

        by_progress: dict[str, int] = {}
        for pid in tree:
            argv = table[pid]["argv"]
            for i, arg in enumerate(argv[:-1]):
                if arg == "--progress-file":
                    by_progress[os.path.basename(argv[i + 1])] = pid

        try:
            files = sorted(self.tmp.glob("worker_*_stdout_*_progress"))
        except OSError:
            files = []
        for f in files:
            m = WORKER_FILE.search(f.name)
            if not m:
                continue
            key = f.name
            w = self.workers.get(key)
            if w is None:
                w = self.workers[key] = Worker(int(m.group(1)), key, f, now)
                self.last_event = now
                self.log(f"worker {w.token} appeared ({key})")
            try:
                size = f.stat().st_size
            except OSError:
                size = w.completed
            pid = by_progress.get(f.name)
            alive = pid is not None
            if alive:
                w.pid, w.ever_alive = pid, True
                if w.cpu_at_last_progress is None:
                    w.cpu_at_last_progress = table[pid]["cpu_ticks"]
            if w.alive and not alive:
                self.last_event = now
                self.log(f"worker {w.token} pid {w.pid} exited after {w.completed} tests")
            w.alive = alive
            w.read_teamcity(now, self.slow_tests)
            if size > w.completed:
                gap = now - w.last_progress
                label = w.finished[-1][0] if w.finished else "(first test of worker)"
                if gap > w.max_gap:
                    w.max_gap, w.max_gap_test = gap, label
                self.gaps.append((gap, w.token, label))
                if w.stall_open_at is not None:
                    msg = f"worker {w.token} resumed after {gap:.0f}s without progress"
                    self.log(msg)
                    self.say(f"AWJ watchdog: {msg}")
                    w.stall_open_at = None
                w.completed, w.last_progress = size, now
                if w.pid in table:
                    w.cpu_at_last_progress = table[w.pid]["cpu_ticks"]
                self.last_event = now
        present = {f.name for f in files}
        for w in self.workers.values():
            if w.alive and w.key not in present:  # ParaTest deletes a worker's files when the run completes
                w.alive = False
                self.last_event = now
                self.log(f"worker {w.token} files removed by ParaTest (run finishing); pid {w.pid} no longer tracked")
        if len(self.slow_tests) > 200:
            self.slow_tests = sorted(self.slow_tests, reverse=True)[:50]
        if len(self.gaps) > 200:
            self.gaps = sorted(self.gaps, reverse=True)[:50]
        return table

    # stall detection
    def check(self, now: float, table: dict[int, dict]) -> None:
        S, R = self.a.stall_seconds, self.a.repeat_seconds
        reasons = []
        for w in self.workers.values():
            if not w.alive or now - w.last_progress < S:
                continue
            if w.stall_open_at is None:
                w.stall_open_at, w.stall_snapshots = now, 0
                reasons.append(f"worker {w.token} (pid {w.pid}) has completed no test for {now - w.last_progress:.0f}s")
            elif now - w.stall_open_at < R * w.stall_snapshots:
                continue
            else:
                reasons.append(f"worker {w.token} (pid {w.pid}) still without a completed test after {now - w.last_progress:.0f}s")
            w.stall_snapshots += 1
        alive = any(w.alive for w in self.workers.values())
        if alive or not descendants(table, self.root, self.me):
            self.runner_stall_open = False
        elif now - self.last_event >= S:
            kind = "runner" if self.workers else "start"
            if not self.runner_stall_open:
                self.runner_stall_open, self.runner_stall_at, self.runner_snapshots = True, now, 0
                reasons.append(f"no worker alive and no worker event for {now - self.last_event:.0f}s ({kind} stall)")
                self.runner_snapshots += 1
            elif now - self.runner_stall_at >= R * self.runner_snapshots:
                reasons.append(f"{kind} stall continues ({now - self.last_event:.0f}s without a worker event)")
                self.runner_snapshots += 1
        if not reasons:
            return
        if self.snapshots >= self.a.max_snapshots:
            for r in reasons:
                self.log(f"stall (snapshot cap {self.a.max_snapshots} reached, not snapshotted): {r}")
                self.stalls.append({"at_s": round(self.elapsed(now)), "reason": r, "snapshot": None})
            return
        path = self.snapshot(now, table, reasons)
        for r in reasons:
            self.stalls.append({"at_s": round(self.elapsed(now)), "reason": r, "snapshot": path.name})

    # snapshot
    def snapshot(self, now: float, table: dict[int, dict], reasons: list[str]) -> Path:
        self.snapshots += 1
        path = self.out / f"snapshot-{self.snapshots:02d}.txt"
        sockets = socket_table()
        tree = descendants(table, self.root, self.me)
        L: list[str] = []
        L.append(f"AWJ PostgreSQL CI stall snapshot #{self.snapshots}")
        L.append(f"utc: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}   watchdog uptime: {self.elapsed(now):.0f}s   stall threshold: {self.a.stall_seconds}s")
        L += [f"reason: {r}" for r in reasons]
        load = (_read("/proc/loadavg") or "?").strip()
        mem = re.search(r"MemAvailable:\s+(\d+)", _read("/proc/meminfo") or "")
        L.append(f"host: loadavg {load}; MemAvailable {int(mem.group(1)) // 1024 if mem else '?'} MiB")

        pg_rows, pg_locks, pg_err = [], [], None
        if self.pg.enabled and self.stop_event.is_set():
            pg_err = "skipped: stop requested while snapshotting"
        elif self.pg.enabled:
            try:
                pg_rows = self.pg.query(ACTIVITY_SQL)
                pg_locks = self.pg.query(LOCKS_SQL)
            except (OSError, subprocess.SubprocessError, RuntimeError) as e:
                pg_err = f"{type(e).__name__}: {redact(str(e))[:200]}"

        L.append("")
        L.append("== workers ==")
        for w in sorted(self.workers.values(), key=lambda x: (x.token, x.first_seen)):
            idle = now - w.last_progress
            L.append(f"worker {w.token}: pid {w.pid or '?'} {'ALIVE' if w.alive else 'exited'}; "
                     f"tests completed {w.completed}; no progress for {idle:.0f}s")
            if not w.alive:
                continue
            L.append(f"  class: {w.suite or '(unknown — teamcity log unavailable)'}")
            if w.current:
                L.append(f"  running test: {w.current['test']} (observed running {now - w.current['seen']:.0f}s)")
            elif w.depth == 0 and w.finished:
                L.append("  running test: none — the worker finished its assigned file (all suites closed); it is "
                         "waiting for ParaTest to assign the next file or to stop it, or is in PHPUnit/Laravel teardown")
            else:
                L.append("  running test: none started since the last finished test "
                         "(between tests: setUp/tearDown of a test, class setup, or worker bootstrap)")
            for name, ms, status in w.finished:
                L.append(f"  finished: {name} {ms} ms {status}")
            p = table.get(w.pid or -1)
            if w.stall_open_at is None:
                L.append("  progressing (below the stall threshold)")
            elif p:
                cpu_since = (p["cpu_ticks"] - (w.cpu_at_last_progress or p["cpu_ticks"])) / CLK_TCK
                verdict, evidence = self.verdict(w, p, table, sockets, pg_rows, pg_err, idle, cpu_since)
                L.append(f"  VERDICT (heuristic): {verdict}")
                L += [f"    - {e}" for e in evidence]
            tail = (_read(str(w.unexpected)) or "")[-1500:]
            if tail.strip():
                L.append("  unexpected output (tail, redacted):")
                L += [f"    | {redact(x)[:MAX_FIELD]}" for x in tail.splitlines()[-15:]]

        L.append("")
        L.append("== process tree of the test command ==")
        L.append(f"{'PID':>7} {'PPID':>7} S {'ELAPSED':>8} {'CPU_S':>8} {'CPU%NOW':>7} {'RSS_MB':>7} {'WCHAN':<26} COMMAND")
        up = uptime()
        depth = {self.root: 0}
        for pid in tree:
            p = table[pid]
            d = depth.get(p["ppid"], 0) + 1
            depth[pid] = d
            wchan = wait_channel(pid, p["state"]) or "?"
            el = up - p["start_ticks"] / CLK_TCK
            rate = self.cpu_rate.get(pid)
            L.append(f"{pid:>7} {p['ppid']:>7} {p['state']} {el:>8.0f} {p['cpu_ticks'] / CLK_TCK:>8.1f} "
                     f"{(f'{rate * 100:.0f}' if rate is not None else '?'):>7} {p['rss_kb'] / 1024:>7.0f} "
                     f"{wchan[:26]:<26} {'  ' * (d - 1)}{short_cmdline(p['argv']) or '[' + p['comm'] + ']'}")

        L.append("")
        L.append("== kernel view of stalled workers and their children ==")
        for w in self.workers.values():
            if not (w.alive and w.stall_open_at is not None and w.pid in table):
                continue
            for pid in [w.pid] + descendants(table, w.pid, self.me):
                fds = open_fds(pid, sockets)
                L.append(f"pid {pid} ({table[pid]['comm']}): state {table[pid]['state']}; "
                         f"syscall {describe_syscall(privileged_read(f'/proc/{pid}/syscall', self.a.privileged_proc and not self.stop_event.is_set()))}; "
                         f"pipes {fds['pipes']}; files {fds['files']}")
                for s in fds["sockets"]:
                    L.append(f"  socket: {s}{'   [postgres]' if s.split(' -> ')[-1].split(' ')[0].endswith(':5432') else ''}")
                stack = privileged_read(f"/proc/{pid}/stack", self.a.privileged_proc and not self.stop_event.is_set())
                L.append("  kernel stack: " + " < ".join(x.split("]", 1)[-1].strip().split("+")[0]
                                                         for x in stack.splitlines()[:8]) if "[<" in stack else f"  kernel stack: {stack}")

        L.append("")
        L.append("== PostgreSQL (pg_stat_activity, read-only monitoring role) ==")
        if not self.pg.enabled:
            L.append("disabled")
        elif pg_err:
            L.append(f"unavailable: {pg_err}")
        else:
            L.append(f"{'PID':>7} {'DATABASE':<16} {'STATE':<22} {'WAIT':<24} {'XACT_S':>6} {'QUERY_S':>7} {'STATE_S':>7} BLOCKED_BY  QUERY(redacted)")
            for r in pg_rows:
                if len(r) < 11:
                    continue
                if r[2] != "client backend":
                    r[3] = f"{r[3]}({r[2]})"
                L.append(f"{r[0]:>7} {r[1][:16]:<16} {r[3][:22]:<22} {(r[4] + ':' + r[5]).strip(':')[:24]:<24} "
                         f"{r[6]:>6} {r[7]:>7} {r[8]:>7} {r[9] or '-':<11} {redact_sql(r[10])}")
            L.append(f"ungranted locks: {len(pg_locks)}")
            for r in pg_locks:
                L.append("  " + " ".join(redact(x) for x in r))

        text = "\n".join(L) + "\n"
        path.write_text(text, encoding="utf-8")
        self.log(f"stall snapshot written: {path.name} ({'; '.join(reasons)})")
        for r in reasons:
            self.say(f"::warning title=PostgreSQL test stall (AWJ watchdog)::{gh_escape(r)} — see {path.name} in the artifact")
        if self.snapshots == 1 or self.a.print_all_snapshots:
            self.say(text.rstrip("\n"), quoted=True)
        return path

    def verdict(self, w, p, table, sockets, pg_rows, pg_err, idle, cpu_since):
        ev = [f"worker state {p['state']}; CPU used since its last completed test: {cpu_since:.1f}s over {idle:.0f}s"]
        db = f"{self.a.pg_db}_test_{w.token}"
        mine = [r for r in pg_rows if len(r) >= 11 and r[1] == db]
        if pg_err:
            ev.append(f"PostgreSQL state unavailable ({pg_err})")
        elif self.pg.enabled:
            ev.append(f"PostgreSQL sessions on {db}: " + (", ".join(
                f"pid {r[0]} {r[3]}{(' wait ' + r[4] + ':' + r[5]) if r[4] else ''}"
                f"{(' blocked by ' + r[9]) if r[9] else ''}" for r in mine) or "none"))
        kids = descendants(table, w.pid, self.me)
        if kids:
            ev.append("child processes: " + ", ".join(f"{k} {table[k]['comm']} ({table[k]['state']})" for k in kids))
        fds = open_fds(w.pid, sockets)
        ext = [s for s in fds["sockets"] if s.startswith("tcp") and ":5432" not in s and "LISTEN" not in s]
        if ext:
            ev.append("non-PostgreSQL TCP sockets: " + "; ".join(ext[:5]))
        wchan = wait_channel(w.pid, p["state"])
        if wchan:
            ev.append(f"kernel wait channel: {wchan}")
        if any(r[3].startswith("idle in transaction") for r in mine):
            ev.append("an idle open transaction is the normal RefreshDatabase state; it is not by itself a cause")

        active = [r for r in mine if r[3] == "active"]
        if any(r[4] == "Lock" for r in active):
            return "waiting on a PostgreSQL lock", ev
        if active:
            return "waiting on PostgreSQL (a statement is executing)", ev
        if kids:
            return "waiting on a child process", ev
        if idle > 0 and cpu_since / idle >= 0.5:
            return "busy on CPU inside PHP (no completed test)", ev
        if "nanosleep" in wchan or "nsleep" in wchan:
            return "sleeping inside PHP (sleep/usleep/time_nanosleep)", ev
        if ext:
            return "blocked in PHP waiting on a non-PostgreSQL socket", ev
        return "blocked in PHP (PostgreSQL idle for this worker, no CPU, no child process)", ev

    # lifecycle
    def heartbeat(self, now: float) -> None:
        if now < self.next_heartbeat:
            return
        self.next_heartbeat = now + self.a.heartbeat_seconds
        alive = [w for w in self.workers.values() if w.alive]
        worst = max((now - w.last_progress for w in alive), default=0)
        self.log(f"heartbeat: workers alive {len(alive)}/{len(self.workers)}; tests completed "
                 f"{sum(w.completed for w in self.workers.values())}; longest current wait {worst:.0f}s")

    def slowest_from_merged_log(self) -> list[tuple[int, str]] | None:
        """The merged --log-teamcity file is complete (ParaTest appends each finished file), unlike
        sampling, which misses tests completed after the last poll."""
        if not self.a.teamcity_log:
            return None
        try:
            f = open(self.a.teamcity_log, encoding="utf-8", errors="replace")
        except OSError:
            return None
        current, top = {}, []
        with f:
            for line in f:
                ev = parse_teamcity(line)
                if not ev:
                    continue
                kind, a = ev
                if kind == "testStarted":
                    current[a.get("flowId")] = test_id(a)
                elif kind == "testFinished":
                    top.append((int(a.get("duration", "0") or 0), current.pop(a.get("flowId"), a.get("name", "?"))))
                    if len(top) > 500:
                        top = sorted(top, reverse=True)[:20]
        return sorted(top, reverse=True)[:10]

    def summary(self) -> dict:
        per_token: dict[int, dict] = {}
        for w in self.workers.values():
            t = per_token.setdefault(w.token, {"token": w.token, "tests": 0, "max_gap_s": 0.0, "max_gap_after": ""})
            t["tests"] += w.completed
            if w.max_gap > t["max_gap_s"]:
                t["max_gap_s"], t["max_gap_after"] = round(w.max_gap, 1), w.max_gap_test
        merged = self.slowest_from_merged_log()
        return {
            "stall_seconds": self.a.stall_seconds,
            "poll_seconds": self.a.poll_seconds,
            "runtime_s": round(self.elapsed()),
            "stop_reason": self.stop_reason,
            "tests_completed": sum(w.completed for w in self.workers.values()),
            "workers": sorted(per_token.values(), key=lambda x: x["token"]),
            "longest_gaps": [{"gap_s": round(g, 1), "worker": t, "after": n} for g, t, n in sorted(self.gaps, reverse=True)[:10]],
            "slowest_tests_source": "merged teamcity log" if merged is not None else "sampled",
            "slowest_tests": [{"ms": ms, "test": n} for ms, n in (merged if merged is not None else sorted(self.slow_tests, reverse=True)[:10])],
            "stalls": self.stalls,
            "snapshots": self.snapshots,
        }

    def request_stop(self, reason: str) -> None:
        if not self.stop_reason:
            self.stop_reason = reason
        self.stop_event.set()

    def run(self) -> None:
        self.log(f"started: pid {self.me}, root {self.root}, threshold {self.a.stall_seconds}s, "
                 f"poll {self.a.poll_seconds}s, postgres {'on' if self.pg.enabled else 'off'}")
        self.say(f"AWJ watchdog: observing PostgreSQL test progress (stall threshold {self.a.stall_seconds}s; observe only)")
        while not self.stop_event.is_set():
            now = time.monotonic()
            try:
                table = self.sample(now)
                self.check(now, table)
                self.heartbeat(now)
            except Exception as e:  # diagnostics must never take the watchdog down
                self.log(f"internal error (continuing): {type(e).__name__}: {redact(str(e))[:300]}")
            if os.getppid() != self.parent0:
                self.request_stop("parent exited")
            elif self.elapsed() >= self.a.max_lifetime_seconds:
                self.request_stop("max lifetime reached")
            self.stop_event.wait(self.a.poll_seconds)
        s = self.summary()
        (self.out / "summary.json").write_text(json.dumps(s, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        top = s["longest_gaps"][0] if s["longest_gaps"] else None
        slow = s["slowest_tests"][0] if s["slowest_tests"] else None
        self.say(f"AWJ watchdog: stopped ({s['stop_reason']}); tests sampled {s['tests_completed']} across "
                 f"{len(s['workers'])} workers; longest sampled gap without a completed test "
                 + (f"{top['gap_s']}s (worker {top['worker']}, then {top['after']})" if top else "n/a")
                 + (f"; slowest test {slow['ms'] / 1000:.1f}s ({slow['test']})" if slow else "")
                 + f"; stalls {len(s['stalls'])}")
        self.log(f"stopped: {s['stop_reason']}")
        self.log_f.close()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--paratest-tmp-dir", required=True)
    ap.add_argument("--stall-seconds", type=float, required=True)
    ap.add_argument("--poll-seconds", type=float, default=5)
    ap.add_argument("--repeat-seconds", type=float, default=300, help="re-snapshot interval while a stall lasts")
    ap.add_argument("--max-snapshots", type=int, default=6)
    ap.add_argument("--heartbeat-seconds", type=float, default=60)
    ap.add_argument("--max-lifetime-seconds", type=float, default=3900)
    ap.add_argument("--root-pid", type=int, default=0, help="observe this process tree (default: parent)")
    ap.add_argument("--pg-docker-filter", default="", help="docker ps --filter selecting the PostgreSQL container")
    ap.add_argument("--psql-cmd", default="", help="psql command prefix (alternative to docker)")
    ap.add_argument("--pg-user", default="awj_ci_watchdog")
    ap.add_argument("--pg-db", default="nibras")
    ap.add_argument("--privileged-proc", action="store_true",
                    help="read /proc/PID/{syscall,stack} of stalled workers with sudo -n when not readable")
    ap.add_argument("--teamcity-log", default="", help="ParaTest --log-teamcity file, read once at stop")
    ap.add_argument("--print-all-snapshots", action="store_true")
    return ap.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    # Handlers first: a stop that arrives during start-up still ends in a clean exit 0.
    early: list[str] = []
    holder: dict = {}

    def on_signal(signum, _frame):
        name = signal.Signals(signum).name
        if "wd" in holder:
            holder["wd"].request_stop(name)
        else:
            early.append(name)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, on_signal)
    try:
        wd = holder["wd"] = Watchdog(parse_args(argv))
    except SystemExit:
        raise
    except Exception as e:
        print(f"\n::warning::AWJ watchdog could not start ({type(e).__name__}); tests continue unobserved", flush=True)
        return 0
    if early:
        wd.request_stop(early[0])
    try:
        wd.run()
    except Exception as e:
        print(f"\n::warning::AWJ watchdog stopped on an internal error ({type(e).__name__})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

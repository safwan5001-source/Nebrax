#!/usr/bin/env python3
"""COPS-H1-1 / #1975 — مرصد جدولة المعالج لعمليات PostgreSQL من خارج الحاوية. **تشخيص فقط**: لا يحكم بحدّ ولا يغيّر حملاً.

لماذا: مرصد `/proc/self/schedstat` داخل اختبار PHP يقيس تأخر **عملية PHP نفسها** فقط؛ أما التوقف داخل COMMIT فتحدثه عملية **PostgreSQL** (الباكند الماسك
لقفل رأس التغذية)، وPHP نائم ينتظر الرد حينها فلا يرى صفره. هذا المرصد يقرأ من المضيف (المشغّل) `/proc/<pid>/schedstat` لكل عملية `postgres`
(الحاوية تشترك مع المضيف في النواة) كل ~5ms، ويحوّل رقم العملية في المضيف إلى رقمها داخل الحاوية عبر `NSpid` ليُطابَق `pg_pid` المسجَّل في الاختبار.

ما يسجّله (كلّه بساعة epoch `time.time()` نفسها التي يستعملها اختبار PHP `microtime(true)` فيُربَط بنافذة التجمّد مباشرة):
  • لكل عيّنة: الفاصل الفعلي عن العيّنة السابقة (dt) — **المرصد نفسه عملية قابلة للتشغيل**؛ إن لم يُجدوَل ~50ms فهذا دليل مباشر أن المعالج لم يُتَح لعمليات المضيف.
  • ضغط المعالج الكلي (PSI cpu some/full، تراكمي µs) وضغط I/O، وعدّادات /proc/stat (busy/idle/iowait/steal بالـjiffy).
  • لكل عملية postgres: الزيادة في run_time (نفّذ على المعالج) وrun_delay (قابل للتشغيل لكن ينتظر معالجاً) — فقط حين تتجاوز 0.1ms.

الفرق بين الأدلة (يُطبَّق في stall_evidence.py): تأخر المرصد/PSI/run_delay لباكند الماسك = **دليل** على نقص المعالج؛ غياب كل ذلك مع COMMIT طويل = ليس معالجاً.
لا يعيد تشغيل شيء ولا يغيّر أولوية أي عملية. فشله لا يجوز أن يُفشل القياس (يُعلَن في الملف `ok:false`).

usage: sched_sampler.py <out.json> [--interval-ms=5] [--refresh-ms=100] [--comm=postgres]
يتوقف عند SIGTERM/SIGINT ويكتب الملف ثم يخرج 0.
"""
from __future__ import annotations

import gc
import json
import os
import signal
import sys
import time
from typing import Any

JIFFY_FIELDS = ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal")


def parse_schedstat(raw: bytes | str) -> tuple[int, int] | None:
    """«run_time_ns run_delay_ns timeslices» ⇒ (run_ns, delay_ns)؛ غير صالح ⇒ None."""
    try:
        parts = (raw.decode() if isinstance(raw, bytes) else raw).split()
        return int(parts[0]), int(parts[1])
    except (ValueError, IndexError, AttributeError):
        return None


def parse_nspid(status_text: str) -> int | None:
    """آخر رقم في سطر NSpid = رقم العملية داخل أعمق فضاء أسماء (الحاوية). بلا NSpid (نواة قديمة) ⇒ None."""
    for line in status_text.splitlines():
        if line.startswith("NSpid:"):
            nums = line.split()[1:]
            try:
                return int(nums[-1])
            except (ValueError, IndexError):
                return None
    return None


def parse_proc_stat(text: str) -> list[int] | None:
    """سطر `cpu ` الأول ⇒ jiffies (user nice system idle iowait irq softirq steal)."""
    for line in text.splitlines():
        if line.startswith("cpu "):
            try:
                return [int(x) for x in line.split()[1:9]]
            except ValueError:
                return None
    return None


def parse_psi_total(text: str) -> dict[str, int]:
    """/proc/pressure/cpu: «some avg10=… total=123» ⇒ {'some': µs, 'full': µs}."""
    out: dict[str, int] = {}
    for line in text.splitlines():
        parts = line.split()
        if not parts or parts[0] not in ("some", "full"):
            continue
        for p in parts[1:]:
            if p.startswith("total="):
                try:
                    out[parts[0]] = int(p[6:])
                except ValueError:
                    pass
    return out


def _read(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


class Sampler:
    def __init__(self, interval_ms: float = 5.0, refresh_ms: float = 100.0, comm: str = "postgres", proc_root: str = "/proc") -> None:
        self.interval = interval_ms / 1000.0
        self.refresh = refresh_ms / 1000.0
        self.comm = comm
        self.proc = proc_root
        self.fds: dict[int, int] = {}          # host pid -> open fd of schedstat
        self.prev: dict[int, tuple[int, int]] = {}
        self.nspid: dict[int, int | None] = {}
        self.rejected: set[int] = set()
        self.stop = False
        self.samples: list[list[int]] = []     # [t_us, dt_us, psi_cpu_some, psi_cpu_full, psi_io_some, jiffy busy, idle, iowait, steal]
        self.events: list[list[int]] = []      # [t_us, host_pid, ns_pid, d_run_us, d_delay_us]
        self.errors: list[str] = []
        self.has_psi = os.path.exists(f"{proc_root}/pressure/cpu")

    # ───── اكتشاف العمليات ─────
    def refresh_pids(self) -> None:
        try:
            names = os.listdir(self.proc)
        except OSError as exc:
            self.errors.append(f"listdir:{exc}")
            return
        alive = set()
        for n in names:
            if not n.isdigit():
                continue
            pid = int(n)
            alive.add(pid)
            if pid in self.fds or pid in self.rejected:
                continue
            comm = _read(f"{self.proc}/{pid}/comm")
            if comm is None:
                continue
            if comm.strip() != self.comm:
                self.rejected.add(pid)
                continue
            try:
                fd = os.open(f"{self.proc}/{pid}/schedstat", os.O_RDONLY)
            except OSError:
                continue
            self.fds[pid] = fd
            st = _read(f"{self.proc}/{pid}/status")
            self.nspid[pid] = parse_nspid(st) if st else None
        for pid in [p for p in self.fds if p not in alive]:
            self._drop(pid)
        self.rejected &= alive

    def _drop(self, pid: int) -> None:
        fd = self.fds.pop(pid, None)
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        self.prev.pop(pid, None)

    # ───── عيّنة واحدة ─────
    def sample_once(self, t_prev_mono: float) -> float:
        now_mono = time.perf_counter()
        wall = time.time()
        t_us = int(wall * 1_000_000)
        dt_us = int((now_mono - t_prev_mono) * 1_000_000)
        for pid in list(self.fds):
            try:
                raw = os.pread(self.fds[pid], 64, 0)
            except OSError:
                self._drop(pid)
                continue
            cur = parse_schedstat(raw)
            if cur is None:
                continue
            old = self.prev.get(pid)
            self.prev[pid] = cur
            if old is None or cur[0] < old[0] or cur[1] < old[1]:
                continue
            d_run, d_delay = (cur[0] - old[0]) // 1000, (cur[1] - old[1]) // 1000   # ns → µs
            if d_run >= 100 or d_delay >= 100:
                self.events.append([t_us, pid, self.nspid.get(pid) or 0, d_run, d_delay])
        psi_c = parse_psi_total(_read(f"{self.proc}/pressure/cpu") or "") if self.has_psi else {}
        psi_i = parse_psi_total(_read(f"{self.proc}/pressure/io") or "") if self.has_psi else {}
        js = parse_proc_stat(_read(f"{self.proc}/stat") or "") or [0] * 8
        busy = js[0] + js[1] + js[2] + js[5] + js[6]
        self.samples.append([t_us, dt_us, psi_c.get("some", -1), psi_c.get("full", -1), psi_i.get("some", -1), busy, js[3], js[4], js[7]])
        return now_mono

    def run(self) -> None:
        gc.disable()                       # لا نُدخل توقف جامع النفايات في المرصد نفسه
        next_refresh = 0.0
        prev = time.perf_counter()
        while not self.stop:
            if prev >= next_refresh:
                self.refresh_pids()
                next_refresh = prev + self.refresh
            prev = self.sample_once(prev)
            time.sleep(self.interval)

    def payload(self, started_wall: float) -> dict[str, Any]:
        return {
            "ok": not self.errors, "errors": self.errors[:10], "clock": "time.time() epoch (== PHP microtime(true))",
            "interval_ms": self.interval * 1000, "refresh_ms": self.refresh * 1000, "comm": self.comm, "started": started_wall, "ended": time.time(),
            "psi_available": self.has_psi, "pids_seen": len(self.nspid), "nspid_available": any(v for v in self.nspid.values()),
            "columns": {
                "samples": ["t_us", "dt_us", "psi_cpu_some_us", "psi_cpu_full_us", "psi_io_some_us", "jiffy_busy", "jiffy_idle", "jiffy_iowait", "jiffy_steal"],
                "events": ["t_us", "host_pid", "ns_pid", "d_run_us", "d_delay_us"],
            },
            "samples": self.samples, "events": self.events,
        }


def main(argv: list[str]) -> int:
    pos = [a for a in argv[1:] if not a.startswith("--")]
    if not pos:
        print("usage: sched_sampler.py <out.json> [--interval-ms=5] [--refresh-ms=100] [--comm=postgres]", file=sys.stderr)
        return 2

    def opt(name: str, default: str) -> str:
        return next((a.split("=", 1)[1] for a in argv[1:] if a.startswith(f"--{name}=")), default)

    s = Sampler(float(opt("interval-ms", "5")), float(opt("refresh-ms", "100")), opt("comm", "postgres"))
    started = time.time()

    def _stop(_signum: int, _frame: Any) -> None:
        s.stop = True

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        s.run()
    except Exception as exc:   # noqa: BLE001 — المرصد لا يُفشل القياس: يُعلن فشله في الملف
        s.errors.append(f"run:{type(exc).__name__}:{exc}")
    with open(pos[0], "w", encoding="utf-8") as fh:
        json.dump(s.payload(started), fh, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

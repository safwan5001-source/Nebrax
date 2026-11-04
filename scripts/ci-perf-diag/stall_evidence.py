#!/usr/bin/env python3
"""COPS-H1-1 / #1975 — يربط نافذة تجمّد قفل التغذية (analyze.freeze_of) بأدلة المعالج وPostgreSQL المقيسة من خارج الاختبار. **تشخيص فقط، لا يحكم بحدّ.**

المدخلات (مجلد artifacts، مجلد فرعي لكل وظيفة): `cops-h1-1-diag.json` (الاختبار) + `sched.json` (sched_sampler.py) + `pg.log` (docker logs لحاوية postgres).
المخرجات: تقرير Markdown يفصل بوضوح بين **دليل مثبِت** و**دليل داعم للفرضية فقط** لكل جولة تجاوزت الحدّ المرجعي، ويحسب الأدلة نفسها على الجولات
النظيفة (ضابط) كي يظهر معدل الإيجابيات الكاذبة لكل مقياس بدل أن يُفترض أنه مميِّز.

تعريفات الأدلة (النافذة W = [t_start, t_end] لأكبر تجمّد في الجولة، hold = طولها):
  مثبِت (proof)
    P1 sampler_starved        : فاصل عيّنة المرصد (عملية قابلة للتشغيل على المضيف) ≥ 50% من hold ⇒ المعالج لم يُتَح لعمليات المضيف.
    P2 root_backend_waited_cpu: run_delay لباكند الماسك الجذري (مطابَق بـNSpid) داخل W ≥ 50% من hold ⇒ الماسك كان قابلاً للتشغيل ولم يُجدوَل.
    P3 pg_commit_slow_in_pg   : سجل PostgreSQL نفسه يُظهر COMMIT للماسك مدّته ≥ 50% من hold ⇒ التأخر داخل الخادم لا في العميل.
    P4 client_side            : لا COMMIT بطيء في سجل PostgreSQL للماسك بينما COMMIT المقيس عند العميل ≥ 50% من hold ⇒ التأخر خارج الباكند.
  داعم فقط (supporting — لا يثبت وحده)
    S1 psi_cpu_some           : ضغط المعالج الكلي (PSI some) داخل W ≥ 50% من hold (يقول إن مهمةً ما انتظرت معالجاً، لا أنها الماسك).
    S2 busy_ge_90pct          : /proc/stat busy ≥ 90% داخل W.
    S3 background_pg_event    : checkpoint/autovacuum في السجل يتقاطع مع W (±0.5s).
    S4 root_backend_idle      : لا run_time ولا run_delay للماسك داخل W (نائم/محجوب لا يُنفَّذ ولا ينتظر معالجاً).
  القرار لا يعتمد على الداعم: `cause` = أقوى مثبِت (P1/P2 ⇒ cpu_scheduling، P3 ⇒ postgres_internal، P4 ⇒ client_side) وإلا `unproven`.

usage: stall_evidence.py <artifacts-dir> [report.md]
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from typing import Any

import analyze as A

SHARE = 0.5
PG_SLOW_LOG_MS = 15.0       # log_min_duration_statement المضبوط في الـworkflow: أقل منه لا يُسجَّل
LOG_RE = re.compile(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) UTC \[(\d+)\] (\w+):\s+(.*)")
DURATION_RE = re.compile(r"duration: ([\d.]+) ms\s+(?:(?:statement|execute\s+\S+|parse\s+\S+|bind\s+\S+):\s*)?(.*)")


def parse_pg_log(text: str) -> list[dict[str, Any]]:
    """يلتقط أسطر `duration:` وأحداث checkpoint/autovacuum؛ الطابع epoch (UTC) لنهاية العبارة."""
    out = []
    for line in text.splitlines():
        m = LOG_RE.search(line)
        if not m:
            continue
        stamp, pid, _lvl, msg = m.groups()
        t = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S.%f").replace(tzinfo=timezone.utc).timestamp()
        d = DURATION_RE.match(msg)
        if d:
            out.append({"t": t, "pid": int(pid), "kind": "duration", "ms": float(d.group(1)), "stmt": d.group(2).strip()[:80]})
        elif re.match(r"checkpoint (starting|complete)", msg):
            out.append({"t": t, "pid": int(pid), "kind": "checkpoint", "msg": msg[:90]})
        elif re.match(r"automatic (vacuum|analyze)", msg):
            out.append({"t": t, "pid": int(pid), "kind": "autovacuum", "msg": msg[:90]})
    return out


def _window_samples(sched: dict[str, Any], t0: float, t1: float) -> list[list[int]]:
    lo, hi = int(t0 * 1e6), int(t1 * 1e6)
    return [s for s in sched["samples"] if s[0] >= lo and s[0] - s[1] <= hi]


def _delta(samples: list[list[int]], idx: int) -> int | None:
    vals = [s[idx] for s in samples if s[idx] >= 0]
    return vals[-1] - vals[0] if len(vals) >= 2 else None


def evidence(rnd: dict[str, Any], fr: dict[str, Any], sched: dict[str, Any] | None, pglog: list[dict[str, Any]] | None) -> dict[str, Any]:
    t0, t1 = fr["t_start"], fr["t_end"]
    hold = fr["freeze_ms"]
    root_w = fr["root"]["w"]
    pg_pid = next((w.get("pg_pid") for w in rnd.get("writers", []) if w.get("w") == root_w), None)
    ev: dict[str, Any] = {"hold_ms": hold, "root_pg_pid": pg_pid, "root_commit_ms": fr["root"]["commit_ms"]}
    proofs: list[str] = []
    support: list[str] = []

    if sched and sched.get("samples"):
        ws = _window_samples(sched, t0 - 0.01, t1 + 0.01)
        ev["sampler_n"] = len(ws)
        ev["sampler_dt_max_ms"] = round(max((s[1] for s in ws), default=0) / 1000.0, 1)
        # PSI/jiffy: الفرق بين عيّنتين تحيطان بالنافذة (±interval)
        psi = _delta(ws, 2)
        ev["psi_cpu_some_ms"] = round(psi / 1000.0, 1) if psi is not None else None
        ev["psi_io_some_ms"] = round((_delta(ws, 4) or 0) / 1000.0, 1) if _delta(ws, 4) is not None else None
        busy, idle, iow, steal = (_delta(ws, i) or 0 for i in (5, 6, 7, 8))
        tot = busy + idle + iow + steal
        ev["busy_pct"] = round(100.0 * busy / tot, 1) if tot > 0 else None
        ev["steal_jiffies"] = steal
        lo, hi = int(t0 * 1e6), int(t1 * 1e6)
        evs = [e for e in sched["events"] if lo <= e[0] <= hi]
        ev["pg_run_ms"] = round(sum(e[3] for e in evs) / 1000.0, 1)
        ev["pg_delay_ms"] = round(sum(e[4] for e in evs) / 1000.0, 1)
        ev["pg_delay_max_one_backend_ms"] = round(max(Counter_sum(evs, 4).values(), default=0) / 1000.0, 1)
        root_ev = [e for e in evs if pg_pid and e[2] == pg_pid]
        ev["root_run_ms"] = round(sum(e[3] for e in root_ev) / 1000.0, 1)
        ev["root_delay_ms"] = round(sum(e[4] for e in root_ev) / 1000.0, 1)
        ev["nspid_mapped"] = bool(sched.get("nspid_available"))
        if ev["sampler_dt_max_ms"] >= SHARE * hold:
            proofs.append("P1_sampler_starved")
        if ev["nspid_mapped"] and ev["root_delay_ms"] >= SHARE * hold:
            proofs.append("P2_root_backend_waited_cpu")
        if ev["psi_cpu_some_ms"] is not None and ev["psi_cpu_some_ms"] >= SHARE * hold:
            support.append("S1_psi_cpu_some")
        if ev["busy_pct"] is not None and ev["busy_pct"] >= 90.0:
            support.append("S2_busy_ge_90pct")
        if ev["nspid_mapped"] and ev["root_run_ms"] < 1.0 and ev["root_delay_ms"] < 1.0:
            support.append("S4_root_backend_idle")
    else:
        ev["sched"] = "missing"

    if pglog is not None:
        near = [e for e in pglog if e["kind"] == "duration" and pg_pid and e["pid"] == pg_pid and t0 - 0.2 <= e["t"] <= t1 + 0.2]
        commits = [e for e in near if e["stmt"].upper().startswith("COMMIT")]
        ev["pg_commit_logged_ms"] = round(max((e["ms"] for e in commits), default=0.0), 1)
        if ev["pg_commit_logged_ms"] >= SHARE * hold:
            proofs.append("P3_pg_commit_slow_in_pg")
        elif fr["root"]["commit_ms"] >= SHARE * hold and ev["pg_commit_logged_ms"] == 0.0:
            # غياب COMMIT بطيء في السجل لا يثبت شيئاً إن كان التسجيل صامتاً: نشترط أن السجل التقط عبارة أخرى بطيئة (منتظر على القفل مثلاً) في المحيط نفسه.
            alive = any(e["kind"] == "duration" and t0 - 0.2 <= e["t"] <= t1 + 0.2 for e in pglog)
            ev["pg_log_alive_near_window"] = alive
            if alive:
                proofs.append("P4_client_side")
        bg = [e for e in pglog if e["kind"] in ("checkpoint", "autovacuum") and t0 - 0.5 <= e["t"] <= t1 + 0.5]
        ev["background_events"] = [e["msg"][:60] for e in bg][:3]
        if bg:
            support.append("S3_background_pg_event")
    else:
        ev["pg_log"] = "missing"

    ev["proofs"], ev["supporting"] = proofs, support
    if any(p.startswith(("P1", "P2")) for p in proofs):
        ev["cause"] = "cpu_scheduling"
    elif any(p.startswith("P3") for p in proofs):
        ev["cause"] = "postgres_internal"
    elif any(p.startswith("P4") for p in proofs):
        ev["cause"] = "client_side"
    else:
        ev["cause"] = "unproven"
    return ev


def Counter_sum(events: list[list[int]], idx: int) -> dict[int, int]:
    acc: dict[int, int] = {}
    for e in events:
        acc[e[1]] = acc.get(e[1], 0) + e[idx]
    return acc


def load_job(dirpath: str) -> dict[str, Any] | None:
    diag = os.path.join(dirpath, "cops-h1-1-diag.json")
    if not os.path.isfile(diag):
        return None
    with open(diag, encoding="utf-8") as fh:
        job: dict[str, Any] = {"dir": os.path.basename(dirpath), "diag": json.load(fh), "sched": None, "pglog": None}
    sp, lp = os.path.join(dirpath, "sched.json"), os.path.join(dirpath, "pg.log")
    if os.path.isfile(sp) and os.path.getsize(sp) > 0:
        try:
            with open(sp, encoding="utf-8") as fh:
                job["sched"] = json.load(fh)
        except json.JSONDecodeError:
            job["sched"] = None
    if os.path.isfile(lp):
        with open(lp, encoding="utf-8", errors="replace") as fh:
            job["pglog"] = parse_pg_log(fh.read())
    return job


def collect(root: str) -> list[dict[str, Any]]:
    jobs = []
    for entry in sorted(os.listdir(root), key=lambda n: (len(n), n)):
        full = os.path.join(root, entry)
        # artifacts قد تكون مسطّحة (diag-<v>-<n>/…) أو متداخلة؛ نبحث عن أقرب مجلد يحمل ملف التشخيص
        for dirpath, _d, files in os.walk(full):
            if "cops-h1-1-diag.json" in files:
                j = load_job(dirpath)
                if j:
                    j["dir"] = entry
                    jobs.append(j)
                break
    return jobs


def build_report(jobs: list[dict[str, Any]]) -> str:
    rows = []
    for j in jobs:
        run = j["diag"]
        for rnd in run["rounds"]:
            if rnd["kind"] == "warmup" or A.round_validity(run, rnd) is not None:
                continue
            fr = A.freeze_of(rnd)
            if fr is None:
                continue
            ev = evidence(rnd, fr, j["sched"], j["pglog"])
            rows.append({"job": j["dir"], "round": rnd["round"], "kind": rnd["kind"], "added": rnd["added_p95_ms"],
                         "over": bool(rnd.get("over_gate_budget")), "category": A.classify(fr), "freeze": fr["freeze_ms"], "ev": ev})
    out = ["## EXPERIMENT — سبب الفشل المتبقي على tmpfs (COPS-H1-1 / #1975)", ""]
    ok_sched = sum(1 for j in jobs if j["sched"] and j["sched"].get("ok"))
    nsp = sum(1 for j in jobs if j["sched"] and j["sched"].get("nspid_available"))
    out.append(f"وظائف: {len(jobs)} · مرصد الجدولة سليم: {ok_sched}/{len(jobs)} · تحويل NSpid متاح: {nsp}/{len(jobs)} · سجل PostgreSQL موجود: {sum(1 for j in jobs if j['pglog'] is not None)}/{len(jobs)}.")
    ge = [r for r in rows if r["kind"] == "gate_equiv"]
    over_ge = [r for r in ge if r["over"]]
    allr = [r for r in rows]
    over = [r for r in allr if r["over"]]
    lo, hi = A.wilson(len(over_ge), len(ge)) if ge else (0.0, 0.0)
    out.append("")
    out.append("### 1) معدل التجاوز (الحدّ المرجعي 50ms — للتمييز لا للحكم)")
    out.append("")
    out.append(f"- جولات gate_equiv: **{len(over_ge)}/{len(ge)}** ({A.pct(len(over_ge) / len(ge)) if ge else '—'}; Wilson {A.pct(lo)}–{A.pct(hi)}). للمقارنة: بوابة 20 تشغيلاً سابقة على tmpfs 2/60 ولا شيء يُغيَّر في حدّها.")
    jobs_over = {r["job"] for r in over_ge}
    out.append(f"- وظائف فيها جولة gate_equiv متجاوزة: **{len(jobs_over)}/{len(jobs)}**.")
    by_round = Counter(r["round"] for r in over)
    out.append("- التجاوز حسب رقم الجولة (كل الأنواع): " + (", ".join(f"ج{k}={v}" for k, v in sorted(by_round.items())) or "لا شيء") + " — من أصل " + ", ".join(f"ج{k}={sum(1 for r in allr if r['round'] == k)}" for k in sorted({r['round'] for r in allr})) + " جولة لها تجمّد قابل للقياس.")
    out.append("")
    out.append("### 2) الجولات المتجاوزة: ما الذي يُثبَت وما الذي يُفترض؟")
    out.append("")
    if not over:
        out.append("**لم تتجاوز أي جولة في هذه الدفعة** — لا عيّنة لتفسيرها (لا إثبات ولا نفي للسبب؛ يُعلَن معدل ≤ حدّ Wilson أعلاه).")
    else:
        out.append("| وظيفة | ج | نوع | p95 | تجمّد ms | تصنيف الاختبار | **السبب (مثبَت)** | مثبِتات | داعم فقط | dt أقصى للمرصد | ضغط CPU (PSI) ms | run_delay الماسك ms | run الماسك ms | busy% | COMMIT في سجل PG ms | COMMIT عند العميل ms |")
        out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for r in over:
            e = r["ev"]
            out.append(f"| {r['job']} | {r['round']} | {r['kind']} | {r['added']} | {r['freeze']} | {r['category']} | **{e['cause']}** | {', '.join(e['proofs']) or '—'} | {', '.join(e['supporting']) or '—'} | "
                       f"{e.get('sampler_dt_max_ms', '—')} | {e.get('psi_cpu_some_ms', '—')} | {e.get('root_delay_ms', '—')} | {e.get('root_run_ms', '—')} | {e.get('busy_pct', '—')} | {e.get('pg_commit_logged_ms', '—')} | {e['root_commit_ms']} |")
        out.append("")
        out.append("توزيع السبب المثبَت: " + ", ".join(f"{k}={v}" for k, v in sorted(Counter(r['ev']['cause'] for r in over).items())))
    out.append("")
    out.append("### 3) ضابط: نفس المقاييس على الجولات النظيفة (معدل الإيجابيات الكاذبة)")
    out.append("")
    clean = [r for r in allr if not r["over"]]
    out.append("جولة نظيفة = لم تتجاوز الحدّ؛ نافذتها أكبر تجمّد فيها (قد يكون صغيراً). **الأدلة المثبِتة تُقاس على hold الجولة نفسها** فلا يُقارَن بين hold مختلفة بالمطلق.")
    out.append("")
    if clean:
        pc = Counter()
        for r in clean:
            for p in r["ev"]["proofs"]:
                pc[p] += 1
            for s in r["ev"]["supporting"]:
                pc[s] += 1
        out.append(f"- جولات نظيفة بتجمّد قابل للقياس: {len(clean)}")
        for k, v in sorted(pc.items()):
            kind = "مثبِت" if k.startswith("P") else "داعم"
            out.append(f"- {k} ({kind}): {v}/{len(clean)} ({A.pct(v / len(clean))}) من النظيفة")
        fr_med = sorted(r["freeze"] for r in clean)[len(clean) // 2]
        out.append(f"- وسيط تجمّد النظيفة: {fr_med}ms · أقصاه {max(r['freeze'] for r in clean)}ms")
    out.append("")
    out.append("### 4) حدود هذا الدليل")
    out.append("")
    out.append("- المرصد والسجل (`log_min_duration_statement=15`) يعملان في **كل** الجولات بما فيها gate_equiv: أثر المراقِب موجود (خفيف: قراءة schedstat كل 5ms)؛ قارن معدل التجاوز أعلاه بالمرجع.")
    out.append("- أحداث الجدولة تُسجَّل فقط حين تتجاوز الزيادة 0.1ms في العيّنة (قد يقلّل المجاميع قليلاً)؛ PSI وjiffy بدقة 10ms.")
    out.append("- `Pn` تُثبِت المسار الفيزيائي للتأخر في تلك الجولة وحدها؛ التعميم على بقية الفشل يحتاج عدد أحداث كافياً (انظر حجم العيّنة في القسم 1).")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    pos = [a for a in argv[1:] if not a.startswith("--")]
    if not pos:
        print("usage: stall_evidence.py <artifacts-dir> [report.md]", file=sys.stderr)
        return 2
    jobs = collect(pos[0])
    report = build_report(jobs)
    if len(pos) > 1:
        with open(pos[1], "w", encoding="utf-8") as fh:
            fh.write(report)
    print(report)
    return 0 if jobs else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

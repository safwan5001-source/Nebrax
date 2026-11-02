#!/usr/bin/env python3
"""COPS-H1-1 — يلخّص مقاييس بوابة أداء قفل تغذية الأحداث (`cops-h1-1-*.json`) إلى ملخّص الـjob.

يقرأ ما سجّله `CommerceOrderEventsPostgresTest` (المجموعة cops-h1-1-perf). **لا يقيّم** حدّاً ولا يخفّفه: الحدّ (p95 إضافي < 50ms) يطبّقه الاختبار نفسه.
وظيفته: (١) إظهار كل المقاييس ومنها الجولة المستبعدة (الإحماء) والتباين، (٢) الفشل إن غابت الأدلة أو نقصت (لا تخطٍّ صامت)،
(٣) عدم الفشل أبداً بسبب قيمة قياس — فقط بسبب غياب الدليل — كي لا يتحوّل إلى بوابة ثانية بمنطق مختلف.

usage: summarize_feed_perf.py <metrics-dir> [--summary-file PATH]
exit: 0 = الأدلة كاملة · 2 = دليل مفقود/ناقص
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

GATE = "cops-h1-1-realistic_load_gate.json"
BURST = "cops-h1-1-saturated_burst_diagnostic.json"
EXPECTED_MEASURED_ROUNDS = 3


class MissingEvidence(Exception):
    pass


def load(directory: Path, name: str) -> dict:
    path = directory / name
    if not path.is_file() or path.stat().st_size == 0:
        raise MissingEvidence(f"لم يُنتج اختبار الأداء {name} — تخطٍّ صامت أو فشل قبل التسجيل")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise MissingEvidence(f"{name} ليس JSON صالحاً: {exc}") from exc


def need(obj: dict, key: str, where: str):
    if key not in obj:
        raise MissingEvidence(f"{where}: الحقل المطلوب «{key}» غائب")
    return obj[key]


def render(gate: dict, burst: dict, environment: str = "") -> str:
    budget = need(gate, "p95_budget_ms", "gate")
    target = need(gate, "offered_rate_target_per_s", "gate")
    rounds = need(gate, "rounds", "gate")
    warm = need(gate, "warmup", "gate")
    if len(rounds) != EXPECTED_MEASURED_ROUNDS:
        raise MissingEvidence(f"بوابة الحمل الواقعي سجّلت {len(rounds)} جولات محتسبة بدل {EXPECTED_MEASURED_ROUNDS}")
    if not warm.get("excluded_from_evaluation"):
        raise MissingEvidence("جولة الإحماء غير موسومة excluded_from_evaluation — الإفصاح مطلوب")
    var = need(gate, "variance", "gate")

    def row(r: dict, label: str) -> str:
        return (f"| {label} | {r['active_window_events_per_second']} | {r['events_per_second']} | {r['startup_overhead_s']}s | "
                f"{r['contended_p50_ms']} | {r['contended_p95_ms']} | **{r['added_p95_ms']}** | "
                f"{r['cpu_busy_pct']} / {r['cpu_iowait_pct']} / {r['cpu_steal_pct']} | {r['loadavg_1m_before']} |")

    lines = [
        "### COPS-H1-1 — قياسات أداء قفل التغذية (PostgreSQL، وظيفة مخصصة)",
        "",
        f"الحدّ المعتمد: p95 إضافي < **{budget}ms** · الحمل: 20 كاتباً × 10 معاملات، تفكير 0–200ms (≈{target:.0f} حدثاً/ث/مستأجر كمتوسط للجولة) · "
        f"baseline p50 = {gate.get('baseline_p50_ms')}ms · مدة الاختبار {gate.get('test_duration_s')}s",
    ]
    if environment:
        lines += ["", f"البيئة: `{environment}`"]
    lines += [
        "",
        "| الجولة | أحداث/ث (نافذة النشاط) | أحداث/ث (إجمالي الجولة) | بدء العمليات | p50 ms | p95 ms | p95 إضافي ms | CPU busy/iowait/steal % | loadavg قبل |",
        "|---|---|---|---|---|---|---|---|---|",
        row(warm, "0 — إحماء (**مستبعد من التقييم**)"),
    ]
    lines += [row(r, str(r["round"])) for r in rounds]
    a, w, t = var["added_p95_ms"], var["active_window_events_per_second"], var["total_round_events_per_second"]
    lines += [
        "",
        f"التباين (3 جولات محتسبة): p95 إضافي min {a['min']} / mean {a['mean']} / max {a['max']} / stdev {a['stdev']} ms · "
        f"نافذة النشاط min {w['min']} / max {w['max']} أحداث/ث · إجمالي الجولة min {t['min']} / max {t['max']} أحداث/ث",
    ]
    # تشخيص فقط (لا يدخل أي معيار): نشاط PostgreSQL الخلفي وشكل أي توقف. حقول اختيارية — غيابها (مرفقات أقدم) لا يفشل شيئاً.
    for r in [warm, *rounds]:
        bg, slow = r.get("pg_background"), r.get("slow_waits") or []
        if bg is None and not slow:
            continue
        label = "إحماء" if r is warm else f"جولة {r.get('round')}"
        parts = []
        if bg is not None:
            parts.append("نقاط تفتيش Δ زمنية/مطلوبة {}/{}".format(bg.get("checkpoints_timed"), bg.get("checkpoints_req"))
                         + f" · دورات autovacuum+analyze Δ {bg.get('autovac_autoanalyze_cycles')} · عمّال autovacuum الآن {bg.get('autovacuum_workers_now')}"
                         + f" · مزامنات WAL Δ {bg.get('wal_syncs')}")
        if slow:
            parts.append(f"انتظارات ≥ الحد: {len(slow)} بين t={slow[0]['t_s']}s وt={slow[-1]['t_s']}s (أطولها {max(x['wait_ms'] for x in slow)}ms)")
        lines.append(f"- {label}: " + " · ".join(parts))
    s = need(burst, "burst", "burst")
    lines += [
        "",
        "تشخيص الاندفاع المشبَع (ليس شرط قبول): "
        f"{s['events_per_second']} حدثاً/ث (إجمالي) · نافذة النشاط {s.get('active_window_events_per_second')} · p50 {s['contended_p50_ms']}ms · "
        f"p95 {s['contended_p95_ms']}ms · p95 إضافي {s['added_p95_ms']}ms · CPU busy {s.get('cpu_busy_pct')}% · أنوية {s.get('cores')}",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    directory = Path(args[0])
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if "--summary-file" in argv:
        out = argv[argv.index("--summary-file") + 1]
    try:
        gate, burst = load(directory, GATE), load(directory, BURST)
        env_file = directory / "perf-environment.txt"
        text = render(gate, burst, env_file.read_text(encoding="utf-8").strip() if env_file.is_file() else "")
    except MissingEvidence as exc:
        print(f"::error::{exc}")
        return 2
    print(text)
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""PERF-TMPFS (#1975) — يجمّع نتائج N تشغيلاً مستقلاً لبوابة COPS-H1-1 (على tmpfs) في تقرير واحد. **لا يقيّم ولا يعيد تشغيل ولا ينتقي.**

يقرأ لكل تشغيل: نتيجة الاختبار الحاكم (من test-output-pgsql-perf.txt)، p95 الإضافي لكل جولة محتسبة (cops-h1-1-realistic_load_gate.json)،
أدلة التخزين (storage-evidence.txt) وبصمة المشغّل (perf-environment.txt). كل تشغيل متوقَّع يظهر في الجدول: الغائب/الناقص يُعلَن ولا يُخفى.

usage: tabulate.py <artifacts-dir> <report.md> --expect=N
exit: 0 = كل التشغيلات المتوقعة مكتملة الأدلة (بصرف النظر عن نجاح/فشل الاختبار؛ النتيجة تُقرأ من التقرير) · 2 = أدلة ناقصة
"""
from __future__ import annotations

import json
import re
import statistics
import sys
from pathlib import Path

GATE = "cops-h1-1-realistic_load_gate.json"


def find(dirpath: Path, name: str) -> Path | None:
    hits = sorted(dirpath.rglob(name))
    return hits[0] if hits else None


def read_run(d: Path) -> dict:
    out: dict = {"run": d.name, "missing": []}
    t = find(d, "test-output-pgsql-perf.txt")
    if t is None:
        out["missing"].append("test-output")
    else:
        text = t.read_text(encoding="utf-8", errors="replace")
        # PHPUnit يطبع «OK, but there were issues!» (تنبيهات deprecation) والاختبار ناجح؛ الفشل فقط FAILURES!/ERRORS!.
        out["passed"] = bool(re.search(r"^OK(,| \()", text, re.M)) and not re.search(r"^(FAILURES!|ERRORS!)", text, re.M)
        m = re.search(r"^Time: ([0-9:.]+)", text, re.M)
        out["phpunit_time"] = m.group(1) if m else "—"
    g = find(d, GATE)
    if g is None:
        out["missing"].append(GATE)
    else:
        gate = json.loads(g.read_text(encoding="utf-8"))
        out["budget"] = gate.get("p95_budget_ms")
        out["rounds"] = [r.get("added_p95_ms") for r in gate.get("rounds", [])]
        warm = gate.get("warmup") or {}
        out["warmup"] = warm.get("added_p95_ms")
    s = find(d, "storage-evidence.txt")
    if s is None:
        out["missing"].append("storage-evidence")
    else:
        out["storage"] = s.read_text(encoding="utf-8", errors="replace")
    e = find(d, "perf-environment.txt")
    out["env"] = e.read_text(encoding="utf-8", errors="replace").strip() if e else "—"
    return out


def pct(vals: list[float], q: float) -> float:
    v = sorted(vals)
    if not v:
        return float("nan")
    k = (len(v) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def build(runs: list[dict], expect: int) -> str:
    out = ["## PERF-TMPFS — تحقق 20 تشغيلاً مستقلاً لبوابة COPS-H1-1 على tmpfs", ""]
    out.append(f"تشغيلات مستلمة: {len(runs)} من المتوقع {expect}. لا إعادة تشغيل انتقائية ولا استبعاد: كل تشغيل متوقع مدرج أدناه. الحدّ المرجعي p95 إضافي < 50ms (لم يتغيّر).")
    out.append("")
    complete = [r for r in runs if not r["missing"]]
    incomplete = [r for r in runs if r["missing"]]
    passed = [r for r in complete if r["passed"]]
    failed = [r for r in complete if not r["passed"]]
    out.append(f"- **نجح الاختبار الحاكم:** {len(passed)}/{len(complete)} · **فشل:** {len(failed)} · **أدلة ناقصة:** {len(incomplete)} · **مفقود كلياً:** {max(expect - len(runs), 0)}")
    fs_bad = [r["run"] for r in complete if not all(f"{k}=tmpfs" in r["storage"].replace(" ", "\n") for k in ("pgdata_fstype", "relation_file_fstype", "pg_wal_fstype"))]
    out.append(f"- **PGDATA وpg_wal وملف علاقة tenants على tmpfs:** {len(complete) - len(fs_bad)}/{len(complete)}" + (f" — مخالفون: {', '.join(fs_bad)}" if fs_bad else ""))
    added = [x for r in complete for x in r["rounds"] if x is not None]
    if added:
        out.append(f"- **p95 الإضافي لكل الجولات المحتسبة (n={len(added)}):** وسيط {statistics.median(added):.1f}ms · p90 {pct(added, .9):.1f} · أقصى **{max(added):.1f}ms** (الحدّ 50ms)")
    out.append("")
    out.append("| تشغيل | النتيجة | p95 إضافي لكل جولة (ms) | إحماء | زمن phpunit | tmpfs (pgdata/relation/wal) |")
    out.append("|---|---|---|---|---|---|")
    for r in runs:
        if r["missing"]:
            out.append(f"| {r['run']} | ⚠ أدلة ناقصة: {', '.join(r['missing'])} | — | — | — | — |")
            continue
        fs = re.findall(r"(pgdata|relation_file|pg_wal)_fstype=(\S+)", r["storage"])
        out.append(f"| {r['run']} | {'✅ نجح' if r['passed'] else '❌ فشل'} | {' / '.join(str(x) for x in r['rounds'])} | {r['warmup']} | {r['phpunit_time']} | {', '.join(v for _, v in fs)} |")
    out.append("")
    cpus = sorted({re.search(r"nproc=\d+", r["env"]).group(0) for r in complete if re.search(r"nproc=\d+", r["env"])})
    out.append(f"المشغّل: {', '.join(cpus) or '—'} (البصمة الكاملة في perf-environment.txt لكل artifact).")
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    expect = next((int(a.split("=", 1)[1]) for a in argv if a.startswith("--expect=")), 0)
    pos = [a for a in argv[1:] if not a.startswith("--")]
    if len(pos) < 2:
        print("usage: tabulate.py <artifacts-dir> <report.md> --expect=N", file=sys.stderr)
        return 2
    base = Path(pos[0])
    dirs = sorted((p for p in base.iterdir() if p.is_dir()), key=lambda p: (len(p.name), p.name))
    runs = [read_run(d) for d in dirs]
    report = build(runs, expect)
    Path(pos[1]).write_text(report, encoding="utf-8")
    print(report)
    return 2 if (any(r["missing"] for r in runs) or len(runs) < expect) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

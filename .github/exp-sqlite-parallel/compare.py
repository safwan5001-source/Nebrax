#!/usr/bin/env python3
"""مقارنة نهائية للتجربة: التطابق مع الضبط التسلسلي، العزل بين العمّال، والأزمنة مقابل الخط الأساسي. يفشل عند أي فرق غير مفسَّر."""
import collections, glob, json, os, statistics, sys

sys.path.insert(0, os.path.dirname(__file__))
from summarize_junit import outcomes, totals  # noqa: E402

# الخط الأساسي (AWJ_CI_PERFORMANCE_AUDIT، 20 تشغيلاً، 2026-11-05..06): خطوة «تشغيل الاختبارات» لفرع SQLite التسلسلي.
BASE_STEP_MEDIAN_S, BASE_STEP_P90_S = 1564, 1852
BASE_JOB_MEDIAN_MIN, BASE_JOB_P90_MIN = 27.8, 32.5


def p90(values):
    v = sorted(values)
    k = (len(v) - 1) * 0.9
    f = int(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)


root = sys.argv[1]
errors, report = [], {}
runs = {}
for d in sorted(glob.glob(os.path.join(root, "*"))):
    if not os.path.isdir(d):
        continue
    name = os.path.basename(d)
    if not os.path.isfile(os.path.join(d, "junit.xml")):
        errors.append(f"{name}: junit.xml missing")
        continue
    meta = json.load(open(os.path.join(d, "meta.json")))
    runs[name] = {"meta": meta, "cases": outcomes(os.path.join(d, "junit.xml"))}

serial = {n: r for n, r in runs.items() if r["meta"]["mode"] == "serial"}
parallel = {n: r for n, r in runs.items() if r["meta"]["mode"] == "parallel"}
if len(serial) != 1 or len(parallel) != 5:
    errors.append(f"unexpected run set: serial={len(serial)} parallel={len(parallel)} (expected 1 and 5)")

ref_name, ref = (next(iter(serial.items())) if serial else (None, None))
report["serial_control"] = totals(ref["cases"]) if ref else None
for n, r in sorted(parallel.items()):
    t = totals(r["cases"])
    diff_missing = list((ref["cases"] - r["cases"]).items())[:10] if ref else []
    diff_extra = list((r["cases"] - ref["cases"]).items())[:10] if ref else []
    report.setdefault("parallel", {})[n] = {"totals": t, "nproc": r["meta"].get("nproc"), "test_step_s": r["meta"]["test_step_s"], "job_cpu_model": r["meta"].get("cpu")}
    if r["meta"].get("nproc") != 4:
        errors.append(f"{n}: nproc={r['meta'].get('nproc')} (experiment requires a 4-vCPU runner)")
    if t.get("failure", 0) or t.get("error", 0):
        errors.append(f"{n}: failures={t.get('failure', 0)} errors={t.get('error', 0)}")
    if ref and (diff_missing or diff_extra):
        errors.append(f"{n}: outcome set differs from serial control; missing={diff_missing} extra={diff_extra}")
    if ref and t != totals(ref["cases"]):
        errors.append(f"{n}: totals {t} != serial {totals(ref['cases'])}")

# عزل العمّال
iso_path = os.path.join(root, "isolation.json")
iso = json.load(open(iso_path)) if os.path.isfile(iso_path) else None
report["isolation"] = iso
if not iso or not iso.get("ok"):
    errors.append(f"worker isolation probe failed: {iso}")

steps = [r["meta"]["test_step_s"] for r in parallel.values()]
jobs = [r["meta"]["job_s"] / 60 for r in parallel.values() if r["meta"].get("job_s")]
if steps:
    report["timing"] = {
        "parallel_test_step_s": {"median": statistics.median(steps), "p90": p90(steps), "min": min(steps), "max": max(steps)},
        "parallel_job_min": ({"median": statistics.median(jobs), "p90": p90(jobs)} if jobs else "taken from the GitHub API outside this script"),
        "baseline_serial_step_s": {"median": BASE_STEP_MEDIAN_S, "p90": BASE_STEP_P90_S},
        "baseline_job_min": {"median": BASE_JOB_MEDIAN_MIN, "p90": BASE_JOB_P90_MIN},
        "serial_control_test_step_s": ref["meta"]["test_step_s"] if ref else None,
        "speedup_vs_baseline_median": round(BASE_STEP_MEDIAN_S / statistics.median(steps), 2),
        "note": "n=5 only: P90 ~ second-largest value, low confidence",
    }

print(json.dumps(report, indent=2, ensure_ascii=False))
if errors:
    print("\nEXPERIMENT STOP - unexplained difference/failure:")
    for e in errors:
        print(" -", e)
    sys.exit(1)
print("\nAll invariants hold: identical outcomes to the serial control, isolated worker databases, no failures.")

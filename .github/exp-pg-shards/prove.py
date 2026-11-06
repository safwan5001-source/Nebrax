#!/usr/bin/env python3
"""إثبات "كل اختبار مرة واحدة": يقارن الشرائح بالمرجعين (جرد SQLite الكامل وتشغيل PostgreSQL كاملاً). يفشل عند أي فرق."""
import collections, glob, hashlib, json, os, statistics as st, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shard_lib import assign, junit_by_file, load_manifest

runs_dir, ref_sqlite, ref_pg, manifest_path, count = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])
STRIP = "/tmp/nibras-app/"
manifest = load_manifest(manifest_path)


def multiset(by_file, names_only=False):
    c = collections.Counter()
    for items in by_file.values():
        for cls, nm, stt, _ in items:
            c[(cls + "::" + nm) if names_only else (cls + "::" + nm, stt)] += 1
    return c


def digest(c):
    h = hashlib.sha256()
    for k, n in sorted(c.items(), key=lambda kv: str(kv[0])):
        h.update(f"{k}\t{n}\n".encode())
    return h.hexdigest()


def lines(p):
    return [l for l in open(p, encoding="utf-8").read().split("\n") if l.strip()] if os.path.isfile(p) else None


errors, report = [], {"reps": {}}
_runners = [json.load(open(p)).get("runner_name") for p in glob.glob(os.path.join(runs_dir, "shard-*-rep-*", "meta.json"))]
if len(_runners) != len(set(_runners)): errors.append("two jobs ran on the same runner (not independent VMs)")
report["independent_runners"] = len(set(_runners))
refS = junit_by_file(ref_sqlite, STRIP); refP = junit_by_file(ref_pg, STRIP)
refS_names, refP_full = multiset(refS, True), multiset(refP)
report["reference"] = {"sqlite_serial_tests": sum(refS_names.values()), "pg_full_tests": sum(refP_full.values()), "pg_digest": digest(refP_full)[:16]}
reps = sorted({os.path.basename(d).split("-rep-")[1] for d in glob.glob(os.path.join(runs_dir, "shard-*-rep-*"))}, key=int)
tracked = set(lines(os.path.join(runs_dir, "tracked_test_files.txt")) or [])
for r in reps:
    row, shards = {}, {}
    for k in range(1, count + 1):
        d = os.path.join(runs_dir, f"shard-{k}-rep-{r}")
        if not os.path.isfile(os.path.join(d, "junit.xml")):
            errors.append(f"rep {r} shard {k}: junit.xml missing"); continue
        meta = json.load(open(os.path.join(d, "meta.json")))
        shards[k] = {"by_file": junit_by_file(os.path.join(d, "junit.xml"), STRIP), "all": lines(os.path.join(d, "all_files.txt")),
                     "assigned": lines(os.path.join(d, "assigned.txt")), "meta": meta}
    if len(shards) != count:
        continue
    alls = [tuple(s["all"] or []) for s in shards.values()]
    if len(set(alls)) != 1:
        errors.append(f"rep {r}: shards discovered different file sets")
    allf = set(alls[0])
    if tracked and not tracked <= allf:
        errors.append(f"rep {r}: tracked test files missing from discovery: {sorted(tracked - allf)[:5]}")
    # 1) الإسناد: فرادة وتغطية، ومطابقة الدالة النقية
    sets = [set(s["assigned"] or []) for s in shards.values()]
    union = set().union(*sets)
    overlap = sorted(set.intersection(*sets)) if count == 2 else []
    if union != allf: errors.append(f"rep {r}: assigned union != discovered ({len(union)} vs {len(allf)})")
    if sum(len(s) for s in sets) != len(union): errors.append(f"rep {r}: a file is assigned to more than one shard")
    for k, s in shards.items():
        exp = {f for f in allf if assign(f, count, manifest) == k - 1}
        if exp != set(s["assigned"] or []): errors.append(f"rep {r} shard {k}: assignment differs from the pure function")
    # 2) التنفيذ: ما نُفّذ ⊆ المسنَد، ولا ملف نُفّذ في شريحتين
    executed = {k: set(s["by_file"]) for k, s in shards.items()}
    for k, ex in executed.items():
        extra = sorted(ex - set(shards[k]["assigned"] or []))
        if extra: errors.append(f"rep {r} shard {k}: executed files outside its assignment: {extra[:3]}")
    both = sorted(set.intersection(*executed.values())) if count == 2 else []
    if both: errors.append(f"rep {r}: files executed in more than one shard: {both[:3]}")
    # 3) المجموع: (صنف::اختبار، حالة) للشرائح معاً = تشغيل PG كامل؛ والأسماء = جرد SQLite
    union_ms = collections.Counter()
    for s in shards.values(): union_ms.update(multiset(s["by_file"]))
    names = collections.Counter()
    for (nm, _), n in union_ms.items(): names[nm] += n
    pg_eq = union_ms == refP_full
    sq_eq = names == refS_names
    if not pg_eq:
        miss = list((refP_full - union_ms).items())[:3]; extra = list((union_ms - refP_full).items())[:3]
        errors.append(f"rep {r}: shard union != full PostgreSQL run; missing={miss} extra={extra}")
    if not sq_eq: errors.append(f"rep {r}: shard union names != SQLite serial inventory")
    # 4) المخطط مقابل المنفَّذ
    for k, s in shards.items():
        planned, ran = s["meta"].get("planned_tests"), sum(len(v) for v in s["by_file"].values())
        if planned is not None and planned != ran: errors.append(f"rep {r} shard {k}: planned tests {planned} != executed {ran}")
        bad = [x for v in s["by_file"].values() for x in v if x[2] in ("failure", "error")]
        if bad: errors.append(f"rep {r} shard {k}: {len(bad)} failing tests")
    # 5) الاستقلال: قواعد كل شريحة = nibras + nibras_test_1..4 فقط، وكل job على مشغّل مختلف
    want = ["nibras"] + [f"nibras_test_{i}" for i in range(1, 5)]
    for k in shards:
        dbs = lines(os.path.join(runs_dir, f"shard-{k}-rep-{r}", "dblist.txt"))
        if sorted(dbs or []) != sorted(want): errors.append(f"rep {r} shard {k}: database set {dbs} != {want}")
    steps = {k: s["meta"].get("test_step_s") for k, s in shards.items()}
    sums = {k: round(sum(x[3] for v in s["by_file"].values() for x in v)) for k, s in shards.items()}
    row = {"files": {k: len(v) for k, v in executed.items()}, "tests": {k: sum(len(v) for v in s["by_file"].values()) for k, s in shards.items()},
           "union_tests": sum(union_ms.values()), "union_digest": digest(union_ms)[:16], "equals_pg_full": pg_eq, "equals_sqlite_names": sq_eq,
           "overlap_files": len(both), "step_s": steps, "sum_test_time_s": sums, "cpu": {k: s["meta"].get("cpu") for k, s in shards.items()},
           "imbalance_step": round(max(steps.values()) / (sum(steps.values()) / count), 3) if all(steps.values()) else None,
           "imbalance_work": round(max(sums.values()) / (sum(sums.values()) / count), 3)}
    report["reps"][r] = row
print(json.dumps(report, indent=1, ensure_ascii=False))
if len(report["reps"]) != len(reps) or not reps: errors.append("incomplete rep set")
if errors:
    print("\nEXPERIMENT STOP - unexplained difference/failure:")
    for e in errors: print(" -", e)
    sys.exit(1)
print("\nAll invariants hold: every test executed exactly once in every rep; shard union == full PostgreSQL run == SQLite inventory.")

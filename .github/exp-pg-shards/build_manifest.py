#!/usr/bin/env python3
"""يولّد shards.json (تعيين ملف→شريحة) بخوارزمية LPT من أوزان نسبية مطبَّعة (وسيط نسبة زمن كل ملف من مجموع التشغيل) عبر عدة JUnit."""
import json, statistics as st, sys
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from shard_lib import junit_by_file

n = int(sys.argv[1]); out = sys.argv[2]; strip = sys.argv[3]; junits = sys.argv[4:]
per_run = []
for j in junits:
    files = junit_by_file(j, strip)
    t = {f: sum(x[3] for x in v) for f, v in files.items()}
    tot = sum(t.values())
    per_run.append({f: x / tot for f, x in t.items()})
allf = sorted(set().union(*[set(r) for r in per_run]))
w = {f: st.median([r.get(f, 0.0) for r in per_run]) for f in allf}
loads = [0.0] * n
assign = {}
for f in sorted(allf, key=lambda f: (-w[f], f)):
    i = min(range(n), key=lambda k: (loads[k], k))
    assign[f] = i
    loads[i] += w[f]
json.dump({"version": 1, "shards": n, "method": "LPT on CPU-normalised median time share", "source_runs": len(junits),
           "expected_share": [round(x, 5) for x in loads], "assignment": dict(sorted(assign.items()))}, open(out, "w"), indent=0, sort_keys=True)
print("files", len(assign), "expected share per shard", [round(x, 4) for x in loads], "imbalance", round(max(loads) / (sum(loads) / n), 4))

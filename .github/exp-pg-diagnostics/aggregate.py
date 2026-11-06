#!/usr/bin/env python3
"""يجمّع قياسات exp/ci-pg-diagnostics لكل تشغيل ويربطها بزمن خطوة الاختبارات. n صغير: ارتباطات استرشادية."""
import collections, glob, json, math, os, re, statistics, sys
import xml.etree.ElementTree as ET


def num(s, d=None):
    try:
        return float(s)
    except Exception:
        return d


def pg_test_fsync(path):
    out = {}
    if not os.path.isfile(path):
        return out
    for line in open(path, errors="replace"):
        m = re.match(r"\s*(open_datasync|fdatasync|fsync|fsync_writethrough|open_sync)\b.*?([\d.]+)\s+ops/sec\s+(\d+)\s+usecs/op", line)
        if m and m.group(1) not in out:
            out[m.group(1)] = {"ops": float(m.group(2)), "us": int(m.group(3))}
    return out


def wait_profile(path):
    tot = collections.Counter()
    ticks = 0
    if not os.path.isfile(path):
        return {}
    for line in open(path):
        p = line.rstrip("\n").split("\t")
        if len(p) == 4:
            tot[(p[1], p[2])] += int(p[3])
    allv = sum(tot.values()) or 1
    by_type = collections.Counter()
    for (t, e), n in tot.items():
        by_type[t] += n
    return {
        "active_session_samples": sum(tot.values()),
        "share_walsync": round(tot[("IO", "WALSync")] / allv, 4),
        "share_io": round(by_type["IO"] / allv, 4),
        "share_lock": round(by_type["Lock"] / allv, 4),
        "share_cpu_none": round(by_type["none"] / allv, 4),
        "share_ipc": round(by_type["IPC"] / allv, 4),
        "top_events": [[f"{t}:{e}", n] for (t, e), n in tot.most_common(6)],
    }


def snap(path):
    d = {"wal": None, "db": None, "io_fsyncs": 0, "io_writes": 0}
    if not os.path.isfile(path):
        return d
    sec = None
    for line in open(path):
        line = line.rstrip("\n")
        if line.startswith("## "):
            sec = line[3:]
            continue
        p = line.split("\t")
        if sec == "pg_stat_wal" and len(p) >= 6:
            d["wal"] = [num(x, 0) for x in p]
        elif sec == "pg_stat_database" and len(p) >= 6:
            d["db"] = [num(x, 0) for x in p]
        elif sec == "pg_stat_io" and len(p) >= 7:
            d["io_writes"] += num(p[4], 0)
            d["io_fsyncs"] += num(p[6], 0)
    return d


def disk(run, device):
    def rd(label):
        res = {}
        f = os.path.join(run, f"diskstats_{label}.txt")
        if os.path.isfile(f):
            for line in open(f):
                p = line.split()
                if len(p) >= 14:
                    res[p[2]] = {"writes": int(p[7]), "sectors_w": int(p[9]), "io_ms": int(p[12])}
        return res
    a, b = rd("before"), rd("after")
    out = {}
    if device and device in a and device in b:
        out = {k: b[device][k] - a[device][k] for k in a[device]}
    return out


def junit(path):
    tot = 0.0
    cls = collections.Counter()
    if not os.path.isfile(path):
        return {}
    for tc in ET.parse(path).getroot().iter("testcase"):
        t = float(tc.get("time") or 0)
        tot += t
        cls[tc.get("classname") or ""] += t
    return {"sum_test_time_s": round(tot), "top_classes": [[c.split("\\")[-1], round(t)] for c, t in cls.most_common(5)]}


def pearson(x, y):
    if len(x) < 3 or len(set(x)) < 2 or len(set(y)) < 2:
        return None
    mx, my = statistics.mean(x), statistics.mean(y)
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    return round(sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy), 2)


root = sys.argv[1]
rows = []
for d in sorted(glob.glob(os.path.join(root, "*")), key=lambda p: (len(p), p)):
    if not os.path.isfile(os.path.join(d, "meta.json")):
        continue
    meta = json.load(open(os.path.join(d, "meta.json")))
    env = open(os.path.join(d, "env.txt"), errors="replace").read() if os.path.isfile(os.path.join(d, "env.txt")) else ""
    src = re.search(r"--- docker root mount\n(\S+)", env)
    device = os.path.basename(src.group(1)) if src else None
    # الجهاز الأب (sda من sda1) أيضاً إن لم يُسجَّل القسم
    sb, sa = snap(os.path.join(d, "pgstats_before.txt")), snap(os.path.join(d, "pgstats_after.txt"))
    step = meta.get("test_step_s") or 0
    wal = [(sa["wal"][i] - sb["wal"][i]) for i in range(6)] if sa["wal"] and sb["wal"] else None
    db = [(sa["db"][i] - sb["db"][i]) for i in range(6)] if sa["db"] and sb["db"] else None
    fs = pg_test_fsync(os.path.join(d, "pg_test_fsync.txt"))
    dk = disk(d, device) or disk(d, re.sub(r"\d+$", "", device or ""))
    psi = [num(m) for m in re.findall(r"io: some avg10=([\d.]+)", open(os.path.join(d, "psi.txt")).read())] if os.path.isfile(os.path.join(d, "psi.txt")) else []
    psc = [num(m) for m in re.findall(r"cpu: some avg10=([\d.]+)", open(os.path.join(d, "psi.txt")).read())] if os.path.isfile(os.path.join(d, "psi.txt")) else []
    w = wait_profile(os.path.join(d, "wait_samples.tsv"))
    r = {
        "run": os.path.basename(d), "test_step_s": step, "cpu": meta.get("cpu"), "nproc": meta.get("nproc"),
        "fdatasync_us": fs.get("fdatasync", {}).get("us"), "open_datasync_us": fs.get("open_datasync", {}).get("us"), "fsync_us": fs.get("fsync", {}).get("us"),
        "wal_sync_per_s": round(wal[5] / step, 1) if wal and step else None, "wal_mb": round(wal[2] / 1e6) if wal else None,
        "commits_per_s": round(db[0] / step, 1) if db and step else None,
        "disk_device": device, "disk_writes_per_s": round(dk["writes"] / step, 1) if dk and step else None,
        "disk_mb_written": round(dk["sectors_w"] * 512 / 1e6) if dk else None, "disk_busy_pct": round(100 * dk["io_ms"] / 1000 / step, 1) if dk and step else None,
        "psi_io_some_avg10_mean": round(statistics.mean(psi), 2) if psi else None, "psi_cpu_some_avg10_mean": round(statistics.mean(psc), 2) if psc else None,
        "waits": w, "junit": junit(os.path.join(d, "junit.xml")),
    }
    rows.append(r)

print(json.dumps(rows, indent=1, ensure_ascii=False))
print("\n## correlation of test_step_s with metric (Pearson r; n=%d, indicative only)" % len(rows))
steps = [r["test_step_s"] for r in rows]
for k in ("fdatasync_us", "open_datasync_us", "fsync_us", "wal_sync_per_s", "commits_per_s", "disk_busy_pct", "disk_writes_per_s", "psi_io_some_avg10_mean", "psi_cpu_some_avg10_mean"):
    pairs = [(r[k], r["test_step_s"]) for r in rows if r.get(k) is not None]
    print(f"{k:28} r={pearson([a for a, _ in pairs], [b for _, b in pairs])}  n={len(pairs)}")
for k in ("share_walsync", "share_io", "share_lock", "share_cpu_none"):
    pairs = [(r["waits"].get(k), r["test_step_s"]) for r in rows if r["waits"].get(k) is not None]
    print(f"{k:28} r={pearson([a for a, _ in pairs], [b for _, b in pairs])}  n={len(pairs)}")
cpus = collections.defaultdict(list)
for r in rows:
    cpus[r["cpu"]].append(r["test_step_s"])
print("\n## step seconds by CPU model:", {k: sorted(v) for k, v in cpus.items()})
print("## step seconds all runs:", sorted(steps), "median", statistics.median(steps) if steps else None)

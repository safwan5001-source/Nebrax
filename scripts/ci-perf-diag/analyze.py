#!/usr/bin/env python3
"""COPS-H1-1 / Issue #1975 (المرحلة 1) — محلّل تشخيص توقف قفل رأس التغذية.

يقرأ ملفات `cops-h1-1-diag.json` التي ينتجها `CommerceOrderEventsStallDiagnosticTest` (واحد لكل تشغيل) ويُخرج:
  1) مقارنة موحّدة بين المتغيّرين (`main` مقابل `pr1972`) بالمنهجية نفسها: معدل الجولات المتجاوزة لحدّ البوابة المرجعي (50ms) ومعدل فشل
     «الوظيفة» (أي جولة gate_equiv متجاوزة) مع فاصل Wilson 95% واختبار Fisher الدقيق، وتوزيع الجولات النظيفة (إشارة الانحدار الحقيقي).
  2) جدول لكل جولة متجاوزة: أين وقع التوقف (تصنيف حتمي أدناه) والأدلة المصاحبة (رصد الماسك، PSI، فرق WAL، تبديلات السياق).

**لا يحكم على أي بوابة ولا يغيّر أي حدّ.** الحدّ 50ms هنا مرجع لتمييز الجولات فقط.

تصنيف «التجمّد» (freeze): أكبر فاصل بين التزامين متتاليين في الجولة (لا أحد يلتزم خلاله ⇒ القفل ممسوك أو في طريق تسليمه).
  ينقسم إلى:
    handoff_ms = من انتهاء التزام السابق حتى اكتمال حيازة التالي للقفل وإدراجه (at + wait)  ← تسليم القفل/إيقاظ المنتظر/الإدراج على الخادم
    hold_ms    = من اكتمال الحيازة حتى انتهاء التزامه (gap + commit)                           ← إمساك القفل: العميل (gap) أو الالتزام (commit)
  التصنيف (الأول المنطبق):
    commit_stall       hold_ms ≥ 50% من التجمّد وcommit_ms ≥ gap_ms
    client_gap_cpu     hold_ms ≥ 50% وgap > commit وrq_gap ≥ 50% من gap   (عملية PHP جاهزة ولم تحصل على معالج وهي ممسكة بالقفل؛ rq_gap
                       يقيس تأخر الطابور داخل نافذة gap نفسها، لا COMMIT وما بعده)
  كل الأرقام أعلاه **مقطوعة على نافذة التجمّد** [بدء تكوّن الطابور، التزام الجذر]: طورٌ وقع قبل تكوّن الطابور لا يُنسب إليه التوقف.
  (rq_gap داخل النافذة تقريب بالتناسب مع الجزء المقطوع من الفجوة.)
    client_gap_other   hold_ms ≥ 50% وgap_ms > commit_ms بلا تأخر طابور   (عميل متوقف لسبب آخر: GC/تبديل/انتظار نظام)
    handoff_latency    handoff_ms ≥ 50% من التجمّد   (تأخر بين تحرير القفل وإتمام الحيازة التالية: جدولة الخادم/الإدراج)
    mixed              غير ذلك
  إن كان أكبر تجمّد < FREEZE_MIN_MS فالجولة «بلا تجمّد»: انتظارات مرتفعة موزّعة (ازدحام معالج متصل، لا حدث توقف).
"""

from __future__ import annotations

import json
import math
import os
import random
import statistics
import sys
from collections import Counter, defaultdict
from typing import Any

BUDGET_MS = 50.0          # مرجع تمييز فقط
FREEZE_MIN_MS = 30.0      # أصغر تجمّد يُعدّ «حدث توقف»
SHARE = 0.5               # حصة المكوّن من التجمّد ليُنسب إليه


# ───────────────────────── إحصاء ─────────────────────────

def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    denom = 1 + z * z / n
    centre = p + z * z / (2 * n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return (max(0.0, (centre - half) / denom), min(1.0, (centre + half) / denom))


def fisher_exact(a: int, b: int, c: int, d: int) -> float:
    """p ثنائي الطرف للجدول [[a,b],[c,d]] (مجموع احتمالات الجداول ≤ احتمال المرصود)."""
    r1, r2, c1 = a + b, c + d, a + c
    n = r1 + r2

    def pr(x: int) -> float:
        return math.comb(r1, x) * math.comb(r2, c1 - x) / math.comb(n, c1)

    lo, hi = max(0, c1 - r2), min(r1, c1)
    obs = pr(a)
    return min(1.0, sum(pr(x) for x in range(lo, hi + 1) if pr(x) <= obs * (1 + 1e-9)))


def perm_median_p(x: list[float], y: list[float], iters: int = 5000, seed: int = 1975) -> float:
    """اختبار تبديل لفرق الوسيطين (ثنائي الطرف)، بذرة ثابتة ⇒ حتمي."""
    if not x or not y:
        return float("nan")
    rng = random.Random(seed)
    obs = abs(statistics.median(x) - statistics.median(y))
    pool = x + y
    nx = len(x)
    hits = 0
    for _ in range(iters):
        rng.shuffle(pool)
        if abs(statistics.median(pool[:nx]) - statistics.median(pool[nx:])) >= obs - 1e-12:
            hits += 1
    return (hits + 1) / (iters + 1)


# ───────────────────────── تحميل ─────────────────────────

def load_runs(root: str) -> list[dict[str, Any]]:
    runs = []
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f == "cops-h1-1-diag.json":
                with open(os.path.join(dirpath, f), encoding="utf-8") as fh:
                    d = json.load(fh)
                d["_path"] = os.path.relpath(os.path.join(dirpath, f), root)
                host = d.get("host", {})
                d["variant"] = host.get("variant") or "unknown"
                d["repeat"] = host.get("repeat") or d["_path"]
                runs.append(d)
    runs.sort(key=lambda r: (r["variant"], str(r["repeat"])))
    return runs


# ───────────────────────── تصنيف ─────────────────────────

def txn_end(t: dict[str, Any]) -> float:
    """وقت إكمال المعاملة: الطابع الفعلي `end` إن سُجّل (لا يفترض اتصال المكوّنات)، وإلا مجموع المكوّنات (بيانات قديمة/اصطناعية)."""
    if "end" in t:
        return float(t["end"])
    return t["at"] + (t["wait_ms"] + t["gap_ms"] + t["commit_ms"]) / 1000.0


QUEUE_MIN = 3             # أقل عدد منتظرين على القفل ليُعدّ الفاصل «تجمّداً» (لا فراغاً طبيعياً في ذيل الجولة أو وقت تفكير)


def acquired_at(t: dict[str, Any]) -> float:
    """لحظة اكتمال حيازة المعاملة للقفل وإدراجها (نهاية append): `at + wait_ms`."""
    return t["at"] + t["wait_ms"] / 1000.0


def freeze_of(rnd: dict[str, Any]) -> dict[str, Any] | None:
    """أكبر فاصل بين التزامين متتاليين **كان خلفه طابور فعلي**، مقيساً من لحظة تكوّن الطابور لا من آخر التزام.

    المنتظرون لحظة الالتزام الثاني = معاملات بدأت (`at`) ولم تُكمل حيازة القفل بعد (`acquired_at`). يبدأ التجمّد من
    max(آخر التزام، لحظة وصول المنتظر رقم QUEUE_MIN) — فوقت التفكير الذي سبق تكوّن الطابور (كتّاب نائمون) لا يُحتسب تجمّداً ولا تسليماً.
    فاصل لا ينتظر خلفه ≥ QUEUE_MIN كتّاب (ذيل الجولة) ليس تجمّداً. أول التزام يُقاس من أبكر بدء نشاط معاملات في الجولة.
    """
    txns = sorted(rnd.get("txns", []), key=txn_end)
    ends = [txn_end(t) for t in txns]
    best = None
    first_start = min((t["at"] for t in txns), default=0.0)
    for idx in range(len(txns)):
        cur = txns[idx]
        prev_end = first_start if idx == 0 else ends[idx - 1]
        cur_end = ends[idx]
        waiting_since = sorted(t["at"] for j, t in enumerate(txns) if j != idx and t["at"] < cur_end < acquired_at(t))
        if len(waiting_since) < QUEUE_MIN:
            continue
        start = max(prev_end, waiting_since[QUEUE_MIN - 1])
        freeze_ms = (cur_end - start) * 1000.0
        if best is None or freeze_ms > best["freeze_ms"]:
            # أطوار الجذر مقطوعة على نافذة التجمّد [start, cur_end]: ما وقع قبل تكوّن الطابور لا يُنسب إليه التوقف.
            commit_s = cur_end - cur["commit_ms"] / 1000.0
            gap_s = commit_s - cur["gap_ms"] / 1000.0

            def clip(a: float, b: float) -> float:
                return max(0.0, min(b, cur_end) - max(a, start)) * 1000.0

            gap_win = clip(gap_s, commit_s)
            commit_win = clip(commit_s, cur_end)
            # rq_gap مقيس على الفجوة كلها؛ يُوزَّع على الجزء داخل النافذة بالتناسب (تقريب معلن: افتراض توزيع منتظم).
            rq_gap_win = cur["rq_gap_ms"] * (gap_win / cur["gap_ms"]) if cur["gap_ms"] > 0 else 0.0
            best = {
                "freeze_ms": round(freeze_ms, 1),
                "handoff_ms": round(max(0.0, (min(acquired_at(cur), cur_end) - start) * 1000.0), 1),
                "hold_ms": round(gap_win + commit_win, 1),
                "gap_win_ms": round(gap_win, 1),
                "commit_win_ms": round(commit_win, 1),
                "rq_gap_win_ms": round(rq_gap_win, 1),
                "queued": len(waiting_since),
                "root": cur,
                "t_start": start,
                "t_end": cur_end,
            }
    return best


def classify(fr: dict[str, Any] | None) -> str:
    if fr is None or fr["freeze_ms"] < FREEZE_MIN_MS:
        return "no_freeze"
    if fr["hold_ms"] >= SHARE * fr["freeze_ms"]:
        if fr["commit_win_ms"] >= fr["gap_win_ms"]:
            return "commit_stall"
        if fr["rq_gap_win_ms"] >= SHARE * fr["gap_win_ms"]:
            return "client_gap_cpu"
        return "client_gap_other"
    if fr["handoff_ms"] >= SHARE * fr["freeze_ms"]:
        return "handoff_latency"
    return "mixed"


def sampler_holders(rnd: dict[str, Any], fr: dict[str, Any] | None) -> dict[str, int]:
    """مفاتيح حالة الماسك الجذري في حلقات الاصطفاف المتقاطعة مع نافذة التجمّد (أو كل الحلقات إن لم يُحدَّد تجمّد)."""
    s = rnd.get("sampler") or {}
    out: Counter[str] = Counter()
    for ep in s.get("queue_episodes", []):
        if fr is not None and (ep.get("t1", ep["t0"]) < fr["t_start"] - 0.02 or ep["t0"] > fr["t_end"] + 0.02):
            continue
        out.update(ep.get("holder_keys", {}))
    return dict(out)


def round_validity(run: dict[str, Any], rnd: dict[str, Any]) -> str | None:
    """سبب بطلان الجولة (None = صالحة). جولة ناقصة (كاتب فشل/تسلسل غير متصل/معاملات أقل) تُخفض p95 زيفاً فلا تدخل أي إحصاء."""
    required = {"at", "wait_ms", "gap_ms", "commit_ms", "rq_gap_ms"}
    if any(not required <= set(t) for t in rnd.get("txns", [])):
        return "schema_mismatch"          # مخرجات بمخطط مختلف: تُعلَن ولا تنهار بها المقارنة كلها
    wl = run.get("workload", {})
    expected = wl.get("writers", 20) * wl.get("per_writer", 10)
    integ = rnd.get("integrity") or {}
    if integ.get("errors"):
        return "writer_errors"
    if not integ.get("sequence_complete", False):
        return "sequence_incomplete"
    if not integ.get("per_writer_complete", False):
        return "per_writer_incomplete"
    if rnd.get("transactions") != expected or len(rnd.get("txns", [])) != expected:
        return f"sample_count_{rnd.get('transactions')}_of_{expected}"
    return None


def round_rows(runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for run in runs:
        for rnd in run["rounds"]:
            invalid = round_validity(run, rnd)
            if invalid is not None:
                rows.append({"variant": run["variant"], "repeat": run["repeat"], "round": rnd["round"], "kind": rnd["kind"], "invalid": invalid})
                continue
            fr = freeze_of(rnd)
            rows.append({
                "variant": run["variant"], "repeat": run["repeat"], "round": rnd["round"], "kind": rnd["kind"],
                "added_p95_ms": rnd["added_p95_ms"], "slow_count": rnd["slow_count"], "over": bool(rnd.get("over_gate_budget")),
                "freeze": fr, "category": classify(fr),
                "holders": sampler_holders(rnd, fr) if rnd.get("sampled") else {},
                "psi_cpu_some_ms": round((rnd.get("psi_delta_us") or {}).get("cpu_some_us", 0) / 1000.0, 1) if rnd.get("psi_delta_us") else None,
                "psi_io_some_ms": round((rnd.get("psi_delta_us") or {}).get("io_some_us", 0) / 1000.0, 1) if rnd.get("psi_delta_us") else None,
                "wal_sync_ms": (rnd.get("pg_wal_delta") or {}).get("wal_sync_time"),
                "components": rnd.get("components", {}),
                "max_nivcsw": max((w["ru"]["nivcsw"] for w in rnd.get("writers", [])), default=None),
                "root_nivcsw": next((w["ru"]["nivcsw"] for w in rnd.get("writers", []) if fr and w.get("w") == fr["root"]["w"]), None),
                "cpu_busy_pct": rnd.get("cpu_busy_pct"), "iowait_pct": rnd.get("cpu_iowait_pct"), "steal_pct": rnd.get("cpu_steal_pct"),
                "sampler_query_p50": ((rnd.get("sampler") or {}).get("query_ms") or {}).get("p50"),
            })
    return rows


# ───────────────────────── تقرير ─────────────────────────

def pct(x: float) -> str:
    return f"{100 * x:.0f}%"


def rate_cell(k: int, n: int) -> str:
    lo, hi = wilson(k, n)
    return f"{k}/{n} ({pct(k / n) if n else '—'}; CI {pct(lo)}–{pct(hi)})"


def median_or_nan(v: list[float]) -> float:
    return statistics.median(v) if v else float("nan")


def build_report(runs: list[dict[str, Any]], expect: int = 0, expected_variants: list[str] | None = None) -> str:
    all_rows = round_rows(runs)
    invalid_rows = [r for r in all_rows if r.get("invalid")]
    rows = [r for r in all_rows if not r.get("invalid")]
    # المتغيّرات = الملاحَظة ∪ المخطَّطة: متغيّر لم يصل منه أي ملف يظهر صراحةً بصفر تشغيلات لا يختفي من التقرير.
    variants = sorted({r["variant"] for r in all_rows} | set(expected_variants or []))
    out: list[str] = []
    out.append("## COPS-H1-1 — تشخيص توقف قفل التغذية (Issue #1975، المرحلة 1)")
    out.append("")
    out.append(f"تشغيلات: {len(runs)} · متغيّرات: {', '.join(variants)} · الحدّ المرجعي للتمييز فقط: {BUDGET_MS:.0f}ms (لا يُحكم به هنا).")
    hosts = Counter((r["host"].get("nproc"), r["host"].get("cpu_model"), r["pg"].get("server_version")) for r in runs)
    out.append("المضيف: " + "; ".join(f"nproc={n} · {m} · PG {v} ×{c}" for (n, m, v), c in hosts.items()))
    out.append("")
    if invalid_rows or expect or expected_variants:
        out.append("### 0) صلاحية البيانات")
        out.append("")
        if invalid_rows:
            by_job = Counter((r["variant"], r["repeat"]) for r in invalid_rows)
            out.append(f"⚠ **{len(invalid_rows)} جولة غير صالحة استُبعدت من كل الإحصاءات** (نزاهة/عدد عيّنات): " +
                       "; ".join(f"{v}#{rep}: {n}" for (v, rep), n in sorted(by_job.items(), key=lambda kv: str(kv[0]))) +
                       ". الأسباب: " + ", ".join(sorted({r["invalid"] for r in invalid_rows})))
        if expect or expected_variants:
            for v in variants:
                got = len({r["repeat"] for r in all_rows if r["variant"] == v})
                if got < expect or (expected_variants and v in expected_variants and got == 0):
                    out.append(f"⚠ المتغيّر {v}: وصل {got} من {expect} تشغيلات متوقعة (وظائف قياس فشلت أو لم تُنتج مخرجات) — المقارنة ناقصة.")
        if not invalid_rows and all(len({r['repeat'] for r in all_rows if r['variant'] == v}) >= max(expect, 1) for v in variants):
            out.append("كل التشغيلات المتوقعة وصلت وكل الجولات صالحة.")
        out.append("")

    # 1) المقارنة الموحّدة
    out.append("### 1) مقارنة موحّدة بين المتغيّرين (المنهجية والحمل والتوقيت نفسها)")
    out.append("")
    out.append("| المتغيّر | وظائف | فشل الوظيفة* | جولات gate_equiv > 50ms | جولات sampled > 50ms | وسيط p95 لجولات gate_equiv النظيفة (ms) |")
    out.append("|---|---|---|---|---|---|")
    stats: dict[str, dict[str, Any]] = {}
    for v in variants:
        vr = [r for r in rows if r["variant"] == v]
        jobs: dict[Any, list[dict[str, Any]]] = defaultdict(list)
        for r in vr:
            jobs[r["repeat"]].append(r)
        job_fail = sum(1 for rs in jobs.values() if any(x["over"] for x in rs if x["kind"] == "gate_equiv"))
        ge = [r for r in vr if r["kind"] == "gate_equiv"]
        sm = [r for r in vr if r["kind"] == "sampled"]
        # الوسيط الأساسي من gate_equiv وحدها (مقارنة صالحة بالبوابة)؛ جولات sampled يغيّرها الرصد فلا تُخلط (تُعرض منفصلة أدناه).
        clean = [r["added_p95_ms"] for r in ge if not r["over"]]
        stats[v] = {"jobs": len(jobs), "job_fail": job_fail, "ge": ge, "sm": sm, "clean": clean}
        out.append(
            f"| {v} | {len(jobs)} | {rate_cell(job_fail, len(jobs))} | {rate_cell(sum(r['over'] for r in ge), len(ge))} | "
            f"{rate_cell(sum(r['over'] for r in sm), len(sm))} | {median_or_nan(clean):.1f} |"
        )
    out.append("")
    out.append("\\* «فشل الوظيفة» = أي جولة gate_equiv (الجولات 1–3 ببذور البوابة) تجاوزت الحدّ المرجعي — أي ما كانت البوابة ستحكم به.")
    if len(variants) == 2:
        a, b = variants
        sa, sb = stats[a], stats[b]
        out.append("")
        out.append("| المقارنة ({} مقابل {}) | Fisher p (ثنائي الطرف) | ملاحظة |".format(a, b))
        out.append("|---|---|---|")
        for label, ka, na, kb, nb in (
            ("فشل الوظيفة", sa["job_fail"], sa["jobs"], sb["job_fail"], sb["jobs"]),
            ("جولات gate_equiv المتجاوزة", sum(r["over"] for r in sa["ge"]), len(sa["ge"]), sum(r["over"] for r in sb["ge"]), len(sb["ge"])),
            ("جولات sampled المتجاوزة", sum(r["over"] for r in sa["sm"]), len(sa["sm"]), sum(r["over"] for r in sb["sm"]), len(sb["sm"])),
        ):
            p = fisher_exact(ka, na - ka, kb, nb - kb) if na and nb else float("nan")
            out.append(f"| {label} | {p:.3f} | {ka}/{na} مقابل {kb}/{nb} |")
        p_med = perm_median_p(sa["clean"], sb["clean"])
        out.append(f"| وسيط p95 للجولات النظيفة (اختبار تبديل، بذرة 1975) | {p_med:.3f} | {median_or_nan(sa['clean']):.1f} مقابل {median_or_nan(sb['clean']):.1f} ms |")
        out.append("")
        out.append("p كبير = لا فرق قابل للكشف بهذا الحجم؛ ليس إثباتاً لانعدامه. الانحدار الحقيقي يظهر كارتفاع **وسيط الجولات النظيفة** (إزاحة التوزيع كله) لا كجولات منعزلة.")
    out.append("")

    # 2) الجولات المتجاوزة
    out.append("### 2) الجولات المتجاوزة: أين وقع التوقف؟")
    over = [r for r in rows if r["over"]]
    out.append("")
    if not over:
        out.append("لا جولة متجاوزة في هذه العيّنة.")
    else:
        out.append("| تشغيل | جولة | نوع | p95 إضافي | بطيئة | تجمّد ms | handoff ms | hold ms في النافذة (gap/commit/rq_gap) | تصنيف | ماسك مرصود | PSI cpu/io ms | WAL sync ms | nivcsw (جذر/أعلى) |")
        out.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for r in over:
            fr = r["freeze"]
            root = fr["root"] if fr else None
            hold = f"{fr['hold_ms']} ({fr['gap_win_ms']}/{fr['commit_win_ms']}/{fr['rq_gap_win_ms']})" if fr else "—"
            holders = ", ".join(f"{k}×{v}" for k, v in sorted(r["holders"].items(), key=lambda kv: -kv[1])[:3]) or "—"
            out.append(
                f"| {r['variant']}#{r['repeat']} | {r['round']} | {r['kind']} | {r['added_p95_ms']} | {r['slow_count']} | "
                f"{fr['freeze_ms'] if fr else '—'} | {fr['handoff_ms'] if fr else '—'} | {hold} | **{r['category']}** | {holders} | "
                f"{r['psi_cpu_some_ms']}/{r['psi_io_some_ms']} | {r['wal_sync_ms']} | {r['root_nivcsw']}/{r['max_nivcsw']} |"
            )
        out.append("")
        cats = Counter((r["variant"], r["category"]) for r in over)
        out.append("توزيع التصنيف: " + "; ".join(f"{v}/{c}: {n}" for (v, c), n in sorted(cats.items())))
    out.append("")

    # 3) أكبر تجمّد في الجولات النظيفة مقابل المتجاوزة (يفصل «حدث» عن «ازدحام»)
    out.append("### 3) أكبر تجمّد (ms) — نظيفة مقابل متجاوزة")
    out.append("")
    cl = [r["freeze"]["freeze_ms"] for r in rows if r["kind"] != "warmup" and not r["over"] and r["freeze"]]
    ov = [r["freeze"]["freeze_ms"] for r in over if r["freeze"]]
    out.append(f"- جولات نظيفة (n={len(cl)}): وسيط {median_or_nan(cl):.1f} · أقصى {max(cl) if cl else float('nan'):.1f}")
    out.append(f"- جولات متجاوزة (n={len(ov)}): وسيط {median_or_nan(ov):.1f} · أدنى {min(ov) if ov else float('nan'):.1f}")
    out.append("")

    # 4) أثر الرصد نفسه
    q = [r["sampler_query_p50"] for r in rows if r["kind"] == "sampled" and r["sampler_query_p50"] is not None]
    ge_clean = [r["added_p95_ms"] for r in rows if r["kind"] == "gate_equiv" and not r["over"]]
    sm_clean = [r["added_p95_ms"] for r in rows if r["kind"] == "sampled" and not r["over"]]
    out.append("### 4) أثر الرصد (تحيّز القياس)")
    out.append("")
    out.append(
        f"- وسيط زمن استعلام الرصد: {median_or_nan(q):.2f}ms · وسيط p95 للنظيفة: gate_equiv {median_or_nan(ge_clean):.1f} مقابل sampled {median_or_nan(sm_clean):.1f} ms "
        "(فرق كبير يعني أن الرصد يغيّر الحمل؛ تُقرأ جولات sampled تفسيرياً لا مقارنةً بالبوابة)."
    )
    return "\n".join(out) + "\n"


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    expect = next((int(a.split("=", 1)[1]) for a in argv[1:] if a.startswith("--expect=")), 0)
    expected_variants = next(([v for v in a.split("=", 1)[1].split(",") if v] for a in argv[1:] if a.startswith("--variants=")), None)
    if not args:
        print("usage: analyze.py <artifacts-dir> [report.md] [--expect=N] [--variants=a,b]", file=sys.stderr)
        return 2
    runs = load_runs(args[0])
    if not runs:
        print("no cops-h1-1-diag.json found", file=sys.stderr)
        return 1
    report = build_report(runs, expect, expected_variants)
    print(report)
    if len(args) > 1:
        with open(args[1], "w", encoding="utf-8") as fh:
            fh.write(report)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

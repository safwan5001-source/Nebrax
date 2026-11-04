import json
import os
import tempfile
import unittest

import analyze as A


def txn(w, at, wait=1.0, gap=0.05, commit=1.0, rq_wait=0.0, rq_after=0.0):
    return {"w": w, "at": at, "wait_ms": wait, "gap_ms": gap, "commit_ms": commit, "rq_wait_ms": rq_wait, "rq_after_ms": rq_after}


def steady(n=20, step=0.01, start=100.0):
    """معاملات نظيفة متتابعة: كل واحدة تنتهي بعد ≈2ms وتبدأ التالية بعد step."""
    return [txn(i % 5, start + i * step) for i in range(n)]


def stalled_queue(stall_at=10, **stall):
    """طابور حقيقي: المعاملة stall_at تمسك القفل وتتوقف؛ التسع التالية تبدأ أثناء التوقف وتنتظر (wait كبير) ثم تُحاز القفل تباعاً بعد انتهائه."""
    t = steady()
    base = t[stall_at]["at"]
    stalled = txn(2, base, **stall)
    t[stall_at] = stalled
    stall_end = A.txn_end(stalled)
    for k in range(stall_at + 1, 20):
        at = base + 0.002 + (k - stall_at) * 0.001
        acquired = stall_end + (k - stall_at) * 0.002
        t[k] = txn(k % 5, at, wait=(acquired - at) * 1000.0)
    return t


def rnd(txns, kind="gate_equiv", added=10.0, slow=0, over=False, **extra):
    base = {"round": 1, "kind": kind, "sampled": kind == "sampled", "added_p95_ms": added, "slow_count": slow,
            "over_gate_budget": over, "txns": txns, "writers": [{"w": i, "pg_pid": 1000 + i, "ru": {"nivcsw": 3 * i}} for i in range(5)]}
    base.update(extra)
    return base


class Stats(unittest.TestCase):
    def test_fisher_known_value(self):
        # [[3,3],[0,6]] ⇒ p = 2 * 20/220
        self.assertAlmostEqual(A.fisher_exact(3, 3, 0, 6), 40 / 220, places=6)
        self.assertEqual(A.fisher_exact(5, 5, 5, 5), 1.0)

    def test_wilson_bounds(self):
        lo, hi = A.wilson(0, 10)
        self.assertEqual(lo, 0.0)
        self.assertAlmostEqual(hi, 0.2775, places=3)
        self.assertEqual(A.wilson(0, 0), (0.0, 0.0))

    def test_permutation_is_deterministic_and_sensitive(self):
        same = A.perm_median_p([10, 11, 12, 13], [10, 11, 12, 13])
        shifted = A.perm_median_p([10, 11, 12, 13, 14, 15], [40, 41, 42, 43, 44, 45])
        self.assertGreater(same, 0.5)
        self.assertLess(shifted, 0.05)
        self.assertEqual(shifted, A.perm_median_p([10, 11, 12, 13, 14, 15], [40, 41, 42, 43, 44, 45]))


class Classification(unittest.TestCase):
    def test_clean_round_has_no_freeze(self):
        self.assertEqual(A.classify(A.freeze_of(rnd(steady()))), "no_freeze")

    def test_idle_tail_gap_without_queue_is_not_a_freeze(self):
        t = steady(10)
        t.append(txn(1, t[-1]["at"] + 0.5))                  # كاتب وحيد بعد فراغ 500ms: لا أحد ينتظر
        self.assertEqual(A.classify(A.freeze_of(rnd(t))), "no_freeze")

    def test_commit_stall(self):
        t = stalled_queue(commit=120.0)                    # التزام واحد بطيء ⇒ الجميع خلفه
        fr = A.freeze_of(rnd(t))
        self.assertEqual(A.classify(fr), "commit_stall")
        self.assertEqual(fr["root"]["w"], 2)
        self.assertGreaterEqual(fr["queued"], A.QUEUE_MIN)

    def test_client_gap_with_runqueue_delay_is_cpu(self):
        t = stalled_queue(gap=80.0, rq_after=70.0)
        self.assertEqual(A.classify(A.freeze_of(rnd(t))), "client_gap_cpu")

    def test_client_gap_without_runqueue_delay_is_other(self):
        t = stalled_queue(gap=80.0, rq_after=1.0)
        self.assertEqual(A.classify(A.freeze_of(rnd(t))), "client_gap_other")

    def test_handoff_latency(self):
        # لا إمساك طويل؛ التسليم للتالي تأخر 90ms بعد انتهاء السابق (أو إدراجه بطيء).
        t = steady()
        for k in range(10, 20):                         # كلهم بدأوا ينتظرون قبل نهاية السابق، لكن الحيازة التالية تأخرت 90ms
            t[k] = txn(k % 5, t[9]["at"] + 0.001 + (k - 10) * 0.0005, wait=92.0 + (k - 10) * 3.0)
        fr = A.freeze_of(rnd(t))
        self.assertEqual(A.classify(fr), "handoff_latency")


class Report(unittest.TestCase):
    def _write(self, root, variant, repeat, rounds):
        d = os.path.join(root, f"{variant}-{repeat}")
        os.makedirs(d)
        payload = {"host": {"variant": variant, "repeat": repeat, "nproc": 4, "cpu_model": "x"}, "pg": {"server_version": "16"}, "rounds": rounds}
        with open(os.path.join(d, "cops-h1-1-diag.json"), "w", encoding="utf-8") as fh:
            json.dump(payload, fh)

    def test_report_compares_variants_and_lists_stalled_rounds(self):
        stalled = stalled_queue(commit=120.0)
        with tempfile.TemporaryDirectory() as root:
            for rep in range(1, 4):
                self._write(root, "main", rep, [rnd(steady(), added=12.0)])
                self._write(root, "pr1972", rep, [rnd(stalled if rep == 1 else steady(), added=80.0 if rep == 1 else 12.0, slow=12 if rep == 1 else 0, over=rep == 1)])
            runs = A.load_runs(root)
            self.assertEqual(len(runs), 6)
            text = A.build_report(runs)
        self.assertIn("main", text)
        self.assertIn("pr1972", text)
        self.assertIn("commit_stall", text)
        self.assertIn("Fisher", text)
        self.assertIn("1/3", text)       # فشل وظيفة واحدة من ثلاث في pr1972


if __name__ == "__main__":
    unittest.main()

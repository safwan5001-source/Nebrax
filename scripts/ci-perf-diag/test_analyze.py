import json
import os
import tempfile
import unittest

import analyze as A


def txn(w, at, wait=1.0, gap=0.05, commit=1.0, rq_wait=0.0, rq_gap=0.0, rq_commit=0.0):
    return {"w": w, "at": at, "wait_ms": wait, "gap_ms": gap, "commit_ms": commit, "rq_wait_ms": rq_wait, "rq_gap_ms": rq_gap, "rq_commit_ms": rq_commit}


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
            "over_gate_budget": over, "txns": txns, "transactions": len(txns),
            "integrity": {"errors": [], "sequence_complete": True, "per_writer_complete": True}, "writers": [{"w": i, "pg_pid": 1000 + i, "ru": {"nivcsw": 3 * i}} for i in range(5)]}
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
        t = stalled_queue(gap=80.0, rq_gap=70.0)
        self.assertEqual(A.classify(A.freeze_of(rnd(t))), "client_gap_cpu")

    def test_client_gap_without_runqueue_delay_is_other(self):
        t = stalled_queue(gap=80.0, rq_gap=1.0)
        self.assertEqual(A.classify(A.freeze_of(rnd(t))), "client_gap_other")

    def test_stall_of_the_very_first_transaction_is_not_hidden(self):
        t = stalled_queue(stall_at=0, commit=120.0)
        fr = A.freeze_of(rnd(t))
        self.assertEqual(A.classify(fr), "commit_stall")
        self.assertGreaterEqual(fr["freeze_ms"], 100.0)

    def test_commit_phase_runqueue_delay_is_not_charged_to_the_client_gap(self):
        # فجوة العميل طويلة لكن تأخر الطابور وقع بعد COMMIT (rq_commit) لا داخل الفجوة ⇒ ليس client_gap_cpu.
        t = stalled_queue(gap=80.0, rq_gap=1.0, rq_commit=70.0)
        self.assertEqual(A.classify(A.freeze_of(rnd(t))), "client_gap_other")

    def test_idle_think_time_before_the_queue_forms_is_not_counted_as_freeze(self):
        # سيناريو Codex: stalled_queue(commit=120) ثم 4 معاملات قصيرة تبدأ بعد 180ms من آخر التزام وتنتظر 1–4ms فقط.
        t = stalled_queue(commit=120.0)
        last_end = max(A.txn_end(x) for x in t)
        for i in range(4):
            t.append(txn(i % 5, last_end + 0.18 + i * 0.0002, wait=1.0 + i))
        fr = A.freeze_of(rnd(t))
        self.assertEqual(A.classify(fr), "commit_stall")
        self.assertLess(fr["freeze_ms"], 200.0)                       # لا يضمّ فراغ الـ180ms
        short_only = A.freeze_of(rnd(steady() + t[20:]))
        self.assertTrue(short_only is None or short_only["freeze_ms"] < 30.0)

    def test_phase_durations_are_clipped_to_the_freeze_window(self):
        # سيناريو Codex: gap=100 ثم commit=80 للجذر؛ الطابور يتكوّن عند 110–113ms، أي أن نافذة التجمّد كلها داخل COMMIT.
        base = 100.0
        root = txn(2, base, wait=1.0, gap=100.0, commit=80.0)
        t = [root]
        for i in range(4):
            at = base + 0.110 + i * 0.001
            t.append(txn(3, at, wait=(A.txn_end(root) + 0.001 + i * 0.002 - at) * 1000.0, gap=0.05, commit=1.0))
        fr = A.freeze_of(rnd(t))
        self.assertAlmostEqual(fr["freeze_ms"], 69.0, delta=1.0)
        self.assertAlmostEqual(fr["gap_win_ms"], 0.0, delta=0.5)
        self.assertAlmostEqual(fr["commit_win_ms"], 69.0, delta=1.0)
        self.assertEqual(A.classify(fr), "commit_stall")

    def test_explicit_end_timestamp_exposes_a_pause_the_components_do_not_cover(self):
        # توقف بين مكوّنين مسجَّلين (القفل ممسوك) لا تلتقطه مجموع المكوّنات؛ الطابع الفعلي `end` يكشفه ولا يُصنَّف «بلا تجمّد».
        t = stalled_queue(commit=1.0)
        stalled = t[10]
        stalled["end"] = stalled["at"] + 0.150
        for k in range(11, 20):
            t[k]["wait_ms"] += 150.0
        fr = A.freeze_of(rnd(t))
        self.assertGreaterEqual(fr["freeze_ms"], 100.0)
        self.assertEqual(A.classify(fr), "mixed")
        self.assertEqual(A.txn_end(stalled), stalled["end"])

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
        payload = {"host": {"variant": variant, "repeat": repeat, "nproc": 4, "cpu_model": "x"}, "pg": {"server_version": "16"},
                   "workload": {"writers": 5, "per_writer": 4}, "rounds": rounds}
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

    def test_integrity_failed_rounds_are_excluded_and_reported_not_counted_as_clean(self):
        incomplete = rnd(steady(), added=3.0)                       # p95 منخفض زيفاً لأن كاتباً فشل
        incomplete["integrity"] = {"errors": ["العملية 3: RuntimeException x"], "sequence_complete": False, "per_writer_complete": False}
        short = rnd(steady(10), added=2.0)                          # عيّنات أقل من المتوقع (20)
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "main", 1, [incomplete, short])
            self._write(root, "main", 2, [rnd(steady(), added=12.0)])
            text = A.build_report(A.load_runs(root), expect=2)
        self.assertIn("جولة غير صالحة استُبعدت", text)
        self.assertIn("writer_errors", text)
        self.assertIn("main#1: 2", text)
        self.assertIn("وسيط p95 للجولات النظيفة", text)
        self.assertNotIn("| main | 2 |", text)                        # التشغيل 1 لا يُحتسب وظيفةً ناجحة؛ يبقى تشغيل صالح واحد فقط

    def test_missing_runs_are_reported_when_expected_count_is_given(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "main", 1, [rnd(steady(), added=12.0)])
            self._write(root, "pr1972", 1, [rnd(steady(), added=12.0)])
            self._write(root, "pr1972", 2, [rnd(steady(), added=12.0)])
            text = A.build_report(A.load_runs(root), expect=2)
        self.assertIn("المتغيّر main: وصل 1 من 2", text)
        self.assertNotIn("المتغيّر pr1972: وصل", text)

    def test_a_planned_variant_with_no_artifacts_is_reported_not_silently_dropped(self):
        with tempfile.TemporaryDirectory() as root:
            self._write(root, "main", 1, [rnd(steady(), added=12.0)])
            text = A.build_report(A.load_runs(root), expect=1, expected_variants=["main", "pr1972"])
        self.assertIn("المتغيّر pr1972: وصل 0 من 1", text)
        self.assertNotIn("كل التشغيلات المتوقعة وصلت", text)
        self.assertIn("pr1972", text)


if __name__ == "__main__":
    unittest.main()

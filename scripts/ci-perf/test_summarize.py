"""اختبارات مُلخِّص مقاييس أداء COPS-H1-1: يعرض كل شيء بما فيه المستبعد، ويفشل على غياب الدليل فقط — لا على قيمة."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("summarize_feed_perf.py")


def rnd(n, add=10.0, active=170.0, total=120.0):
    return {"round": n, "active_window_events_per_second": active, "events_per_second": total, "startup_overhead_s": 0.25,
            "contended_p50_ms": 3.0, "contended_p95_ms": add + 2, "added_p95_ms": add, "cpu_busy_pct": 55.0, "cpu_iowait_pct": 0.1,
            "cpu_steal_pct": 0.0, "loadavg_1m_before": 0.5, "achieved_vs_offered_target_pct": 130.0}


def gate(**over):
    g = {"p95_budget_ms": 50.0, "offered_rate_target_per_s": 130.0, "baseline_p50_ms": 2.0, "test_duration_s": 9.0,
         "warmup": {**rnd(0, 40.0, 150.0, 60.0), "excluded_from_evaluation": True},
         "rounds": [rnd(1), rnd(2), rnd(3)],
         "variance": {"added_p95_ms": {"min": 10, "max": 10, "mean": 10, "stdev": 0}, "active_window_events_per_second": {"min": 170, "max": 170},
                      "total_round_events_per_second": {"min": 120, "max": 120}}}
    g.update(over)
    return g


BURST = {"burst": {"events_per_second": 170.0, "active_window_events_per_second": 200.0, "contended_p50_ms": 40.0, "contended_p95_ms": 100.0,
                   "added_p95_ms": 98.0, "cpu_busy_pct": 90.0, "cores": 4}}


class Summarize(unittest.TestCase):
    def run_in(self, files):
        with tempfile.TemporaryDirectory() as d:
            for name, content in files.items():
                Path(d, name).write_text(json.dumps(content) if not isinstance(content, str) else content)
            summary = Path(d, "summary.md")
            p = subprocess.run([sys.executable, str(SCRIPT), d, "--summary-file", str(summary)], capture_output=True, text=True)
            return p.returncode, p.stdout, (summary.read_text() if summary.exists() else "")

    def test_complete_evidence_is_rendered_with_the_excluded_warmup_disclosed(self):
        rc, out, summary = self.run_in({"cops-h1-1-realistic_load_gate.json": gate(), "cops-h1-1-saturated_burst_diagnostic.json": BURST})
        self.assertEqual(rc, 0, out)
        self.assertIn("مستبعد من التقييم", summary)
        self.assertIn("نافذة النشاط", summary)
        self.assertIn("تشخيص الاندفاع المشبَع", summary)
        self.assertEqual(summary.count("| 0 — إحماء"), 1)

    def test_a_slow_measurement_is_displayed_not_hidden_and_does_not_fail_the_summary(self):
        slow = gate(rounds=[rnd(1, 170.0), rnd(2), rnd(3)])
        rc, _, summary = self.run_in({"cops-h1-1-realistic_load_gate.json": slow, "cops-h1-1-saturated_burst_diagnostic.json": BURST})
        self.assertEqual(rc, 0)
        self.assertIn("**170.0**", summary)

    def test_missing_gate_file_fails(self):
        rc, out, _ = self.run_in({"cops-h1-1-saturated_burst_diagnostic.json": BURST})
        self.assertEqual(rc, 2)
        self.assertIn("realistic_load_gate", out)

    def test_missing_burst_file_fails(self):
        rc, _, _ = self.run_in({"cops-h1-1-realistic_load_gate.json": gate()})
        self.assertEqual(rc, 2)

    def test_empty_file_fails(self):
        rc, _, _ = self.run_in({"cops-h1-1-realistic_load_gate.json": "", "cops-h1-1-saturated_burst_diagnostic.json": BURST})
        self.assertEqual(rc, 2)

    def test_wrong_round_count_fails(self):
        rc, out, _ = self.run_in({"cops-h1-1-realistic_load_gate.json": gate(rounds=[rnd(1), rnd(2)]), "cops-h1-1-saturated_burst_diagnostic.json": BURST})
        self.assertEqual(rc, 2)
        self.assertIn("2 جولات", out)

    def test_warmup_must_be_disclosed_as_excluded(self):
        bad = gate(warmup=rnd(0))
        rc, out, _ = self.run_in({"cops-h1-1-realistic_load_gate.json": bad, "cops-h1-1-saturated_burst_diagnostic.json": BURST})
        self.assertEqual(rc, 2)
        self.assertIn("excluded_from_evaluation", out)

    def test_invalid_json_fails(self):
        rc, _, _ = self.run_in({"cops-h1-1-realistic_load_gate.json": "{not json", "cops-h1-1-saturated_burst_diagnostic.json": BURST})
        self.assertEqual(rc, 2)


if __name__ == "__main__":
    unittest.main()

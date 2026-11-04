"""التجربة التشخيصية تطابق حمل بوابة COPS-H1-1 الحالية حرفياً (الكتّاب/المعاملات/التفكير/البذور/حد الجولات). يفشل إن انحرف أحدهما."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GATE = (ROOT / "tests" / "Feature" / "CommerceOrderEventsPostgresTest.php").read_text(encoding="utf-8")
DIAG = (ROOT / "tests" / "Feature" / "CommerceOrderEventsStallDiagnosticTest.php").read_text(encoding="utf-8")


def const(src, name):
    m = re.search(rf"const {name} = ([^;]+);", src)
    return m.group(1).strip() if m else None


class WorkloadParity(unittest.TestCase):
    def test_budget_think_and_shape_match_the_gate(self):
        self.assertEqual(const(GATE, "P95_BUDGET_MS"), const(DIAG, "GATE_P95_BUDGET_MS"))
        self.assertEqual(const(GATE, "REALISTIC_THINK_MAX_MS"), const(DIAG, "THINK_MAX_MS"))
        self.assertEqual(const(DIAG, "WRITERS"), "20")
        self.assertEqual(const(DIAG, "PER_WRITER"), "10")

    def test_gate_rounds_use_the_same_writers_per_writer_and_seeds(self):
        self.assertIn("writers: 20, perWriter: 10, thinkMaxMs: self::REALISTIC_THINK_MAX_MS, seed: 0)", GATE)                    # إحماء
        self.assertIn("writers: 20, perWriter: 10, thinkMaxMs: self::REALISTIC_THINK_MAX_MS, seed: 1000 * $round)", GATE)         # جولات 1–3
        self.assertIn("$this->measureRound(seed: 1000 * $round, sampled: $sampled)", DIAG)                                      # نفس البذور
        self.assertEqual(const(DIAG, "GATE_EQUIV_ROUNDS"), "3")
        self.assertIn("foreach ([1, 2, 3] as $round)", GATE)

    def test_writers_seed_per_process_identically(self):
        self.assertIn("mt_srand($seed + $i);", GATE)
        self.assertIn("mt_srand($seed + $i);", DIAG)


if __name__ == "__main__":
    unittest.main()

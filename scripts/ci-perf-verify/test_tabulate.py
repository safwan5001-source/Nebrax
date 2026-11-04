import json
import tempfile
import unittest
from pathlib import Path

import tabulate as T


def make_run(root: Path, name: str, passed=True, rounds=(14.2, 15.1, 13.0), fs="tmpfs", with_gate=True):
    d = root / name
    (d / "pgsql-watchdog").mkdir(parents=True)
    (d / "test-output-pgsql-perf.txt").write_text(("Time: 00:25.1, Memory: 40.00 MB\n\nOK (2 tests, 40 assertions)\n" if passed else "Time: 00:25.1\n\nFAILURES!\n"))
    if with_gate:
        (d / "pgsql-watchdog" / T.GATE).write_text(json.dumps({"p95_budget_ms": 50, "warmup": {"added_p95_ms": 30.0}, "rounds": [{"added_p95_ms": x} for x in rounds]}))
    (d / "pgsql-watchdog" / "storage-evidence.txt").write_text(f"pgdata_fstype={fs} relation_file_fstype={fs} pg_wal_fstype={fs}\n")
    (d / "pgsql-watchdog" / "perf-environment.txt").write_text("runner: nproc=4 loadavg_before=0.1")


class Tabulate(unittest.TestCase):
    def test_counts_and_stats(self):
        with tempfile.TemporaryDirectory() as r:
            root = Path(r)
            make_run(root, "feed-perf-metrics-1")
            make_run(root, "feed-perf-metrics-2", passed=False, rounds=(80.0, 12.0, 11.0))
            text = T.build([T.read_run(p) for p in sorted(root.iterdir())], 2)
        self.assertIn("نجح الاختبار الحاكم:** 1/2", text)
        self.assertIn("أقصى **80.0ms**", text)
        self.assertIn("❌ فشل", text)

    def test_missing_evidence_is_declared_and_exit_nonzero(self):
        with tempfile.TemporaryDirectory() as r:
            root = Path(r)
            make_run(root, "feed-perf-metrics-1")
            make_run(root, "feed-perf-metrics-2", with_gate=False)
            rep = root / "rep.md"
            code = T.main(["x", str(root), str(rep), "--expect=3"])
            text = rep.read_text()
        self.assertEqual(code, 2)
        self.assertIn("أدلة ناقصة", text)
        self.assertIn("مفقود كلياً:** 1", text)

    def test_non_tmpfs_is_flagged(self):
        with tempfile.TemporaryDirectory() as r:
            root = Path(r)
            make_run(root, "feed-perf-metrics-1", fs="overlay")
            text = T.build([T.read_run(p) for p in sorted(root.iterdir())], 1)
        self.assertIn("على tmpfs:** 0/1", text)
        self.assertIn("مخالفون", text)


if __name__ == "__main__":
    unittest.main()

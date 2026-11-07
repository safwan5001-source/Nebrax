"""PG-SHARD-GATE-1: the exactly-once proof must fail on every way a test can be dropped, duplicated or misattributed.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import shard_proof as sp

FILES = [f"tests/Feature/F{i}Test.php" for i in range(8)]


def tests_of(f):  # two tests per file, stable ids
    stem = Path(f).stem
    return [f"Tests\\Feature\\{stem}::test_a", f"Tests\\Feature\\{stem}::test_b with data set #0"]


def junit(files, fail=None):
    cases = []
    for f in files:
        stem = Path(f).stem
        cases.append(f'<testsuite name="Tests\\Feature\\{stem}" file="/tmp/nibras-app/{f}">')
        for t in tests_of(f):
            name = t.split("::", 1)[1]
            body = "<failure>boom</failure>" if fail == t else ""
            cases.append(f'<testcase name="{name}" class="Tests\\Feature\\{stem}" file="/tmp/nibras-app/{f}">{body}</testcase>')
        cases.append("</testsuite>")
    return '<?xml version="1.0"?><testsuites><testsuite name="all">' + "".join(cases) + "</testsuite></testsuites>"


def listing(files):
    return "Available test(s):\n" + "".join(f" - {t}\n" for f in files for t in tests_of(f))


class Fx:
    """A correct 2-shard run on disk; each test mutates one thing."""

    def __init__(self, n=2):
        self.n = n
        self.d = Path(tempfile.mkdtemp())
        self.parts = {k: [f for f in FILES if sp.assign(f, n, {}) == k - 1] for k in range(1, n + 1)}
        assert all(self.parts.values()), "fixture needs files on every shard"
        for k, fs in self.parts.items():
            s = self.d / f"shard-{k}"
            s.mkdir()
            (s / "all_files.txt").write_text("\n".join(FILES))
            (s / "assigned.txt").write_text("\n".join(fs))
            (s / "inventory.txt").write_text(listing(FILES))
            (s / "planned.txt").write_text(listing(fs))
            (s / "junit.xml").write_text(junit(fs))
        (self.d / "tracked_test_files.txt").write_text("\n".join(FILES))

    def w(self, k, name, text):
        (self.d / f"shard-{k}" / name).write_text(text)

    def errs(self, n=None):
        return sp.verify(self.d, n or self.n, {})

    def close(self):
        shutil.rmtree(self.d, ignore_errors=True)


class ShardProof(unittest.TestCase):
    def setUp(self):
        self.fx = Fx()
        self.addCleanup(self.fx.close)

    def has(self, errs, needle):
        self.assertTrue(any(needle in e for e in errs), errs)

    def test_correct_run_passes(self):
        self.assertEqual(self.fx.errs(), [])

    def test_three_shards_pass_too(self):
        fx = Fx(3)
        self.addCleanup(fx.close)
        self.assertEqual(fx.errs(), [])

    # ── dropped ────────────────────────────────────────────────────────────────────────────────────────────
    def test_dropped_file_assignment(self):
        k = 1
        fs = self.fx.parts[k]
        self.fx.w(k, "assigned.txt", "\n".join(fs[1:]))
        e = self.fx.errs()
        self.has(e, "assigned to no shard (dropped)")
        self.has(e, "differs from the pure assignment function")

    def test_dropped_test_in_plan(self):
        fs = self.fx.parts[1]
        self.fx.w(1, "planned.txt", listing(fs[:-1]))
        self.has(self.fx.errs(), "union of planned tests != unsharded inventory")

    def test_executed_fewer_than_planned(self):
        fs = self.fx.parts[2]
        self.fx.w(2, "junit.xml", junit(fs[:-1]))
        self.has(self.fx.errs(), "executed")

    def test_shard_missing(self):
        shutil.rmtree(self.fx.d / "shard-2")
        e = self.fx.errs()
        self.has(e, "shard directories")
        self.has(e, "shard 2: missing")

    def test_shard_artifact_missing(self):
        (self.fx.d / "shard-1" / "junit.xml").unlink()
        self.has(self.fx.errs(), "shard 1: missing ['junit.xml']")

    def test_tracked_file_not_discovered(self):
        (self.fx.d / "tracked_test_files.txt").write_text("\n".join(FILES + ["tests/Feature/NewTest.php"]))
        self.has(self.fx.errs(), "tracked test files not discovered")

    def test_missing_or_empty_tracked_list(self):
        (self.fx.d / "tracked_test_files.txt").unlink()
        self.has(self.fx.errs(), "tracked_test_files.txt missing")
        (self.fx.d / "tracked_test_files.txt").write_text("")
        self.has(self.fx.errs(), "tracked_test_files.txt is empty")

    def test_empty_inventory_is_not_a_vacuous_pass(self):
        for k in (1, 2):
            self.fx.w(k, "inventory.txt", "Available test(s):\n")
            self.fx.w(k, "planned.txt", "Available test(s):\n")
        self.has(self.fx.errs(), "inventory is empty")

    # ── duplicated ─────────────────────────────────────────────────────────────────────────────────────────
    def test_file_assigned_to_two_shards(self):
        extra = self.fx.parts[2][0]
        self.fx.w(1, "assigned.txt", "\n".join(self.fx.parts[1] + [extra]))
        self.has(self.fx.errs(), "more than one shard (duplicated)")

    def test_test_planned_twice(self):
        fs = self.fx.parts[1]
        self.fx.w(1, "planned.txt", listing(fs) + f" - {tests_of(fs[0])[0]}\n")
        self.has(self.fx.errs(), "duplicated/extra")

    def test_file_listed_twice_in_one_assignment(self):
        fs = self.fx.parts[1]
        self.fx.w(1, "assigned.txt", "\n".join(fs + [fs[0]]))
        self.has(self.fx.errs(), "listed twice")

    def test_executed_file_outside_assignment(self):
        other = self.fx.parts[2][0]
        self.fx.w(1, "junit.xml", junit(self.fx.parts[1][:-1] + [other]))
        self.has(self.fx.errs(), "outside its assignment")

    # ── misattributed / tampered ───────────────────────────────────────────────────────────────────────────
    def test_extra_shard_directory(self):
        shutil.copytree(self.fx.d / "shard-1", self.fx.d / "shard-3")
        self.has(self.fx.errs(), "shard directories")

    def test_assignment_not_the_pure_function(self):
        a, b = self.fx.parts[1][0], self.fx.parts[2][0]
        self.fx.w(1, "assigned.txt", "\n".join([b] + self.fx.parts[1][1:]))
        self.fx.w(2, "assigned.txt", "\n".join([a] + self.fx.parts[2][1:]))
        self.has(self.fx.errs(), "differs from the pure assignment function")

    def test_shards_disagree_on_discovery(self):
        self.fx.w(2, "all_files.txt", "\n".join(FILES[:-1]))
        self.has(self.fx.errs(), "different test-file sets")

    def test_shards_disagree_on_inventory(self):
        self.fx.w(2, "inventory.txt", listing(FILES[:-1]))
        self.has(self.fx.errs(), "different unsharded inventories")

    def test_failing_test(self):
        fs = self.fx.parts[1]
        self.fx.w(1, "junit.xml", junit(fs, fail=tests_of(fs[0])[0]))
        self.has(self.fx.errs(), "failing test")

    def test_unreadable_junit(self):
        self.fx.w(1, "junit.xml", "<testsuites>")
        self.has(self.fx.errs(), "unreadable artifact")

    def test_wrong_declared_count(self):
        self.has(self.fx.errs(3), "shard directories")
        self.has(sp.verify(self.fx.d, 1, {}), "shard count")
        self.has(sp.verify(self.fx.d, 0, {}), "shard count")

    def test_manifest_assignment_is_honoured_and_enforced(self):
        # moving one file via a manifest entry is legitimate only if the shard lists follow it
        f = self.fx.parts[1][0]
        man = {f: 1}
        self.assertTrue(sp.verify(self.fx.d, 2, man))  # lists still use the hash: manifest says shard 2, list says shard 1
        self.fx.w(1, "assigned.txt", "\n".join(self.fx.parts[1][1:]))
        self.fx.w(2, "assigned.txt", "\n".join(self.fx.parts[2] + [f]))
        for k, fs in ((1, self.fx.parts[1][1:]), (2, self.fx.parts[2] + [f])):
            self.fx.w(k, "planned.txt", listing(fs))
            self.fx.w(k, "junit.xml", junit(fs))
        self.assertEqual(sp.verify(self.fx.d, 2, man), [])

    def test_cli_exit_codes(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(sp.main(["--root", str(self.fx.d), "--shards", "2"]), 0)
        self.assertIn("SHARD PROOF OK", buf.getvalue())
        self.fx.w(1, "planned.txt", listing(self.fx.parts[1][:-1]))
        man = self.fx.d / "m.json"
        man.write_text(json.dumps({"assignment": {}}))
        with contextlib.redirect_stdout(buf):
            self.assertEqual(sp.main(["--root", str(self.fx.d), "--shards", "2", "--manifest", str(man)]), 1)
        self.assertIn("SHARD PROOF FAILED", buf.getvalue())

    def test_assign_is_total_and_stable(self):
        for n in (2, 3, 4):
            for f in FILES:
                self.assertIn(sp.assign(f, n, {}), range(n))
                self.assertEqual(sp.assign(f, n, {}), sp.assign(f, n, {}))
        self.assertEqual(sp.assign("x", 2, {"x": 7}), sp.assign("x", 2, {}))  # out-of-range manifest entry is ignored
        self.assertEqual(sp.assign("x", 2, {"x": True}), sp.assign("x", 2, {}))  # a bool is not an index


if __name__ == "__main__":
    unittest.main()

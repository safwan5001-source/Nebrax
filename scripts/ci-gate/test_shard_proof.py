"""PG-SHARD-GATE-1: the exactly-once proof must fail on every way a test can be dropped, duplicated or misattributed.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from xml.sax.saxutils import escape

import shard_proof as sp

FILES = [f"tests/Feature/F{i}Test.php" for i in range(8)]
NS = "Tests\\Feature\\"


def tests_of(f):
    """Three tests per file in the shapes PHPUnit really emits: plain, int data set, string data set (Arabic + quotes + '::')."""
    stem = Path(f).stem
    return [(NS + stem, "test_a", None), (NS + stem, "test_b", "#0"), (NS + stem, "test_c", '"حالة: \'x\' :: y"')]


def tid(t):
    return t[0] + "::" + t[1] + (" with data set " + t[2] if t[2] else "")


def junit(files, fail=None, drop=None, rename=None, extra=(), summary=None):
    """ParaTest/PHPUnit 11 JUnit shape: <testsuites><testsuite name='' tests=N><testsuite name=Class file=...><testcase .../>."""
    body, total = [], 0
    for f in files:
        stem = Path(f).stem
        body.append(f'<testsuite name="{NS}{stem}" file="/tmp/nibras-app/{f}">')
        for t in tests_of(f):
            if drop and t == drop:
                continue
            cls, m, ds = rename.get(t, t) if rename else t
            name = escape(m + (" with data set " + ds if ds else ""), {'"': "&quot;"})
            failure = "<failure>boom</failure>" if fail == t else ""
            body.append(f'<testcase name="{name}" class="{cls}" file="/tmp/nibras-app/{f}">{failure}</testcase>')
            total += 1
        body.append("</testsuite>")
    for (cls, m, ds, f) in extra:
        body.append(f'<testsuite name="{cls}" file="/tmp/nibras-app/{f}"><testcase name="{m}" class="{cls}" file="/tmp/nibras-app/{f}"/></testsuite>')
        total += 1
    claimed = total if summary is None else summary
    return ('<?xml version="1.0" encoding="UTF-8"?><testsuites name="PHPUnit tests">'
            f'<testsuite name="" tests="{claimed}">' + "".join(body) + "</testsuite></testsuites>")


def listing(files, drop=None, add=(), header=True):
    out = "PHPUnit 11.5.57 by Sebastian Bergmann and contributors.\n\n" + ("Available tests:\n" if header else "")
    for f in files:
        for t in tests_of(f):
            if drop and t == drop:
                continue
            out += " - " + t[0] + "::" + t[1] + (t[2] or "") + "\n"
    for line in add:
        out += f" - {line}\n"
    return out


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
        (self.d / f"shard-{k}" / name).write_text(text, encoding="utf-8")

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
            self.fx.w(k, "inventory.txt", "Available tests:\n")
            self.fx.w(k, "planned.txt", "Available tests:\n")
        e = self.fx.errs()
        self.has(e, "inventory is empty")
        self.has(e, "planned no tests")

    # ── duplicated ─────────────────────────────────────────────────────────────────────────────────────────
    def test_file_assigned_to_two_shards(self):
        extra = self.fx.parts[2][0]
        self.fx.w(1, "assigned.txt", "\n".join(self.fx.parts[1] + [extra]))
        self.has(self.fx.errs(), "more than one shard (duplicated)")

    def test_test_planned_twice(self):
        fs = self.fx.parts[1]
        t = tests_of(fs[0])[0]
        self.fx.w(1, "planned.txt", listing(fs, add=[t[0] + "::" + t[1]]))
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

    # ── identity (PG-SHARD-GATE-2): same counts, different tests ───────────────────────────────────────────
    def test_renamed_executed_test_with_identical_count(self):
        fs = self.fx.parts[1]
        t = tests_of(fs[0])[0]
        self.fx.w(1, "junit.xml", junit(fs, rename={t: (t[0], "test_a_renamed", None)}))
        e = self.fx.errs()
        self.has(e, "executed tests differ from the plan")
        self.has(e, "test_a_renamed")
        self.assertFalse(any("executed " in x and "but planned" in x for x in e))  # the count alone would have passed

    def test_data_set_key_changed_with_identical_count(self):
        fs = self.fx.parts[2]
        t = tests_of(fs[0])[1]
        self.fx.w(2, "junit.xml", junit(fs, rename={t: (t[0], t[1], "#1")}))
        self.has(self.fx.errs(), "executed tests differ from the plan")

    def test_string_data_set_label_changed_with_identical_count(self):
        fs = self.fx.parts[2]
        t = tests_of(fs[0])[2]
        self.fx.w(2, "junit.xml", junit(fs, rename={t: (t[0], t[1], '"other label"')}))
        self.has(self.fx.errs(), "executed tests differ from the plan")

    def test_one_missing_and_one_duplicated_with_identical_count(self):
        fs = self.fx.parts[1]
        t0, t1 = tests_of(fs[0])[0], tests_of(fs[0])[1]
        # t0 never runs; t1 runs twice: 3 tests/file stays 3 tests/file overall
        self.fx.w(1, "junit.xml", junit(fs, drop=t0, extra=[(t1[0], t1[1] + " with data set #0", None, fs[0])]))
        e = self.fx.errs()
        self.has(e, "not executed")
        self.has(e, "unplanned/duplicated")

    def test_swapped_between_shards_with_identical_counts(self):
        a, b = self.fx.parts[1][0], self.fx.parts[2][0]
        ta, tb = tests_of(a)[0], tests_of(b)[0]
        self.fx.w(1, "junit.xml", junit(self.fx.parts[1], drop=ta, extra=[(tb[0], tb[1], None, b)]))
        self.fx.w(2, "junit.xml", junit(self.fx.parts[2], drop=tb, extra=[(ta[0], ta[1], None, a)]))
        e = self.fx.errs()
        self.has(e, "executed in the wrong shard")
        self.has(e, "outside its assignment")

    def test_test_executed_in_the_wrong_shard_only(self):
        other = self.fx.parts[2][0]
        t = tests_of(other)[0]
        self.fx.w(1, "junit.xml", junit(self.fx.parts[1], extra=[(t[0], t[1], None, other)]))
        self.has(self.fx.errs(), "executed in the wrong shard")

    def test_same_test_executed_twice_in_a_shard(self):
        fs = self.fx.parts[1]
        t = tests_of(fs[0])[0]
        self.fx.w(1, "junit.xml", junit(fs, extra=[(t[0], t[1], None, fs[0])]))
        self.has(self.fx.errs(), "unplanned/duplicated")

    def test_planned_identity_differs_from_the_inventory_with_the_same_count(self):
        fs = self.fx.parts[1]
        t = tests_of(fs[0])[0]
        self.fx.w(1, "planned.txt", listing(fs, drop=t, add=[NS + "Ghost::test_ghost"]))
        self.fx.w(1, "junit.xml", junit(fs, drop=t, extra=[(NS + "Ghost", "test_ghost", None, fs[0])]))
        self.has(self.fx.errs(), "union of planned tests != unsharded inventory")

    # ── identity formats (verified against real PHPUnit 11 / ParaTest output) ───────────────────────────────
    def test_list_and_junit_forms_reduce_to_one_identity(self):
        ids, probs = sp.parse_list(listing(["tests/Feature/F0Test.php"]))
        self.assertEqual(probs, [])
        self.assertEqual(ids, [tid(t) for t in tests_of("tests/Feature/F0Test.php")])
        self.assertEqual(sp.canonical("A\\B", "m", None), "A\\B::m")
        self.assertEqual(sp.canonical("A\\B", "m", "#3"), "A\\B::m with data set #3")

    def test_real_phpunit_list_lines(self):
        text = ("PHPUnit 11.5.57 by Sebastian Bergmann and contributors.\n\nAvailable tests:\n"
                " - Tests\\Unit\\ExampleTest::test_that_true_is_true\n"
                " - Tests\\Feature\\ApplicationOperationClassifierTest::verified_read_actions_are_classified_as_read#4\n"
                ' - Tests\\Feature\\AiAnswerGuardTest::test_numbers_must_come_from_the_digest"arabic-indic digits"\n')
        ids, probs = sp.parse_list(text)
        self.assertEqual(probs, [])
        self.assertEqual(ids[1], "Tests\\Feature\\ApplicationOperationClassifierTest::verified_read_actions_are_classified_as_read with data set #4")
        self.assertEqual(ids[2], 'Tests\\Feature\\AiAnswerGuardTest::test_numbers_must_come_from_the_digest with data set "arabic-indic digits"')

    # ── artifacts: incomplete or corrupt ───────────────────────────────────────────────────────────────────
    def test_list_without_header_is_not_a_smaller_suite(self):
        self.fx.w(1, "planned.txt", listing(self.fx.parts[1], header=False))
        self.has(self.fx.errs(), "missing header")

    def test_truncated_list_line(self):
        self.fx.w(2, "inventory.txt", listing(FILES) + " - Tests\\Feature\\F0Te")
        self.has(self.fx.errs(), "unparseable line")

    def test_garbage_after_header(self):
        self.fx.w(1, "planned.txt", listing(self.fx.parts[1]) + "Fatal error: out of memory\n")
        self.has(self.fx.errs(), "unparseable line")

    def test_junit_truncated_mid_file(self):
        text = junit(self.fx.parts[1])
        self.fx.w(1, "junit.xml", text[: len(text) // 2])
        self.has(self.fx.errs(), "unreadable artifact")

    def test_junit_valid_xml_but_summary_disagrees(self):
        fs = self.fx.parts[1]
        self.fx.w(1, "junit.xml", junit(fs, summary=len(fs) * 3 + 5))
        self.has(self.fx.errs(), "summary says")

    def test_junit_with_zero_testcases(self):
        self.fx.w(1, "junit.xml", '<testsuites><testsuite name="" tests="0"/></testsuites>')
        self.has(self.fx.errs(), "no testcases")

    def test_junit_with_wrong_root(self):
        self.fx.w(1, "junit.xml", "<html><body/></html>")
        self.has(self.fx.errs(), "unexpected root element")

    def test_junit_testcase_without_class(self):
        text = junit(self.fx.parts[1]).replace('class="Tests\\Feature\\F', 'klass="Tests\\Feature\\F', 1)
        self.fx.w(1, "junit.xml", text)
        self.has(self.fx.errs(), "lacks class or name")

    def test_every_artifact_may_be_empty_or_undecodable(self):
        for name in ("all_files.txt", "assigned.txt", "inventory.txt", "planned.txt", "junit.xml"):
            with self.subTest(name=name):
                fx = Fx()
                self.addCleanup(fx.close)
                fx.w(1, name, "")
                self.has(fx.errs(), "empty artifact")
        self.fx.d.joinpath("shard-1", "planned.txt").write_bytes(b"\xff\xfe\x00bad")
        self.has(self.fx.errs(), "unreadable artifact")

    def test_failure_in_any_artifact_blocks_the_cross_shard_checks(self):
        (self.fx.d / "shard-2" / "junit.xml").unlink()
        e = self.fx.errs()
        self.has(e, "shard 2: missing")
        self.assertEqual(sum("union of planned" in x for x in e), 0)  # never a partial "OK"

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

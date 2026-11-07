"""PG-SHARD-ADDITIVE-1: the shard selector places every test file on exactly one shard and fails closed.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import select_shard as ss
import shard_proof as sp

PHPUNIT = """<?xml version="1.0" encoding="UTF-8"?>
<phpunit bootstrap="vendor/autoload.php">
    <testsuites>
        <testsuite name="Unit">
            <directory>tests/Unit</directory>
        </testsuite>
        <testsuite name="Feature">
            <directory>tests/Feature</directory>
        </testsuite>
    </testsuites>
    <source><include><directory>app</directory></include></source>
</phpunit>
"""
FEATURE = [f"tests/Feature/A{i}Test.php" for i in range(12)]


def make_app(extra=()):
    d = Path(tempfile.mkdtemp())
    (d / "tests/Feature").mkdir(parents=True)
    (d / "tests/Unit").mkdir(parents=True)
    (d / "tests/Fixtures").mkdir(parents=True)
    for f in [*FEATURE, "tests/Unit/ExampleTest.php", *extra]:
        p = d / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("<?php\n")
    (d / "tests/Feature/Helper.php").write_text("<?php\n")          # not a test class
    (d / "tests/Fixtures/NotATest.php").write_text("<?php\n")        # outside the suite dirs
    (d / "phpunit.xml").write_text(PHPUNIT)
    return d


class SelectShard(unittest.TestCase):
    def setUp(self):
        self.app = make_app()
        self.out = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.app, True)
        self.addCleanup(shutil.rmtree, self.out, True)

    def run_shard(self, k, n=2, manifest=None):
        return ss.select(self.app, k, n, manifest or {}, self.out / f"s{k}")

    def test_discovery_matches_phpunit_defaults(self):
        found = ss.discover(self.app)
        self.assertEqual(found, sorted([*FEATURE, "tests/Unit/ExampleTest.php"]))

    def test_discovery_is_recursive(self):
        app = make_app(extra=["tests/Feature/Sub/DeepTest.php"])
        self.addCleanup(shutil.rmtree, app, True)
        self.assertIn("tests/Feature/Sub/DeepTest.php", ss.discover(app))

    def test_every_file_is_on_exactly_one_shard(self):
        for n in (2, 3):
            mine = []
            for k in range(1, n + 1):
                app = make_app()
                self.addCleanup(shutil.rmtree, app, True)
                ss.select(app, k, n, {}, self.out / f"n{n}k{k}")
                mine.append((self.out / f"n{n}k{k}" / "assigned.txt").read_text().split())
            flat = [f for part in mine for f in part]
            self.assertEqual(sorted(flat), ss.discover(self.app))
            self.assertEqual(len(flat), len(set(flat)))

    def test_assignment_is_the_proof_functions_assignment(self):
        self.run_shard(1)
        mine = (self.out / "s1" / "assigned.txt").read_text().split()
        self.assertEqual(mine, [f for f in ss.discover(self.app) if sp.assign(f, 2, {}) == 0])

    def test_manifest_overrides_the_hash_and_unknown_files_fall_back(self):
        target = FEATURE[0]
        hashed = sp.assign(target, 2, {})            # 0-based shard the hash picks
        moved = 1 - hashed                           # the manifest sends it to the other shard
        home = hashed + 1                            # 1-based shard that would have run it
        info = self.run_shard(home, manifest={target: moved})
        self.assertNotIn(target, (self.out / f"s{home}" / "assigned.txt").read_text().split())
        self.assertGreater(info["by_hash_fallback"], 0)
        other = make_app()
        self.addCleanup(shutil.rmtree, other, True)
        ss.select(other, moved + 1, 2, {target: moved}, self.out / "other")
        self.assertIn(target, (self.out / "other" / "assigned.txt").read_text().split())

    def test_phpunit_xml_lists_only_the_shards_files_and_the_original_is_kept(self):
        self.run_shard(1)
        mine = (self.out / "s1" / "assigned.txt").read_text().split()
        cfg = (self.app / "phpunit.xml").read_text()
        self.assertEqual((self.app / "phpunit.xml.orig").read_text(), PHPUNIT)
        self.assertEqual(cfg.count("<testsuites>"), 1)
        self.assertEqual([l.strip()[6:-7] for l in cfg.splitlines() if l.strip().startswith("<file>")], mine)
        self.assertNotIn("<directory>tests/Feature</directory>", cfg)
        self.assertIn('<source><include><directory>app</directory></include></source>', cfg)  # the rest is untouched

    def test_every_test_file_stays_on_disk(self):
        before = ss.discover(self.app)
        self.run_shard(2)
        self.assertEqual(ss.discover(self.app), before)

    def test_all_files_lists_everything_discovered_on_every_shard(self):
        self.run_shard(1)
        self.run_shard(2)
        a = (self.out / "s1" / "all_files.txt").read_text()
        self.assertEqual(a, (self.out / "s2" / "all_files.txt").read_text())

    # ── fail closed ────────────────────────────────────────────────────────────────────────────────────────
    def test_bad_shard_indexes(self):
        for k, n in ((0, 2), (3, 2), (1, 1), (-1, 2)):
            with self.assertRaises(SystemExit):
                ss.select(self.app, k, n, {}, self.out / "x")

    def test_no_test_files(self):
        empty = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, empty, True)
        (empty / "phpunit.xml").write_text(PHPUNIT)
        with self.assertRaises(SystemExit):
            ss.select(empty, 1, 2, {}, self.out / "x")

    def test_a_shard_with_no_files_is_an_error(self):
        app = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, app, True)
        (app / "tests/Feature").mkdir(parents=True)
        (app / "tests/Feature/OnlyTest.php").write_text("<?php\n")
        (app / "phpunit.xml").write_text(PHPUNIT)
        only = "tests/Feature/OnlyTest.php"
        empty_k = 2 - sp.assign(only, 2, {})  # the shard that does NOT get the single file
        with self.assertRaises(SystemExit):
            ss.select(app, empty_k, 2, {}, self.out / "x")
        self.assertEqual((app / "phpunit.xml").read_text(), PHPUNIT)  # nothing was rewritten

    def test_phpunit_xml_without_exactly_one_testsuites_block(self):
        for bad in ("<phpunit></phpunit>", PHPUNIT.replace("</testsuites>", "</testsuites>\n<testsuites></testsuites>")):
            (self.app / "phpunit.xml").write_text(bad)
            with self.assertRaises(SystemExit):
                self.run_shard(1)
            self.assertEqual((self.app / "phpunit.xml").read_text(), bad)

    def test_manifest_loading(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, True)
        with self.assertRaises(SystemExit):
            ss.load_manifest(d / "missing.json")
        (d / "bad.json").write_text(json.dumps({"version": 2, "assignment": {}}))
        with self.assertRaises(SystemExit):
            ss.load_manifest(d / "bad.json")
        (d / "bad2.json").write_text(json.dumps({"version": 1, "assignment": []}))
        with self.assertRaises(SystemExit):
            ss.load_manifest(d / "bad2.json")
        (d / "ok.json").write_text(json.dumps({"version": 1, "assignment": {"a": 0}}))
        self.assertEqual(ss.load_manifest(d / "ok.json"), {"a": 0})

    def test_cli(self):
        rc = ss.main(["--app", str(self.app), "--shard", "1", "--count", "2",
                      "--manifest", str(Path(ss.__file__).with_name("pg-shards.json")), "--out", str(self.out / "cli")])
        self.assertEqual(rc, 0)


class CommittedManifest(unittest.TestCase):
    """The committed assignment is well-formed and never exceeds the shard count."""

    def test_shape(self):
        m = json.loads(Path(ss.__file__).with_name("pg-shards.json").read_text(encoding="utf-8"))
        self.assertEqual(m["version"], 1)
        self.assertEqual(m["shards"], 2)
        vals = set(m["assignment"].values())
        self.assertEqual(vals, {0, 1})
        self.assertTrue(all(isinstance(v, int) and not isinstance(v, bool) for v in m["assignment"].values()))
        self.assertTrue(all(k.startswith(("tests/Feature/", "tests/Unit/")) and k.endswith("Test.php") for k in m["assignment"]))

    def test_balanced_by_file_count(self):
        m = json.loads(Path(ss.__file__).with_name("pg-shards.json").read_text(encoding="utf-8"))["assignment"]
        a, b = list(m.values()).count(0), list(m.values()).count(1)
        self.assertLess(abs(a - b), max(a, b) * 0.05)


if __name__ == "__main__":
    unittest.main()

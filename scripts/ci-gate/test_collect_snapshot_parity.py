"""PG-SHARD final closure: the Horizon collector (scripts/horizon-eval/collect_snapshot.py) and CI Gate must agree on which checks are required.

The collector cannot import the gate (it is a self-contained, hash-pinned read-only tool), so it re-implements the group expansion in a few lines.
This test keeps the two from drifting: for the live manifest and for additive/superseding variants, the collector's always-tier names must equal the gate's.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import copy
import json
import sys
import unittest
from pathlib import Path

import ci_gate as g

HE = g.ROOT / "scripts" / "horizon-eval"
sys.path.insert(0, str(HE))
import collect_snapshot as cs  # noqa: E402

LEGACY = "php artisan test (L11, pgsql)"


def manifest():
    return json.loads((g.ROOT / ".github" / "ci-gate" / "required-checks.json").read_text(encoding="utf-8"))


def gate_names(m, tier):
    return sorted({c["name"] for c in g.expand_groups(m)["checks"] if c["tier"] == tier})


def superseding(m):
    m = copy.deepcopy(m)
    m["checks"] = [c for c in m["checks"] if c["name"] != LEGACY]
    m["shard_groups"][0]["status"] = "superseding"
    m["shard_groups"][0]["proof"]["name"] = LEGACY
    return m


class CollectorMatchesTheGate(unittest.TestCase):
    def check(self, m):
        always, paths = cs.required_check_names(m)
        self.assertEqual(always, gate_names(m, "always"))
        self.assertEqual(paths, gate_names(m, "paths"))

    def test_live_manifest(self):
        self.check(manifest())

    def test_without_groups(self):
        m = manifest()
        m.pop("shard_groups")
        self.check(m)

    def test_superseding_variant(self):
        self.check(superseding(manifest()))

    def test_three_shard_variant(self):
        m = manifest()
        m["shard_groups"][0]["count"] = 3
        self.check(m)


if __name__ == "__main__":
    unittest.main()

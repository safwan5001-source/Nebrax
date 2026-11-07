"""PG-SHARD final closure: the read-only collector must see the checks CI Gate requires through `shard_groups`.

`collect_snapshot.required_check_names` expands groups the way CI Gate does. Without it a `superseding` group (whose proof job takes over the name of the
check it replaces, so that name leaves the raw `checks` list) would make the evaluator report MANIFEST_BELOW_POLICY_FLOOR for a check that is still required.
Pure tests: no network, nothing is written.
Run: python3 -I -m unittest discover -s scripts/horizon-eval -v"""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

import collect_snapshot as cs
import contract_runner as cr
import horizon_eval as he

REPO = Path(__file__).resolve().parents[2]
LEGACY = "php artisan test (L11, pgsql)"
SQLITE = "php artisan test (L11, sqlite)"
PROOF = "php artisan test (L11, pgsql, shards proven)"
S1, S2 = "php artisan test (L11, pgsql, shard 1)", "php artisan test (L11, pgsql, shard 2)"


def live_manifest():
    return json.loads((REPO / ".github" / "ci-gate" / "required-checks.json").read_text(encoding="utf-8"))


def superseding(m):
    m = copy.deepcopy(m)
    m["checks"] = [c for c in m["checks"] if c["name"] != LEGACY]  # the superseded check leaves `checks`
    m["shard_groups"][0]["status"] = "superseding"
    m["shard_groups"][0]["proof"]["name"] = LEGACY  # ...and its name is owned by the group's proof job
    return m


def raw_names(m):
    return sorted({c["name"] for c in m["checks"] if c["tier"] == "always"})


class RequiredCheckNames(unittest.TestCase):
    def test_manifest_without_groups_is_unchanged(self):
        m = live_manifest()
        m.pop("shard_groups")
        self.assertEqual(cs.required_check_names(m)[0], raw_names(m))
        m["shard_groups"] = []
        self.assertEqual(cs.required_check_names(m)[0], raw_names(m))

    def test_additive_group_adds_its_shards_and_proof_and_keeps_the_full_check(self):
        always, paths = cs.required_check_names(live_manifest())
        self.assertTrue({LEGACY, SQLITE, S1, S2, PROOF} <= set(always))
        self.assertEqual(paths, sorted({c["name"] for c in live_manifest()["checks"] if c["tier"] == "paths"}))
        self.assertEqual(always, sorted(set(always)))

    def test_superseding_group_keeps_the_replaced_name_through_its_proof(self):
        m = superseding(live_manifest())
        self.assertNotIn(LEGACY, raw_names(m))  # the raw list alone would lose it (the bug this fixes)
        always, _ = cs.required_check_names(m)
        self.assertIn(LEGACY, always)
        self.assertTrue({S1, S2, SQLITE} <= set(always))
        self.assertNotIn(PROOF, always)  # the old proof name is gone: the proof now carries the replaced name

    def test_malformed_groups_fail_closed(self):
        for mut in (lambda g: g.pop("count"), lambda g: g.update(count=0), lambda g: g.update(count=True), lambda g: g.update(count="2"),
                    lambda g: g.pop("shard_name"), lambda g: g.update(shard_name=5), lambda g: g.pop("proof"), lambda g: g["proof"].pop("name"),
                    lambda g: g.update(proof=None)):
            m = live_manifest()
            mut(m["shard_groups"][0])
            with self.assertRaises(cs.CollectError):
                cs.required_check_names(m)
        m = live_manifest()
        m["shard_groups"] = {"id": "x"}
        with self.assertRaises(cs.CollectError):
            cs.required_check_names(m)

    def test_three_shards_expand_to_three_names(self):
        m = live_manifest()
        m["shard_groups"][0]["count"] = 3
        always, _ = cs.required_check_names(m)
        self.assertIn("php artisan test (L11, pgsql, shard 3)", always)
        self.assertNotIn("php artisan test (L11, pgsql, shard 4)", always)


class EvaluatorFloor(unittest.TestCase):
    """The real evaluator, fed the names the collector now produces."""

    def case_with(self, names):
        case = cr.load_case(cr.FIXTURES / "base_case.json")[0]
        case["evidence"]["required_checks"]["always_names"] = names
        return case

    def codes(self, names):
        rec = he.evaluate(self.case_with(names), allow_synthetic=True)
        return {r["code"] for r in rec["reasons"]}

    def test_live_policy_floor_is_met_by_the_expanded_names_for_additive_and_superseding(self):
        floor = he.load_policy()[0]["ci_floor"]["always"]
        for m in (live_manifest(), superseding(live_manifest())):
            always, _ = cs.required_check_names(m)
            self.assertFalse(set(floor) - set(always), "policy floor name missing from the collector's names")
            self.assertNotIn("MANIFEST_BELOW_POLICY_FLOOR", self.codes(always))

    def test_without_the_expansion_a_superseding_manifest_would_be_blocked(self):
        # documents the defect the collector fix removes: the raw list lost the replaced check
        self.assertIn("MANIFEST_BELOW_POLICY_FLOOR", self.codes(raw_names(superseding(live_manifest()))))

    def test_losing_a_floor_check_is_still_blocked(self):
        always, _ = cs.required_check_names(live_manifest())
        self.assertIn("MANIFEST_BELOW_POLICY_FLOOR", self.codes([n for n in always if n != SQLITE]))


class ReadOnlyBoundaryUnchanged(unittest.TestCase):
    def test_the_new_function_is_pure(self):
        import inspect
        src = inspect.getsource(cs.required_check_names)
        for forbidden in ("gh_get", "subprocess", "open(", "write", "requests"):
            self.assertNotIn(forbidden, src)


if __name__ == "__main__":
    unittest.main()

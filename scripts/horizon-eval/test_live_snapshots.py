"""Validation against frozen READ-ONLY evidence from the real repository (snapshots/).

These are public-metadata snapshots taken with collect_snapshot.py (GET only; file patches omitted).
In live mode the evaluator must never be eligible: there is no grant on main, no registered horizon,
no recorded review, and no authenticity verifier - and the real repository shows exactly that.
"""
from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

import contract_runner as cr
import horizon_eval as he

SNAP = Path(__file__).resolve().parent / "snapshots"
EXPECTED = {
    # file: (decision, zone, must-include reasons)
    "live-pr1093.json": ("BLOCK", "A", {"CI_CHECK_NEVER_STARTED", "NO_ACTIVE_GRANT", "HORIZON_NOT_REGISTERED_V2"}),
    "live-pr1346.json": ("STOP_OWNER_DECISION", "C", {"ZONE_C_OWNER_GATED", "PR_ALREADY_MERGED", "UNREGISTERED_PR_OVERLAP"}),
    "live-pr1350.json": ("STOP_OWNER_DECISION", "C", {"ZONE_C_OWNER_GATED", "NO_ACTIVE_GRANT", "HORIZON_NOT_REGISTERED_V2"}),
    "live-pr1349.json": ("BLOCK", "B", {"CI_CHECK_PENDING", "NO_ACTIVE_GRANT", "INDEPENDENT_REVIEW_MISSING"}),
    "live-pr586.json": ("STOP_OWNER_DECISION", "C", {"ZONE_C_OWNER_GATED", "CI_CHECK_NEVER_STARTED"}),
}


def load(name):
    return json.loads((SNAP / name).read_text(encoding="utf-8"))


class LiveSnapshots(unittest.TestCase):
    def test_all_snapshots_present_and_valid(self):
        self.assertEqual(sorted(p.name for p in SNAP.glob("*.json")), sorted(EXPECTED))
        for name in EXPECTED:
            case = load(name)
            self.assertEqual(he.validate_case(case), [], name)
            self.assertEqual(case["mode"], "live")
            self.assertEqual(case["evidence"]["source"], "github-readonly")
            self.assertEqual(case["evidence"]["grant_store"]["grants"], [], "no grant exists on main today")
            self.assertEqual(case["evidence"]["registry"]["horizons"], [])

    def test_decisions_on_real_evidence(self):
        for name, (decision, zone, must) in EXPECTED.items():
            rec = he.evaluate(load(name), allow_synthetic=True)
            self.assertEqual(rec["decision"], decision, name)
            self.assertEqual(rec["zone"], zone, name)
            self.assertTrue(must <= {r["code"] for r in rec["reasons"]}, f"{name}: {must - {r['code'] for r in rec['reasons']}}")
            self.assertFalse(rec["would_merge"])

    def test_real_parallel_horizon_overlaps_are_observed_not_reported(self):
        rec = he.evaluate(load("live-pr1346.json"))
        kinds = {c["evidence_kind"] for c in rec["conflicts"]}
        self.assertEqual(kinds, {"observed"})
        self.assertTrue(rec["conflicts"], "PR #1346 (governance docs) overlaps the stale PR #202 on S-GOV-DOCS")          # nobody registered a claim: only GitHub-observed evidence exists
        self.assertTrue(all(c["registered"] is False for c in rec["conflicts"]))

    def test_gate_never_ran_on_legacy_prs_is_visible(self):
        for name in ("live-pr1093.json", "live-pr586.json"):
            self.assertIn("CI_CHECK_NEVER_STARTED", {r["code"] for r in he.evaluate(load(name))["reasons"]})

    def test_giving_real_evidence_a_perfect_synthetic_grant_still_cannot_make_it_eligible_in_live_mode(self):
        base, _ = cr.load_case(cr.FIXTURES / "base_case.json")
        for name in EXPECTED:
            case = load(name)
            case["evidence"]["grant_store"]["grants"] = copy.deepcopy(base["evidence"]["grant_store"]["grants"])
            case["request"]["horizon_id"] = "SYNTH-HZ-PILOT"
            case["evidence"]["grant_store"]["grants"][0]["origin"]["commit_sha"] = case["evidence"]["main"]["sha"]  # as if it were on main
            rec = he.evaluate(case, allow_synthetic=True)
            self.assertNotEqual(rec["decision"], "ELIGIBLE_SIMULATED", name)
            self.assertIn("SYNTHETIC_GRANT_IN_LIVE_MODE", {r["code"] for r in rec["reasons"]})

    def test_real_evidence_cannot_be_relabelled_synthetic(self):
        for name in EXPECTED:
            case = load(name)
            case["mode"] = "synthetic-test"
            rec = he.evaluate(case, allow_synthetic=True)
            self.assertNotEqual(rec["decision"], "ELIGIBLE_SIMULATED", name)
            self.assertIn("SYNTHETIC_MODE_REQUIRES_FIXTURE_SOURCE", {r["code"] for r in rec["reasons"]})

    def test_every_contract_fixture_turned_live_is_never_eligible(self):
        for path in cr.case_files() + [cr.FIXTURES / "base_case.json"]:
            case, _ = cr.load_case(path)
            case["mode"] = "live"
            case["evidence"]["source"] = "github-readonly"
            rec = he.evaluate(case, allow_synthetic=True)
            self.assertNotEqual(rec["decision"], "ELIGIBLE_SIMULATED", path.name)

    def test_snapshots_hold_no_secret_like_values(self):
        import re
        rx = re.compile(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY")
        for p in SNAP.glob("*.json"):
            self.assertIsNone(rx.search(p.read_text(encoding="utf-8")), p.name)


if __name__ == "__main__":
    unittest.main()

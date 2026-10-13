"""Committed Shadow evidence must match the implementation that is in the repository (AWJ-HORIZON-V2-2 closure).

Read-only. If shadow_observe.py, shadow_run.py, horizon_eval.py, collect_snapshot.py or the policy file change, regenerate the
evidence (see docs/autonomous-engineering/horizon-shadow-evidence/README.md) - stale evidence must not sit in the repository.
"""
from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

import horizon_eval as he
import shadow_observe as so

HERE = Path(__file__).resolve().parent
EVIDENCE = HERE.parent.parent / "docs" / "autonomous-engineering" / "horizon-shadow-evidence"
SNAP = HERE / "snapshots"


def manifest():
    return json.loads((EVIDENCE / "MANIFEST.json").read_text(encoding="utf-8"))


class CommittedEvidenceIsCurrent(unittest.TestCase):
    def test_manifest_implementation_hashes_match_the_files_in_the_repo(self):
        for rel, digest in manifest()["implementation_sha256"].items():
            self.assertEqual(hashlib.sha256((HERE / rel).read_bytes()).hexdigest(), digest,
                             f"{rel} changed since the evidence was generated - regenerate the evidence")

    def test_file_set_is_exactly_the_manifest_plus_docs(self):
        listed = {r["file"] for r in manifest()["reports"]} | {r["markdown"] for r in manifest()["reports"]}
        actual = {p.name for p in EVIDENCE.iterdir()}
        self.assertEqual(actual, listed | {"MANIFEST.json", "README.md", "shadow-summary.md"})

    def test_every_report_is_self_consistent_and_matches_the_manifest(self):
        policy_sha = he.load_policy()[1]
        rows = manifest()["reports"]
        self.assertTrue(rows)
        for row in rows:
            rep = json.loads((EVIDENCE / row["file"]).read_text(encoding="utf-8"))
            body = {k: v for k, v in rep.items() if k != "report_sha256"}
            self.assertEqual(rep["report_sha256"], he.sha256_hex(he.canon(body)), row["file"])
            self.assertEqual(rep["report_sha256"], row["report_sha256"], row["file"])
            self.assertEqual(rep["observation"]["evidence_digest"], row["evidence_digest"], row["file"])
            self.assertEqual(rep["observation"]["policy_sha256"], row["policy_sha256"], row["file"])
            self.assertEqual(row["policy_sha256"], policy_sha, f"{row['file']}: not produced under the current policy")
            self.assertNotEqual(row["policy_sha256"], "inline")
            self.assertEqual((rep["pr"]["number"], rep["pr"]["head_sha"], rep["observation"]["mode"]), (row["pr"], row["head_sha"], row["mode"]))
            self.assertIn(rep["report_sha256"], (EVIDENCE / row["markdown"]).read_text(encoding="utf-8"))
            self.assertIs(rep["authorization"]["merge_authorized"], False)
            self.assertIs(rep["safety"]["would_merge"], False)
            self.assertEqual(rep["safety"]["github_writes"], 0)
            self.assertIn(rep["recommendation"], so.RECOMMENDATIONS)
            if row["mode"] == "replay-frozen":
                self.assertNotEqual(rep["recommendation"], "READY_FOR_MANUAL_REVIEW")

    def test_replay_reports_regenerate_byte_for_byte_from_the_committed_snapshots(self):
        replays = [r for r in manifest()["reports"] if r["mode"] == "replay-frozen"]
        self.assertEqual(sorted(r["pr"] for r in replays), [586, 1093, 1346, 1349, 1350])
        for row in replays:
            case = json.loads((SNAP / f"live-pr{row['pr']}.json").read_text(encoding="utf-8"))
            rep = so.observe(case, replay=True)
            self.assertEqual(so.report_json(rep), (EVIDENCE / row["file"]).read_text(encoding="utf-8"), row["file"])
            self.assertEqual(so.render_markdown(rep), (EVIDENCE / row["markdown"]).read_text(encoding="utf-8"), row["markdown"])


if __name__ == "__main__":
    unittest.main()

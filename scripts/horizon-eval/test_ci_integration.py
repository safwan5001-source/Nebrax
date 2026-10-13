"""CI wiring guards (AWJ-HORIZON-V2-1D): the evaluator tests must run on every PR and must not be quietly weakened.

Stdlib only, offline. The authoritative structural lint is `scripts/ci-gate/ci_gate.py validate` (run by CI Gate on
every PR, PyYAML); these checks repeat the essentials so a plain `unittest discover` run fails locally too.
They read text only - they never execute the workflow.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
WORKFLOW = REPO / ".github" / "workflows" / "horizon-eval-ci.yml"
MANIFEST = REPO / ".github" / "ci-gate" / "required-checks.json"
CHECK_NAME = "Horizon dry-run evaluator (tests)"
# 172 = the suite size when this was wired into CI (V2-1C). The floor may rise; it must never fall below this.
ORIGINAL_SUITE = 172


def workflow_text() -> str:
    """The workflow without comment-only lines (the header comment legitimately names the forbidden constructs)."""
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()
    return "\n".join(line for line in lines if not line.lstrip().startswith("#")) + "\n"


def discovered_tests() -> int:
    def count(suite) -> int:
        return sum(count(t) if isinstance(t, unittest.TestSuite) else 1 for t in suite)
    return count(unittest.defaultTestLoader.discover(str(HERE), top_level_dir=str(HERE)))


class GateManifest(unittest.TestCase):
    def setUp(self):
        checks = {c["name"]: c for c in json.loads(MANIFEST.read_text(encoding="utf-8"))["checks"]}
        self.assertIn(CHECK_NAME, checks, "the Horizon evaluator check must be listed in the CI Gate manifest")
        self.check = checks[CHECK_NAME]

    def test_is_blocking_on_every_pr(self):
        self.assertEqual(self.check["tier"], "always")  # never `paths` (a path filter leaves the PR pending/skipped) or advisory

    def test_points_at_this_workflow_and_job(self):
        self.assertEqual(self.check["workflow"], ".github/workflows/horizon-eval-ci.yml")
        self.assertEqual(self.check["job"], "horizon-eval")
        self.assertRegex(workflow_text(), r"(?m)^  horizon-eval:\n    name: " + re.escape(CHECK_NAME) + r"\n")

    def test_guard_forbids_swallowing_or_filtering_the_tests(self):
        guard = self.check["guard"]
        self.assertEqual(guard["step_run_contains"], "unittest discover -s scripts/horizon-eval")
        for need in ("set -o pipefail", "MIN_TESTS=", '!= "OK"'):
            self.assertIn(need, guard["require"])
        for bad in ("|| true", "|| :", "exit 0", " -k ", "--pattern", " -p "):
            self.assertIn(bad, guard["forbidden"])


class WorkflowShape(unittest.TestCase):
    def test_runs_on_every_pull_request_and_push(self):
        text = workflow_text()
        self.assertRegex(text, r"(?m)^on:\n  push:\n    branches: \['\*\*'\]\n  pull_request:\n    branches: \['\*\*'\]\n")
        for forbidden in (r"\bpaths(-ignore)?:", r"\bbranches-ignore:", r"\btags(-ignore)?:", r"(?m)^    if:", r"continue-on-error",
                          r"pull_request_target", r"workflow_run", r"secrets\.", r"\|\| true"):
            self.assertNotRegex(text, forbidden)

    def test_least_privilege(self):
        text = workflow_text()
        self.assertRegex(text, r"(?m)^permissions:\n  contents: read\n\njobs:")
        self.assertNotRegex(text, r"(?m)^\s+(contents|actions|checks|pull-requests|statuses|id-token|packages|deployments): write")
        self.assertIn("persist-credentials: false", text)  # PR-controlled code runs here: no token left in .git/config

    def test_no_network_or_install_step(self):
        for forbidden in (r"\bpip\b", r"\bnpm\b", r"\bcurl\b", r"\bwget\b", r"GITHUB_TOKEN", r"\bgh api\b"):
            self.assertNotRegex(workflow_text(), forbidden)


class FloorCannotSilentlyShrink(unittest.TestCase):
    def test_floor_is_at_least_the_original_suite_and_at_most_what_is_discovered(self):
        found = re.findall(r"MIN_TESTS=(\d+)", workflow_text())
        self.assertEqual(len(found), 1, "MIN_TESTS must be assigned exactly once")
        floor = int(found[0])
        self.assertGreaterEqual(floor, ORIGINAL_SUITE)
        self.assertLessEqual(floor, discovered_tests(), "the floor is above the number of tests (CI would fail)")

    def test_floor_tracks_the_suite_closely(self):
        # A floor far below the suite lets tests disappear unnoticed; keep it within a small slack of reality.
        floor = int(re.search(r"MIN_TESTS=(\d+)", workflow_text()).group(1))
        self.assertLessEqual(discovered_tests() - floor, 5, "raise MIN_TESTS in horizon-eval-ci.yml to the current suite size")


if __name__ == "__main__":
    unittest.main()

"""Offline tests for the CI Gate. Run: python3 -m unittest discover -s scripts/ci-gate"""
import argparse
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_gate as g

M = g.load_manifest()
DOCS = {c["workflow"]: g.load_yaml(g.ROOT / c["workflow"]) for c in M["checks"]}
PHP = ["php artisan test (L11, sqlite)", "php artisan test (L11, pgsql)"]
_id = iter(range(1, 10_000))


def cr(name, status="completed", conclusion="success", app="github-actions", id=None):
    return {"id": id or next(_id), "name": name, "status": status, "conclusion": conclusion, "app": {"slug": app}}


def ok_php():
    return [cr(n) for n in PHP]


def ev(files, runs, wf_runs=None, elapsed=60, deadline=4200):
    exp = g.expected_checks(M, DOCS, files)
    wf = wf_runs if wf_runs is not None else [{"path": ".github/workflows/ci.yml", "status": "in_progress"}]
    return exp, g.evaluate(M, exp, runs, wf, elapsed, deadline)


class Globbing(unittest.TestCase):
    def test_semantics(self):
        self.assertTrue(g.paths_match(["web/**"], ["web/src/a/b.ts"]))
        self.assertFalse(g.paths_match(["web/**"], ["webx/a.ts"]))
        self.assertTrue(g.paths_match(["Dockerfile"], ["Dockerfile"]))
        self.assertFalse(g.paths_match(["Dockerfile"], ["sub/Dockerfile"]))
        self.assertTrue(g.paths_match(["deploy/**"], ["deploy/php/awj-uploads.ini"]))
        self.assertFalse(g.paths_match(["*.md"], ["docs/a.md"]))


class Expectation(unittest.TestCase):
    def test_docs_only_expects_only_backend(self):
        exp = g.expected_checks(M, DOCS, ["docs/x.md"])
        self.assertEqual(set(exp), set(PHP))

    def test_web_change_adds_web(self):
        exp = g.expected_checks(M, DOCS, ["web/src/a.ts"])
        self.assertIn("web build (Next.js)", exp)
        self.assertNotIn("storefront (lint + typecheck + test)", exp)

    def test_shared_contract_triggers_web_and_mobile(self):
        exp = g.expected_checks(M, DOCS, ["contracts/app-builder/x.json"])
        self.assertIn("web build (Next.js)", exp)
        self.assertIn("mobile (iOS release build proof)", exp)

    def test_unknown_diff_requires_everything_blocking(self):
        exp = g.expected_checks(M, DOCS, None)
        self.assertEqual(len(exp), 8)

    def test_advisory_never_expected(self):
        exp = g.expected_checks(M, DOCS, ["storefront/src/app/x.ts"])
        self.assertNotIn("merchant preview visual QA", exp)


class Verdicts(unittest.TestCase):
    def test_docs_only_passes_without_conditional_checks(self):
        _, (v, rows, _) = ev(["docs/a.md"], ok_php())
        self.assertEqual(v, "pass")

    def test_missing_conditional_does_not_hang_when_not_expected(self):
        _, (v, _, _) = ev(["README.md"], ok_php())
        self.assertEqual(v, "pass")

    def test_failure_fails(self):
        runs = [cr(PHP[0]), cr(PHP[1], conclusion="failure")]
        self.assertEqual(ev(["a.md"], runs)[1][0], "fail")

    def test_cancelled_skipped_neutral_timed_out_are_not_success(self):
        for concl in ("cancelled", "skipped", "neutral", "timed_out", "action_required", "stale", None):
            runs = [cr(PHP[0]), cr(PHP[1], conclusion=concl)]
            self.assertEqual(ev(["a.md"], runs)[1][0], "fail", concl)

    def test_in_progress_waits(self):
        runs = [cr(PHP[0]), cr(PHP[1], status="in_progress", conclusion=None)]
        self.assertEqual(ev(["a.md"], runs)[1][0], "wait")

    def test_not_yet_reported_waits_then_fails_at_deadline(self):
        runs = [cr(PHP[0])]
        self.assertEqual(ev(["a.md"], runs, elapsed=30)[1][0], "wait")
        self.assertEqual(ev(["a.md"], runs, elapsed=4200)[1][0], "fail")

    def test_workflow_never_triggered_fails_after_grace(self):
        runs = [cr(PHP[0])]
        v = ev(["a.md"], runs, wf_runs=[], elapsed=601)[1][0]
        self.assertEqual(v, "fail")
        self.assertEqual(ev(["a.md"], runs, wf_runs=[], elapsed=100)[1][0], "wait")

    def test_workflow_finished_without_job_fails(self):
        runs = [cr(PHP[0])]
        wf = [{"path": ".github/workflows/ci.yml", "status": "completed", "conclusion": "success"}]
        self.assertEqual(ev(["a.md"], runs, wf_runs=wf)[1][0], "fail")

    def test_action_required_fails(self):
        wf = [{"path": ".github/workflows/ci.yml", "status": "completed", "conclusion": "action_required"}]
        self.assertEqual(ev(["a.md"], [], wf_runs=wf)[1][0], "fail")

    def test_present_but_unexpected_check_must_still_pass(self):
        runs = ok_php() + [cr("web build (Next.js)", conclusion="failure")]
        self.assertEqual(ev(["docs/a.md"], runs)[1][0], "fail")

    def test_rerun_uses_latest_attempt_and_warns(self):
        runs = [cr(PHP[0]), cr(PHP[1], conclusion="failure", id=900), cr(PHP[1], id=901)]
        v, _, warns = ev(["a.md"], runs)[1]
        self.assertEqual(v, "pass")
        self.assertTrue(any("earlier attempt" in w for w in warns))

    def test_rerun_in_progress_after_failure_waits(self):
        runs = [cr(PHP[0]), cr(PHP[1], conclusion="failure", id=900),
                cr(PHP[1], status="in_progress", conclusion=None, id=901)]
        self.assertEqual(ev(["a.md"], runs)[1][0], "wait")

    def test_spoofed_check_from_other_app_ignored(self):
        runs = [cr(PHP[0]), cr(PHP[1], app="evil-app")]
        self.assertEqual(ev(["a.md"], runs, elapsed=30)[1][0], "wait")

    def test_advisory_failure_does_not_block(self):
        runs = ok_php() + [cr("merchant preview visual QA", conclusion="failure")]
        self.assertEqual(ev(["a.md"], runs)[1][0], "pass")


class Validation(unittest.TestCase):
    def test_repo_is_clean(self):
        errors, warnings = g.validate()
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [], "unclassified PR checks exist")

    def _sandbox(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d)
        shutil.copytree(g.ROOT / ".github", d / ".github")
        return d

    def _mutate(self, wf, old, new):
        d = self._sandbox()
        p = d / ".github" / "workflows" / wf
        text = p.read_text(encoding="utf-8")
        self.assertIn(old, text)
        p.write_text(text.replace(old, new, 1), encoding="utf-8")
        return g.validate(d)[0]

    def test_path_filter_on_always_check_is_rejected(self):
        errs = self._mutate("ci.yml", "  pull_request:\n    branches: ['**']\n",
                            "  pull_request:\n    branches: ['**']\n    paths: ['app/**']\n")
        self.assertTrue(any("tier=always" in e for e in errs), errs)

    def test_job_rename_is_drift(self):
        errs = self._mutate("web-ci.yml", "name: web build (Next.js)", "name: web build")
        self.assertTrue(any("name drift" in e for e in errs), errs)

    def test_job_level_if_rejected(self):
        errs = self._mutate("web-ci.yml", "    name: web build (Next.js)\n",
                            "    name: web build (Next.js)\n    if: github.actor != 'x'\n")
        self.assertTrue(any("job-level `if`" in e for e in errs), errs)

    def test_continue_on_error_rejected(self):
        errs = self._mutate("web-ci.yml", "    name: web build (Next.js)\n",
                            "    name: web build (Next.js)\n    continue-on-error: true\n")
        self.assertTrue(any("continue-on-error" in e for e in errs), errs)

    def test_test_filter_rejected(self):
        errs = self._mutate("ci.yml", "php artisan test 2>&1", "php artisan test --filter=Ledger 2>&1")
        self.assertTrue(any("--filter" in e for e in errs), errs)

    def test_lost_pipefail_rejected(self):
        errs = self._mutate("ci.yml", "set -o pipefail", "true")
        self.assertTrue(any("pipefail" in e for e in errs), errs)

    def test_paths_ignore_unsupported(self):
        d = self._sandbox()
        p = d / ".github" / "workflows" / "web-ci.yml"
        p.write_text(p.read_text(encoding="utf-8").replace(
            "    paths: ['web/**', 'contracts/app-builder/**', 'contracts/flowers-admin-journey/**', '.github/workflows/web-ci.yml']\n\njobs",
            "    paths-ignore: ['docs/**']\n\njobs"), encoding="utf-8")
        errs = g.validate(d)[0]
        self.assertTrue(any("paths-ignore" in e for e in errs), errs)

    def test_new_unclassified_workflow_is_flagged(self):
        d = self._sandbox()
        (d / ".github" / "workflows" / "new.yml").write_text(
            "name: New\non:\n  pull_request:\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps: []\n")
        _, warns = g.validate(d)
        self.assertTrue(any("unclassified" in w for w in warns), warns)


SHA = "a" * 40


def wfr(path, suite, event="pull_request", sha=SHA, status="in_progress", conclusion=None):
    return {"path": path, "check_suite_id": suite, "event": event, "head_sha": sha,
            "status": status, "conclusion": conclusion}


def scr(name, suite, id, conclusion="success", status="completed"):
    r = cr(name, status=status, conclusion=conclusion, id=id)
    r["check_suite"] = {"id": suite}
    return r


class Binding(unittest.TestCase):
    """Regression: PR #1334 showed push-event and pull_request-event runs publish the SAME
    check names on the SAME head SHA."""
    CI = ".github/workflows/ci.yml"

    def test_push_event_check_runs_are_ignored(self):
        wf = [wfr(self.CI, 1, event="push"), wfr(self.CI, 2)]
        raw = [scr(PHP[0], 1, 10), scr(PHP[1], 1, 11), scr(PHP[0], 2, 20), scr(PHP[1], 2, 21)]
        bound, mine = g.bind_check_runs(raw, wf, SHA)
        self.assertEqual({r["id"] for r in bound}, {20, 21})
        self.assertEqual(len(mine), 1)

    def test_push_run_rerun_cannot_mask_pr_failure(self):
        wf = [wfr(self.CI, 1, event="push"), wfr(self.CI, 2)]
        raw = [scr(PHP[0], 2, 20), scr(PHP[1], 2, 21, conclusion="failure"),
               scr(PHP[0], 1, 90), scr(PHP[1], 1, 91)]  # push run re-run later: higher ids, green
        bound, mine = g.bind_check_runs(raw, wf, SHA)
        exp = g.expected_checks(M, DOCS, ["docs/a.md"])
        self.assertEqual(g.evaluate(M, exp, bound, mine, 60, 4200)[0], "fail")

    def test_runs_of_other_sha_are_ignored(self):
        wf = [wfr(self.CI, 7, sha="b" * 40)]
        raw = [scr(PHP[0], 7, 5), scr(PHP[1], 7, 6)]
        bound, mine = g.bind_check_runs(raw, wf, SHA)
        self.assertEqual((bound, mine), ([], []))
        exp = g.expected_checks(M, DOCS, ["docs/a.md"])
        self.assertEqual(g.evaluate(M, exp, bound, mine, 30, 4200)[0], "wait")

    def test_check_run_from_unrelated_suite_is_ignored(self):
        bound, _ = g.bind_check_runs([scr(PHP[0], 99, 5)], [wfr(self.CI, 2)], SHA)
        self.assertEqual(bound, [])

    def test_rerun_same_suite_takes_newest(self):
        wf = [wfr(self.CI, 2)]
        raw = [scr(PHP[0], 2, 20), scr(PHP[1], 2, 21, conclusion="failure"), scr(PHP[1], 2, 31)]
        bound, mine = g.bind_check_runs(raw, wf, SHA)
        exp = g.expected_checks(M, DOCS, ["docs/a.md"])
        self.assertEqual(g.evaluate(M, exp, bound, mine, 60, 4200)[0], "pass")


class Baseline(unittest.TestCase):
    """Regression: a PR must not weaken required checks by editing the manifest/workflows."""

    def _pair(self):
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d)
        for side in ("base", "head"):
            shutil.copytree(g.ROOT / ".github", d / side / ".github")
        return d / "base", d / "head"

    def _edit_manifest(self, head, fn):
        p = head / ".github/ci-gate/required-checks.json"
        m = json.loads(p.read_text())
        fn(m)
        p.write_text(json.dumps(m))

    def test_identical_is_fine(self):
        b, h = self._pair()
        self.assertEqual(g.compare_baseline(b, h), [])

    def test_bootstrap_without_base_manifest(self):
        b, h = self._pair()
        (b / ".github/ci-gate/required-checks.json").unlink()
        self.assertEqual(g.compare_baseline(b, h), [])

    def test_removing_blocking_check_fails(self):
        b, h = self._pair()
        self._edit_manifest(h, lambda m: m["checks"].pop(0))
        self.assertTrue(any("removed" in e for e in g.compare_baseline(b, h)))

    def test_demoting_tier_fails(self):
        b, h = self._pair()
        def f(m):
            for c in m["checks"]:
                if c["name"] == "web build (Next.js)":
                    c["tier"] = "advisory"
        self._edit_manifest(h, f)
        self.assertTrue(any("tier weakened" in e for e in g.compare_baseline(b, h)))

    def test_guard_shrink_fails(self):
        b, h = self._pair()
        def f(m):
            m["checks"][0]["guard"]["forbidden"].remove("--filter")
        self._edit_manifest(h, f)
        self.assertTrue(any("guard.forbidden" in e for e in g.compare_baseline(b, h)))

    def test_narrowing_path_filter_fails(self):
        b, h = self._pair()
        p = h / ".github/workflows/web-ci.yml"
        t = p.read_text()
        p.write_text(t.replace("  pull_request:\n    branches: ['**']\n    paths: ['web/**', ", "  pull_request:\n    branches: ['**']\n    paths: [", 1))
        self.assertTrue(any("paths lost" in e for e in g.compare_baseline(b, h)), t[:0])

    def test_adding_checks_or_paths_is_allowed(self):
        b, h = self._pair()
        def f(m):
            m["checks"].append({"name": "extra", "workflow": ".github/workflows/web-ci.yml", "job": "build", "tier": "advisory"})
        self._edit_manifest(h, f)
        self.assertEqual(g.compare_baseline(b, h), [])

    def test_touches_gate(self):
        self.assertTrue(g.touches_gate(["scripts/ci-gate/ci_gate.py"]))
        self.assertTrue(g.touches_gate([".github/ci-gate/required-checks.json"]))
        self.assertTrue(g.touches_gate([".github/workflows/ci-gate.yml"]))
        self.assertTrue(g.touches_gate(None))
        self.assertFalse(g.touches_gate(["docs/a.md", "web/x.ts"]))


class FakeApi:
    """Scripted GitHub: one PR (docs-only diff) whose PR-event run reports `results`."""
    head = SHA

    def __init__(self, results, head=None):
        self.results, self.head_now = results, head or SHA

    def get(self, path, params=None):
        assert path == "pulls/5"
        return {"state": "open", "head": {"sha": self.head_now}, "base": {"sha": "c" * 40}, "merge_commit_sha": "d" * 40}

    def pages(self, path, key, params=None):
        if path == "pulls/5/files":
            return [{"filename": "docs/a.md"}]
        if path == "actions/runs":
            return [wfr(".github/workflows/ci.yml", 1, event="push"),
                    wfr(".github/workflows/ci.yml", 2, status="completed", conclusion="success")]
        if path == f"commits/{SHA}/check-runs":
            return ([scr(PHP[0], 1, 1), scr(PHP[1], 1, 2)] +  # push-event twins, always green
                    [scr(n, 2, 10 + i, conclusion=c) for i, (n, c) in enumerate(self.results.items())])
        raise AssertionError(path)


class EndToEnd(unittest.TestCase):
    def _run(self, results, head=None):
        orig = g.Api
        g.Api = lambda repo, token: FakeApi(results, head)
        os.environ.update(GITHUB_REPOSITORY="o/r", GITHUB_TOKEN="t")
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        try:
            args = argparse.Namespace(root=str(g.ROOT), base_root=str(g.ROOT), pr=5, sha=SHA,
                                      timeout_minutes=1, interval=0)
            return g.run_gate(args)
        finally:
            g.Api = orig

    def test_green(self):
        self.assertEqual(self._run({PHP[0]: "success", PHP[1]: "success"}), 0)

    def test_pr_failure_not_hidden_by_green_push_twin(self):
        self.assertEqual(self._run({PHP[0]: "success", PHP[1]: "failure"}), 1)

    def test_stale_head_fails_closed(self):
        with self.assertRaises(g.GateError):
            self._run({PHP[0]: "success", PHP[1]: "success"}, head="e" * 40)


class Timeouts(unittest.TestCase):
    """Regression (POST-MERGE): 70 min failed healthy PRs whose runner queue was long (observed 73 and 114 min)."""

    def test_deadline_covers_observed_worst_case(self):
        self.assertGreaterEqual(g.DEFAULT_TIMEOUT_MINUTES, 120)

    def test_job_timeout_exceeds_gate_deadline(self):
        doc = g.load_yaml(g.ROOT / ".github/workflows/ci-gate.yml")
        self.assertGreater(doc["jobs"]["gate"]["timeout-minutes"], g.DEFAULT_TIMEOUT_MINUTES + 5)

    def test_cli_default_uses_constant(self):
        import re
        src = (g.ROOT / "scripts/ci-gate/ci_gate.py").read_text()
        self.assertIn("default=DEFAULT_TIMEOUT_MINUTES", src)
        self.assertIsNone(re.search(r"default=70", src))


class Hygiene(unittest.TestCase):
    def test_no_bytecode_tracked_and_ignored(self):
        try:
            tracked = subprocess.run(["git", "ls-files"], cwd=g.ROOT, capture_output=True, text=True, check=True).stdout
        except (OSError, subprocess.CalledProcessError):
            self.skipTest("git unavailable")
        bad = [f for f in tracked.splitlines() if "__pycache__" in f or f.endswith(".pyc")]
        self.assertEqual(bad, [])
        ignore = (g.ROOT / ".gitignore").read_text()
        self.assertIn("__pycache__/", ignore)
        self.assertIn("*.pyc", ignore)


if __name__ == "__main__":
    unittest.main()

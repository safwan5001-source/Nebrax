"""Offline tests for the CI Gate. Run: python3 -m unittest discover -s scripts/ci-gate"""
import copy
import json
import shutil
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


if __name__ == "__main__":
    unittest.main()

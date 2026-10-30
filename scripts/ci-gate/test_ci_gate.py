"""Offline tests for the CI Gate. Run: python3 -m unittest discover -s scripts/ci-gate"""
import argparse
import contextlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import ci_gate as g

M = g.load_manifest()
DOCS = {c["workflow"]: g.load_yaml(g.ROOT / c["workflow"]) for c in M["checks"]}
PHP = ["php artisan test (L11, sqlite)", "php artisan test (L11, pgsql)"]
HORIZON = "Horizon dry-run evaluator (tests)"  # AWJ-HORIZON-V2-1D: tier=paths (only PRs that touch Horizon files)
HZ_WF = ".github/workflows/horizon-eval-ci.yml"
HZ_FILES = ["scripts/horizon-eval/horizon_eval.py"]  # a Horizon-related diff
HZ_TRIGGERS = [HZ_FILES[0], "scripts/horizon-eval/policy/zone_policy.v1.json", ".github/workflows/horizon-eval-ci.yml",
               ".github/ci-gate/required-checks.json"]
# diffs that must never be affected by the Horizon requirement (accounting / POS / storefront / web / DB / other CI)
UNRELATED = ["app/Services/Accounting/LedgerService.php", "app/Http/Controllers/Api/PosSessionController.php",
             "app/Services/Pos/PosCheckoutService.php", "storefront/src/app/page.tsx", "web/src/app/x.tsx",
             "database/migrations/2026_10_13_000001_x.php", "routes/api.php", "docs/a.md", "README.md",
             ".github/workflows/ci.yml", ".github/workflows/web-ci.yml", "scripts/ci-gate/ci_gate.py"]
GREEN = {n: "success" for n in PHP}
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
        self.assertEqual(len(exp), 11)  # 10 previously; +1 = path-scoped storefront Docker build context check
        self.assertIn(HORIZON, exp)

    def test_advisory_never_expected(self):
        exp = g.expected_checks(M, DOCS, ["storefront/src/app/x.ts"])
        self.assertNotIn("merchant preview visual QA", exp)


class HorizonPathsTier(unittest.TestCase):
    """The Horizon check is tier=paths: required only for PRs that touch Horizon files, invisible to every other PR."""

    def test_required_for_every_horizon_related_diff(self):
        for f in HZ_TRIGGERS:
            self.assertIn(HORIZON, g.expected_checks(M, DOCS, [f]), f)
        # one Horizon file among many unrelated ones is enough
        self.assertIn(HORIZON, g.expected_checks(M, DOCS, UNRELATED + HZ_FILES))
        # a rename away from a Horizon path counts (previous_filename is part of the file list)
        self.assertIn(HORIZON, g.expected_checks(M, DOCS, ["docs/moved.md", "scripts/horizon-eval/old.py"]))

    def test_not_required_for_unrelated_prs(self):
        for f in UNRELATED:
            exp = g.expected_checks(M, DOCS, [f])
            self.assertNotIn(HORIZON, exp, f)
            self.assertTrue(set(PHP) <= set(exp), f)  # the always-checks are unchanged
        self.assertNotIn(HORIZON, g.expected_checks(M, DOCS, UNRELATED))

    def test_unrelated_pr_passes_without_any_horizon_run(self):
        backend_only = [f for f in UNRELATED if not f.startswith(("web/", "storefront/", ".github/workflows/web-ci"))]
        self.assertTrue(backend_only)
        for f in backend_only:
            _, (v, rows, _) = ev([f], [cr(n) for n in PHP])
            self.assertEqual(v, "pass", f)
            self.assertIn((HORIZON, "paths", "not required (path filter)", "-", "ok"), rows, f)
        # web / storefront PRs keep their own existing requirement and gain nothing from Horizon
        _, (v, rows, _) = ev(["web/src/x.tsx"], [cr(n) for n in PHP] + [cr("web build (Next.js)")])
        self.assertEqual(v, "pass")
        self.assertIn((HORIZON, "paths", "not required (path filter)", "-", "ok"), rows)

    def test_horizon_pr_blocks_on_failure_and_waits_when_missing(self):
        php = [cr(n) for n in PHP]
        self.assertEqual(ev(HZ_FILES, php + [cr(HORIZON)])[1][0], "pass")
        for concl in ("failure", "cancelled", "skipped", "neutral", "timed_out", "action_required", "stale", None):
            self.assertEqual(ev(HZ_FILES, php + [cr(HORIZON, conclusion=concl)])[1][0], "fail", concl)
        self.assertEqual(ev(HZ_FILES, php)[1][0], "wait")                       # not reported yet
        self.assertEqual(ev(HZ_FILES, php, elapsed=4200)[1][0], "fail")        # never reported -> deadline
        wf = [{"path": HZ_WF, "status": "completed", "conclusion": "success"}]
        self.assertEqual(ev(HZ_FILES, php, wf_runs=wf)[1][0], "fail")          # workflow ran, job never reported
        self.assertEqual(ev(HZ_FILES, php + [cr(HORIZON, app="evil-app")], elapsed=30)[1][0], "wait")
        self.assertEqual(ev(HZ_FILES, php + [cr(HORIZON, status="in_progress", conclusion=None)])[1][0], "wait")

    def test_unrelated_pr_is_not_blocked_by_a_stray_failing_horizon_run(self):
        """A Horizon run that nevertheless exists on an unrelated PR is judged like any present check (strict, fail-closed)."""
        php = [cr(n) for n in PHP]
        self.assertEqual(ev(["docs/a.md"], php + [cr(HORIZON, conclusion="failure")])[1][0], "fail")
        self.assertEqual(ev(["docs/a.md"], php + [cr(HORIZON)])[1][0], "pass")


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

    HZ = "horizon-eval-ci.yml"

    def test_horizon_workflow_cannot_be_path_filtered_or_skipped(self):
        cases = {
            # tier=paths REQUIRES a pull_request.paths filter; removing it would make the check run (and be required) everywhere
            "pull_request path filter removed": ("  pull_request:\n    branches: ['**']\n    paths: ['scripts/horizon-eval/**', '.github/workflows/horizon-eval-ci.yml', '.github/ci-gate/**']\n", "  pull_request:\n    branches: ['**']\n", "tier=paths but"),
            "job-level if": ("    name: Horizon dry-run evaluator (tests)\n", "    name: Horizon dry-run evaluator (tests)\n    if: github.actor != 'x'\n", "job-level `if`"),
            "job continue-on-error": ("    name: Horizon dry-run evaluator (tests)\n", "    name: Horizon dry-run evaluator (tests)\n    continue-on-error: true\n", "continue-on-error"),
            "step continue-on-error": ("      - name: Contract table", "      - continue-on-error: true\n        name: Contract table", "continue-on-error"),
            "rename": ("name: Horizon dry-run evaluator (tests)", "name: Horizon tests", "name drift"),
            "no pull_request": ("  pull_request:\n    branches: ['**']\n    paths: ['scripts/horizon-eval/**', '.github/workflows/horizon-eval-ci.yml', '.github/ci-gate/**']\n", "", "no longer triggers on pull_request"),
        }
        for label, (old, new, expect) in cases.items():
            errs = self._mutate(self.HZ, old, new)
            self.assertTrue(any(expect in e for e in errs), (label, errs))

    def test_horizon_test_step_cannot_be_neutered(self):
        cases = {
            "floor removed": (re.search(r"MIN_TESTS=\d+", (g.ROOT / ".github/workflows/horizon-eval-ci.yml").read_text(encoding="utf-8")).group(0), "FLOOR=1", "MIN_TESTS="),
            "clean-OK check removed": ('if [ "$last" != "OK" ]', "if false", '!= \"OK\"'),
            "pipefail removed": ("set -o pipefail\n          set -eu\n          MIN_TESTS", "set -eu\n          MIN_TESTS", "pipefail"),
            "swallowed failure": ("-v 2>&1 | tee", "-v 2>&1 || true | tee", "|| true"),
            "forced success": ('echo "tests run:', "exit 0\n          echo \"tests run:", "exit 0"),
            "errexit disabled": ("          set -eu\n          MIN_TESTS", "          set -eu\n          set +e\n          MIN_TESTS", "set +e"),
            "exit overridden": ("          MIN_TESTS=", "          exit() { return 0; }\n          MIN_TESTS=", "exit()"),
            "trap": ("          MIN_TESTS=", "          trap 'exit 0' ERR\n          MIN_TESTS=", "trap "),
            "filtered discovery": ("unittest discover -s scripts/horizon-eval -v", "unittest discover -s scripts/horizon-eval -p test_contract.py -v", " -p "),
            "test step removed": ("python -I -B -m unittest discover -s scripts/horizon-eval -v", "python -I -B -m unittest --help", "no step runs"),
        }
        for label, (old, new, expect) in cases.items():
            errs = self._mutate(self.HZ, old, new)
            self.assertTrue(any(expect in e for e in errs), (label, errs))

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
        # قائمة pull_request.paths (آخر قائمة قبل jobs) تُستبدل بـ paths-ignore، بصرف النظر عن تنسيقها.
        text = re.sub(r"(  pull_request:\n    branches: \['\*\*'\]\n)    paths:.*?(?=\n\njobs)",
                      r"\1    paths-ignore: ['docs/**']", p.read_text(encoding="utf-8"), count=1, flags=re.S)
        p.write_text(text, encoding="utf-8")
        errs = g.validate(d)[0]
        self.assertTrue(any("paths-ignore" in e for e in errs), errs)

    def test_duplicate_producer_of_a_required_check_name_is_an_error(self):
        d = self._sandbox()
        (d / ".github" / "workflows" / "impostor.yml").write_text(
            "name: Impostor\non:\n  pull_request:\njobs:\n  fake:\n    name: Horizon dry-run evaluator (tests)\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n")
        errs, _ = g.validate(d)
        self.assertTrue(any("more than one PR-triggered job" in e and HORIZON in e for e in errs), errs)
        # also inside the declared workflow itself
        d = self._sandbox()
        p = d / ".github" / "workflows" / "horizon-eval-ci.yml"
        p.write_text(p.read_text(encoding="utf-8") + "  second:\n    name: Horizon dry-run evaluator (tests)\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n", encoding="utf-8")
        errs, _ = g.validate(d)
        self.assertTrue(any("more than one PR-triggered job" in e for e in errs), errs)

    def test_unparseable_job_name_in_a_declared_workflow_is_an_error(self):
        """Codex P1: `name: ${{ 'Required name' }}` is rejected by job_names(), which used to be only a warning, so the
        impostor escaped duplicate detection. In a workflow that hosts required checks it must fail validation."""
        d = self._sandbox()
        p = d / ".github" / "workflows" / "horizon-eval-ci.yml"
        p.write_text(p.read_text(encoding="utf-8")
                     + "  impostor:\n    needs: horizon-eval\n    if: always()\n    name: ${{ 'Horizon dry-run evaluator (tests)' }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n",
                     encoding="utf-8")
        errs, _ = g.validate(d)
        self.assertTrue(any("cannot evaluate" in e and "impostor" in e for e in errs), errs)
        # a workflow that hosts NO required check keeps the old warning-only behaviour
        d = self._sandbox()
        (d / ".github" / "workflows" / "other.yml").write_text(
            "name: Other\non:\n  pull_request:\njobs:\n  x:\n    name: ${{ github.ref }}\n    runs-on: ubuntu-latest\n    steps: []\n")
        errs, warns = g.validate(d)
        self.assertEqual(errs, [])
        self.assertTrue(any("other.yml" in w for w in warns))

    def test_matrix_axis_missing_from_the_name_counts_as_duplicate_producers(self):
        """Codex P1: GitHub creates one same-named check run per combination of an axis the name does not mention."""
        self.assertEqual(g.job_names("j", {"name": "Fixed", "strategy": {"matrix": {"v": ["a", "b"]}}}), ["Fixed", "Fixed"])
        self.assertEqual(g.job_names("j", {"name": "N ${{ matrix.db }}", "strategy": {"matrix": {"db": ["x", "y"], "v": ["a", "b", "c"]}}}),
                         ["N x"] * 3 + ["N y"] * 3)
        self.assertEqual(g.job_names("j", {"name": "Fixed"}), ["Fixed"])
        with self.assertRaises(g.GateError):
            g.job_names("j", {"name": "Fixed", "strategy": {"matrix": "${{ fromJson(needs.x.outputs.m) }}"}})
        for bad in ("${{ fromJSON('[\"a\", \"b\"]') }}", "scalar", 3):  # Codex P1: an expression-valued axis is not a list
            with self.assertRaises(g.GateError, msg=repr(bad)):
                g.job_names("j", {"name": "Fixed", "strategy": {"matrix": {"variant": bad}}})
        # ...and inside a workflow that hosts a required check that becomes a validation error
        d = self._sandbox()
        p = d / ".github" / "workflows" / "horizon-eval-ci.yml"
        t = p.read_text(encoding="utf-8")
        p.write_text(t.replace("    timeout-minutes: 10\n", "    timeout-minutes: 10\n    strategy:\n      matrix:\n        variant: ${{ fromJSON('[\"checked\", \"bypass\"]') }}\n", 1), encoding="utf-8")
        errs, _ = g.validate(d)
        self.assertTrue(any("cannot evaluate" in e for e in errs), errs)
        d = self._sandbox()
        p = d / ".github" / "workflows" / "horizon-eval-ci.yml"
        t = p.read_text(encoding="utf-8")
        old = "    timeout-minutes: 10\n"
        self.assertIn(old, t)
        p.write_text(t.replace(old, old + "    strategy:\n      matrix:\n        variant: [checked, bypass]\n", 1), encoding="utf-8")
        errs, _ = g.validate(d)
        self.assertTrue(any("more than one PR-triggered job" in e for e in errs), errs)

    def test_step_level_if_on_a_guarded_test_step_is_rejected(self):
        """Codex P1: `if: false` on the guarded step leaves the job green without running a single test."""
        errs = self._mutate("horizon-eval-ci.yml", "      - name: Evaluator tests (unit + contract + mutation + static guards)\n",
                            "      - name: Evaluator tests (unit + contract + mutation + static guards)\n        if: false\n")
        self.assertTrue(any("step-level `if`" in e for e in errs), errs)
        # an `if` on an unguarded diagnostics step stays allowed (the PHP workflow has one)
        self.assertEqual(g.validate()[0], [])

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

    def test_horizon_push_twin_cannot_mask_pr_failure(self):
        wf = [wfr(self.CI, 1, event="push"), wfr(self.CI, 2),
              wfr(HZ_WF, 3, event="push"), wfr(HZ_WF, 4)]
        raw = [scr(PHP[0], 2, 20), scr(PHP[1], 2, 21), scr(HORIZON, 4, 40, conclusion="failure"),
               scr(HORIZON, 3, 90)]  # push-event twin, higher id, green
        bound, mine = g.bind_check_runs(raw, wf, SHA)
        exp = g.expected_checks(M, DOCS, HZ_FILES)
        self.assertEqual(g.evaluate(M, exp, bound, mine, 60, 4200)[0], "fail")

    def test_impostor_check_from_another_workflow_does_not_satisfy_a_required_check(self):
        """Codex P1: a PR-triggered job in ANOTHER workflow named like a required check (same github-actions app)
        must not count; only the suite of the manifest-declared workflow does."""
        wf = [wfr(self.CI, 2), wfr(HZ_WF, 4)]
        raw = [scr(PHP[0], 2, 20), scr(PHP[1], 2, 21),
               scr(HORIZON, 2, 90),                       # impostor: same name, reported by the PHP workflow's suite
               scr(HORIZON, 4, 40, conclusion="failure")]  # the real evaluator job failed
        bound, mine = g.bind_check_runs(raw, wf, SHA)
        kept = g.restrict_to_declared_workflows(M, bound, mine)
        self.assertEqual({r["id"] for r in kept if r["name"] == HORIZON}, {40})
        exp = g.expected_checks(M, DOCS, HZ_FILES)
        self.assertEqual(g.evaluate(M, exp, kept, mine, 60, 4200)[0], "fail")

    def test_impostor_alone_never_reports_the_required_check(self):
        wf = [wfr(self.CI, 2)]  # the Horizon workflow never ran
        raw = [scr(PHP[0], 2, 20), scr(PHP[1], 2, 21), scr(HORIZON, 2, 90)]
        bound, mine = g.bind_check_runs(raw, wf, SHA)
        kept = g.restrict_to_declared_workflows(M, bound, mine)
        self.assertNotIn(HORIZON, {r["name"] for r in kept})
        exp = g.expected_checks(M, DOCS, HZ_FILES)
        self.assertEqual(g.evaluate(M, exp, kept, mine, 4200, 4200)[0], "fail")

    def test_unknown_suite_is_dropped_and_unlisted_names_pass_through(self):
        wf = [wfr(self.CI, 2)]
        stray = scr(PHP[0], 99, 5)
        other = scr("some unlisted job", 2, 6)
        self.assertEqual(g.restrict_to_declared_workflows(M, [stray, other], wf), [other])

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

    def _horizon(self, m):
        return next(c for c in m["checks"] if c["name"] == HORIZON)

    def test_removing_horizon_check_fails(self):
        b, h = self._pair()
        self._edit_manifest(h, lambda m: m["checks"].remove(self._horizon(m)))
        self.assertTrue(any(HORIZON in e and "removed" in e for e in g.compare_baseline(b, h)))

    def test_demoting_horizon_check_fails(self):
        b, h = self._pair()
        self._edit_manifest(h, lambda m: self._horizon(m).update(tier="advisory"))
        self.assertTrue(any(HORIZON in e and "tier weakened" in e for e in g.compare_baseline(b, h)))

    def test_repointing_horizon_check_fails(self):
        b, h = self._pair()
        self._edit_manifest(h, lambda m: self._horizon(m).update(workflow=".github/workflows/ci.yml", job="test"))
        self.assertTrue(any(HORIZON in e and "different workflow/job" in e for e in g.compare_baseline(b, h)))

    def test_shrinking_horizon_guard_fails(self):
        b, h = self._pair()
        self._edit_manifest(h, lambda m: self._horizon(m)["guard"]["forbidden"].remove("|| true"))
        self.assertTrue(any(HORIZON in e and "guard.forbidden" in e for e in g.compare_baseline(b, h)))
        b, h = self._pair()
        self._edit_manifest(h, lambda m: self._horizon(m)["guard"]["require"].remove("MIN_TESTS="))
        self.assertTrue(any(HORIZON in e and "guard.require" in e for e in g.compare_baseline(b, h)))

    def test_narrowing_the_horizon_path_filter_fails(self):
        """Dropping a pattern would silently stop requiring the check for those files."""
        for dropped in ("scripts/horizon-eval/**", ".github/workflows/horizon-eval-ci.yml", ".github/ci-gate/**"):
            b, h = self._pair()
            p = h / HZ_WF
            t = p.read_text(encoding="utf-8")
            self.assertIn(f"'{dropped}'", t)
            p.write_text(t.replace(f"'{dropped}', ", "").replace(f", '{dropped}'", ""), encoding="utf-8")
            errs = g.compare_baseline(b, h)
            self.assertTrue(any(HORIZON in e and "paths lost" in e and dropped in e for e in errs), (dropped, errs))

    def test_widening_the_horizon_path_filter_is_allowed(self):
        b, h = self._pair()
        p = h / HZ_WF
        t = p.read_text(encoding="utf-8")
        p.write_text(t.replace("'.github/ci-gate/**']", "'.github/ci-gate/**', 'docs/autonomous-engineering/**']"), encoding="utf-8")
        self.assertEqual(g.compare_baseline(b, h), [])

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
        head, sep, tail = t.partition("  pull_request:\n")
        p.write_text(head + sep + tail.replace("      - 'web/**'\n", "", 1))
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
    """Scripted GitHub: one PR (docs-only diff unless `files` says otherwise) whose PR-event run reports `results`."""
    head = SHA
    files = ["docs/a.md"]
    impostor = False  # a green job named like the Horizon check, reported by the PHP workflow's suite

    def __init__(self, results, head=None):
        self.results, self.head_now = results, head or SHA

    def get(self, path, params=None):
        assert path == "pulls/5"
        return {"state": "open", "head": {"sha": self.head_now}, "base": {"sha": "c" * 40}, "merge_commit_sha": "d" * 40}

    def pages(self, path, key, params=None):
        if path == "pulls/5/files":
            return [{"filename": f} for f in self.files]
        if path == "actions/runs":
            runs = [wfr(".github/workflows/ci.yml", 1, event="push"),
                    wfr(".github/workflows/ci.yml", 2, status="completed", conclusion="success")]
            if self.files == HZ_FILES:  # the path-filtered workflow only triggers for Horizon-related diffs
                runs += [wfr(HZ_WF, 3, event="push"), wfr(HZ_WF, 4, status="completed", conclusion="success")]
            return runs
        if path == f"commits/{SHA}/check-runs":
            return ([scr(PHP[0], 1, 1), scr(PHP[1], 1, 2)] +  # push-event twins, always green
                    ([scr(HORIZON, 3, 3)] if self.files == HZ_FILES else []) +
                    [scr(n, 4 if n == HORIZON else 2, 10 + i, conclusion=c) for i, (n, c) in enumerate(self.results.items())] +
                    ([scr(HORIZON, 2, 99)] if self.impostor else []))
        raise AssertionError(path)


class EndToEnd(unittest.TestCase):
    def _run(self, results, head=None, timeout=1, files=None, impostor=False):
        orig = g.Api
        FakeApi.files = files or ["docs/a.md"]
        FakeApi.impostor = impostor
        g.Api = lambda repo, token: FakeApi(results, head)
        os.environ.update(GITHUB_REPOSITORY="o/r", GITHUB_TOKEN="t")
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        try:
            args = argparse.Namespace(root=str(g.ROOT), base_root=str(g.ROOT), pr=5, sha=SHA,
                                      timeout_minutes=timeout, interval=0)
            with contextlib.redirect_stdout(io.StringIO()):  # keep CI logs free of a scary "FAIL" table
                return g.run_gate(args)
        finally:
            g.Api = orig
            FakeApi.files, FakeApi.impostor = ["docs/a.md"], False

    def test_green(self):
        self.assertEqual(self._run({PHP[0]: "success", PHP[1]: "success"}), 0)

    def test_pr_failure_not_hidden_by_green_push_twin(self):
        self.assertEqual(self._run({PHP[0]: "success", PHP[1]: "failure"}), 1)

    def test_unrelated_pr_is_green_without_any_horizon_run(self):
        """End to end through run_gate: an accounting/POS/storefront-style PR is unaffected by the Horizon requirement."""
        for f in ("app/Services/Accounting/LedgerService.php", "app/Http/Controllers/Api/PosSessionController.php", "docs/a.md"):
            self.assertEqual(self._run(GREEN, files=[f], timeout=0), 0, f)

    def test_horizon_pr_requires_and_is_blocked_by_the_horizon_check(self):
        self.assertEqual(self._run({**GREEN, HORIZON: "success"}, files=HZ_FILES), 0)
        self.assertEqual(self._run({**GREEN, HORIZON: "failure"}, files=HZ_FILES), 1)   # blocks on test failure
        self.assertEqual(self._run(GREEN, files=HZ_FILES, timeout=0), 1)                 # required, never reported
        self.assertEqual(self._run({**GREEN, HORIZON: "failure"}, files=HZ_FILES, impostor=True), 1)
        self.assertEqual(self._run(GREEN, files=HZ_FILES, timeout=0, impostor=True), 1)  # impostor cannot stand in

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

"""PG-SHARD final closure (requirement 6): with the shard group `superseding`, CI Gate can only pass when ALL of these hold — no bypass.

  1. both shards succeeded, 2. the exactly-once proof job (which carries the retired `php artisan test (L11, pgsql)` context) succeeded,
  3. AIA-0.4 (strict) and 4. the watchdog (role, tests, wrapper, diagnostics) and the lock limit are present, unmasked and unconditional in the shard job.

Layers (each tested here or in its own file): the verdict (`evaluate`: only conclusion=success counts; skipped/failed/cancelled/missing never pass),
the trusted structure check (`validate`: every safeguard step exists exactly once, is never skipped or masked — test_shard_safety_parity.py), the baseline
(`compare_baseline`: nothing already required can be removed or weakened — test_required_steps.py / test_additive_to_superseding.py), and `needs`
(a failed shard skips the proof job, and a skipped job is not a success for the gate).
Run: python3 -m unittest discover -s scripts/ci-gate"""
import unittest

import ci_gate as g

CI = ".github/workflows/ci.yml"
LEGACY = "php artisan test (L11, pgsql)"
S1, S2 = "php artisan test (L11, pgsql, shard 1)", "php artisan test (L11, pgsql, shard 2)"
SQLITE = "php artisan test (L11, sqlite)"
PERF = "PostgreSQL feed-lock performance (COPS-H1-1)"
ALWAYS = [SQLITE, LEGACY, PERF, S1, S2]
M = g.load_manifest()
DOCS = {c["workflow"]: g.load_yaml(g.ROOT / c["workflow"]) for c in M["checks"]}
_id = iter(range(1, 100_000))


def cr(name, status="completed", conclusion="success", app="github-actions"):
    return {"id": next(_id), "name": name, "status": status, "conclusion": conclusion, "app": {"slug": app}}


def verdict(runs, files=("docs/a.md",), elapsed=60, deadline=4200, wf=None):
    exp = g.expected_checks(M, DOCS, list(files))
    wf = wf if wf is not None else [{"path": CI, "status": "in_progress"}]
    return g.evaluate(M, exp, runs, wf, elapsed, deadline)[0]


def green(skip=()):
    return [cr(n) for n in ALWAYS if n not in skip]


class TheGateNeedsEveryContext(unittest.TestCase):
    def test_all_green_passes(self):
        self.assertEqual(verdict(green()), "pass")

    def test_the_live_manifest_requires_exactly_these_always_contexts(self):
        self.assertEqual(sorted(c["name"] for c in M["checks"] if c["tier"] == "always"), sorted(ALWAYS))

    def test_each_context_must_conclude_success(self):
        for name in (S1, S2, LEGACY):
            for concl in ("failure", "cancelled", "skipped", "neutral", "timed_out", "action_required", "stale", None):
                runs = [cr(n, conclusion=concl) if n == name else cr(n) for n in ALWAYS]
                self.assertEqual(verdict(runs), "fail", (name, concl))

    def test_a_skipped_proof_because_a_shard_failed_is_a_failure_not_a_pass(self):
        # GitHub skips a job whose `needs` failed; for branch protection that can look green, but CI Gate only accepts conclusion=success
        runs = [cr(S1, conclusion="failure"), cr(S2), cr(LEGACY, conclusion="skipped"), cr(SQLITE), cr(PERF)]
        self.assertEqual(verdict(runs), "fail")

    def test_a_missing_context_never_passes(self):
        for name in (S1, S2, LEGACY):
            self.assertEqual(verdict(green(skip=(name,))), "wait")  # not reported yet...
            self.assertEqual(verdict(green(skip=(name,)), elapsed=4200), "fail")  # ...and a failure at the deadline
            finished = [{"path": CI, "status": "completed", "conclusion": "success"}]
            self.assertEqual(verdict(green(skip=(name,)), wf=finished), "fail")  # workflow done without reporting it

    def test_an_unfinished_context_waits(self):
        for name in (S1, S2, LEGACY):
            runs = [cr(n, status="in_progress", conclusion=None) if n == name else cr(n) for n in ALWAYS]
            self.assertEqual(verdict(runs), "wait")

    def test_a_forged_context_from_another_app_does_not_count(self):
        for name in (S1, S2, LEGACY):
            runs = [cr(n, app="evil-app") if n == name else cr(n) for n in ALWAYS]
            self.assertIn(verdict(runs), ("wait",))  # latest_by_name ignores non-github-actions apps: treated as not reported

    def test_a_check_run_with_a_declared_name_from_another_workflow_is_dropped(self):
        forged = {"id": next(_id), "name": LEGACY, "status": "completed", "conclusion": "success", "app": {"slug": "github-actions"}, "check_suite": {"id": 99}}
        honest = [dict(cr(n), check_suite={"id": 1}) for n in ALWAYS if n != LEGACY]
        wf = [{"check_suite_id": 1, "path": CI}, {"check_suite_id": 99, "path": ".github/workflows/other.yml"}]
        kept = g.restrict_to_declared_workflows(M, honest + [forged], wf)
        self.assertNotIn(forged, kept)

    def test_a_third_shard_is_count_drift_and_fails_even_when_green(self):
        runs = green() + [cr("php artisan test (L11, pgsql, shard 3)")]
        self.assertEqual(verdict(runs), "fail")


class TheProofJobCannotRunWithoutTheShards(unittest.TestCase):
    def test_the_proof_job_needs_the_shard_job_and_is_unconditional(self):
        jobs = DOCS[CI]["jobs"]
        proof = jobs["test-pg-shards-proof"]
        self.assertEqual(proof["needs"], ["test-pg-shards"])
        for forbidden in ("if", "continue-on-error"):
            self.assertNotIn(forbidden, proof)
        self.assertEqual(proof["name"], LEGACY)

    def test_the_gate_validates_the_whole_structure_clean(self):
        self.assertEqual(g.validate()[0], [])


class EverySafeguardIsARequiredStep(unittest.TestCase):
    """The safeguards that make a shard job fail when AIA-0.4 / the watchdog tests / the lock setup fail are exactly the manifest's required_steps."""

    def test_labels(self):
        grp = M["shard_groups"][0]
        self.assertEqual(grp["status"], "superseding")
        self.assertEqual({r["label"] for r in grp["required_steps"]}, set(g.SUPERSEDE_REQUIRED_LABELS))

    def test_each_required_step_is_found_exactly_once_unconditionally_in_the_live_workflow(self):
        grp = M["shard_groups"][0]
        job = DOCS[CI]["jobs"][grp["job"]]
        self.assertEqual(g.check_required_steps(grp["id"], grp, job), [])
        for rs in grp["required_steps"]:
            hit = [s for s in job["steps"] if g._step_matches(s, rs)]
            self.assertEqual(len(hit), 1, rs["label"])
            self.assertNotIn("continue-on-error", hit[0], rs["label"])


if __name__ == "__main__":
    unittest.main()

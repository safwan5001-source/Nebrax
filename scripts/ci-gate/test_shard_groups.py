"""PG-SHARD-GATE-1: CI Gate shard groups (inert until a manifest declares one).

Every case builds a throw-away copy of the real `.github/` tree, declares a shard group in its manifest and patches the
shard/proof jobs into its ci.yml, so nothing here touches the live manifest or workflow.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import yaml

import ci_gate as g

REAL = g.ROOT
CI = ".github/workflows/ci.yml"
LEGACY = "php artisan test (L11, pgsql)"
SQLITE = "php artisan test (L11, sqlite)"
PERF = "PostgreSQL feed-lock performance (COPS-H1-1)"
S1, S2, S3 = ("php artisan test (L11, pgsql, shard %d)" % i for i in (1, 2, 3))
PROOF = "php artisan test (L11, pgsql, shards proven)"
FORBIDDEN = ["--filter", "--group", "--exclude-group", "--testsuite", "--stop-on", "|| true"]
GROUP = {
    "id": "pgsql-suite", "status": "additive", "supersedes": LEGACY, "workflow": CI, "job": "test-pg-shards",
    "axis": "shard", "count": 2, "shard_name": "php artisan test (L11, pgsql, shard {i})",
    "guard": {"step_run_contains": "php artisan test", "require": ["set -o pipefail"], "forbidden": FORBIDDEN},
    "proof": {"name": PROOF, "job": "test-pg-shards-proof",
              "guard": {"step_run_contains": "shard_proof.py", "require": ["set -euo pipefail"], "forbidden": ["|| true"]}},
}


def shard_job(count=2, name="php artisan test (L11, pgsql, shard ${{ matrix.shard }})", extra=""):
    return {"name": name, "runs-on": "ubuntu-latest",
            "strategy": {"fail-fast": False, "matrix": {"shard": list(range(1, count + 1))}},
            "steps": [{"name": "Run shard", "run": "set -o pipefail\nphp artisan test --parallel --processes=4 " + extra + "2>&1 | tee out.txt\n"}]}


def proof_job(count=2, run=None, name=PROOF):
    return {"name": name, "runs-on": "ubuntu-latest", "needs": ["test-pg-shards"],
            "steps": [{"name": "Prove", "run": run or f"set -euo pipefail\npython3 scripts/ci-gate/shard_proof.py --root shards --shards {count}\n"}]}


class Sandbox:
    """A copy of the real `.github/` with an optional shard group + jobs applied. `mutate(manifest, doc)` may edit both."""

    def __init__(self, group=None, shards=True, mutate=None, retire_legacy=False):
        self.root = Path(tempfile.mkdtemp())
        shutil.copytree(REAL / ".github", self.root / ".github")
        mp = self.root / ".github/ci-gate/required-checks.json"
        manifest = json.loads(mp.read_text(encoding="utf-8"))
        doc = yaml.safe_load((self.root / CI).read_text(encoding="utf-8"))
        grp = copy.deepcopy(group) if group else None
        if grp:
            manifest["shard_groups"] = [grp]
            if shards:
                n = grp["count"] if isinstance(grp["count"], int) and not isinstance(grp["count"], bool) else 2
                doc["jobs"][grp["job"]] = shard_job(n)
                if grp["proof"].get("job"):
                    doc["jobs"][grp["proof"]["job"]] = proof_job(n, name=grp["proof"].get("name", PROOF))
        if retire_legacy:  # the superseded check leaves `checks` and the `test` matrix; its name lives on the proof job
            manifest["checks"] = [c for c in manifest["checks"] if c["name"] != LEGACY]
            doc["jobs"]["test"]["strategy"]["matrix"]["db"] = ["sqlite"]
        if mutate:
            mutate(manifest, doc)
        mp.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        (self.root / CI).write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")

    def validate(self):
        return g.validate(self.root)[0]

    def manifest(self):
        return g.load_manifest(self.root / ".github/ci-gate/required-checks.json")

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


def superseding(**kw):
    grp = copy.deepcopy(GROUP)
    grp["status"] = "superseding"
    grp["proof"]["name"] = LEGACY
    return grp


class Base(unittest.TestCase):
    def sb(self, *a, **kw):
        s = Sandbox(*a, **kw)
        self.addCleanup(s.cleanup)
        return s

    def has(self, errs, needle):
        self.assertTrue(any(needle in e for e in errs), errs)


# ───────────────────────────── backward compatibility ─────────────────────────────

class BackwardCompatibility(Base):
    def test_live_manifest_declares_no_group_and_expands_to_itself(self):
        raw = json.loads((REAL / ".github/ci-gate/required-checks.json").read_text(encoding="utf-8"))
        self.assertNotIn("shard_groups", raw)  # PG-SHARD-GATE-1 must not activate sharding
        m = g.load_manifest()
        self.assertEqual(m["shard_groups"], [])
        self.assertEqual([c["name"] for c in m["checks"]], [c["name"] for c in raw["checks"]])
        self.assertTrue(all("_group" not in c for c in m["checks"]))

    def test_empty_or_null_groups_equal_absent_groups(self):
        for val in ([], None):
            s = self.sb(mutate=lambda m, d, v=val: m.__setitem__("shard_groups", v))
            self.assertEqual(s.manifest()["checks"], g.load_manifest()["checks"])
            self.assertEqual(s.validate(), g.validate(REAL)[0])

    def test_live_repo_still_validates_clean(self):
        self.assertEqual(g.validate(REAL)[0], [])

    def test_group_free_sandbox_equals_live_validation(self):
        s = self.sb()
        self.assertEqual(g.validate(s.root), g.validate(REAL))

    def test_baseline_compare_without_groups_is_unchanged(self):
        self.assertEqual(g.compare_baseline(REAL, REAL), [])

    def test_existing_checks_keep_their_names_with_a_group(self):
        s = self.sb(GROUP)
        names = [c["name"] for c in s.manifest()["checks"]]
        for n in (SQLITE, LEGACY, PERF):
            self.assertIn(n, names)
        self.assertEqual(sorted(set(names) - {c["name"] for c in g.load_manifest()["checks"]}), sorted([S1, S2, PROOF]))


# ───────────────────────────── validation: positive ─────────────────────────────

class ValidCompliantGroups(Base):
    def test_additive_group_is_clean_and_keeps_the_legacy_check(self):
        s = self.sb(GROUP)
        self.assertEqual(s.validate(), [])
        m = s.manifest()
        self.assertIn(LEGACY, [c["name"] for c in m["checks"] if c.get("_role") is None])

    def test_superseding_group_is_clean_and_proof_keeps_the_legacy_name(self):
        s = self.sb(superseding(), retire_legacy=True)
        self.assertEqual(s.validate(), [])
        by = {c["name"]: c for c in s.manifest()["checks"]}
        self.assertEqual(by[LEGACY]["_role"], "proof")
        self.assertEqual(by[LEGACY]["job"], "test-pg-shards-proof")

    def test_group_checks_are_blocking_always(self):
        m = self.sb(GROUP).manifest()
        for n in (S1, S2, PROOF):
            c = next(c for c in m["checks"] if c["name"] == n)
            self.assertEqual(c["tier"], "always")

    def test_proof_guard_implicitly_requires_the_shard_count(self):
        m = self.sb(GROUP).manifest()
        c = next(c for c in m["checks"] if c["name"] == PROOF)
        self.assertIn("--shards 2", c["guard"]["require"])

    def test_three_shards_validate(self):
        grp = copy.deepcopy(GROUP)
        grp["count"] = 3
        self.assertEqual(self.sb(grp).validate(), [])


# ───────────────────────────── validation: negatives (structural, manifest only) ─────────────────────────────

class StructuralRejections(Base):
    def rejects(self, grp, needle):
        with self.assertRaises(g.GateError) as cm:
            self.sb(grp, shards=False).manifest()
        self.assertIn(needle, str(cm.exception))

    def mut(self, fn):
        grp = copy.deepcopy(GROUP)
        fn(grp)
        return grp

    def test_shard_name_without_index_would_let_one_shard_mask_another(self):
        self.rejects(self.mut(lambda x: x.update(shard_name="php artisan test (L11, pgsql, shard)")), "must contain {i}")

    def test_duplicate_group_ids(self):
        s = self.sb(GROUP)
        mp = s.root / ".github/ci-gate/required-checks.json"
        m = json.loads(mp.read_text(encoding="utf-8"))
        m["shard_groups"].append(copy.deepcopy(m["shard_groups"][0]))
        mp.write_text(json.dumps(m), encoding="utf-8")
        with self.assertRaises(g.GateError) as cm:
            g.load_manifest(mp)
        self.assertIn("duplicate shard group id", str(cm.exception))

    def test_shard_name_colliding_with_an_existing_check(self):
        grp = self.mut(lambda x: x["proof"].update(name=SQLITE))
        self.rejects(grp, "duplicate check name")

    def test_additive_proof_may_not_take_the_legacy_name(self):
        self.rejects(self.mut(lambda x: x["proof"].update(name=LEGACY)), "must not reuse the superseded name")

    def test_superseding_must_keep_the_context_name(self):
        grp = superseding()
        grp["proof"]["name"] = PROOF
        self.rejects(grp, "needs an owner decision on Branch Protection")

    def test_superseding_cannot_coexist_with_the_legacy_entry(self):
        with self.assertRaises(g.GateError) as cm:
            self.sb(superseding()).manifest()  # legacy NOT retired from `checks`
        self.assertIn("remove it from `checks`", str(cm.exception))

    def test_additive_must_supersede_a_declared_always_check(self):
        self.rejects(self.mut(lambda x: x.update(supersedes="no such check")), "must supersede a declared tier=always check")
        self.rejects(self.mut(lambda x: x.update(supersedes="web build (Next.js)")), "must supersede a declared tier=always check")

    def test_count_bounds(self):
        for bad in (1, 0, -2, 17, True, "2", 2.0):
            self.rejects(self.mut(lambda x, b=bad: x.update(count=b)), "count must be an integer")

    def test_bad_status_and_missing_keys(self):
        self.rejects(self.mut(lambda x: x.update(status="parallel")), "bad status")
        for k in ("id", "supersedes", "workflow", "job", "axis", "count", "shard_name", "guard", "proof"):
            with self.subTest(missing=k):
                grp = copy.deepcopy(GROUP)
                del grp[k]
                self.rejects(grp, f"missing {k!r}")
        for k in ("name", "job", "guard"):
            with self.subTest(proof_missing=k):
                grp = copy.deepcopy(GROUP)
                del grp["proof"][k]
                self.rejects(grp, f"proof missing {k!r}")

    def test_shard_guard_floor_cannot_be_weakened(self):
        for flag in FORBIDDEN:
            with self.subTest(forbidden=flag):
                self.rejects(self.mut(lambda x, f=flag: x["guard"].update(forbidden=[a for a in FORBIDDEN if a != f])),
                             "guard.forbidden lacks the mandatory")
        self.rejects(self.mut(lambda x: x["guard"].update(require=[])), "guard.require lacks the mandatory")
        self.rejects(self.mut(lambda x: x["guard"].update(step_run_contains="php artisan")), "step_run_contains must be")

    def test_proof_guard_floor_cannot_be_weakened(self):
        self.rejects(self.mut(lambda x: x["proof"]["guard"].update(require=["set -o pipefail"])), "guard.require lacks the mandatory")
        self.rejects(self.mut(lambda x: x["proof"]["guard"].update(forbidden=[])), "guard.forbidden lacks the mandatory")
        self.rejects(self.mut(lambda x: x["proof"]["guard"].update(step_run_contains="")), "step_run_contains is required")

    def test_additive_shard_guard_may_not_be_weaker_than_the_legacy_guard(self):
        def legacy_stricter(m, d):
            for c in m["checks"]:
                if c["name"] == LEGACY:
                    c["guard"]["forbidden"] = [*c["guard"]["forbidden"], "--bail"]
        with self.assertRaises(g.GateError) as cm:
            self.sb(GROUP, mutate=legacy_stricter).manifest()
        self.assertIn("weaker than the superseded check", str(cm.exception))

    def test_groups_must_be_a_list(self):
        s = self.sb()
        mp = s.root / ".github/ci-gate/required-checks.json"
        m = json.loads(mp.read_text(encoding="utf-8"))
        m["shard_groups"] = {"id": "x"}
        mp.write_text(json.dumps(m), encoding="utf-8")
        with self.assertRaises(g.GateError):
            g.load_manifest(mp)


# ───────────────────────────── validation: negatives (workflow shape) ─────────────────────────────

class WorkflowRejections(Base):
    def run_with(self, fn, grp=GROUP):
        def mutate(m, d):
            fn(d["jobs"])
        return self.sb(grp, mutate=mutate).validate()

    def test_duplicate_shard_names_in_the_workflow(self):
        e = self.run_with(lambda j: j["test-pg-shards"].update(name="php artisan test (L11, pgsql, shard 1)"))
        self.has(e, "duplicate or drifting names")

    def test_name_not_derived_from_the_axis_is_rejected(self):
        e = self.run_with(lambda j: j["test-pg-shards"].update(name="php artisan test (L11, pgsql, shard ${{ matrix.shard }}) x"))
        self.has(e, "name drift")

    def test_extra_matrix_value_is_count_drift(self):
        e = self.run_with(lambda j: j["test-pg-shards"]["strategy"]["matrix"].update(shard=[1, 2, 3]))
        self.has(e, "must be exactly [1, 2]")

    def test_missing_matrix_value_is_count_drift(self):
        e = self.run_with(lambda j: j["test-pg-shards"]["strategy"]["matrix"].update(shard=[1]))
        self.has(e, "must be exactly [1, 2]")

    def test_string_matrix_values_are_rejected(self):
        e = self.run_with(lambda j: j["test-pg-shards"]["strategy"]["matrix"].update(shard=["1", "2"]))
        self.has(e, "must be exactly [1, 2]")

    def test_hidden_second_matrix_axis_is_rejected(self):
        e = self.run_with(lambda j: j["test-pg-shards"]["strategy"]["matrix"].update(db=["pgsql", "sqlite"]))
        self.has(e, "exactly one matrix axis")

    def test_matrix_include_is_rejected(self):
        e = self.run_with(lambda j: j["test-pg-shards"]["strategy"]["matrix"].update(include=[{"shard": 9}]))
        self.has(e, "exactly one matrix axis")

    def test_missing_shard_job(self):
        e = self.run_with(lambda j: j.pop("test-pg-shards"))
        self.has(e, "not found")

    def test_missing_proof_job(self):
        e = self.run_with(lambda j: j.pop("test-pg-shards-proof"))
        self.has(e, "not found")

    def test_filter_flag_in_a_shard_step(self):
        e = self.run_with(lambda j: j["test-pg-shards"].update(steps=shard_job(extra="--filter=Ledger ")["steps"]))
        self.has(e, "forbidden '--filter'")

    def test_group_flag_in_a_shard_step(self):
        e = self.run_with(lambda j: j["test-pg-shards"].update(steps=shard_job(extra="--group=fast ")["steps"]))
        self.has(e, "forbidden '--group'")

    def test_masked_failure_in_a_shard_step(self):
        steps = [{"name": "Run shard", "run": "set -o pipefail\nphp artisan test --parallel 2>&1 | tee out.txt || true\n"}]
        e = self.run_with(lambda j: j["test-pg-shards"].update(steps=steps))
        self.has(e, "forbidden '|| true'")

    def test_lost_pipefail_in_a_shard_step(self):
        steps = [{"name": "Run shard", "run": "php artisan test --parallel 2>&1 | tee out.txt\n"}]
        e = self.run_with(lambda j: j["test-pg-shards"].update(steps=steps))
        self.has(e, "lacks required 'set -o pipefail'")

    def test_shard_test_step_skipped_by_if(self):
        e = self.run_with(lambda j: j["test-pg-shards"]["steps"][0].update({"if": "github.actor != 'x'"}))
        self.has(e, "step-level `if`")

    def test_shard_job_skipped_by_if(self):
        e = self.run_with(lambda j: j["test-pg-shards"].update({"if": "github.actor != 'x'"}))
        self.has(e, "job-level `if`")

    def test_shard_job_continue_on_error(self):
        e = self.run_with(lambda j: j["test-pg-shards"].update({"continue-on-error": True}))
        self.has(e, "continue-on-error")

    def test_shard_step_continue_on_error(self):
        e = self.run_with(lambda j: j["test-pg-shards"]["steps"][0].update({"continue-on-error": True}))
        self.has(e, "continue-on-error")

    def test_no_shard_test_step_at_all(self):
        e = self.run_with(lambda j: j["test-pg-shards"].update(steps=[{"name": "noop", "run": "true"}]))
        self.has(e, "no step runs 'php artisan test'")

    def test_proof_without_needs_runs_without_the_shards(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].pop("needs"))
        self.has(e, "must `needs` the shard job")

    def test_proof_needing_the_wrong_job(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(needs=["test"]))
        self.has(e, "must `needs` the shard job")

    def test_proof_needs_as_string_is_accepted(self):
        self.assertEqual(self.run_with(lambda j: j["test-pg-shards-proof"].update(needs="test-pg-shards")), [])

    def test_proof_job_skipped_by_if(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update({"if": "always()"}))
        self.has(e, "job-level `if`")

    def test_proof_continue_on_error(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update({"continue-on-error": True}))
        self.has(e, "continue-on-error")

    def test_proof_step_with_wrong_shard_count(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(steps=proof_job(count=1)["steps"]))
        self.has(e, "lacks required '--shards 2'")

    def test_proof_step_ignoring_failure(self):
        run = "set -euo pipefail\npython3 scripts/ci-gate/shard_proof.py --root shards --shards 2 || true\n"
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(steps=proof_job(run=run)["steps"]))
        self.has(e, "forbidden '|| true'")

    def test_proof_step_without_strict_shell(self):
        run = "python3 scripts/ci-gate/shard_proof.py --root shards --shards 2\n"
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(steps=proof_job(run=run)["steps"]))
        self.has(e, "lacks required 'set -euo pipefail'")

    def test_proof_step_never_runs_the_verifier(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(steps=[{"name": "Prove", "run": "set -euo pipefail\necho --shards 2\n"}]))
        self.has(e, "no step runs 'shard_proof.py'")

    def test_proof_step_skipped_by_if(self):
        steps = proof_job()["steps"]
        steps[0]["if"] = "false"
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(steps=steps))
        self.has(e, "step-level `if`")

    def test_proof_job_with_a_matrix(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(strategy={"matrix": {"x": [1, 2]}}))
        self.has(e, "proof job must not use a matrix")

    def test_proof_name_drift(self):
        e = self.run_with(lambda j: j["test-pg-shards-proof"].update(name="renamed proof"))
        self.has(e, "name drift")

    def test_shard_job_not_triggered_by_pull_request(self):
        def mutate(m, d):
            d["on"] = {"push": {"branches": ["main"]}}
            d.pop(True, None)
        e = self.sb(GROUP, mutate=mutate).validate()
        self.has(e, "no longer triggers on pull_request")

    def test_duplicate_producer_in_another_workflow(self):
        s = self.sb(GROUP)
        (s.root / ".github/workflows/impostor.yml").write_text(
            "name: impostor\non:\n  pull_request:\n    branches: ['**']\njobs:\n  fake:\n    name: " + S1 + "\n    runs-on: ubuntu-latest\n"
            "    steps:\n      - run: 'true'\n", encoding="utf-8")
        self.has(s.validate(), "produced by more than one PR-triggered job")

    def test_duplicate_producer_of_the_proof_name_in_the_same_workflow(self):
        e = self.run_with(lambda j: j.update(fake={"name": PROOF, "runs-on": "ubuntu-latest", "steps": [{"run": "true"}]}))
        self.has(e, "produced by more than one PR-triggered job")

    def test_missing_workflow_file(self):
        grp = copy.deepcopy(GROUP)
        grp["workflow"] = ".github/workflows/nope.yml"
        e = self.sb(grp, shards=False).validate()
        self.has(e, "workflow file missing")

    def test_superseding_group_with_legacy_still_in_the_matrix_is_a_duplicate_producer(self):
        s = self.sb(superseding(), retire_legacy=False, mutate=lambda m, d: m.__setitem__(
            "checks", [c for c in m["checks"] if c["name"] != LEGACY]))
        self.has(s.validate(), "produced by more than one PR-triggered job")


# ───────────────────────────── online verdict ─────────────────────────────

_ids = iter(range(1, 100_000))


def cr(name, conclusion="success", status="completed", app="github-actions", suite=None):
    r = {"id": next(_ids), "name": name, "status": status, "conclusion": conclusion, "app": {"slug": app}}
    if suite is not None:
        r["check_suite"] = {"id": suite}
    return r


class Verdict(Base):
    def setUp(self):
        self.s = self.sb(GROUP)
        self.m = self.s.manifest()
        self.docs = {c["workflow"]: g.load_yaml(self.s.root / c["workflow"]) for c in self.m["checks"]}
        self.base = [cr(n) for n in (SQLITE, LEGACY, PERF)]
        self.green = [*self.base, cr(S1), cr(S2), cr(PROOF)]

    def verdict(self, runs, m=None, wf_runs=None, elapsed=60, deadline=4200):
        m = m or self.m
        exp = g.expected_checks(m, self.docs, ["app/X.php"])
        wf = wf_runs if wf_runs is not None else [{"path": CI, "status": "in_progress"}]
        return g.evaluate(m, exp, runs, wf, elapsed, deadline)

    def row(self, rows, name):
        return next(r for r in rows if r[0] == name)

    def test_everything_green_passes(self):
        v, rows, _ = self.verdict(self.green)
        self.assertEqual(v, "pass", rows)

    def test_group_checks_are_expected_on_every_pr(self):
        exp = g.expected_checks(self.m, self.docs, ["README.md"])
        for n in (S1, S2, PROOF):
            self.assertEqual(exp[n], "always")

    def test_a_failed_shard_fails_the_gate(self):
        for conc in ("failure", "cancelled", "timed_out", "skipped", "neutral", "stale", "action_required", None):
            with self.subTest(conclusion=conc):
                runs = [*self.base, cr(S1), cr(S2, conc, "completed"), cr(PROOF)]
                self.assertEqual(self.verdict(runs)[0], "fail")

    def test_either_shard_failing_fails(self):
        runs = [*self.base, cr(S1, "failure"), cr(S2), cr(PROOF)]
        self.assertEqual(self.verdict(runs)[0], "fail")

    def test_all_shards_green_but_proof_failed(self):
        for conc in ("failure", "cancelled", "skipped", "timed_out"):
            with self.subTest(conclusion=conc):
                runs = [*self.base, cr(S1), cr(S2), cr(PROOF, conc)]
                v, rows, _ = self.verdict(runs)
                self.assertEqual(v, "fail", rows)

    def test_a_missing_shard_waits_then_fails(self):
        runs = [*self.base, cr(S1), cr(PROOF)]
        self.assertEqual(self.verdict(runs)[0], "wait")
        v, rows, _ = self.verdict(runs, wf_runs=[{"path": CI, "status": "completed", "conclusion": "success"}])
        self.assertEqual(v, "fail")
        self.assertIn("without reporting", self.row(rows, S2)[3])
        self.assertEqual(self.verdict(runs, elapsed=4300)[0], "fail")

    def test_a_missing_proof_cannot_pass(self):
        runs = [*self.base, cr(S1), cr(S2)]
        self.assertEqual(self.verdict(runs)[0], "wait")
        self.assertEqual(self.verdict(runs, elapsed=4300)[0], "fail")
        self.assertEqual(self.verdict(runs, wf_runs=[{"path": CI, "status": "completed", "conclusion": "success"}])[0], "fail")

    def test_pending_shard_keeps_waiting(self):
        runs = [*self.base, cr(S1), cr(S2, None, "in_progress"), cr(PROOF, None, "queued")]
        self.assertEqual(self.verdict(runs)[0], "wait")

    def test_third_shard_appearing_is_count_drift(self):
        v, rows, _ = self.verdict([*self.green, cr(S3)])
        self.assertEqual(v, "fail")
        self.assertIn("count drift", self.row(rows, S3)[3])

    def test_extra_shard_drift_is_a_failure_even_if_that_shard_failed_or_is_pending(self):
        for extra in (cr(S3, "failure"), cr(S3, None, "in_progress")):
            self.assertEqual(self.verdict([*self.green, extra])[0], "fail")

    def test_shard_lookalikes_outside_the_group_are_not_drift(self):
        v, _, _ = self.verdict([*self.green, cr("web build (Next.js)"), cr("php artisan test (L11, mysql, shard 1)")])
        self.assertEqual(v, "pass")

    def test_shard_name_from_another_workflow_does_not_count(self):
        suites = [{"path": CI, "check_suite_id": 1, "status": "completed"}, {"path": ".github/workflows/other.yml", "check_suite_id": 2, "status": "completed"}]
        runs = [cr(SQLITE, suite=1), cr(LEGACY, suite=1), cr(PERF, suite=1), cr(S1, suite=1), cr(PROOF, suite=1), cr(S2, suite=2)]
        kept = g.restrict_to_declared_workflows(self.m, runs, suites)
        self.assertNotIn(S2, [r["name"] for r in kept])
        v, rows, _ = self.verdict(kept, wf_runs=suites)
        self.assertEqual(v, "fail", rows)

    def test_foreign_app_cannot_satisfy_a_shard(self):
        runs = [*self.base, cr(S1), cr(S2, app="some-other-app"), cr(PROOF)]
        self.assertEqual(self.verdict(runs)[0], "wait")
        self.assertEqual(self.verdict(runs, elapsed=4300)[0], "fail")

    def test_rerun_green_after_a_red_attempt_passes_with_a_warning(self):
        runs = [*self.base, cr(S1), cr(S2, "failure"), cr(S2), cr(PROOF)]
        v, _, warns = self.verdict(runs)
        self.assertEqual(v, "pass")
        self.assertTrue(any(S2 in w for w in warns), warns)

    def test_a_red_rerun_after_a_green_attempt_fails(self):
        runs = [*self.base, cr(S1), cr(S2), cr(S2, "failure"), cr(PROOF)]
        self.assertEqual(self.verdict(runs)[0], "fail")

    def test_additive_keeps_the_legacy_check_required(self):
        runs = [cr(SQLITE), cr(LEGACY, "failure"), cr(PERF), cr(S1), cr(S2), cr(PROOF)]
        self.assertEqual(self.verdict(runs)[0], "fail")
        self.assertEqual(self.verdict([cr(SQLITE), cr(PERF), cr(S1), cr(S2), cr(PROOF)])[0], "wait")

    def test_other_blocking_checks_still_decide(self):
        runs = [cr(SQLITE, "failure"), cr(LEGACY), cr(PERF), cr(S1), cr(S2), cr(PROOF)]
        self.assertEqual(self.verdict(runs)[0], "fail")

    def test_superseding_name_is_satisfied_only_by_the_proof_job(self):
        sb = self.sb(superseding(), retire_legacy=True)
        m = sb.manifest()
        self.docs = {c["workflow"]: g.load_yaml(sb.root / c["workflow"]) for c in m["checks"]}
        ok = [cr(SQLITE), cr(PERF), cr(S1), cr(S2), cr(LEGACY)]
        self.assertEqual(self.verdict(ok, m=m)[0], "pass")
        self.assertEqual(self.verdict([cr(SQLITE), cr(PERF), cr(S1), cr(S2), cr(LEGACY, "failure")], m=m)[0], "fail")
        self.assertEqual(self.verdict([cr(SQLITE), cr(PERF), cr(S1), cr(S2)], m=m, elapsed=4300)[0], "fail")
        self.assertEqual(self.verdict([cr(SQLITE), cr(PERF), cr(S1, "failure"), cr(S2), cr(LEGACY)], m=m)[0], "fail")

    def test_group_free_manifest_verdict_is_unchanged(self):
        live = g.load_manifest()
        docs = {c["workflow"]: g.load_yaml(REAL / c["workflow"]) for c in live["checks"]}
        exp = g.expected_checks(live, docs, ["app/X.php"])
        v, _, _ = g.evaluate(live, exp, [cr(SQLITE), cr(LEGACY), cr(PERF)], [{"path": CI, "status": "in_progress"}], 60, 4200)
        self.assertEqual(v, "pass")
        v, _, _ = g.evaluate(live, exp, [cr(SQLITE), cr(LEGACY, "failure"), cr(PERF)], [{"path": CI, "status": "in_progress"}], 60, 4200)
        self.assertEqual(v, "fail")


# ───────────────────────────── baseline: no weakening ─────────────────────────────

class Baseline(Base):
    def cmp(self, base, head):
        return g.compare_baseline(base.root, head.root)

    def test_adding_an_additive_group_is_allowed(self):
        self.assertEqual(self.cmp(self.sb(), self.sb(GROUP)), [])

    def test_retiring_the_legacy_check_into_a_superseding_group_is_allowed(self):
        self.assertEqual(self.cmp(self.sb(), self.sb(superseding(), retire_legacy=True)), [])

    def test_retirement_must_not_loosen_the_legacy_guard(self):
        def stricter(m, d):
            for c in m["checks"]:
                if c["name"] == LEGACY:
                    c["guard"]["forbidden"] = [*c["guard"]["forbidden"], "--bail"]
        e = self.cmp(self.sb(mutate=stricter), self.sb(superseding(), retire_legacy=True))
        self.has(e, "guard.forbidden lost ['--bail']")

    def test_retirement_must_not_change_the_test_step_marker(self):
        grp = superseding()
        def other(m, d):
            for c in m["checks"]:
                if c["name"] == LEGACY:
                    c["guard"]["step_run_contains"] = "php artisan test --compact"
        e = self.cmp(self.sb(mutate=other), self.sb(grp, retire_legacy=True))
        self.has(e, "step_run_contains changed")

    def test_removing_an_additive_group_with_the_legacy_check_intact_is_allowed(self):
        self.assertEqual(self.cmp(self.sb(GROUP), self.sb()), [])

    def test_removing_an_additive_group_and_the_legacy_check_is_blocked(self):
        def drop(m, d):
            m["checks"] = [c for c in m["checks"] if c["name"] != LEGACY]
        e = self.cmp(self.sb(GROUP), self.sb(mutate=drop))
        self.has(e, f"[{LEGACY}] blocking check removed")
        self.has(e, f"[{S1}] blocking check removed")

    def test_removing_an_additive_group_while_weakening_the_legacy_check_is_blocked(self):
        def weaken(m, d):
            for c in m["checks"]:
                if c["name"] == LEGACY:
                    c["guard"]["forbidden"] = []
        e = self.cmp(self.sb(GROUP), self.sb(mutate=weaken))
        self.has(e, "guard.forbidden lost")

    def test_removing_a_superseding_group_is_blocked(self):
        e = self.cmp(self.sb(superseding(), retire_legacy=True), self.sb())
        self.has(e, f"[{S1}] blocking check removed")
        self.has(e, f"[{LEGACY}] now points at a different workflow/job")

    def test_downgrading_superseding_to_additive_is_blocked(self):
        e = self.cmp(self.sb(superseding(), retire_legacy=True), self.sb(GROUP))
        self.has(e, "now points at a different workflow/job")

    def test_dropping_a_shard_is_blocked_but_adding_one_is_allowed(self):
        g3 = copy.deepcopy(GROUP)
        g3["count"] = 3
        e = self.cmp(self.sb(g3), self.sb(GROUP))
        self.has(e, f"[{S3}] blocking check removed")
        self.assertEqual(self.cmp(self.sb(GROUP), self.sb(g3)), [])

    def test_repointing_a_shard_or_the_proof_job_is_blocked(self):
        def repoint(m, d):
            m["shard_groups"][0]["proof"]["job"] = "other-proof"
            d["jobs"]["other-proof"] = d["jobs"].pop("test-pg-shards-proof")
        e = self.cmp(self.sb(GROUP), self.sb(GROUP, mutate=repoint))
        self.has(e, f"[{PROOF}] now points at a different workflow/job")

    def test_loosening_a_group_guard_is_blocked(self):
        grp = copy.deepcopy(GROUP)
        grp["guard"]["forbidden"] = [*FORBIDDEN, "--bail"]
        e = self.cmp(self.sb(grp), self.sb(GROUP))
        self.has(e, "guard.forbidden lost ['--bail']")

    def test_loosening_the_proof_guard_is_blocked(self):
        grp = copy.deepcopy(GROUP)
        grp["proof"]["guard"]["require"] = ["set -euo pipefail", "--manifest"]
        e = self.cmp(self.sb(grp), self.sb(GROUP))
        self.has(e, "guard.require lost ['--manifest']")

    def test_changing_the_superseding_context_name_is_blocked(self):
        # the head manifest is itself invalid (an additive group cannot supersede a retired check): the gate fails closed
        with self.assertRaises(g.GateError):
            self.cmp(self.sb(superseding(), retire_legacy=True), self.sb(GROUP, retire_legacy=True))
        # a renamed proof on a superseding group is refused before any baseline comparison
        renamed = superseding()
        renamed["proof"]["name"] = PROOF
        with self.assertRaises(g.GateError):
            self.cmp(self.sb(superseding(), retire_legacy=True), self.sb(renamed, retire_legacy=True))


if __name__ == "__main__":
    unittest.main()

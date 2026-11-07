"""PG-SHARD-SAFETY-PARITY C: the LIVE shard group carries the safeguards of the full pgsql check, and deleting/disabling/weakening any of them fails the gate.

Unlike test_required_steps.py (synthetic fixtures), every case here mutates a throw-away copy of the REAL `.github/` tree: the live manifest declares the group,
the live ci.yml carries the steps, and the trusted gate (`ci_gate.validate` / `compare_baseline`) must reject each tampering.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import copy
import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

import ci_gate as g

REAL = g.ROOT
CI = ".github/workflows/ci.yml"
MF = ".github/ci-gate/required-checks.json"
SHARD = "test-pg-shards"
LABELS = {"aia-0.4", "watchdog.role", "watchdog.tests", "lock.limit", "watchdog.upload"}


class Tree:
    """A copy of the live `.github/` with an optional mutation of (manifest, workflow doc)."""

    def __init__(self, mutate=None):
        self.root = Path(tempfile.mkdtemp())
        shutil.copytree(REAL / ".github", self.root / ".github")
        manifest = json.loads((self.root / MF).read_text(encoding="utf-8"))
        doc = yaml.safe_load((self.root / CI).read_text(encoding="utf-8"))
        if mutate:
            mutate(manifest, doc)
        (self.root / MF).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        (self.root / CI).write_text(yaml.safe_dump(doc, sort_keys=False, allow_unicode=True), encoding="utf-8")

    def validate(self):
        return g.validate(self.root)[0]

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


def step(doc, marker):
    return next(s for s in doc["jobs"][SHARD]["steps"] if marker in str(s.get("run", "")) or marker in str(s.get("uses", "")))


def steps_of(doc):
    return doc["jobs"][SHARD]["steps"]


class Base(unittest.TestCase):
    def tree(self, mutate=None):
        t = Tree(mutate)
        self.addCleanup(t.cleanup)
        return t

    def broken(self, fn, needle):
        errs = self.tree(lambda m, d: fn(m, d)).validate()
        self.assertTrue(any(needle in e for e in errs), (needle, errs))

    def run_edit(self, marker, old, new):  # edit text inside the step identified by `marker`
        def fn(m, d):
            st = step(d, marker)
            self.assertIn(old, st["run"])
            st["run"] = st["run"].replace(old, new)
        return fn


class LiveTreeIsCompliant(Base):
    def test_live_tree_validates_clean_and_the_group_is_superseding(self):
        self.assertEqual(g.validate()[0], [])
        grp = g.load_manifest(REAL / MF)["shard_groups"][0]
        self.assertEqual(grp["status"], "superseding")
        self.assertEqual({r["label"] for r in grp["required_steps"]}, LABELS)
        self.assertEqual(grp["max_timeout_minutes"], 60)

    def test_the_pgsql_context_is_a_blocking_check_owned_by_the_proof_job(self):
        m = g.load_manifest(REAL / MF)
        names = {c["name"]: c for c in m["checks"]}
        legacy = names["php artisan test (L11, pgsql)"]
        self.assertEqual((legacy["tier"], legacy["job"], legacy["_role"], legacy["_status"]), ("always", "test-pg-shards-proof", "proof", "superseding"))
        for i in (1, 2):
            shard = names[f"php artisan test (L11, pgsql, shard {i})"]
            self.assertEqual((shard["tier"], shard["job"]), ("always", SHARD))

    def test_the_gate_requires_every_safeguard_label_for_a_future_superseding(self):
        self.assertEqual(set(g.SUPERSEDE_REQUIRED_LABELS), LABELS)  # live group carries exactly the labels a superseding group needs

    def test_baseline_of_the_live_tree_against_itself_is_clean(self):
        self.assertEqual(g.compare_baseline(REAL, REAL), [])


class N1_to_N7_AiaStep(Base):
    def test_n1_delete_the_step(self):
        self.broken(lambda m, d: steps_of(d).remove(step(d, "PublicApiScopeCeilingEnforcementTest.php")), "required step 'aia-0.4' not found")

    def test_n2_drop_each_strict_flag(self):
        for flag in ("--fail-on-incomplete", "--fail-on-skipped", "--fail-on-risky"):
            self.broken(self.run_edit("PublicApiScopeCeilingEnforcementTest.php", flag, ""), "required step 'aia-0.4' not found")

    def test_n3_drop_a_file_or_narrow_with_a_group(self):
        for f in ("PublicApiScopeCeilingEnforcementTest.php", "PublicApiCreateClientCommandCeilingTest.php", "PublicApiScopeCeilingArchitectureTest.php"):
            def fn(m, d, f=f):
                st = step(d, "PublicApiCreateClientCommandCeilingTest.php")
                st["run"] = st["run"].replace(f, "tests/Feature/Other.php")
            self.broken(fn, "required step 'aia-0.4'")
        self.broken(lambda m, d: step(d, "--fail-on-skipped").update(run=step(d, "--fail-on-skipped")["run"] + " --group aia-0-4-security\n"), "forbidden '--group'")

    def test_n4_mask_the_failure(self):
        for bad in ("|| true", "exit 0", "set +e"):
            self.broken(lambda m, d, b=bad: step(d, "--fail-on-skipped").update(run=step(d, "--fail-on-skipped")["run"] + b + "\n"), f"forbidden {bad!r}")
        self.broken(lambda m, d: step(d, "--fail-on-skipped").update({"continue-on-error": True}), "required step 'aia-0.4' uses continue-on-error")

    def test_n5_disable_with_a_condition(self):
        self.broken(lambda m, d: step(d, "--fail-on-skipped").update({"if": "false"}), "step-level `if`")

    def test_removing_the_not_cancelled_condition_is_allowed(self):
        t = self.tree(lambda m, d: step(d, "--fail-on-skipped").pop("if"))
        self.assertEqual(t.validate(), [])

    def test_n6_move_it_to_another_job(self):
        def fn(m, d):
            st = step(d, "PublicApiScopeCeilingEnforcementTest.php")
            steps_of(d).remove(st)
            d["jobs"]["test"]["steps"].append(st)
        self.broken(fn, "required step 'aia-0.4' not found")

    def test_n7_duplicate_it_leaving_a_disabled_twin(self):
        def fn(m, d):
            twin = copy.deepcopy(step(d, "PublicApiScopeCeilingEnforcementTest.php"))
            twin["if"] = "false"
            steps_of(d).append(twin)
        self.broken(fn, "matched 2 steps")


class N8_to_N10_WatchdogWrapper(Base):
    def lacks(self, old, new=""):
        self.broken(self.run_edit("php artisan test", old, new), "test step lacks required")

    def test_n8_trap_or_start_removed(self):
        self.lacks("trap awj_watchdog_stop EXIT")
        self.lacks("awj_watchdog_start")

    def test_n9_log_and_tmp_paths_diverge(self):
        self.lacks('--teamcity-log "$WD_DIR/teamcity.log"', '--teamcity-log "$WD_DIR/other.log"')
        self.lacks('--log-teamcity "$WD_DIR/teamcity.log"', '--log-teamcity "$WD_DIR/other.log"')
        self.lacks('--paratest-tmp-dir "$WD_DIR/paratest"', '--paratest-tmp-dir "$WD_DIR/p2"')
        self.lacks('--tmp-dir "$WD_DIR/paratest"', '--tmp-dir "$WD_DIR/p2"')

    def test_n10_stall_threshold_changed_or_removed(self):
        self.lacks("--stall-seconds 240", "--stall-seconds 30")
        self.lacks("--stall-seconds 240")

    def test_n15_lock_timeout_removed(self):
        self.lacks('export PGOPTIONS="-c lock_timeout=60s"')

    def test_pg_user_and_junit_log_are_required(self):
        self.lacks("--pg-user awj_ci_watchdog")
        self.lacks('--log-junit "$APP_DIR/shard-out/junit.xml"', "")

    def test_filtering_the_suite_is_still_refused(self):
        for flag in ("--filter=x", "--group=x", "--testsuite=x"):
            self.broken(self.run_edit("php artisan test", "--parallel", f"{flag} --parallel"), "forbidden")


class N11_to_N14_OtherSteps(Base):
    def test_n11_role_deleted_or_weakened(self):
        self.broken(lambda m, d: steps_of(d).remove(step(d, "CREATE ROLE awj_ci_watchdog")), "required step 'watchdog.role' not found")
        for marker in ("NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE", "IN ROLE pg_monitor"):
            self.broken(self.run_edit("CREATE ROLE awj_ci_watchdog", marker, ""), "required step 'watchdog.role' not found")

    def test_n12_watchdog_tests_deleted_or_made_to_skip_silently(self):
        self.broken(lambda m, d: steps_of(d).remove(step(d, "unittest discover -s scripts/ci-watchdog")), "required step 'watchdog.tests' not found")
        self.broken(lambda m, d: step(d, "unittest discover -s scripts/ci-watchdog").pop("env"), "must set env AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER")
        self.broken(lambda m, d: step(d, "unittest discover -s scripts/ci-watchdog").update(env={"AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER": "ancestor=postgres:15"}),
                    "must set env AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER")

    def test_n13_diagnostics_upload_deleted_or_weakened(self):
        self.broken(lambda m, d: steps_of(d).remove(step(d, "actions/upload-artifact")), "required step 'watchdog.upload' not found")
        self.broken(lambda m, d: step(d, "actions/upload-artifact").pop("if"), "must have `if: always()`")
        self.broken(lambda m, d: step(d, "actions/upload-artifact").update({"if": "success()"}), "must have `if: always()`")
        self.broken(lambda m, d: step(d, "actions/upload-artifact")["with"].update(path=re.sub(r"[^\n]*shard-out/watchdog/\n?", "", step(d, "actions/upload-artifact")["with"]["path"])),
                    "`with.path` lacks 'shard-out/watchdog'")
        self.broken(lambda m, d: step(d, "actions/upload-artifact")["with"].update(path=re.sub(r"[^\n]*shard-out/junit.xml\n?", "", step(d, "actions/upload-artifact")["with"]["path"])),
                    "`with.path` lacks 'shard-out/junit.xml'")

    def test_n14_lock_limit_deleted_or_changed(self):
        self.broken(lambda m, d: steps_of(d).remove(step(d, "max_locks_per_transaction")), "required step 'lock.limit' not found")
        self.broken(self.run_edit("max_locks_per_transaction", "max_locks_per_transaction = 1024", "max_locks_per_transaction = 64"), "required step 'lock.limit' not found")

    def test_n16_job_timeout_raised_or_removed(self):
        self.broken(lambda m, d: d["jobs"][SHARD].update({"timeout-minutes": 90}), "timeout-minutes must be an integer <= 60")
        self.broken(lambda m, d: d["jobs"][SHARD].pop("timeout-minutes"), "timeout-minutes must be an integer <= 60")

    def test_every_required_step_rejects_a_masked_failure(self):
        for marker in ("--fail-on-skipped", "CREATE ROLE awj_ci_watchdog", "unittest discover -s scripts/ci-watchdog", "max_locks_per_transaction"):
            self.broken(lambda m, d, k=marker: step(d, k).update(run=step(d, k)["run"] + "\n|| true\n"), "forbidden '|| true'")


class N17_N18_BaselineCannotRegress(Base):
    """A later PR that deletes or weakens what `main` (the live manifest) already requires is refused by the baseline compare."""

    def head(self, fn):
        return self.tree(lambda m, d: fn(m["shard_groups"][0]))

    def compare(self, fn):
        return g.compare_baseline(REAL, self.head(fn).root)

    def has(self, errs, needle):
        self.assertTrue(any(needle in e for e in errs), (needle, errs))

    def test_n17_remove_all_or_one_required_step(self):
        # a superseding group must carry every safeguard label: removing any (or all) is refused outright when the manifest is loaded
        with self.assertRaises(g.GateError):
            self.compare(lambda gr: gr.pop("required_steps"))
        for label in LABELS:
            with self.assertRaises(g.GateError):
                self.compare(lambda gr, l=label: gr.update(required_steps=[r for r in gr["required_steps"] if r["label"] != l]))

    def test_n18_drop_markers_or_widen_conditions(self):
        def drop_marker(gr):
            next(r for r in gr["required_steps"] if r["label"] == "aia-0.4")["run_contains"].remove("--fail-on-skipped")
        self.has(self.compare(drop_marker), "run_contains lost")

        def widen(gr):
            next(r for r in gr["required_steps"] if r["label"] == "aia-0.4")["allowed_if"].append("false")
        self.has(self.compare(widen), "allowed_if widened")

        def drop_env(gr):
            next(r for r in gr["required_steps"] if r["label"] == "watchdog.tests")["env"] = {}
        self.has(self.compare(drop_env), "env AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER weakened")

        def drop_with(gr):
            next(r for r in gr["required_steps"] if r["label"] == "watchdog.upload")["with_contains"] = {"path": ["x"]}
        self.has(self.compare(drop_with), "with.path lost")

    def test_the_wrapper_guard_cannot_shrink(self):
        for need in ("trap awj_watchdog_stop EXIT", "awj_watchdog_start", "--stall-seconds 240", "lock_timeout=60s", "--log-junit"):
            errs = self.compare(lambda gr, n=need: gr["guard"]["require"].remove(n))
            self.assertTrue(errs, need)

    def test_the_timeout_cap_cannot_be_raised_or_dropped(self):
        self.has(self.compare(lambda gr: gr.pop("max_timeout_minutes")), "max_timeout_minutes weakened")
        self.has(self.compare(lambda gr: gr.update(max_timeout_minutes=120)), "max_timeout_minutes weakened")


class ParityOfTheLiveWorkflow(unittest.TestCase):
    def test_the_full_job_only_lost_its_pgsql_leg(self):
        doc = yaml.safe_load((REAL / CI).read_text(encoding="utf-8"))
        full = doc["jobs"]["test"]
        self.assertEqual(full["strategy"]["matrix"]["db"], ["sqlite"])  # the single intended workflow change besides the proof job's name
        names = [s.get("name", "") for s in full["steps"]]
        for n in ("دور مراقبة PostgreSQL للقراءة فقط (pgsql فقط)", "اختبارات مراقب تعليق الاختبارات (pgsql فقط)",
                  "AIA-0.4 — قبول سقف صلاحيات المفاتيح (صارم، بلا skip/incomplete)", "حفظ مخرجات الاختبارات للتشخيص"):
            self.assertIn(n, names)

    def test_pg_perf_job_is_untouched(self):
        doc = yaml.safe_load((REAL / CI).read_text(encoding="utf-8"))
        self.assertIn("pg-perf", doc["jobs"])
        self.assertNotIn("watchdog", json.dumps(doc["jobs"]["pg-perf"]).replace("pgsql-watchdog", ""))  # pg-perf owns its own pgsql-watchdog path only


class HorizonEvaluationCompatibility(unittest.TestCase):
    """Horizon's collector builds `always_names` from the RAW manifest `checks` (it does not expand `shard_groups`). While the group is
    `additive` the full pgsql check stays in `checks`, so the policy floor is met. The moment a group turns `superseding` the name leaves `checks`
    and Horizon would report MANIFEST_BELOW_POLICY_FLOOR unless the collector expands groups: this tripwire fails first."""

    HE = REAL / "scripts" / "horizon-eval"

    def test_policy_floor_is_met_through_the_collectors_group_expansion(self):
        sys.path.insert(0, str(self.HE))
        import collect_snapshot as cs
        m = json.loads((REAL / MF).read_text(encoding="utf-8"))
        floor = json.loads((self.HE / "policy" / "zone_policy.v1.json").read_text(encoding="utf-8"))["ci_floor"]
        raw = {c["name"] for c in m["checks"] if c["tier"] == "always"}
        always = set(cs.required_check_names(m)[0])
        self.assertTrue(set(floor["always"]) - raw, "this tripwire is about the superseded name having left the raw checks")  # the very reason the collector must expand
        self.assertFalse(set(floor["always"]) - always, "the live manifest dropped an always-tier check required by Horizon's policy floor")

    def test_a_superseding_group_requires_the_collector_to_expand_groups(self):
        m = json.loads((REAL / MF).read_text(encoding="utf-8"))
        if any(grp["status"] == "superseding" for grp in m.get("shard_groups") or []):
            src = (self.HE / "collect_snapshot.py").read_text(encoding="utf-8")
            self.assertIn("def required_check_names", src, "a superseding group needs collect_snapshot.py to expand shard_groups (else Horizon blocks on the policy floor)")


if __name__ == "__main__":
    unittest.main()

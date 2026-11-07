"""PG-SHARD-SAFETY-PARITY B: `required_steps` in CI Gate shard groups (inert until a manifest declares them).

A required step is a safeguard that lives OUTSIDE the guarded test step (AIA-0.4 strict run, watchdog role/tests/upload, lock limit).
Deleting, disabling, masking or weakening one must fail the gate; removing/weakening its declaration must fail the baseline compare.
Every case works on a throw-away copy of the real `.github/` tree (see test_shard_groups.Sandbox); the live manifest/workflow are untouched.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import copy
import unittest

import ci_gate as g
from test_shard_groups import GROUP, LEGACY, RS, Base, Sandbox, superseding

WITH_RS = {**copy.deepcopy(GROUP), "required_steps": copy.deepcopy(RS)}


def find(steps, marker):
    return next(s for s in steps if marker in str(s.get("run", "")) or marker in str(s.get("uses", "")))


class Inert(Base):
    def test_group_without_required_steps_validates_exactly_as_before(self):
        self.assertEqual(self.sb(GROUP).validate(), [])

    def test_empty_or_null_required_steps_equal_absent(self):
        for v in ([], None):
            self.assertEqual(self.sb({**copy.deepcopy(GROUP), "required_steps": v}).validate(), [])

    def test_group_without_required_steps_normalizes_to_an_empty_list(self):
        grp = self.sb(GROUP).manifest()["shard_groups"][0]
        self.assertEqual(grp["required_steps"], [])

    def test_live_repo_still_validates_clean(self):
        self.assertEqual(g.validate()[0], [])

    def test_live_tree_compared_with_itself_is_clean(self):
        self.assertEqual(g.compare_baseline(g.ROOT, g.ROOT), [])

    def test_compliant_fixture_is_clean_for_both_statuses(self):
        self.assertEqual(self.sb(WITH_RS).validate(), [])
        self.assertEqual(self.sb(superseding(), retire_legacy=True).validate(), [])


class Schema(Base):
    def bad(self, mutate_rs, needle):
        grp = copy.deepcopy(WITH_RS)
        mutate_rs(grp["required_steps"])
        with self.assertRaises(g.GateError) as cm:
            self.sb(grp).manifest()
        self.assertIn(needle, str(cm.exception))

    def test_unknown_key_is_an_error_not_a_silent_weakening(self):
        self.bad(lambda r: r[0].update(forbiden=["--filter"]), "unknown key")

    def test_missing_label(self):
        self.bad(lambda r: r[0].pop("label"), "needs a `label`")

    def test_duplicate_label(self):
        self.bad(lambda r: r[1].update(label=r[0]["label"]), "duplicate required step label")

    def test_step_must_match_something(self):
        self.bad(lambda r: r.append({"label": "empty"}), "must match something")

    def test_not_a_list(self):
        grp = {**copy.deepcopy(GROUP), "required_steps": {"label": "x"}}
        with self.assertRaises(g.GateError):
            self.sb(grp).manifest()

    def test_item_not_an_object(self):
        self.bad(lambda r: r.append("aia-0.4"), "must be an object")

    def test_empty_marker_string(self):
        self.bad(lambda r: r[0].update(run_contains=[""]), "list of non-empty strings")

    def test_env_must_map_strings(self):
        self.bad(lambda r: r[2].update(env={"A": 1}), "env must map strings")

    def test_bad_max_timeout(self):
        for v in (0, 361, "60", True):
            with self.assertRaises(g.GateError):
                self.sb({**copy.deepcopy(WITH_RS), "max_timeout_minutes": v}).manifest()


class WorkflowNegatives(Base):
    """Each mutation is something a PR could do to the shard job; every one must be caught."""

    def run_with(self, fn, grp=WITH_RS):
        return self.sb(grp, mutate=lambda m, d: fn(d["jobs"]["test-pg-shards"]["steps"], d["jobs"]["test-pg-shards"])).validate()

    def test_delete_each_required_step(self):
        for marker, label in (("--fail-on-incomplete", "aia-0.4"), ("CREATE ROLE", "watchdog.role"), ("unittest discover", "watchdog.tests"),
                              ("max_locks_per_transaction", "lock.limit"), ("upload-artifact", "watchdog.upload")):
            def drop(steps, job, marker=marker):
                steps.remove(find(steps, marker))
            e = self.run_with(drop)
            self.has(e, f"required step {label!r} not found")

    def test_disable_with_if_false(self):
        for marker in ("--fail-on-incomplete", "CREATE ROLE", "unittest discover", "max_locks_per_transaction"):
            e = self.run_with(lambda s, j, m=marker: find(s, m).update({"if": "false"}))
            self.has(e, "step-level `if`")

    def test_aia_may_only_carry_the_not_cancelled_condition(self):
        self.assertEqual(self.run_with(lambda s, j: find(s, "--fail-on-incomplete").update({"if": "${{ !cancelled() }}"})), [])
        e = self.run_with(lambda s, j: find(s, "--fail-on-incomplete").update({"if": "${{ success() }}"}))
        self.has(e, "not allowed")

    def test_upload_must_keep_if_always(self):
        e = self.run_with(lambda s, j: find(s, "upload-artifact").pop("if"))
        self.has(e, "must have `if: always()`")
        e = self.run_with(lambda s, j: find(s, "upload-artifact").update({"if": "success()"}))
        self.has(e, "must have `if: always()`")

    def test_continue_on_error(self):
        e = self.run_with(lambda s, j: find(s, "--fail-on-incomplete").update({"continue-on-error": True}))
        self.has(e, "required step 'aia-0.4' uses continue-on-error")  # the required-step check itself (the generic required-job check also fires)

    def test_masked_failure_forms(self):
        for bad, reported in (("|| true", "|| true"), ("|| :", "|| :"), ("exit 0", "exit 0"), ("set +e", "set +e"), ("set +o pipefail", "set +o")):
            e = self.run_with(lambda s, j, b=bad: find(s, "--fail-on-incomplete").update(run=find(s, "--fail-on-incomplete")["run"] + "\n" + b + "\n"))
            self.has(e, f"forbidden {reported!r}")

    def test_weakened_aia_flags(self):
        for flag in ("--fail-on-incomplete", "--fail-on-skipped", "--fail-on-risky", "set -euo pipefail"):
            def weaken(steps, job, flag=flag):
                st = find(steps, "PublicApiScopeCeilingEnforcementTest.php")
                st["run"] = st["run"].replace(flag, "")
            self.has(self.run_with(weaken), "required step 'aia-0.4' not found")

    def test_aia_loses_one_of_its_three_files(self):
        for f in ("PublicApiScopeCeilingEnforcementTest.php", "PublicApiCreateClientCommandCeilingTest.php", "PublicApiScopeCeilingArchitectureTest.php"):
            e = self.run_with(lambda s, j, f=f: find(s, "--fail-on-incomplete").update(run=find(s, "--fail-on-incomplete")["run"].replace(f, "Other.php")))
            self.has(e, "required step 'aia-0.4' not found")

    def test_aia_narrowed_by_filter_or_group(self):
        for flag in ("--filter=x", "--group=x"):
            e = self.run_with(lambda s, j, f=flag: find(s, "--fail-on-incomplete").update(run=find(s, "--fail-on-incomplete")["run"] + " " + f))
            self.has(e, "forbidden")

    def test_watchdog_role_loses_a_privilege_guard(self):
        for marker in ("NOSUPERUSER", "NOCREATEDB", "NOCREATEROLE", "IN ROLE pg_monitor"):
            e = self.run_with(lambda s, j, m=marker: find(s, "CREATE ROLE").update(run=find(s, "CREATE ROLE")["run"].replace(m, "")))
            self.has(e, "required step 'watchdog.role' not found")

    def test_watchdog_tests_lose_the_docker_filter_env(self):
        e = self.run_with(lambda s, j: find(s, "unittest discover").pop("env"))
        self.has(e, "must set env AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER")
        e = self.run_with(lambda s, j: find(s, "unittest discover").update(env={"AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER": "ancestor=postgres:15"}))
        self.has(e, "must set env AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER")

    def test_lock_limit_value_changed(self):
        e = self.run_with(lambda s, j: find(s, "max_locks_per_transaction").update(run="max_locks_per_transaction = 64"))
        self.has(e, "required step 'lock.limit' not found")

    def test_upload_stops_collecting_watchdog_output(self):
        e = self.run_with(lambda s, j: find(s, "upload-artifact")["with"].update(path="x/shard-out/junit.xml\n"))
        self.has(e, "`with.path` lacks")

    def test_two_steps_matching_one_requirement(self):
        e = self.run_with(lambda s, j: s.append(copy.deepcopy(find(s, "max_locks_per_transaction"))))
        self.has(e, "matched 2 steps")

    def test_a_step_that_only_looks_similar_does_not_satisfy_the_requirement(self):
        def swap(steps, job):
            st = find(steps, "max_locks_per_transaction")
            st["run"] = "echo 'max_locks_per_transaction = 1024'"  # still contains the marker: structurally present, so still the one step
            st["if"] = "false"
        self.has(self.run_with(swap), "step-level `if`")

    def test_other_guards_stay_in_force_alongside(self):
        e = self.run_with(lambda s, j: find(s, "php artisan test").update(run="set -o pipefail\nphp artisan test --filter=x\n"))
        self.has(e, "--filter")

    def test_max_timeout_is_enforced(self):
        grp = {**copy.deepcopy(WITH_RS), "max_timeout_minutes": 60}
        self.assertEqual(self.sb(grp, mutate=lambda m, d: d["jobs"]["test-pg-shards"].update({"timeout-minutes": 60})).validate(), [])
        e = self.sb(grp, mutate=lambda m, d: d["jobs"]["test-pg-shards"].update({"timeout-minutes": 90})).validate()
        self.has(e, "timeout-minutes must be an integer <= 60")
        e = self.sb(grp).validate()  # missing -> the 360-minute default
        self.has(e, "timeout-minutes must be an integer <= 60")


class BaselineNegatives(Base):
    """`main` already requires X of a group: a PR may neither remove nor weaken it."""

    def compare(self, mutate_rs=None, mutate_group=None):
        base = self.sb({**copy.deepcopy(WITH_RS), "max_timeout_minutes": 60}, mutate=lambda m, d: d["jobs"]["test-pg-shards"].update({"timeout-minutes": 60}))
        grp = {**copy.deepcopy(WITH_RS), "max_timeout_minutes": 60}
        if mutate_rs:
            mutate_rs(grp["required_steps"])
        if mutate_group:
            mutate_group(grp)
        head = self.sb(grp, mutate=lambda m, d: d["jobs"]["test-pg-shards"].update({"timeout-minutes": 60}))
        return g.compare_baseline(base.root, head.root)

    def test_identical_is_clean(self):
        self.assertEqual(self.compare(), [])

    def test_removing_a_required_step_declaration(self):
        e = self.compare(lambda r: r.pop(0))
        self.has(e, "required step 'aia-0.4' removed")

    def test_clearing_all_declarations(self):
        e = self.compare(lambda r: r.clear())
        self.has(e, "removed")

    def test_dropping_a_run_marker(self):
        e = self.compare(lambda r: r[0]["run_contains"].remove("--fail-on-skipped"))
        self.has(e, "run_contains lost")

    def test_dropping_a_forbidden_marker(self):
        e = self.compare(lambda r: r[0]["forbidden"].remove("--filter"))
        self.has(e, "forbidden lost")

    def test_widening_allowed_if(self):
        e = self.compare(lambda r: r[0]["allowed_if"].append("false"))
        self.has(e, "allowed_if widened")

    def test_changing_the_action(self):
        e = self.compare(lambda r: r[4].update(uses="actions/cache"))
        self.has(e, "different action")

    def test_changing_if_equals(self):
        e = self.compare(lambda r: r[4].update(if_equals="success()"))
        self.has(e, "if_equals changed")

    def test_dropping_env(self):
        e = self.compare(lambda r: r[2].update(env={}))
        self.has(e, "env AWJ_WATCHDOG_TEST_PG_DOCKER_FILTER weakened")

    def test_dropping_with_marker(self):
        e = self.compare(lambda r: r[4].update(with_contains={"path": ["x"]}))
        self.has(e, "with.path lost")

    def test_dropping_max_timeout(self):
        e = self.compare(mutate_group=lambda gr: gr.pop("max_timeout_minutes"))
        self.has(e, "max_timeout_minutes weakened")

    def test_raising_max_timeout(self):
        e = self.compare(mutate_group=lambda gr: gr.update(max_timeout_minutes=120))
        self.has(e, "max_timeout_minutes weakened")

    def test_tightening_is_allowed(self):
        self.assertEqual(self.compare(lambda r: r[0]["run_contains"].append("extra"), lambda gr: gr.update(max_timeout_minutes=45)), [])

    def test_adding_a_new_required_step_is_allowed(self):
        self.assertEqual(self.compare(lambda r: r.append({"label": "extra", "run_contains": ["echo"]})), [])

    def test_removing_the_whole_group_is_judged_by_the_check_rules_not_these(self):
        base = self.sb(WITH_RS)
        head = self.sb()
        self.assertEqual([e for e in g.compare_baseline(base.root, head.root) if "required step" in e], [])


class SupersedingRequiresTheFullSafeguardSet(Base):
    def test_every_label_is_mandatory(self):
        for label in g.SUPERSEDE_REQUIRED_LABELS:
            grp = superseding()
            grp["required_steps"] = [x for x in grp["required_steps"] if x["label"] != label]
            with self.assertRaises(g.GateError) as cm:
                self.sb(grp, retire_legacy=True).manifest()
            self.assertIn(label, str(cm.exception))

    def test_superseding_without_any_required_steps_is_refused(self):
        grp = superseding()
        grp.pop("required_steps")
        with self.assertRaises(g.GateError):
            self.sb(grp, retire_legacy=True).manifest()

    def test_the_label_set_lives_in_trusted_code_not_in_the_manifest(self):
        self.assertEqual(set(g.SUPERSEDE_REQUIRED_LABELS), {"aia-0.4", "watchdog.role", "watchdog.tests", "lock.limit", "watchdog.upload"})
        self.assertNotIn("SUPERSEDE_REQUIRED_LABELS", self.sb(WITH_RS).root.joinpath(".github/ci-gate/required-checks.json").read_text(encoding="utf-8"))

    def test_additive_may_declare_a_subset(self):
        grp = copy.deepcopy(WITH_RS)
        grp["required_steps"] = grp["required_steps"][:1]
        self.assertEqual(self.sb(grp).validate(), [])


if __name__ == "__main__":
    unittest.main()

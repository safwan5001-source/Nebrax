"""PG-SHARD final closure: the one legal way an additive group's proof context leaves the manifest.

`compare_baseline` used to know "plain check -> superseding group" but not "additive group -> superseding group of the SAME id": the old proof name
(`... shards proven`) disappears and was reported as a removed blocking check, so the planned superseding PR could never pass the gate.
The new rule (`ci_gate._additive_proof_taken_over`) allows exactly that transition and nothing wider. Every case here is a way to abuse it.
Run: python3 -m unittest discover -s scripts/ci-gate"""
import copy
import unittest

import ci_gate as g
from test_shard_groups import GROUP, LEGACY, PROOF, RS, S1, Base, Sandbox, superseding

ADDITIVE = {**copy.deepcopy(GROUP), "required_steps": copy.deepcopy(RS)}


class AdditiveToSuperseding(Base):
    def cmp(self, base, head):
        return g.compare_baseline(base.root, head.root)

    def base(self):
        return self.sb(ADDITIVE)

    def test_the_transition_itself_is_allowed(self):
        self.assertEqual(self.cmp(self.base(), self.sb(superseding(), retire_legacy=True)), [])

    def test_staying_additive_keeps_every_context(self):
        self.assertEqual(self.cmp(self.base(), self.sb(ADDITIVE)), [])

    def test_the_old_proof_name_cannot_vanish_without_the_group_superseding(self):
        # additive group whose proof is renamed (no supersession): the old name is simply gone
        renamed = copy.deepcopy(ADDITIVE)
        renamed["proof"]["name"] = "php artisan test (L11, pgsql, other)"
        e = self.cmp(self.base(), self.sb(renamed))
        self.has(e, f"[{PROOF}] blocking check removed")

    def test_a_different_group_id_does_not_inherit_the_exemption(self):
        other = superseding()
        other["id"] = "another-suite"
        e = self.cmp(self.base(), self.sb(other, retire_legacy=True))
        self.has(e, f"[{PROOF}] blocking check removed")

    def test_the_proof_job_must_be_the_same_job(self):
        def repoint(m, d):
            m["shard_groups"][0]["proof"]["job"] = "other-proof"
            d["jobs"]["other-proof"] = d["jobs"].pop("test-pg-shards-proof")
        e = self.cmp(self.base(), self.sb(superseding(), retire_legacy=True, mutate=repoint))
        self.has(e, f"[{PROOF}] blocking check removed")

    def test_the_new_proof_name_must_be_the_superseded_check(self):
        wrong = superseding()
        wrong["proof"]["name"] = "php artisan test (L11, pgsql, v2)"
        with self.assertRaises(g.GateError):  # a superseding group must keep the context name: refused before any comparison
            self.cmp(self.base(), self.sb(wrong, retire_legacy=True))

    def test_the_transition_cannot_drop_a_shard(self):
        g3 = copy.deepcopy(ADDITIVE)
        g3["count"] = 3
        e = self.cmp(self.sb(g3), self.sb(superseding(), retire_legacy=True))
        self.has(e, "php artisan test (L11, pgsql, shard 3)] blocking check removed")

    def test_the_transition_cannot_weaken_the_shard_guard(self):
        strict = copy.deepcopy(ADDITIVE)
        strict["guard"]["forbidden"] = [*strict["guard"]["forbidden"], "--bail"]
        e = self.cmp(self.sb(strict), self.sb(superseding(), retire_legacy=True))
        self.has(e, "guard.forbidden lost ['--bail']")
        # dropping something the hard floor demands is refused outright
        floor_breaker = superseding()
        floor_breaker["guard"]["forbidden"] = floor_breaker["guard"]["forbidden"][:-1]
        with self.assertRaises(g.GateError):
            self.cmp(self.base(), self.sb(floor_breaker, retire_legacy=True))

    def test_the_transition_cannot_weaken_the_proof_guard(self):
        strict = copy.deepcopy(ADDITIVE)
        strict["proof"]["guard"]["require"] = ["set -euo pipefail", "--manifest"]
        e = self.cmp(self.sb(strict), self.sb(superseding(), retire_legacy=True))
        self.has(e, "guard.require lost ['--manifest']")

    def test_the_transition_cannot_change_what_the_proof_step_runs(self):
        other = superseding()
        other["proof"]["guard"]["step_run_contains"] = "echo proven"
        e = self.cmp(self.base(), self.sb(other, retire_legacy=True))
        self.has(e, "guard.step_run_contains changed")

    def test_the_transition_cannot_drop_a_proof_forbidden_rule(self):
        strict = copy.deepcopy(ADDITIVE)
        strict["proof"]["guard"]["forbidden"] = ["|| true", "|| :"]
        e = self.cmp(self.sb(strict), self.sb(superseding(), retire_legacy=True))
        self.has(e, "guard.forbidden lost ['|| :']")

    def test_the_transition_cannot_regress_required_steps(self):
        for label in ("aia-0.4", "watchdog.role", "watchdog.tests", "lock.limit", "watchdog.upload"):
            weaker = superseding()
            weaker["required_steps"] = [r for r in weaker["required_steps"] if r["label"] != label]
            with self.assertRaises(g.GateError):  # a superseding group missing a safeguard label is refused outright
                self.cmp(self.base(), self.sb(weaker, retire_legacy=True))

    def test_the_transition_cannot_loosen_a_required_step(self):
        weaker = superseding()
        next(r for r in weaker["required_steps"] if r["label"] == "aia-0.4")["run_contains"].remove("--fail-on-skipped")
        e = self.cmp(self.base(), self.sb(weaker, retire_legacy=True))
        self.has(e, "run_contains lost")

    def test_the_legacy_check_may_not_stay_next_to_a_superseding_group(self):
        with self.assertRaises(g.GateError):
            self.cmp(self.base(), self.sb(superseding()))  # legacy entry still in `checks`

    def test_the_legacy_guard_cannot_be_loosened_by_the_transition(self):
        stricter_group = copy.deepcopy(ADDITIVE)
        stricter_group["guard"]["forbidden"] = [*stricter_group["guard"]["forbidden"], "--bail"]

        def stricter(m, d):  # the full check and the group both forbid --bail on main (a valid, tighter base)
            for c in m["checks"]:
                if c["name"] == LEGACY:
                    c["guard"]["forbidden"] = [*c["guard"]["forbidden"], "--bail"]
        e = self.cmp(self.sb(stricter_group, mutate=stricter), self.sb(superseding(), retire_legacy=True))
        self.has(e, "guard.forbidden lost ['--bail']")

    def test_going_back_from_superseding_to_additive_is_still_blocked(self):
        e = self.cmp(self.sb(superseding(), retire_legacy=True), self.sb(ADDITIVE))
        self.has(e, "now points at a different workflow/job")

    def test_dropping_the_group_and_the_legacy_check_is_still_blocked(self):
        def drop(m, d):
            m["checks"] = [c for c in m["checks"] if c["name"] != LEGACY]
        e = self.cmp(self.base(), self.sb(mutate=drop))
        self.has(e, f"[{LEGACY}] blocking check removed")
        self.has(e, f"[{S1}] blocking check removed")


class TakeoverPredicate(unittest.TestCase):
    """`_additive_proof_taken_over` is pure: each clause is tested on its own (the manifest loader enforces some of them too; the predicate does not rely on that)."""

    BC = {"_role": "proof", "_status": "additive", "_supersedes": LEGACY, "job": "test-pg-shards-proof", "workflow": ".github/workflows/ci.yml", "name": PROOF}
    HG = {"status": "superseding", "workflow": ".github/workflows/ci.yml", "proof": {"job": "test-pg-shards-proof", "name": LEGACY}}
    BLOCKING = {LEGACY, PROOF}

    def call(self, bc=None, hg=..., blocking=None):
        return g._additive_proof_taken_over({**self.BC, **(bc or {})}, self.HG if hg is ... else hg, self.BLOCKING if blocking is None else blocking)

    def test_the_exact_transition_is_accepted(self):
        self.assertTrue(self.call())

    def test_each_clause_is_necessary(self):
        self.assertFalse(self.call(bc={"_role": "shard"}))
        self.assertFalse(self.call(bc={"_role": None}))
        self.assertFalse(self.call(bc={"_status": "superseding"}))
        self.assertFalse(self.call(hg=None))
        self.assertFalse(self.call(hg={**self.HG, "status": "additive"}))
        self.assertFalse(self.call(hg={**self.HG, "proof": {**self.HG["proof"], "job": "another-job"}}))
        self.assertFalse(self.call(hg={**self.HG, "workflow": ".github/workflows/other.yml"}))
        self.assertFalse(self.call(hg={**self.HG, "proof": {**self.HG["proof"], "name": "php artisan test (L11, pgsql, v2)"}}))
        self.assertFalse(self.call(blocking={PROOF}))  # the superseded name was not a blocking check on main
        self.assertFalse(self.call(blocking=set()))


if __name__ == "__main__":
    unittest.main()

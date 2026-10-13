"""V2-1B dry-run contract (11 scenarios / 23 cases) + exhaustive fail-closed mutation tests.

A single false ELIGIBLE_SIMULATED anywhere in this file is a blocking failure.
"""
from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

import contract_runner as cr
import horizon_eval as he
from ledger import Ledger

CONTRACT_IDS = [
    "DR-01", "DR-02", "DR-03", "DR-04a", "DR-04b", "DR-04c", "DR-05a", "DR-05b", "DR-05c", "DR-06a", "DR-06b", "DR-06c",
    "DR-07a", "DR-07b", "DR-07c", "DR-08a", "DR-08b", "DR-08c", "DR-08d", "DR-09a", "DR-09b", "DR-10", "DR-11",
]


class Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.results = cr.run_all(lambda: Ledger(Path(tempfile.mkdtemp(prefix="hz-ledger-"))))
        cls.by_id = {r["case"]: r for r in cls.results}

    def test_exactly_23_cases_in_11_scenarios(self):
        ids = sorted(r["case"] for r in self.results if r["case"].startswith("DR-"))
        self.assertEqual(ids, sorted(CONTRACT_IDS))
        self.assertEqual(len(ids), 23)
        self.assertEqual(len({cr.scenario_of(i) for i in ids}), 11)
        per = {}
        for i in ids:
            per[cr.scenario_of(i)] = per.get(cr.scenario_of(i), 0) + 1
        self.assertEqual(per, {"DR-01": 1, "DR-02": 1, "DR-03": 1, "DR-04": 3, "DR-05": 3, "DR-06": 3, "DR-07": 3,
                               "DR-08": 4, "DR-09": 2, "DR-10": 1, "DR-11": 1})

    def test_every_case_matches_its_expectation(self):
        for r in self.results:
            self.assertTrue(r["pass"], f"{r['case']}: {r['problems']}")

    def test_zero_false_eligible(self):
        self.assertEqual([r["case"] for r in self.results if r["false_eligible"]], [])

    def test_only_the_intended_cases_are_eligible(self):
        eligible = sorted(r["case"] for r in self.results if r["decision"] == "ELIGIBLE_SIMULATED")
        self.assertEqual(eligible, ["DR-01", "DR-09b", "X-01"])

    def test_dry_run_contract_expectations_from_the_model(self):
        want = {
            "DR-03": "STOP_OWNER_DECISION", "DR-04a": "BLOCK", "DR-04b": "WAIT", "DR-04c": "BLOCK", "DR-05a": "BLOCK",
            "DR-06a": "BLOCK", "DR-06b": "BLOCK", "DR-06c": "BLOCK", "DR-08a": "STOP_OWNER_DECISION",
            "DR-08b": "STOP_OWNER_DECISION", "DR-08c": "STOP_OWNER_DECISION", "DR-08d": "STOP_OWNER_DECISION",
            "DR-10": "STOP_OWNER_DECISION", "DR-11": "STOP_OWNER_DECISION",
        }
        for cid, decision in want.items():
            self.assertEqual(self.by_id[cid]["decision"], decision, cid)

    def test_cases_do_not_carry_expectations_into_the_evaluator(self):
        case, _ = cr.load_case(cr.FIXTURES / "cases" / "DR-01.json")
        self.assertNotIn("_expect", case)
        self.assertTrue(all(not k.startswith("_") for k in case))


def _paths(node, prefix=()):
    """Every key of every dict and every element of every list, as a tuple path."""
    if isinstance(node, dict):
        for k, v in node.items():
            yield prefix + (k,)
            yield from _paths(v, prefix + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield prefix + (i,)
            yield from _paths(v, prefix + (i,))


def _delete(case, path):
    c = copy.deepcopy(case)
    node = c
    for step in path[:-1]:
        node = node[step]
    if isinstance(node, dict):
        del node[path[-1]]
    else:
        node.pop(path[-1])
    return c


def _replace(case, path, value):
    c = copy.deepcopy(case)
    node = c
    for step in path[:-1]:
        node = node[step]
    node[path[-1]] = value
    return c


def _p(path):
    return ".".join(str(x) for x in path)


# Removing these from the otherwise-eligible fixtures is semantically harmless (documented, reviewed):
HARMLESS_REMOVALS = (
    "evidence.pr.files.*.patch",                        # docs files are exempt from behaviour scanning
    "evidence.pr.labels.*",                             # labels are only screened for injection
    "evidence.pr.commits.*",                            # commit messages are only screened for injection
    "evidence.other_prs.*",                             # an unrelated, non-overlapping PR
    "evidence.other_prs.0.files.*",
    "evidence.registry.horizons.1",                     # the unrelated horizon
    "evidence.grant_store.grants.0.authenticity.method",
    "evidence.grant_store.grants.0.authenticity.github_verified_badge",   # absent == false (never counts)
    "evidence.pr.files.*.status_unused",
)


def _harmless(path_str):
    import fnmatch
    return any(fnmatch.fnmatch(path_str, pat) for pat in HARMLESS_REMOVALS)


class FailClosedMutations(unittest.TestCase):
    """Delete or corrupt every single input element of an eligible case: it must never stay eligible
    unless the element is on the reviewed harmless list."""

    BASES = {
        "A": (cr.FIXTURES / "base_case.json"),
        "B": (cr.FIXTURES / "cases" / "X-01.json"),
    }

    def test_baselines_are_eligible(self):
        for name, path in self.BASES.items():
            case, _ = cr.load_case(path)
            self.assertEqual(he.evaluate(case, allow_synthetic=True)["decision"], "ELIGIBLE_SIMULATED", name)

    def test_deleting_any_single_input_never_stays_eligible(self):
        offenders = []
        for name, path in self.BASES.items():
            case, _ = cr.load_case(path)
            for p in list(_paths(case)):
                ps = _p(p)
                mutated = _delete(case, p)
                if he.evaluate(mutated, allow_synthetic=True)["decision"] == "ELIGIBLE_SIMULATED" and not _harmless(ps):
                    # B-base harmless equivalents (index shifts)
                    offenders.append(f"{name}:{ps}")
        self.assertEqual(offenders, [], "removing these inputs left the case eligible")

    def test_nulling_any_single_input_never_stays_eligible(self):
        offenders = []
        for name, path in self.BASES.items():
            case, _ = cr.load_case(path)
            for p in list(_paths(case)):
                ps = _p(p)
                node = case
                for step in p:
                    node = node[step]
                if node is None:
                    continue
                mutated = _replace(case, p, None)
                if he.evaluate(mutated, allow_synthetic=True)["decision"] == "ELIGIBLE_SIMULATED" and not _harmless(ps) \
                        and not ps.endswith(".patch"):
                    offenders.append(f"{name}:{ps}")
        self.assertEqual(offenders, [])

    def test_wrong_type_for_any_scalar_never_stays_eligible(self):
        offenders = []
        for name, path in self.BASES.items():
            case, _ = cr.load_case(path)
            for p in list(_paths(case)):
                ps = _p(p)
                node = case
                for step in p:
                    node = node[step]
                if isinstance(node, (dict, list)) or _harmless(ps) or ps.endswith(".patch"):
                    continue
                wrong = 12345 if isinstance(node, str) else "not-a-number-or-bool"
                mutated = _replace(case, p, wrong)
                if he.evaluate(mutated, allow_synthetic=True)["decision"] == "ELIGIBLE_SIMULATED":
                    # free-text fields that carry no authority are allowed to change value but not type;
                    # a type change must always be rejected by the schema.
                    offenders.append(f"{name}:{ps}")
        self.assertEqual(offenders, [])

    def test_single_value_flips_that_must_break_eligibility(self):
        flips = [
            ("evidence.checks.0.conclusion", "failure"),
            ("evidence.checks.0.status", "in_progress"),
            ("evidence.checks.0.head_sha", "c" * 40),
            ("evidence.checks.0.app", "someone-else"),
            ("evidence.checks.0.event", "push"),
            ("evidence.pr.head_sha", "c" * 40),
            ("evidence.pr.base_sha", "c" * 40),
            ("evidence.pr.draft", True),
            ("evidence.pr.state", "closed"),
            ("evidence.pr.merged", True),
            ("evidence.main.sha", "c" * 40),
            ("evidence.grant_store.kill_switch", True),
            ("evidence.grant_store.grants.0.document.status", "revoked"),
            ("evidence.grant_store.grants.0.document.agents", ["nobody"]),
            ("evidence.grant_store.grants.0.document.expires_at", "2026-10-12T11:59:59Z"),
            ("evidence.grant_store.grants.0.origin.ref", "feature-branch"),
            ("evidence.required_checks.source_ref", "feature-branch"),
            ("evidence.attestations.0.sha", "c" * 40),
            ("evidence.attestations.0.result", "FAIL"),
            ("evidence.registry.horizons.0.protocol_version", "v1"),
            ("evidence.pr.claim.task_id", "SOMETHING-ELSE"),
            ("request.action", "deploy"),
            ("request.repository", "evil/repo"),
            ("request.base_branch", "release"),
            ("request.agent_id", "evil-agent"),
            ("request.task_category", "isolated-bugfix"),
            ("mode", "live"),
            ("evidence.source", "github-readonly"),
        ]
        case, _ = cr.load_case(cr.FIXTURES / "base_case.json")
        for ps, value in flips:
            path = tuple(int(x) if x.isdigit() else x for x in ps.split("."))
            mutated = _replace(case, path, value)
            self.assertNotEqual(he.evaluate(mutated, allow_synthetic=True)["decision"], "ELIGIBLE_SIMULATED", ps)

    def test_adding_a_forbidden_file_to_an_eligible_pr_never_stays_eligible(self):
        forbidden = [
            ".github/workflows/ci.yml", ".github/CODEOWNERS", "CODEOWNERS", "CLAUDE.md", "scripts/ci-gate/ci_gate.py",
            "scripts/horizon-eval/horizon_eval.py", "docs/autonomous-engineering/AWJ-HORIZON-V2-1B-AUTHORITY-THREAT-MODEL.md",
            "docs/autonomous-engineering/grants/GR-20261012-001.json", "database/migrations/2026_10_12_000001_x.php",
            "app/Services/Accounting/LedgerService.php", "app/Tenancy/TenantScope.php", "routes/api.php", "Dockerfile",
            "deploy/anything.yml", ".env", "composer.lock", "unknown/new/path.bin", "../escape.md", "docs/../.github/x.yml",
        ]
        case, _ = cr.load_case(cr.FIXTURES / "base_case.json")
        doc = case["evidence"]["grant_store"]["grants"][0]["document"]
        doc["paths_allow"] = ["**"]                               # even a hostile grant must not help
        doc["task_categories"] = ["docs-nongov", "a11y-label", "presentational-ui", "isolated-bugfix", "tests-additive"]
        cr.resolve_auto(case["evidence"]["grant_store"]["grants"][0].update(content_sha256="@auto") or case)
        case["evidence"]["grant_store"]["grants"][0]["authenticity"]["signed_content_sha256"] = "@auto"
        cr.resolve_auto(case)
        self.assertEqual(he.evaluate(case, allow_synthetic=True)["decision"], "ELIGIBLE_SIMULATED")
        for path in forbidden:
            c = copy.deepcopy(case)
            c["evidence"]["pr"]["files"].append({"filename": path, "status": "modified", "additions": 1, "deletions": 0, "patch": "@@ -1 +1 @@\n-a\n+b"})
            c["evidence"]["pr"]["changed_files"] += 1
            c["evidence"]["pr"]["additions"] += 1
            rec = he.evaluate(c, allow_synthetic=True)
            self.assertNotEqual(rec["decision"], "ELIGIBLE_SIMULATED", path)


if __name__ == "__main__":
    unittest.main()

"""Static guards: the pilot must stay dry-run and its fixtures must stay synthetic.

These tests read source text/AST only. They exist so that a future edit cannot quietly add an
operational capability (merge, deploy, settings change, credential use) or let a fixture grant leak
into a place where it could be mistaken for a live one.
"""
from __future__ import annotations

import ast
import inspect
import json
import re
import subprocess as real_subprocess
import unittest
from pathlib import Path
from unittest import mock

import collect_snapshot as cs
import horizon_eval as he

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SYNTHETIC = HERE / "fixtures" / "synthetic"


def imports_of(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module.split(".")[0])
    return names


def code_atoms(path: Path):
    """(identifiers, string constants) of executable code only - docstrings and comments excluded."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    doc_nodes = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant):
                doc_nodes.add(id(body[0].value))
    names, strings = set(), []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in doc_nodes:
            strings.append(node.value)
    return names, strings


class NoOperationalCapability(unittest.TestCase):
    CORE_FILES = [HERE / "horizon_eval.py", HERE / "ledger.py", HERE / "contract_runner.py"]
    NETWORK = {"subprocess", "socket", "ssl", "http", "urllib", "urllib3", "requests", "httpx", "aiohttp", "ftplib", "smtplib",
               "ctypes", "shutil", "multiprocessing", "asyncio", "webbrowser", "pty", "pexpect"}

    def test_core_modules_have_no_network_or_process_imports(self):
        for f in self.CORE_FILES:
            bad = imports_of(f) & self.NETWORK
            self.assertEqual(bad, set(), f"{f.name} imports {bad}")

    def test_evaluator_never_touches_env_filesystem_or_writes(self):
        self.assertNotIn("os", imports_of(HERE / "horizon_eval.py"))
        names, _ = code_atoms(HERE / "horizon_eval.py")
        for ident in ("environ", "getenv", "putenv", "system", "popen", "spawn", "eval", "exec", "__import__", "open",
                      "write_text", "write_bytes", "write", "unlink", "rename", "replace_file", "mkdir", "touch", "chmod", "rmtree"):
            self.assertNotIn(ident, names, ident)
        # the only filesystem access the CLI has is reading the case file
        self.assertIn("read_text", names)
        self.assertIn("read_bytes", names)

    def test_no_operation_names_appear_in_any_module(self):
        forbidden = ["merge_pull_request", "enable_pr_auto_merge", "update_pull_request_branch", "create_or_update_file",
                     "push_files", "pulls/merge", "/merge", "git push", "git merge", "auto_merge", "gh pr merge",
                     "gh api -X", "--method", "-X POST", "-X PUT", "-X PATCH", "-X DELETE", "set-variables", "railway"]
        for f in [HERE / "horizon_eval.py", HERE / "ledger.py", HERE / "collect_snapshot.py", HERE / "contract_runner.py"]:
            names, strings = code_atoms(f)
            code = "\n".join(strings) + "\n" + "\n".join(sorted(names))
            for needle in forbidden:
                if needle == "auto_merge" and f.name == "horizon_eval.py":
                    continue  # the audit record's constant counter key 'auto_merge': 0
                self.assertNotIn(needle, code, f"{f.name}: {needle}")

    def test_would_merge_is_a_constant_false(self):
        src = (HERE / "horizon_eval.py").read_text(encoding="utf-8")
        self.assertEqual(len(re.findall(r'"would_merge"\s*:\s*False', src)), 1)
        self.assertNotIn('"would_merge": True', src)
        self.assertNotIn("would_merge = True", src)


class CollectorIsReadOnly(unittest.TestCase):
    def test_single_subprocess_call_site_and_get_only_argv(self):
        tree = ast.parse((HERE / "collect_snapshot.py").read_text(encoding="utf-8"))
        calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                 and n.func.attr in ("run", "Popen", "call", "check_output", "check_call")]
        self.assertEqual(len(calls), 1)
        body = inspect.getsource(cs.gh_get)
        self.assertIn('argv = ["gh", "api", path] + (["--paginate", "--slurp"] if paginate else [])', body)
        flags = set(re.findall(r'"(-{1,2}[A-Za-z][A-Za-z-]*)"', body))
        self.assertEqual(flags, {"--paginate", "--slurp"})

    def test_runtime_argv_is_exactly_gh_api_path(self):
        seen = []

        def fake_run(argv, **kw):
            seen.append(argv)
            return real_subprocess.CompletedProcess(argv, 0, stdout='[[{"ok": true}]]' if "--slurp" in argv else '{"ok": true}', stderr="")

        with mock.patch.object(cs.subprocess, "run", fake_run):
            cs.gh_get("repos/o/r/pulls/1")
            cs.gh_get("repos/o/r/pulls/1/files?per_page=100", paginate=True)
        self.assertEqual(seen[0], ["gh", "api", "repos/o/r/pulls/1"])
        self.assertEqual(seen[1], ["gh", "api", "repos/o/r/pulls/1/files?per_page=100", "--paginate", "--slurp"])

    def test_every_list_endpoint_the_collector_reads_is_paginated(self):  # Codex thread 13 (workflow-runs lookup)
        calls = []

        def fake_gh_get(path, paginate=False):
            calls.append((path.split("?")[0], paginate))
            tail = path.split("?")[0]
            if tail.endswith("/branches/main"):
                return {"commit": {"sha": "a" * 40}}
            if "/pulls/" in tail and tail.count("/") == 4:
                return {"state": "open", "draft": False, "merged": False, "merge_commit_sha": None, "user": {"login": "u"}, "title": "t", "body": "",
                        "head": {"sha": "b" * 40, "ref": "r", "repo": {"full_name": "o/r"}}, "base": {"sha": "a" * 40, "ref": "main", "repo": {"full_name": "o/r"}},
                        "additions": 0, "deletions": 0, "changed_files": 0, "labels": []}
            if tail.endswith("/files") or tail.endswith("/commits") or tail.endswith("/comments") or tail.endswith("/reviews"):
                return []
            if "/commits/" in tail and tail.endswith("/b" * 1 + "b" * 39):
                return {"commit": {"committer": {"date": "2026-10-12T00:00:00Z"}}}
            if tail.endswith("/check-runs"):
                return {"check_runs": []}
            if tail.endswith("/actions/runs"):
                return {"workflow_runs": []}
            if "/contents/.github/ci-gate" in tail:
                import base64
                return {"content": base64.b64encode(json.dumps({"gate_check_name": "CI Gate", "grace_minutes_no_run": 10, "checks": []}).encode()).decode()}
            if "/contents/docs/autonomous-engineering/grants" in tail:
                raise cs.CollectError("404 Not Found")
            if tail.endswith("/pulls"):
                return []
            return {"commit": {"committer": {"date": "2026-10-12T00:00:00Z"}}}

        with mock.patch.object(cs, "gh_get", fake_gh_get):
            cs.collect("o/r", 7, {"horizon_id": "h", "task_id": "t", "task_category": "c", "agent_id": "a", "repository": "o/r", "base_branch": "main", "action": "merge"})
        paginated = {path for path, pag in calls if pag}
        for tail in ("/pulls/7/files", "/pulls/7/commits", "/issues/7/comments", "/pulls/7/reviews", "/check-runs", "/actions/runs", "/pulls"):
            self.assertTrue(any(p.endswith(tail) for p in paginated), f"{tail} must be read with pagination")

    def test_paginated_shapes_are_flattened(self):
        self.assertEqual(cs.flatten_pages([[1, 2], [3]]), [1, 2, 3])
        merged = cs.flatten_pages([{"total_count": 3, "check_runs": [{"id": 1}, {"id": 2}]}, {"total_count": 3, "check_runs": [{"id": 3}]}])
        self.assertEqual([c["id"] for c in merged["check_runs"]], [1, 2, 3])
        self.assertEqual(cs.flatten_pages([]), [])
        for bad in ({"a": 1}, [[1], {"a": 1}], "x"):
            with self.assertRaises(cs.CollectError):
                cs.flatten_pages(bad)

    def test_refuses_anything_outside_repos_paths(self):
        for bad in ["user", "orgs/x/members", "/repos/o/r", "graphql", "repos/o", "repos/o/r/../../x", "repos/o/r/x -X DELETE",
                    "repos/o/r/x;rm", "repos/o/r/pulls/1\n-f x=1",
                    # dot-segments / encoded separators match the charset but would leave the repo namespace
                    "repos/o/r/../../x", "repos/../../user/x", "repos/o/../x/y", "repos/o/r/./pulls",
                    "repos/o/r/%2e%2e/%2e%2e/user", "repos/o/r/pulls%2F1", "repos/o/r/pulls?x=1/../../user"]:
            # hermetic: a refused path must never reach a subprocess (so the test needs neither `gh` nor a network)
            with mock.patch.object(cs.subprocess, "run", side_effect=AssertionError("spawned a process")):
                with self.assertRaises(cs.CollectError, msg=bad):
                    cs.gh_get(bad)


class FixturesStaySynthetic(unittest.TestCase):
    def test_every_fixture_lives_under_the_synthetic_dir_and_is_marked(self):
        files = sorted(SYNTHETIC.rglob("*.json"))
        self.assertGreaterEqual(len(files), 25)
        for f in files:
            data = json.loads(f.read_text(encoding="utf-8"))
            self.assertIn("_synthetic_notice", data, f.name)
            self.assertIn("SYNTHETIC", data["_synthetic_notice"], f.name)

    def test_every_grant_in_a_fixture_is_synthetic(self):
        for f in sorted(SYNTHETIC.rglob("*.json")):
            text = f.read_text(encoding="utf-8")
            for gid in re.findall(r'"grant_id":\s*"([^"]+)"', text):
                self.assertTrue(gid.startswith("GR-SYNTHETIC-"), f"{f.name}: {gid}")
            self.assertNotRegex(text, r'"grant_id":\s*"GR-\d{8}-\d{3}"', f.name)

    def test_no_fixture_grant_text_exists_outside_the_fixture_dir(self):
        offenders = []
        for f in HERE.rglob("*"):
            if f.is_file() and SYNTHETIC not in f.parents and f.suffix in (".json", ".md", ".py", ".yml", ".yaml") \
                    and "__pycache__" not in f.parts and f.name not in ("test_static_guards.py", "test_horizon_eval.py",
                                                                         "test_contract.py", "horizon_eval.py", "README.md"):
                if "GR-SYNTHETIC-" in f.read_text(encoding="utf-8", errors="ignore"):
                    offenders.append(f.name)
        self.assertEqual(offenders, [])

    def test_no_live_grant_or_registry_directory_exists_in_this_pilot(self):
        # If the owner later introduces real grants, this guard must be edited in an owner-reviewed (Zone C) PR.
        for rel in ("docs/autonomous-engineering/grants", "docs/autonomous-engineering/registry"):
            self.assertFalse((REPO / rel).exists(), rel)

    def test_fixture_cases_are_all_synthetic_mode_or_live_with_synthetic_base(self):
        for f in sorted((SYNTHETIC / "cases").glob("*.json")):
            data = json.loads(f.read_text(encoding="utf-8"))
            self.assertIn(data.get("mode", "synthetic-test"), ("synthetic-test", "live"))
            self.assertEqual(data["_extends"].startswith("../base_case"), True)

    def test_no_secret_like_strings_in_pilot_files(self):
        rx = re.compile(r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+/]{20,}")
        for f in HERE.rglob("*"):
            if f.is_file() and "__pycache__" not in f.parts and f.name != "test_horizon_eval.py":
                self.assertIsNone(rx.search(f.read_text(encoding="utf-8", errors="ignore")), f.name)


class PolicyIntegrity(unittest.TestCase):
    def test_policy_shape(self):
        pol, sha = he.load_policy()
        self.assertEqual(len(sha), 64)
        ids = {r["id"] for r in pol["path_rules"]}
        self.assertEqual(len(ids), len(pol["path_rules"]))
        for r in pol["path_rules"]:
            self.assertIn(r["zone"], he.ZONES)
        for name, spec in pol["categories"].items():
            self.assertIn(spec["max_zone"], ("A", "B"), name)
            self.assertTrue(set(spec["rules"]) <= ids, name)
            for rid in spec["rules"]:
                self.assertIn(next(r for r in pol["path_rules"] if r["id"] == rid)["zone"], ("A", "B"), f"{name}->{rid}")

    def test_hard_deny_covers_the_hard_exclusions_of_v2_1b_3_4(self):
        pol, _ = he.load_policy()
        for path in [".github/workflows/ci-gate.yml", "scripts/ci-gate/ci_gate.py", "docs/autonomous-engineering/x.md",
                     "CODEOWNERS", "CLAUDE.md", "database/migrations/x.php", "Dockerfile", ".env", "deploy/x",
                     "scripts/horizon-eval/policy/zone_policy.v1.json", ".claude/settings.json"]:
            self.assertTrue(he.any_match(pol["hard_deny_patterns"], path), path)

    def test_every_hard_deny_path_classifies_as_c_or_p(self):
        pol, _ = he.load_policy()
        for path in [".github/workflows/x.yml", "scripts/ci-gate/x.py", "docs/autonomous-engineering/x.md", "CODEOWNERS",
                     "database/seeders/x.php", "Dockerfile", ".env.local"]:
            rec = he.evaluate({"_": 1})  # touch evaluate on junk to be sure it never raises
            self.assertEqual(rec["decision"], "BLOCK")
            reasons = he.Reasons()
            recs, pz, _, _ = he.classify_files([{"filename": path, "status": "modified", "additions": 1, "deletions": 0, "patch": "x"}], pol, reasons)
            self.assertIn(pz, ("C", "P"), path)

    def test_the_evaluator_protects_itself(self):
        pol, _ = he.load_policy()
        for f in ("horizon_eval.py", "ledger.py", "contract_runner.py", "collect_snapshot.py", "policy/zone_policy.v1.json",
                  "fixtures/synthetic/base_case.json"):
            reasons = he.Reasons()
            _, pz, _, _ = he.classify_files([{"filename": f"scripts/horizon-eval/{f}", "status": "modified", "additions": 1, "deletions": 0, "patch": "x"}], pol, reasons)
            self.assertEqual(pz, "C", f)


class Docs(unittest.TestCase):
    def test_readme_states_dry_run(self):
        text = (HERE / "README.md").read_text(encoding="utf-8")
        for needle in ("DRY-RUN", "ELIGIBLE_SIMULATED", "never authorises", "synthetic"):
            self.assertIn(needle, text)


if __name__ == "__main__":
    unittest.main()

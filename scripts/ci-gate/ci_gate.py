#!/usr/bin/env python3
"""AWJ CI Gate (AWJ-HORIZON-V2-1A).

One stable, always-reported check ("CI Gate") that can later become the single
Required Status Check. It does NOT run tests itself: it decides, from the PR
diff and the workflow files, which checks must exist for the PR head SHA, and
waits until each is `completed/success`.

Modes
  validate   static, offline: manifest vs workflows + anti-bypass lints
  gate       online: poll the Checks API for the PR head SHA (needs GITHUB_TOKEN)

Stdlib + PyYAML only. Fail-closed: any API error, unsupported workflow
construct, or manifest drift is a failure, never a pass.
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML is required (pip install pyyaml)")

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / ".github" / "ci-gate" / "required-checks.json"
GITHUB_ACTIONS_APP = "github-actions"
BLOCKING = ("always", "paths")
# Measured on 119 merged PRs: CI wall time median 24 min, p90 38, max 114 (runner queue up to 90 min).
# 120 min covers all of them; 70 would have failed 2 healthy PRs. Keep the workflow job timeout above this.
DEFAULT_TIMEOUT_MINUTES = 120
MAX_PR_FILES = 3000  # REST cap: beyond it the file list is incomplete -> require everything


class GateError(Exception):
    """Configuration/drift problem: always a failure."""


# ───────────────────────── workflow parsing ─────────────────────────

def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def on_block(doc: dict) -> dict:
    # YAML 1.1 parses the bare key `on` as boolean True.
    raw = doc.get("on", doc.get(True))
    if isinstance(raw, str):
        return {raw: None}
    if isinstance(raw, list):
        return {k: None for k in raw}
    return raw or {}


def pr_trigger(doc: dict):
    """Return (triggers_on_pr, paths|None). Raises on constructs we cannot evaluate."""
    on = on_block(doc)
    if "pull_request" not in on:
        return False, None
    cfg = on["pull_request"] or {}
    if "paths-ignore" in cfg:
        raise GateError("paths-ignore is not supported by the gate; use `paths`")
    branches = cfg.get("branches")
    if branches not in (None, ["**"]):
        raise GateError(f"pull_request.branches={branches!r} is not supported by the gate")
    if "branches-ignore" in cfg:
        raise GateError("pull_request.branches-ignore is not supported by the gate")
    paths = cfg.get("paths")
    if paths is not None:
        if any(str(p).startswith("!") for p in paths):
            raise GateError("negated path patterns (!) are not supported by the gate")
        paths = [str(p) for p in paths]
    return True, paths


def job_names(job_id: str, job: dict) -> list[str]:
    """Expand a job's display name over its matrix (single-axis lists only)."""
    template = str(job.get("name", job_id))
    matrix = ((job.get("strategy") or {}).get("matrix")) or {}
    if "include" in matrix or "exclude" in matrix:
        raise GateError(f"job {job_id}: matrix include/exclude not supported by the gate")
    axes = {k: v for k, v in matrix.items() if isinstance(v, list)}
    refs = set(re.findall(r"\$\{\{\s*([^}]*?)\s*\}\}", template))
    if not refs:
        return [template]
    for ref in refs:
        if not re.fullmatch(r"matrix\.\w+", ref) or ref.split(".")[1] not in axes:
            raise GateError(f"job {job_id}: unsupported expression in name: {template!r}")
    keys = sorted({r.split(".")[1] for r in refs})
    names = []
    for combo in itertools.product(*(axes[k] for k in keys)):
        n = template
        for k, v in zip(keys, combo):
            n = re.sub(r"\$\{\{\s*matrix\." + k + r"\s*\}\}", str(v), n)
        names.append(n)
    return names


# ───────────────────────── path globbing ─────────────────────────

def glob_to_regex(pattern: str) -> re.Pattern:
    """GitHub filter-pattern semantics: `*` no slash, `**` anything, `?` one non-slash char."""
    i, out = 0, ""
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
            continue
        if pattern.startswith("**", i):
            out += ".*"
            i += 2
            continue
        if c == "*":
            out += "[^/]*"
        elif c == "?":
            out += "[^/]"
        else:
            out += re.escape(c)
        i += 1
    return re.compile("^" + out + "$")


def paths_match(patterns: list[str], files: list[str]) -> bool:
    regs = [glob_to_regex(p) for p in patterns]
    return any(r.match(f) for f in files for r in regs)


# ───────────────────────── manifest / validation ─────────────────────────

def load_manifest(path: Path = MANIFEST) -> dict:
    m = json.loads(path.read_text(encoding="utf-8"))
    if m.get("version") != 1:
        raise GateError("unsupported manifest version")
    seen = set()
    for c in m["checks"]:
        for k in ("name", "workflow", "job", "tier"):
            if not c.get(k):
                raise GateError(f"manifest check missing {k!r}: {c}")
        if c["tier"] not in (*BLOCKING, "advisory"):
            raise GateError(f"bad tier for {c['name']}")
        if c["name"] in seen:
            raise GateError(f"duplicate check name {c['name']!r}")
        seen.add(c["name"])
    return m


def validate(root: Path = ROOT, manifest: dict | None = None) -> tuple[list[str], list[str]]:
    """Return (errors, warnings). Offline; the gate runs it first and fails on errors."""
    manifest = manifest or load_manifest(root / ".github" / "ci-gate" / "required-checks.json")
    errors, warnings = [], []
    classified: set[tuple[str, str]] = set()
    docs: dict[str, dict] = {}

    for c in manifest["checks"]:
        wf = c["workflow"]
        p = root / wf
        if not p.exists():
            errors.append(f"[{c['name']}] workflow file missing: {wf}")
            continue
        doc = docs.setdefault(wf, load_yaml(p))
        job = (doc.get("jobs") or {}).get(c["job"])
        if job is None:
            errors.append(f"[{c['name']}] job {c['job']!r} not found in {wf}")
            continue
        try:
            names = job_names(c["job"], job)
            on_pr, paths = pr_trigger(doc)
        except GateError as e:
            errors.append(f"[{c['name']}] {e}")
            continue
        classified.add((wf, c["name"]))
        if c["name"] not in names:
            errors.append(f"[{c['name']}] name drift: {wf}:{c['job']} now produces {names}")
        if c["tier"] in BLOCKING:
            if not on_pr:
                errors.append(f"[{c['name']}] {wf} no longer triggers on pull_request")
            if c["tier"] == "always" and paths is not None:
                errors.append(f"[{c['name']}] tier=always but {wf} has a pull_request.paths filter (would leave PRs pending)")
            if c["tier"] == "paths" and paths is None:
                errors.append(f"[{c['name']}] tier=paths but {wf} has no pull_request.paths (reclassify as always)")
            # Anti-bypass: a skipped/continue-on-error job reports SUCCESS to branch protection.
            if "if" in job:
                errors.append(f"[{c['name']}] required job has a job-level `if` (a skipped job counts as success)")
            if str(job.get("continue-on-error", False)).lower() not in ("false",):
                errors.append(f"[{c['name']}] required job uses continue-on-error")
            steps = job.get("steps") or []
            for s in steps:
                if str(s.get("continue-on-error", False)).lower() not in ("false",):
                    errors.append(f"[{c['name']}] step {s.get('name', s.get('uses', '?'))!r} uses continue-on-error")
            guard = c.get("guard")
            if guard:
                hit = [s for s in steps if guard["step_run_contains"] in str(s.get("run", ""))]
                if not hit:
                    errors.append(f"[{c['name']}] no step runs {guard['step_run_contains']!r}")
                for s in hit:
                    run = str(s.get("run", ""))
                    for bad in guard.get("forbidden", []):
                        if bad in run:
                            errors.append(f"[{c['name']}] test step contains forbidden {bad!r}")
                    for need in guard.get("require", []):
                        if need not in run:
                            errors.append(f"[{c['name']}] test step lacks required {need!r}")

    # Discovery: any PR-triggered workflow job nobody classified is a gap, not a pass.
    gate_wf = ".github/workflows/ci-gate.yml"
    producers: dict[str, list[str]] = {}
    declared_wfs = {c["workflow"] for c in manifest["checks"]}
    for f in sorted((root / ".github" / "workflows").glob("*.y*ml")):
        rel = f.relative_to(root).as_posix()
        if rel == gate_wf:
            continue
        doc = docs.get(rel) or load_yaml(f)
        try:
            on_pr, _ = pr_trigger(doc)
        except GateError as e:
            warnings.append(f"{rel}: {e}")
            continue
        if not on_pr:
            continue
        for jid, job in (doc.get("jobs") or {}).items():
            try:
                names = job_names(jid, job)
            except GateError as e:
                warnings.append(f"{rel}: {e}")
                if rel in declared_wfs:
                    # A job whose display name cannot be evaluated (e.g. `${{ 'Required check name' }}`) may report under a
                    # required name and is invisible to duplicate detection. Inside a workflow that hosts required checks
                    # that is an error, not a warning.
                    errors.append(f"{rel}:{jid} has a job name the gate cannot evaluate in a workflow that hosts required checks ({e})")
                continue
            for n in names:
                producers.setdefault(n, []).append(f"{rel}:{jid}")
                if (rel, n) not in classified:
                    warnings.append(f"unclassified PR check {n!r} ({rel}:{jid}) — add it to required-checks.json (tier required or advisory)")
    # A required check name must be produced by exactly one job. A second job with the same display name (in this or
    # another workflow) could report success under it; `latest_by_name` alone cannot tell the two apart.
    for c in manifest["checks"]:
        jobs = producers.get(c["name"], [])
        if len(jobs) > 1:
            errors.append(f"[{c['name']}] check name is produced by more than one PR-triggered job: {sorted(jobs)}")
    return errors, warnings


GATE_PATHS = (".github/workflows/ci-gate.yml", ".github/ci-gate/", "scripts/ci-gate/")


def touches_gate(files: list[str] | None) -> bool:
    return files is None or any(f.startswith(GATE_PATHS) for f in files)


def compare_baseline(base_root: Path, head_root: Path) -> list[str]:
    """A PR may add checks or tighten, never weaken what `main` already requires.
    Compares the base branch's manifest/workflows with the PR's. Errors = weakening."""
    bp = base_root / ".github" / "ci-gate" / "required-checks.json"
    if not bp.exists():
        return []  # bootstrap: the base has no gate yet
    base, head = load_manifest(bp), load_manifest(head_root / ".github" / "ci-gate" / "required-checks.json")
    errors = []
    hmap = {c["name"]: c for c in head["checks"]}
    rank = {"advisory": 0, "paths": 1, "always": 2}
    for bc in base["checks"]:
        if bc["tier"] not in BLOCKING:
            continue
        hc = hmap.get(bc["name"])
        if hc is None:
            errors.append(f"[{bc['name']}] blocking check removed from the manifest")
            continue
        if rank[hc["tier"]] < rank[bc["tier"]]:
            errors.append(f"[{bc['name']}] tier weakened {bc['tier']} -> {hc['tier']}")
        if (hc["workflow"], hc["job"]) != (bc["workflow"], bc["job"]):
            errors.append(f"[{bc['name']}] now points at a different workflow/job")
        bg, hg = bc.get("guard") or {}, hc.get("guard") or {}
        if bg:
            for key in ("forbidden", "require"):
                lost = set(bg.get(key, [])) - set(hg.get(key, []))
                if lost:
                    errors.append(f"[{bc['name']}] guard.{key} lost {sorted(lost)}")
            if bg.get("step_run_contains") != hg.get("step_run_contains"):
                errors.append(f"[{bc['name']}] guard.step_run_contains changed")
        # Path filters live in the workflow: removing a pattern silently un-requires files.
        if bc["tier"] == "paths":
            try:
                _, bpaths = pr_trigger(load_yaml(base_root / bc["workflow"]))
                _, hpaths = pr_trigger(load_yaml(head_root / hc["workflow"]))
            except (GateError, FileNotFoundError) as e:
                errors.append(f"[{bc['name']}] cannot compare path filters: {e}")
                continue
            lost = set(bpaths or []) - set(hpaths or [])
            if hpaths is None:
                lost = set()  # no filter = runs always = stricter
            if lost:
                errors.append(f"[{bc['name']}] pull_request.paths lost {sorted(lost)}")
    return errors


# ───────────────────────── expectation + verdict (pure) ─────────────────────────

def expected_checks(manifest: dict, docs: dict[str, dict], files: list[str] | None) -> dict[str, str]:
    """name -> reason, for blocking checks that MUST be reported on this PR.
    files=None means the diff is unknown/truncated: require every blocking check."""
    out = {}
    for c in manifest["checks"]:
        if c["tier"] not in BLOCKING:
            continue
        on_pr, paths = pr_trigger(docs[c["workflow"]])
        if not on_pr:
            raise GateError(f"{c['workflow']} does not trigger on pull_request")
        if c["tier"] == "always" or paths is None:
            out[c["name"]] = "always"
        elif files is None:
            out[c["name"]] = "diff unknown -> required"
        elif paths_match(paths, files):
            out[c["name"]] = "paths match"
    return out


def bind_check_runs(check_runs: list[dict], wf_runs: list[dict], sha: str) -> tuple[list[dict], list[dict]]:
    """Keep only check runs that belong to a `pull_request`-event workflow run of this exact
    head SHA. `push`-event runs of the same branch publish identically named check runs on the
    same SHA (observed on PR #1334); they are a different attempt context and must not decide
    (or mask) the PR verdict. Returns (bound_check_runs, relevant_workflow_runs)."""
    mine = [w for w in wf_runs if w.get("event") == "pull_request" and w.get("head_sha") == sha]
    suites = {w["check_suite_id"] for w in mine if w.get("check_suite_id") is not None}
    bound = [r for r in check_runs if (r.get("check_suite") or {}).get("id") in suites]
    return bound, mine


def restrict_to_declared_workflows(manifest: dict, check_runs: list[dict], wf_runs: list[dict]) -> list[dict]:
    """A manifest check only counts when its check run belongs to the suite of the workflow the manifest declares.
    Without this, any PR-triggered job (another workflow, same display name, same github-actions app) satisfies a
    required check without running it. Runs whose name is not in the manifest are passed through unchanged;
    a manifest-named run with an unknown suite or a different workflow is dropped (fail closed: it is then 'not reported')."""
    path_by_suite = {w["check_suite_id"]: w.get("path") for w in wf_runs if w.get("check_suite_id") is not None}
    declared = {c["name"]: c["workflow"] for c in manifest["checks"]}
    kept = []
    for r in check_runs:
        want = declared.get(r["name"])
        if want is None or path_by_suite.get((r.get("check_suite") or {}).get("id")) == want:
            kept.append(r)
    return kept


def latest_by_name(check_runs: list[dict]) -> dict[str, dict]:
    """Newest attempt per name, github-actions app only (a re-run adds a higher id)."""
    best: dict[str, dict] = {}
    for r in check_runs:
        if (r.get("app") or {}).get("slug") != GITHUB_ACTIONS_APP:
            continue
        if r["name"] not in best or r["id"] > best[r["name"]]["id"]:
            best[r["name"]] = r
    return best


def evaluate(manifest, expected, check_runs, workflow_runs, elapsed_s, deadline_s):
    """Return (verdict, rows, warnings). verdict: pass | fail | wait."""
    latest = latest_by_name(check_runs)
    grace_s = manifest.get("grace_minutes_no_run", 10) * 60
    rows, warnings = [], []
    by_wf: dict[str, list[dict]] = {}
    for w in workflow_runs:
        by_wf.setdefault(w.get("path", ""), []).append(w)

    for c in manifest["checks"]:
        name, tier = c["name"], c["tier"]
        run = latest.get(name)
        if tier == "advisory":
            state = "n/a" if not run else (run["conclusion"] or run["status"])
            rows.append((name, tier, "advisory", state, "ok"))
            continue
        if name not in expected and run is None:
            rows.append((name, tier, "not required (path filter)", "-", "ok"))
            continue
        why = expected.get(name, "present on SHA")
        if run is not None:
            if run["status"] != "completed":
                status = "wait"
            elif run["conclusion"] == "success":
                status = "ok"
            else:
                status = "bad"
            rows.append((name, tier, why, run["conclusion"] or run["status"], status))
            if status == "ok":
                older = [r for r in check_runs if r["name"] == name and r["id"] != run["id"]
                         and r.get("conclusion") in ("failure", "timed_out", "cancelled")]
                if older:
                    warnings.append(f"{name}: passed on re-run; {len(older)} earlier attempt(s) failed — verify it was infra, not a flaky test")
            continue
        # expected but not reported
        wf_runs = by_wf.get(c["workflow"], [])
        if any(w.get("conclusion") == "action_required" for w in wf_runs):
            rows.append((name, tier, why, "action_required", "bad"))
        elif not wf_runs and elapsed_s >= grace_s:
            rows.append((name, tier, why, f"workflow never triggered ({grace_s // 60} min grace)", "bad"))
        elif wf_runs and all(w.get("status") == "completed" for w in wf_runs):
            rows.append((name, tier, why, "workflow finished without reporting this job", "bad"))
        else:
            rows.append((name, tier, why, "not reported yet", "wait"))

    if elapsed_s >= deadline_s:
        rows = [(n, t, w, s + " (deadline)" if st == "wait" else s, "bad" if st == "wait" else st)
                for n, t, w, s, st in rows]
    states = {r[4] for r in rows}
    verdict = "fail" if "bad" in states else "wait" if "wait" in states else "pass"
    return verdict, rows, warnings


# ───────────────────────── GitHub API ─────────────────────────

class Api:
    def __init__(self, repo: str, token: str):
        self.repo, self.token = repo, token

    def get(self, path: str, params: dict | None = None):
        url = f"https://api.github.com/repos/{self.repo}/{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "awj-ci-gate",
        })
        last = None
        for attempt in range(5):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504):
                    raise GateError(f"GitHub API {e.code} for {path}: {e.read()[:200]!r}")
                last = e
            except urllib.error.URLError as e:
                last = e
            time.sleep(2 ** attempt)
        raise GateError(f"GitHub API unreachable for {path}: {last}")

    def pages(self, path: str, key: str | None, params: dict | None = None, max_pages: int = 40):
        items = []
        for page in range(1, max_pages + 1):
            data = self.get(path, {**(params or {}), "per_page": 100, "page": page})
            chunk = data[key] if key else data
            items += chunk
            if len(chunk) < 100:
                return items
        raise GateError(f"{path}: more than {max_pages} pages")


def render_summary(verdict, rows, warnings, expected, sha, files_known):
    icon = {"ok": "✅", "wait": "⏳", "bad": "❌"}
    lines = [f"## CI Gate — **{verdict.upper()}**", f"`{sha}`", "",
             "| Check | Tier | Why | State | |", "|---|---|---|---|---|"]
    lines += [f"| {n} | {t} | {w} | {s} | {icon[st]} |" for n, t, w, s, st in rows]
    if not files_known:
        lines += ["", "> PR file list unavailable/truncated: every blocking check was required."]
    for w in warnings:
        lines.append(f"\n⚠️ {w}")
    return "\n".join(lines) + "\n"


def run_gate(args) -> int:
    root = Path(args.root).resolve()
    errors, warns = validate(root)
    if args.base_root:
        errors += compare_baseline(Path(args.base_root).resolve(), root)
    for w in warns:
        print(f"::warning::{w}")
    if errors:
        for e in errors:
            print(f"::error::{e}")
        return 1
    manifest = load_manifest(root / ".github" / "ci-gate" / "required-checks.json")
    docs = {c["workflow"]: load_yaml(root / c["workflow"]) for c in manifest["checks"]}
    api = Api(os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_TOKEN"])
    sha, pr = args.sha, args.pr

    def assert_head_current():
        info = api.get(f"pulls/{pr}")
        if info["state"] != "open" or info["head"]["sha"] != sha:
            raise GateError(f"stale gate: PR head is now {info['head']['sha']} (state {info['state']}), this run evaluates {sha}")
        return info

    info = assert_head_current()
    # Evidence: the workflow executes on the merge ref; checks are attached to the PR head SHA.
    print(f"Evidence: GITHUB_SHA(merge)={os.environ.get('GITHUB_SHA')} GITHUB_REF={os.environ.get('GITHUB_REF')} "
          f"event={os.environ.get('GITHUB_EVENT_NAME')} pr.head={info['head']['sha']} pr.base={info['base']['sha']} "
          f"pr.merge_commit_sha={info.get('merge_commit_sha')}")

    files = api.pages(f"pulls/{pr}/files", None)
    files_known = len(files) < MAX_PR_FILES
    names = None
    if files_known:
        names = []
        for f in files:
            names.append(f["filename"])
            if f.get("previous_filename"):
                names.append(f["previous_filename"])
    expected = expected_checks(manifest, docs, names)
    print("Expected:", json.dumps(expected, ensure_ascii=False))
    banner = ""
    if touches_gate(names):
        banner = ("GATE SELF-CHANGE: this PR modifies the gate/manifest. Weakening vs main is blocked automatically; "
                  "other gate changes need manual owner review.")
        print(f"::warning::{banner}")

    start, deadline = time.monotonic(), args.timeout_minutes * 60
    last_sig = None
    gate_name = manifest["gate_check_name"]
    while True:
        wf_all = api.pages("actions/runs", "workflow_runs", {"head_sha": sha, "event": "pull_request"})
        raw = [r for r in api.pages(f"commits/{sha}/check-runs", "check_runs", {"filter": "all"})
               if r["name"] != gate_name]
        check_runs, wf_runs = bind_check_runs(raw, wf_all, sha)
        check_runs = restrict_to_declared_workflows(manifest, check_runs, wf_runs)
        verdict, rows, warnings = evaluate(manifest, expected, check_runs, wf_runs,
                                           time.monotonic() - start, deadline)
        summary = render_summary(verdict, rows, warnings, expected, sha, files_known)
        if banner:
            summary += f"\n> {banner}\n"
        sig = (verdict, tuple((r[0], r[3]) for r in rows))
        if sig != last_sig or verdict != "wait":  # log only on change (a 45-min wait otherwise prints ~90 tables)
            print(summary)
            last_sig = sig
        if verdict != "wait":
            break
        time.sleep(args.interval)
        assert_head_current()
    assert_head_current()

    if os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(os.environ["GITHUB_STEP_SUMMARY"]).write_text(summary, encoding="utf-8")
    for w in warnings:
        print(f"::warning::{w}")
    if verdict == "fail":
        print("::error::CI Gate failed. After fixing/re-running a failed job, re-run this CI Gate job.")
        return 1
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("--root", default=str(ROOT))
    g = sub.add_parser("gate")
    g.add_argument("--root", default=str(ROOT), help="PR checkout (manifest + workflows under test)")
    g.add_argument("--base-root", default=None, help="trusted checkout of the base commit (no-weakening baseline)")
    g.add_argument("--pr", type=int, required=True)
    g.add_argument("--sha", required=True)
    g.add_argument("--timeout-minutes", type=int, default=DEFAULT_TIMEOUT_MINUTES)
    g.add_argument("--interval", type=int, default=30)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "validate":
            errors, warns = validate(Path(args.root).resolve())
            for w in warns:
                print(f"warning: {w}")
            for e in errors:
                print(f"error: {e}")
            print("OK" if not errors else f"{len(errors)} error(s)")
            return 1 if errors else 0
        return run_gate(args)
    except GateError as e:
        print(f"::error::{e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

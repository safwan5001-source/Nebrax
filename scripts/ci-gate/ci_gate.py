#!/usr/bin/env python3
"""AWJ CI Gate (AWJ-HORIZON-V2-1A).

One stable, always-reported check ("CI Gate") that can later become the single
Required Status Check. It does NOT run tests itself: it decides, from the PR
diff and the workflow files, which checks must exist for the PR head SHA, and
waits until each is `completed/success`.

Modes
  validate   static, offline: manifest vs workflows + anti-bypass lints
  gate       online: poll the Checks API for the PR head SHA (needs GITHUB_TOKEN)

Shard groups (PG-SHARD-GATE-1, inert until a manifest declares one)
  A suite may be split into N shard jobs. A `shard_groups` entry declares the shard job, its matrix axis, the
  count, and a `proof` job (scripts/ci-gate/shard_proof.py) that checks the shards together ran every test
  exactly once. The group expands into ordinary blocking checks (one per shard + the proof), so every existing
  rule (anti-bypass, guards, duplicate producers, baseline no-weakening, latest-attempt verdict) applies to it
  unchanged. `status: additive` keeps the superseded check; `status: superseding` retires it into the group while
  the proof job keeps its exact name (so a Branch Protection context by that name stays valid).

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
GROUP_STATUSES = ("additive", "superseding")
MAX_SHARDS = 16
# Floors every shard group must meet regardless of what the manifest says (a group may add rules, never drop these).
SHARD_GUARD_FLOOR = {"step_run_contains": "php artisan test", "require": ("set -o pipefail",),
                     "forbidden": ("--filter", "--group", "--exclude-group", "--testsuite", "--stop-on", "|| true")}
PROOF_GUARD_FLOOR = {"require": ("set -euo pipefail",), "forbidden": ("|| true",)}
# `required_steps` (PG-SHARD-SAFETY-PARITY B): safeguards that live in steps OTHER than the guarded test step. Best-effort shell lint, like the
# other guards (a shell cannot be fully analysed): a matching step may not mask failure or leave early.
REQUIRED_STEP_FLOOR_FORBIDDEN = ("|| true", "|| :", "exit 0", "set +e", "set +o")
REQUIRED_STEP_KEYS = frozenset({"label", "run_contains", "uses", "forbidden", "allowed_if", "if_equals", "env", "with_contains"})
# A `superseding` group retires the full check it replaces, so it must carry every safeguard that check ran. The set lives HERE (trusted
# base code), not in the manifest a PR edits: a PR cannot shrink it.
SUPERSEDE_REQUIRED_LABELS = ("aia-0.4", "watchdog.role", "watchdog.tests", "lock.limit", "watchdog.upload")
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
    if not isinstance(matrix, dict):
        raise GateError(f"job {job_id}: non-mapping matrix is not supported by the gate")
    if "include" in matrix or "exclude" in matrix:
        raise GateError(f"job {job_id}: matrix include/exclude not supported by the gate")
    bad_axes = sorted(k for k, v in matrix.items() if not isinstance(v, list))
    if bad_axes:  # e.g. `variant: ${{ fromJSON(...) }}`: the number of runs is unknowable here, so fail closed
        raise GateError(f"job {job_id}: matrix axes with non-list values are not supported by the gate: {bad_axes}")
    axes = dict(matrix)
    refs = set(re.findall(r"\$\{\{\s*([^}]*?)\s*\}\}", template))
    # GitHub creates one check run per matrix combination. An axis the display name does not mention multiplies the
    # runs sharing one name; count them, so the duplicate-producer scan sees the extra same-named check runs.
    used = {r.split(".")[1] for r in refs if re.fullmatch(r"matrix\.\w+", r)}
    hidden = 1
    for k, v in axes.items():
        if k not in used:
            hidden *= max(len(v), 1)
    if not refs:
        return [template] * hidden
    for ref in refs:
        if not re.fullmatch(r"matrix\.\w+", ref) or ref.split(".")[1] not in axes:
            raise GateError(f"job {job_id}: unsupported expression in name: {template!r}")
    keys = sorted({r.split(".")[1] for r in refs})
    names = []
    for combo in itertools.product(*(axes[k] for k in keys)):
        n = template
        for k, v in zip(keys, combo):
            n = re.sub(r"\$\{\{\s*matrix\." + k + r"\s*\}\}", str(v), n)
        names.extend([n] * hidden)
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

def _guard_gaps(guard: dict, floor: dict, what: str) -> list[str]:
    out = []
    want = floor.get("step_run_contains")
    if want and guard.get("step_run_contains") != want:
        out.append(f"{what}: guard.step_run_contains must be {want!r}")
    for key in ("require", "forbidden"):
        lost = set(floor.get(key, ())) - set(guard.get(key, []))
        if lost:
            out.append(f"{what}: guard.{key} lacks the mandatory {sorted(lost)}")
    return out


def shard_names(grp: dict) -> list[str]:
    return [grp["shard_name"].replace("{i}", str(i)).replace("{n}", str(grp["count"])) for i in range(1, grp["count"] + 1)]


def shard_name_regex(grp: dict) -> re.Pattern:
    """Matches ANY shard index of the group (including ones beyond `count`): used to catch count drift."""
    parts = re.split(r"\{i\}|\{n\}", grp["shard_name"])
    return re.compile(r"\d+".join(re.escape(p) for p in parts))


def _str_list(v, what: str, allow_empty: bool = True) -> list[str]:
    if v is None:
        v = []
    if not isinstance(v, list) or not all(isinstance(x, str) and x for x in v) or (not allow_empty and not v):
        raise GateError(f"{what} must be a {'non-empty ' if not allow_empty else ''}list of non-empty strings")
    return list(v)


def normalize_required_steps(gid, raw) -> list[dict]:
    """Strict schema for `required_steps` (pure). An unknown key is an error: a typo such as `forbiden` would otherwise silently weaken a safeguard."""
    if raw in (None, []):
        return []
    if not isinstance(raw, list):
        raise GateError(f"shard group {gid}: required_steps must be a list")
    out, labels = [], set()
    for item in raw:
        if not isinstance(item, dict):
            raise GateError(f"shard group {gid}: every required step must be an object")
        unknown = sorted(set(item) - REQUIRED_STEP_KEYS)
        if unknown:
            raise GateError(f"shard group {gid}: required step has unknown key(s) {unknown}")
        label = item.get("label")
        if not isinstance(label, str) or not label:
            raise GateError(f"shard group {gid}: every required step needs a `label`")
        if label in labels:
            raise GateError(f"shard group {gid}: duplicate required step label {label!r}")
        labels.add(label)
        run_contains = _str_list(item.get("run_contains"), f"required step {label!r}: run_contains")
        uses = item.get("uses")
        if uses is not None and (not isinstance(uses, str) or not uses):
            raise GateError(f"shard group {gid}: required step {label!r}: uses must be a non-empty string")
        if not run_contains and not uses:
            raise GateError(f"shard group {gid}: required step {label!r} must match something (run_contains and/or uses)")
        env = item.get("env") or {}
        if not isinstance(env, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in env.items()):
            raise GateError(f"shard group {gid}: required step {label!r}: env must map strings to strings")
        wc = item.get("with_contains") or {}
        if not isinstance(wc, dict):
            raise GateError(f"shard group {gid}: required step {label!r}: with_contains must be an object")
        wc = {k: _str_list(v, f"required step {label!r}: with_contains.{k}", allow_empty=False) for k, v in wc.items()}
        ie = item.get("if_equals")
        if ie is not None and (not isinstance(ie, str) or not ie):
            raise GateError(f"shard group {gid}: required step {label!r}: if_equals must be a non-empty string")
        out.append({"label": label, "run_contains": run_contains, "uses": uses, "forbidden": _str_list(item.get("forbidden"), f"required step {label!r}: forbidden"),
                    "allowed_if": _str_list(item.get("allowed_if"), f"required step {label!r}: allowed_if"), "if_equals": ie, "env": env, "with_contains": wc})
    return out


def expand_groups(m: dict) -> dict:
    """Return the manifest with `checks` = declared checks + one synthetic blocking check per shard + the proof.
    Pure (no I/O). Structural problems raise GateError; workflow-dependent ones are reported by validate()."""
    raw = m["checks"]
    groups = m.get("shard_groups") or []
    if not isinstance(groups, list):
        raise GateError("shard_groups must be a list")
    declared = {c["name"]: c for c in raw}
    extra, ids, norm_groups = [], set(), []
    for grp in groups:
        gid = grp.get("id")
        for k in ("id", "status", "supersedes", "workflow", "job", "axis", "count", "shard_name", "guard", "proof"):
            if grp.get(k) in (None, "", [], {}):
                raise GateError(f"shard group {gid!r}: missing {k!r}")
        if gid in ids:
            raise GateError(f"duplicate shard group id {gid!r}")
        ids.add(gid)
        if grp["status"] not in GROUP_STATUSES:
            raise GateError(f"shard group {gid}: bad status {grp['status']!r}")
        n = grp["count"]
        if not isinstance(n, int) or isinstance(n, bool) or not 2 <= n <= MAX_SHARDS:
            raise GateError(f"shard group {gid}: count must be an integer in 2..{MAX_SHARDS}")
        if "{i}" not in grp["shard_name"]:
            raise GateError(f"shard group {gid}: shard_name must contain {{i}} (equal names would let one shard mask another)")
        proof = grp["proof"]
        for k in ("name", "job", "guard"):
            if not proof.get(k):
                raise GateError(f"shard group {gid}: proof missing {k!r}")
        if not proof["guard"].get("step_run_contains"):
            raise GateError(f"shard group {gid}: proof.guard.step_run_contains is required")
        gaps = _guard_gaps(grp["guard"], SHARD_GUARD_FLOOR, f"shard group {gid} (shards)")
        gaps += _guard_gaps(proof["guard"], PROOF_GUARD_FLOOR, f"shard group {gid} (proof)")
        sup = declared.get(grp["supersedes"])
        if grp["status"] == "additive":
            if sup is None or sup["tier"] != "always":
                raise GateError(f"shard group {gid}: additive group must supersede a declared tier=always check ({grp['supersedes']!r})")
            if proof["name"] == grp["supersedes"]:
                raise GateError(f"shard group {gid}: additive group must not reuse the superseded name for its proof")
            sg = sup.get("guard") or {}
            for key in ("require", "forbidden"):
                lost = set(sg.get(key, [])) - set(grp["guard"].get(key, []))
                if lost:
                    gaps.append(f"shard group {gid}: shard guard.{key} is weaker than the superseded check (lost {sorted(lost)})")
        else:
            if proof["name"] != grp["supersedes"]:
                raise GateError(f"shard group {gid}: superseding group must keep the context name {grp['supersedes']!r} on its proof "
                                f"job (renaming a required context needs an owner decision on Branch Protection)")
            if sup is not None:
                raise GateError(f"shard group {gid}: superseding group owns {grp['supersedes']!r}; remove it from `checks`")
        if gaps:
            raise GateError("; ".join(gaps))
        rs = normalize_required_steps(gid, grp.get("required_steps"))
        if grp["status"] == "superseding":
            missing = sorted(set(SUPERSEDE_REQUIRED_LABELS) - {x["label"] for x in rs})
            if missing:
                raise GateError(f"shard group {gid}: a superseding group retires the full check, so it must carry every safeguard it ran; "
                                f"required_steps lacks {missing}")
        mt = grp.get("max_timeout_minutes")
        if mt is not None and (not isinstance(mt, int) or isinstance(mt, bool) or not 1 <= mt <= 360):
            raise GateError(f"shard group {gid}: max_timeout_minutes must be an integer in 1..360")
        norm_groups.append({**grp, "required_steps": rs})
        tag = {"_group": gid, "_status": grp["status"], "_supersedes": grp["supersedes"]}
        covers = (sup or {}).get("covers", ["shard-group"])
        for name in shard_names(grp):
            extra.append({"name": name, "workflow": grp["workflow"], "job": grp["job"], "tier": "always", "covers": covers,
                          "guard": grp["guard"], "_role": "shard", **tag})
        pg = dict(proof["guard"])
        pg["require"] = [*pg.get("require", []), f"--shards {n}"]
        extra.append({"name": proof["name"], "workflow": grp["workflow"], "job": proof["job"], "tier": "always",
                      "covers": covers, "guard": pg, "_role": "proof", **tag})
    out = dict(m)
    out["declared_checks"] = raw
    out["shard_groups"] = norm_groups
    out["checks"] = [*raw, *extra]
    return out


def load_manifest(path: Path = MANIFEST) -> dict:
    m = json.loads(path.read_text(encoding="utf-8"))
    if m.get("version") != 1:
        raise GateError("unsupported manifest version")
    for c in m["checks"]:
        for k in ("name", "workflow", "job", "tier"):
            if not c.get(k):
                raise GateError(f"manifest check missing {k!r}: {c}")
        if c["tier"] not in (*BLOCKING, "advisory"):
            raise GateError(f"bad tier for {c['name']}")
    m = expand_groups(m)
    seen = set()
    for c in m["checks"]:
        if c["name"] in seen:
            raise GateError(f"duplicate check name {c['name']!r}")
        seen.add(c["name"])
    return m


def validate_group(root: Path, grp: dict, docs: dict[str, dict]) -> list[str]:
    """Workflow-dependent rules for a shard group (the shard/proof jobs themselves are validated as ordinary checks)."""
    gid, wf, errors = grp["id"], grp["workflow"], []
    p = root / wf
    if not p.exists():
        return [f"[shard group {gid}] workflow file missing: {wf}"]
    jobs = docs.setdefault(wf, load_yaml(p)).get("jobs") or {}
    job, pjob = jobs.get(grp["job"]), jobs.get(grp["proof"]["job"])
    if job is None or pjob is None:
        return [f"[shard group {gid}] job {grp['job'] if job is None else grp['proof']['job']!r} not found in {wf}"]
    matrix = (job.get("strategy") or {}).get("matrix")
    if not isinstance(matrix, dict) or set(matrix) != {grp["axis"]}:
        errors.append(f"[shard group {gid}] shard job must have exactly one matrix axis {grp['axis']!r}, got {matrix!r}")
    elif matrix[grp["axis"]] != list(range(1, grp["count"] + 1)):
        errors.append(f"[shard group {gid}] matrix.{grp['axis']} must be exactly {list(range(1, grp['count'] + 1))}, got {matrix[grp['axis']]!r}")
    else:
        try:
            got = sorted(job_names(grp["job"], job))
        except GateError as e:
            errors.append(f"[shard group {gid}] {e}")
        else:
            if got != sorted(shard_names(grp)):
                errors.append(f"[shard group {gid}] shard job produces {got}, expected {sorted(shard_names(grp))} (duplicate or drifting names)")
    needs = pjob.get("needs") or []
    needs = [needs] if isinstance(needs, str) else list(needs)
    if grp["job"] not in needs:
        errors.append(f"[shard group {gid}] proof job must `needs` the shard job {grp['job']!r} (it would otherwise run without the shards)")
    if (pjob.get("strategy") or {}).get("matrix"):
        errors.append(f"[shard group {gid}] proof job must not use a matrix")
    errors += check_required_steps(gid, grp, job)
    mt = grp.get("max_timeout_minutes")
    if mt is not None:
        t = job.get("timeout-minutes")
        if not isinstance(t, int) or isinstance(t, bool) or t > mt:
            errors.append(f"[shard group {gid}] shard job timeout-minutes must be an integer <= {mt} (got {t!r}); a missing value means the 360-minute default")
    return errors


def _step_matches(step: dict, rs: dict) -> bool:
    if rs["uses"] and str(step.get("uses", "")).split("@")[0] != rs["uses"]:
        return False
    run = str(step.get("run", ""))
    return all(x in run for x in rs["run_contains"])


def check_required_steps(gid: str, grp: dict, job: dict) -> list[str]:
    """Each required step must exist exactly once in the shard job, unconditionally (bar an allowed `if`), unmasked, with its markers intact."""
    errors, steps = [], job.get("steps") or []
    for rs in grp.get("required_steps") or []:
        tag = f"[shard group {gid}] required step {rs['label']!r}"
        hit = [s for s in steps if _step_matches(s, rs)]
        if not hit:
            errors.append(f"{tag} not found in job {grp['job']!r} (deleted, moved or one of its markers changed)")
            continue
        if len(hit) > 1:
            errors.append(f"{tag} matched {len(hit)} steps (must be exactly one)")
            continue
        st = hit[0]
        cond = str(st["if"]).strip() if "if" in st else None
        if rs["if_equals"] is not None:
            if cond != rs["if_equals"]:
                errors.append(f"{tag} must have `if: {rs['if_equals']}` (got {cond!r})")
        elif cond is not None and cond not in rs["allowed_if"]:
            errors.append(f"{tag} has a step-level `if` ({cond!r}) that is not allowed (a skipped step still reports a green job)")
        if str(st.get("continue-on-error", False)).lower() not in ("false",):
            errors.append(f"{tag} uses continue-on-error")
        run = str(st.get("run", ""))
        for bad in (*REQUIRED_STEP_FLOOR_FORBIDDEN, *rs["forbidden"]):
            if bad in run:
                errors.append(f"{tag} contains forbidden {bad!r}")
        senv = st.get("env") or {}
        for k, v in rs["env"].items():
            if str(senv.get(k)) != v:
                errors.append(f"{tag} must set env {k}={v!r} (got {senv.get(k)!r})")
        swith = st.get("with") or {}
        for k, subs in rs["with_contains"].items():
            val = str(swith.get(k, ""))
            for sub in subs:
                if sub not in val:
                    errors.append(f"{tag} `with.{k}` lacks {sub!r}")
    return errors


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
                    if "if" in s:
                        errors.append(f"[{c['name']}] guarded test step {s.get('name', '?')!r} has a step-level `if` (a skipped step still reports a green job)")
                    run = str(s.get("run", ""))
                    for bad in guard.get("forbidden", []):
                        if bad in run:
                            errors.append(f"[{c['name']}] test step contains forbidden {bad!r}")
                    for need in guard.get("require", []):
                        if need not in run:
                            errors.append(f"[{c['name']}] test step lacks required {need!r}")

    for grp in manifest.get("shard_groups") or []:
        errors += validate_group(root, grp, docs)

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


def _additive_proof_taken_over(bc: dict, hgrp: dict | None, base_blocking: set[str]) -> bool:
    """True only for the one legal way an `additive` group's proof context may leave the manifest: the SAME group (id) becomes `superseding`, its proof
    stays the very same job of the same workflow, and it now carries the name of the full check the group supersedes (a blocking check on `main`).
    The requirement is not lowered: the shards and the proof job stay required, and the retired full check is judged by the checks above/below
    (its guard is compared with the group's shard guard, and `required_steps` may not regress). Any other disappearance stays an error."""
    return (bc.get("_role") == "proof" and bc.get("_status") == "additive" and hgrp is not None and hgrp.get("status") == "superseding"
            and hgrp["proof"].get("job") == bc.get("job") and hgrp.get("workflow") == bc.get("workflow")
            and hgrp["proof"].get("name") == bc.get("_supersedes") and bc.get("_supersedes") in base_blocking)


def compare_baseline(base_root: Path, head_root: Path) -> list[str]:
    """A PR may add checks or tighten, never weaken what `main` already requires.
    Compares the base branch's manifest/workflows with the PR's. Errors = weakening."""
    bp = base_root / ".github" / "ci-gate" / "required-checks.json"
    if not bp.exists():
        return []  # bootstrap: the base has no gate yet
    base, head = load_manifest(bp), load_manifest(head_root / ".github" / "ci-gate" / "required-checks.json")
    errors = []
    hmap = {c["name"]: c for c in head["checks"]}
    head_group_ids = {g["id"] for g in head.get("shard_groups") or []}
    head_groups_by_id = {g["id"]: g for g in head.get("shard_groups") or []}
    base_blocking = {c["name"] for c in base["checks"] if c["tier"] in BLOCKING}
    derived = re.compile(r"--shards \d+")  # implied by the group's `count`; a count change is judged by the shard names
    retiring = {g["supersedes"]: g for g in head.get("shard_groups") or [] if g["status"] == "superseding"}
    rank = {"advisory": 0, "paths": 1, "always": 2}
    for bc in base["checks"]:
        if bc["tier"] not in BLOCKING:
            continue
        hc = hmap.get(bc["name"])
        if hc is None:
            legacy = hmap.get(bc.get("_supersedes", ""))
            if (bc.get("_status") == "additive" and bc.get("_group") not in head_group_ids and legacy is not None and legacy.get("_group") is None and legacy["tier"] in BLOCKING):
                continue  # dropping a whole additive group leaves the superseded full-suite check in force: coverage unchanged
            hgrp = head_groups_by_id.get(bc.get("_group"))
            if _additive_proof_taken_over(bc, hgrp, base_blocking):
                # additive -> superseding: the same proof job now carries the name of the full check it retires. The old proof's guard is
                # compared with the proof guard the group now declares (tighten-only), so the transition cannot loosen it.
                bg, hg = bc.get("guard") or {}, hgrp["proof"].get("guard") or {}
                for key in ("forbidden", "require"):
                    lost = {x for x in set(bg.get(key, [])) - set(hg.get(key, [])) if not derived.fullmatch(x)}
                    if lost:
                        errors.append(f"[{bc['name']}] guard.{key} lost {sorted(lost)}")
                if bg.get("step_run_contains") != hg.get("step_run_contains"):
                    errors.append(f"[{bc['name']}] guard.step_run_contains changed")
                continue
            errors.append(f"[{bc['name']}] blocking check removed from the manifest")
            continue
        if rank[hc["tier"]] < rank[bc["tier"]]:
            errors.append(f"[{bc['name']}] tier weakened {bc['tier']} -> {hc['tier']}")
        hg = hc.get("guard") or {}
        if hc.get("_role") == "proof" and hc.get("_status") == "superseding" and bc.get("_group") is None:
            # A plain check retired into a superseding group: the proof job keeps the name; the tests now run in the
            # shards, so the OLD guard is compared with the group's SHARD guard (the proof job runs no tests).
            hg = retiring[bc["name"]]["guard"]
        elif (hc["workflow"], hc["job"]) != (bc["workflow"], bc["job"]):
            errors.append(f"[{bc['name']}] now points at a different workflow/job")
        bg = bc.get("guard") or {}
        if bg:
            for key in ("forbidden", "require"):
                lost = {x for x in set(bg.get(key, [])) - set(hg.get(key, [])) if not derived.fullmatch(x)}
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
    head_groups = {g["id"]: g for g in head.get("shard_groups") or []}
    for bg in base.get("shard_groups") or []:
        hg = head_groups.get(bg["id"])
        if hg is not None:  # a vanished group is judged by the check-removal rules above (an additive group may go while the full check stays)
            errors += required_steps_regressions(bg, hg)
    return errors


def required_steps_regressions(bg: dict, hg: dict) -> list[str]:
    """Tighten-only: what `main` already requires of a group's steps may be neither removed nor weakened."""
    errors, gid = [], bg["id"]
    hmap = {x["label"]: x for x in hg.get("required_steps") or []}
    for b in bg.get("required_steps") or []:
        tag = f"[shard group {gid}] required step {b['label']!r}"
        h = hmap.get(b["label"])
        if h is None:
            errors.append(f"{tag} removed")
            continue
        if b["uses"] != h["uses"]:
            errors.append(f"{tag} now matches a different action ({b['uses']!r} -> {h['uses']!r})")
        for key in ("run_contains", "forbidden"):
            lost = [x for x in b[key] if x not in h[key]]
            if lost:
                errors.append(f"{tag} {key} lost {lost}")
        widened = [x for x in h["allowed_if"] if x not in b["allowed_if"]]
        if widened:
            errors.append(f"{tag} allowed_if widened by {widened}")
        if b["if_equals"] != h["if_equals"]:
            errors.append(f"{tag} if_equals changed ({b['if_equals']!r} -> {h['if_equals']!r})")
        for k, v in b["env"].items():
            if h["env"].get(k) != v:
                errors.append(f"{tag} env {k} weakened ({v!r} -> {h['env'].get(k)!r})")
        for k, subs in b["with_contains"].items():
            lost = [x for x in subs if x not in h["with_contains"].get(k, [])]
            if lost:
                errors.append(f"{tag} with.{k} lost {lost}")
    bt, ht = bg.get("max_timeout_minutes"), hg.get("max_timeout_minutes")
    if bt is not None and (ht is None or ht > bt):
        errors.append(f"[shard group {gid}] max_timeout_minutes weakened ({bt!r} -> {ht!r})")
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

    # Count drift: a check run that looks like a shard of a group but is not one of its declared shards (e.g. a 3rd
    # shard appearing while the manifest says 2) means the partition changed under the gate: never a pass.
    for grp in manifest.get("shard_groups") or []:
        rx, allowed = shard_name_regex(grp), set(shard_names(grp))
        for n in sorted({r["name"] for r in check_runs}):
            if rx.fullmatch(n) and n not in allowed:
                rows.append((n, "always", f"shard group {grp['id']}", "unexpected shard (count drift)", "bad"))
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

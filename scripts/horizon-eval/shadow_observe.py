"""Horizon SHADOW MODE observer (AWJ-HORIZON-V2-2) - advisory, read-only, never an authorisation.

Takes ONE live (`github-readonly`) evidence case, runs the existing V2-1C evaluator on it and turns the
audit record into an advisory report with one recommendation:

  WAIT                        evidence may still arrive (CI pending, draft, base moved, stale snapshot)
  BLOCK                       something failed or cannot be verified (fail-closed default)
  OWNER_REVIEW                Zone C/P, governance/hard-deny path, parallel-horizon conflict, injection suspicion
  READY_FOR_MANUAL_REVIEW     nothing the evidence can show stands in the way; a HUMAN still decides everything

Zone A and B can reach READY (Zone B's extra attestations are authorization-class "missing" items, listed not required); Zone C/P never can.

What this module is NOT: a merge gate. `merge_authorized` is a constant False in every report; the
authorization blockers (no registered horizon / claim / grant / attestation) are listed, never "fixed" or
hidden. A recommendation of READY_FOR_MANUAL_REVIEW therefore means "worth a person's time", not "may merge".

Fail-closed rules
  * Authorization-class reason codes (AUTHORIZATION_CODES) are the ONLY codes that do not move the
    recommendation - because shadow mode has no grant by design. Every other non-INFO reason keeps the
    evaluator's own severity (BLOCK / STOP / WAIT), so an unknown or new code can never be ignored.
  * Anything but a fresh, complete, internally consistent live snapshot yields BLOCK or WAIT, never READY.
  * A replayed (frozen) snapshot is historical: it can never recommend READY.
  * READY additionally re-checks its own preconditions (SHADOW_READY_PRECONDITION_FAILED -> BLOCK).
  * The whole observation is wrapped: an internal error is a BLOCK report, never an exception.

Pure and offline: no network, process, environment or filesystem access (enforced by test_static_guards.py).
The report is deterministic for a given (case, replay) and contains no PR text, logins or tenant data.
"""
from __future__ import annotations

import json
import re
from datetime import datetime

import horizon_eval as he

SHADOW_VERSION = "horizon-shadow/0.1.0"
REPORT_SCHEMA = "horizon-shadow-report/1"
RECOMMENDATIONS = ("WAIT", "BLOCK", "OWNER_REVIEW", "READY_FOR_MANUAL_REVIEW")
PATH_LIST_CAP = 300

# Reason codes that only say "no authorisation exists yet". In shadow mode there is no grant, no registered
# horizon, no claim and no attestation by construction, so these are reported as authorization blockers and
# do not (and must not) decide the recommendation. Everything NOT listed keeps its evaluator severity.
AUTHORIZATION_CODES = frozenset({
    "HORIZON_NOT_REGISTERED_V2", "CLAIM_MISSING_OR_MISMATCH", "HORIZON_LABEL_MISSING_OR_CONTRADICTORY", "NO_ACTIVE_GRANT",
    "AGENT_NOT_REGISTERED_OWNER", "AUTHOR_NOT_AUTHORISED", "BRANCH_NOT_UNDER_HORIZON_PREFIX",
    "PRE_MERGE_REVIEW_MISSING", "GUARDIAN_MISSING", "REGRESSION_TEST_MISSING", "INDEPENDENT_REVIEW_MISSING", "CODEOWNER_REVIEW_MISSING",
})
# No GRANT_* prefix carve-out: stale/foreign/unverifiable grant-store codes (GRANT_STORE_STALE, GRANT_FROM_UNTRUSTED_ORIGIN, ...) are
# safety signals about the kill switch and must keep their severity. Shadow mode has no grants, so only NO_ACTIVE_GRANT is expected.
# Deliberately NOT carved out: the grant-scope checks (zone/category/path/limit/task/repository/base-branch/agent). They only run when a
# grant exists, which shadow mode never has; if that ever changes they must keep their evaluator severity until reviewed.
# Evidence the observer could not obtain / verify (reported separately; they keep their severity).
MISSING_EVIDENCE_CODES = frozenset({
    "CI_CHECK_MISSING", "CI_CHECK_NEVER_STARTED", "TESTED_BASE_UNKNOWN", "PATCH_UNAVAILABLE", "PATCH_INCOMPLETE",
    "FILE_LIST_INCOMPLETE", "OTHER_PR_FILES_INCOMPLETE", "UNTRUSTED_TEXT_TRUNCATED", "CI_CHECK_NO_COMPLETION_TIME",
    "EVIDENCE_STALE", "OBSERVATION_STALE", "GRANT_STORE_STALE",
})
# Shadow-only reason codes (added by this module, never by the evaluator).
SHADOW_CODES = {
    "SHADOW_REQUIRES_LIVE_EVIDENCE": "BLOCK", "SHADOW_NO_CLOCK": "BLOCK", "SHADOW_REPLAY_HISTORICAL": "WAIT",
    "SHADOW_HARD_DENY_PATH": "STOP", "SHADOW_CI_GATE_NOT_CONFIRMED": "BLOCK",
    "SHADOW_READY_PRECONDITION_FAILED": "BLOCK", "SHADOW_INTERNAL_ERROR": "BLOCK", "SHADOW_REPORT_WITHHELD": "BLOCK",
    "SHADOW_HORIZON_ID_COLLISION": "BLOCK",
}
REQUEST_DEFAULTS = {"horizon_id": "SHADOW", "task_id": "observe", "task_category": "presentational-ui",
                    "agent_id": "shadow-observer", "action": "merge"}


# Reason details are free text built by the evaluator (some carry logins or refs). Only codes whose detail is a check name, a count,
# a repo path or a fixed phrase may show it; every other code (including unknown/new ones) is reported by code alone.
DETAIL_SAFE_CODES = frozenset({
    "CI_CHECK_MISSING", "CI_CHECK_NEVER_STARTED", "CI_CHECK_NOT_SUCCESS", "CI_CHECK_PENDING", "CI_TESTED_AGAINST_OLDER_BASE",
    "TESTED_BASE_UNKNOWN", "CI_COMPLETED_BEFORE_HEAD_PUSH", "CI_CHECK_WRONG_APP", "CI_CHECK_NO_COMPLETION_TIME",
    "EVIDENCE_STALE", "FILE_LIST_INCOMPLETE", "PATCH_UNAVAILABLE", "PATCH_INCOMPLETE", "ZONE_C_OWNER_GATED", "ZONE_P_NEVER_AUTONOMOUS",
    "HARD_DENY_PATH", "CONFLICT_EXCLUSIVE_SURFACE", "CONFLICT_POLICY_STOP", "UNREGISTERED_HORIZON_ACTIVE", "UNREGISTERED_PR_OVERLAP",
    "OBSERVATION_STALE", "INJECTION_SUSPECTED", "HORIZON_LABEL_MISSING_OR_CONTRADICTORY", "PRE_MERGE_REVIEW_MISSING",
    "GUARDIAN_MISSING", "REGRESSION_TEST_MISSING", "INDEPENDENT_REVIEW_MISSING", "CODEOWNER_REVIEW_MISSING",
}) | frozenset(SHADOW_CODES)


def is_authorization_code(code: str) -> bool:
    return code in AUTHORIZATION_CODES


def _collapse(reasons: list[dict]) -> list[dict]:
    """One row per (severity, code): `count` and the first detail. Order: severity desc, code, as the evaluator sorts."""
    rows: dict[tuple[str, str], dict] = {}
    for r in reasons:
        key = (r["severity"], r["code"])
        if key in rows:
            rows[key]["count"] += 1
        else:
            rows[key] = {"severity": r["severity"], "code": r["code"], "detail": r.get("detail", "") if r["code"] in DETAIL_SAFE_CODES else "", "count": 1}
    return sorted(rows.values(), key=lambda r: (-he.SEVERITY_RANK[r["severity"]], r["code"]))


def _ci_summary(record: dict) -> dict:
    checks = [{"name": c["name"], "status": c["status"], "conclusion": c["conclusion"]} for c in record.get("checks", [])]
    gate = next((c for c in checks if c["name"] == "CI Gate"), None)
    codes = {r["code"] for r in record.get("reasons", [])}
    if any(c in codes for c in ("CI_CHECK_NOT_SUCCESS", "CI_CHECK_WRONG_APP", "CI_COMPLETED_BEFORE_HEAD_PUSH")):
        overall = "failing"
    elif any(c in codes for c in ("CI_CHECK_PENDING", "CI_CHECK_MISSING", "CI_TESTED_AGAINST_OLDER_BASE")):
        overall = "pending"
    elif "CI_CHECK_NEVER_STARTED" in codes:
        overall = "missing"
    elif gate and gate["status"] == "completed" and gate["conclusion"] == "success":
        overall = "passing"
    else:
        overall = "unconfirmed"
    return {"ci_gate": gate or {"name": "CI Gate", "status": "absent", "conclusion": None}, "overall": overall, "checks": checks}


def _classify(reasons: list[dict]) -> dict:
    authorization = [r for r in reasons if is_authorization_code(r["code"])]
    deciding = [r for r in reasons if r["severity"] != "INFO" and not is_authorization_code(r["code"])]
    return {
        "authorization": authorization,
        "deciding": deciding,
        "missing": [r for r in deciding if r["code"] in MISSING_EVIDENCE_CODES],
    }


def _recommend(deciding: list[dict], zone: str) -> tuple[str, list[str]]:
    by_sev = {s: sorted({r["code"] for r in deciding if r["severity"] == s}) for s in ("BLOCK", "STOP", "WAIT")}
    if by_sev["BLOCK"]:
        return "BLOCK", by_sev["BLOCK"]
    if by_sev["STOP"]:
        return "OWNER_REVIEW", by_sev["STOP"]
    if zone not in ("A", "B"):
        return "OWNER_REVIEW", [f"ZONE_{zone}"]
    if by_sev["WAIT"]:
        return "WAIT", by_sev["WAIT"]
    return "READY_FOR_MANUAL_REVIEW", []


def _facts_support_ready(case: dict, ci: dict, policy: dict) -> bool:
    """READY re-check straight from the evidence, independent of whatever reasons the evaluator did or did not emit:
    PR open/not draft/not merged, the gate and every required always-tier check present on the head, and EVERY observed check green."""
    ev = case["evidence"]
    pr = ev["pr"]
    if pr.get("draft") is not False or pr.get("merged") is not False or pr.get("state") != "open":
        return False
    if not ci["checks"] or any(c["status"] != "completed" or c["conclusion"] != "success" for c in ci["checks"]):
        return False
    names = {c["name"] for c in ci["checks"]}
    rc, floor = ev["required_checks"], policy["ci_floor"]
    # the TRUSTED floor (policy), not only the observed manifest: a manifest that dropped a check must not shrink what READY demands
    required = {rc["gate_name"], floor["gate_name"], *rc["always_names"], *floor["always"]}
    touched = [f["filename"] for f in pr["files"]] + [f["previous_filename"] for f in pr["files"] if f.get("previous_filename")]
    for pattern, name in floor.get("required_when_touched", {}).items():
        if any(he.any_match([pattern], t) for t in touched):
            required.add(name)
    return required <= names


def _hard_deny_hits(record: dict, policy: dict) -> list[str]:
    paths = [f["path"] for f in record.get("files", [])] + [f["previous_path"] for f in record.get("files", []) if f.get("previous_path")]
    return sorted({p for p in paths if he.any_match_ci(policy["hard_deny_patterns"], p)})


_TIME_RX = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")


def _clean_time(value) -> str:
    """The snapshot time is echoed in the report, so only a strictly formatted UTC timestamp may pass; anything else is replaced."""
    return value if isinstance(value, str) and _TIME_RX.fullmatch(value) else "<invalid>"


def _base_report(case, now: str) -> dict:
    return {
        "schema": REPORT_SCHEMA, "shadow_version": SHADOW_VERSION, "evaluator_version": he.VERSION,
        "snapshot_time": now,
        "authorization": {
            "merge_authorized": False, "grant_verified": False, "advisory_only": True,
            "statement": "Shadow Mode never grants permission to merge, deploy or change settings. A person decides.",
        },
        "safety": {"would_merge": False, "github_writes": 0, "tool_calls": {"merge": 0, "auto_merge": 0, "update_branch": 0, "writes": 0}},
    }


def _error_report(case, reasons: list[dict], now: str = "<invalid>") -> dict:
    rep = _base_report(case, _clean_time(now))
    rep.update({
        "observation": {"mode": "unknown"}, "pr": {}, "zone": None, "zone_basis": {}, "paths": [], "paths_omitted": 0,
        "surfaces": {}, "ci": {"ci_gate": {"name": "CI Gate", "status": "absent", "conclusion": None}, "overall": "unconfirmed", "checks": []},
        "conflicts": [], "missing_evidence": [], "authorization_blockers": [], "owner_review_required": False,
        "reasons": _collapse(reasons), "recommendation": "BLOCK", "recommendation_basis": sorted({r["code"] for r in reasons}),
        "human_checks_remaining": ["observation_failed_nothing_can_be_concluded"],
    })
    return _seal(rep)


def _seal(rep: dict) -> dict:
    body = {k: v for k, v in rep.items() if k != "report_sha256"}
    text = he.canon(body)
    if he._SECRET_RX.search(text):  # defence in depth: the report is built from allow-listed fields only
        body = {k: body[k] for k in ("schema", "shadow_version", "snapshot_time", "authorization", "safety") if k in body}
        body.update({"recommendation": "BLOCK", "recommendation_basis": ["SHADOW_REPORT_WITHHELD"],
                     "reasons": [{"severity": "BLOCK", "code": "SHADOW_REPORT_WITHHELD", "detail": "secret-like content; report withheld", "count": 1}]})
        text = he.canon(body)
    body["report_sha256"] = he.sha256_hex(text)
    return body


def observe(case, *, wall_clock: datetime | None = None, replay: bool = False, policy: dict | None = None) -> dict:
    """Never raises. Returns the advisory report (see module docstring). `case` must be a live github-readonly case."""
    try:
        return _observe(case, wall_clock, replay, policy)
    except Exception as exc:  # fail closed on any bug or hostile input
        return _error_report(case, [{"severity": "BLOCK", "code": "SHADOW_INTERNAL_ERROR", "detail": type(exc).__name__}])


def _observe(case, wall_clock, replay, policy) -> dict:
    now = _clean_time(case.get("now") if isinstance(case, dict) else None)
    if not (isinstance(case, dict) and case.get("mode") == "live"
            and isinstance(case.get("evidence"), dict) and case["evidence"].get("source") == "github-readonly"):
        return _error_report(case, [{"severity": "BLOCK", "code": "SHADOW_REQUIRES_LIVE_EVIDENCE",
                                     "detail": "only mode=live / source=github-readonly evidence is observed"}], now)
    extra: list[dict] = []
    if not replay and wall_clock is None:
        extra.append({"severity": "BLOCK", "code": "SHADOW_NO_CLOCK", "detail": "a live observation needs a wall clock to prove freshness"})
    if replay:
        extra.append({"severity": "WAIT", "code": "SHADOW_REPLAY_HISTORICAL",
                      "detail": "frozen snapshot evaluated at its own recorded time; historical, cannot be ready"})
    try:
        registered_ids = {h.get("horizon_id") for h in case["evidence"].get("registry", {}).get("horizons", []) if isinstance(h, dict)}
    except Exception:  # noqa: BLE001 - malformed evidence is reported by the evaluator
        registered_ids = set()
    if REQUEST_DEFAULTS["horizon_id"] in registered_ids:  # the placeholder id must never resolve to a real horizon's registration
        extra.append({"severity": "BLOCK", "code": "SHADOW_HORIZON_ID_COLLISION", "detail": "registry contains the reserved shadow id"})
    pol = policy if policy is not None else he.load_policy()[0]
    # allow_synthetic is hard-wired False: shadow mode only ever sees real evidence
    # default path: let the evaluator load the policy itself so the record carries its real SHA (an explicit policy is labelled "inline")
    record = he.evaluate(case, allow_synthetic=False, policy=policy, wall_clock=None if replay else wall_clock)

    pr = record.get("pr", {})
    hits = _hard_deny_hits(record, pol)
    if hits:
        extra.append({"severity": "STOP", "code": "SHADOW_HARD_DENY_PATH", "detail": f"{len(hits)} governance/production path(s): " + ",".join(he.safe_path(h, 80) for h in hits[:3])})
    ci = _ci_summary(record)
    all_reasons = list(record.get("reasons", [])) + extra
    cls = _classify(all_reasons)
    zone = record.get("zone")
    rec, basis = _recommend(cls["deciding"], zone if isinstance(zone, str) else "?")

    if rec == "READY_FOR_MANUAL_REVIEW":
        gate = ci["ci_gate"]
        ok = (gate["status"] == "completed" and gate["conclusion"] == "success" and ci["overall"] == "passing"
              and pr.get("state") == "open" and pr.get("base_sha") == record.get("main_sha")
              and record.get("would_merge") is False and record.get("decision") != "ELIGIBLE_SIMULATED"
              and zone in ("A", "B") and not hits and not replay and not record.get("injection_flags")
              and pr.get("head_sha_reviewed") is not None and all(v == 0 for v in record.get("tool_calls", {}).values())
              and _facts_support_ready(case, ci, pol))
        if not ok:
            code = "SHADOW_CI_GATE_NOT_CONFIRMED" if ci["ci_gate"]["conclusion"] != "success" else "SHADOW_READY_PRECONDITION_FAILED"
            all_reasons.append({"severity": "BLOCK", "code": code, "detail": "READY preconditions re-check failed"})
            cls = _classify(all_reasons)
            rec, basis = "BLOCK", [code]

    files = sorted(record.get("files", []), key=lambda f: f["path"])
    paths = [{"path": he.safe_path(f["path"]), "status": f["status"], "zone": f["zone"], "surfaces": sorted(f["surfaces"])} for f in files[:PATH_LIST_CAP]]
    rep = _base_report(case, now)
    age = None
    try:
        age = int((he.parse_ts(case["now"]) - he.parse_ts(case["evidence"]["fetched_at"])).total_seconds())
    except Exception:  # noqa: BLE001 - evaluator already reported INPUT_INVALID if timestamps are unusable
        pass
    rep.update({
        "observation": {"mode": "replay-frozen" if replay else "live", "evidence_age_seconds": age,
                        "snapshot_case_id": he.safe(record.get("case_id"), 80), "evidence_digest": record.get("evidence_digest"),
                        "evaluator_record_id": record.get("record_id"), "policy_sha256": record.get("policy_sha256")},
        "pr": {"number": pr.get("number"), "state": pr.get("state"), "head_sha": pr.get("head_sha_reviewed"),
               "base_sha": pr.get("base_sha"), "main_sha": record.get("main_sha"),
               "base_is_current_main": bool(pr.get("base_sha")) and pr.get("base_sha") == record.get("main_sha")},
        "zone": zone, "zone_basis": record.get("zone_basis", {}),
        "paths": paths, "paths_omitted": max(0, len(files) - PATH_LIST_CAP),
        "surfaces": record.get("surfaces", {}),
        "ci": ci,
        "conflicts": [{"pr": c["pr"], "paths": c["paths"], "surfaces": c["surfaces"], "evidence_kind": c["evidence_kind"],
                       "registered": c["registered"], "recent_activity": c["recent_activity"]} for c in record.get("conflicts", [])],
        "missing_evidence": _collapse(cls["missing"]),
        "authorization_blockers": _collapse(cls["authorization"]),
        "owner_review_required": rec == "OWNER_REVIEW" or any(r["severity"] == "STOP" for r in cls["deciding"]),
        "reasons": _collapse(all_reasons),
        "recommendation": rec, "recommendation_basis": basis,
        "evaluator_decision": record.get("decision"),
        "human_checks_remaining": sorted(set(record.get("human_checks_remaining", [])) | {"a_person_decides_merge_shadow_mode_never_does"}),
    })
    rep["safety"]["tool_calls"] = dict(record.get("tool_calls", rep["safety"]["tool_calls"]))
    return _seal(rep)


# ───────────────────────────── rendering ─────────────────────────────

def report_json(rep: dict) -> str:
    return json.dumps(rep, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _md(value, limit: int = 160, code: bool = False) -> str:
    """Table/inline-safe text: no pipes, backticks, angle brackets or newlines; outside code spans also no link/mention/emphasis syntax."""
    text = re.sub(r"[\r\n\t|`<>]" if code else r"[\r\n\t|`<>\[\]()*_@#~!]", " ", str(value))
    return text if len(text) <= limit else text[:limit] + "…"


def _reason_table(rows: list[dict]) -> list[str]:
    if not rows:
        return ["_none_", ""]
    out = ["| Severity | Code | × | Detail |", "|---|---|---|---|"]
    out += [f"| {r['severity']} | `{_md(r['code'], code=True)}` | {r['count']} | {_md(r['detail'])} |" for r in rows]
    return out + [""]


def render_markdown(rep: dict) -> str:
    pr, ci, auth = rep.get("pr", {}), rep.get("ci", {}), rep.get("authorization", {})
    obs = rep.get("observation", {})
    short = lambda s: (s or "n/a")  # noqa: E731
    lines = [
        f"# Horizon Shadow report — PR #{pr.get('number', 'n/a')}",
        "",
        f"**Recommendation: `{rep['recommendation']}`** — advisory only. `merge_authorized: {str(auth.get('merge_authorized')).lower()}` · "
        f"`grant_verified: {str(auth.get('grant_verified')).lower()}` · GitHub writes: {rep['safety']['github_writes']}",
        "",
        f"> {auth.get('statement', '')}",
        "",
        "| Field | Value |", "|---|---|",
        f"| Observation | {_md(obs.get('mode', 'n/a'))} (evidence age {obs.get('evidence_age_seconds', 'n/a')}s) at {_md(rep.get('snapshot_time'))} |",
        f"| PR state | {_md(pr.get('state', 'n/a'))} |",
        f"| Head SHA | `{short(pr.get('head_sha'))}` |",
        f"| Base SHA | `{short(pr.get('base_sha'))}` |",
        f"| Main SHA (at observation) | `{short(pr.get('main_sha'))}` · base is current main: {pr.get('base_is_current_main')} |",
        f"| Risk zone | **{rep.get('zone')}** (path {rep.get('zone_basis', {}).get('path')}, behavior {rep.get('zone_basis', {}).get('behavior')}, context {rep.get('zone_basis', {}).get('context')}) |",
        f"| CI | {ci.get('overall')} · CI Gate: {ci.get('ci_gate', {}).get('status')}/{ci.get('ci_gate', {}).get('conclusion')} |",
        f"| Owner review required | {rep.get('owner_review_required')} |",
        f"| Evaluator raw decision | {_md(rep.get('evaluator_decision', 'n/a'))} |",
        f"| Evidence digest | `{short(obs.get('evidence_digest'))}` |",
        f"| Report SHA-256 | `{rep.get('report_sha256')}` |",
        "",
        "## Why this recommendation",
        "",
        ", ".join(f"`{_md(c, code=True)}`" for c in rep.get("recommendation_basis", [])) or "_no blocking reason found_",
        "",
        "## Changed paths and semantic surfaces",
        "",
        "Surfaces: " + (", ".join(f"`{_md(s, code=True)}` ({_md(m, code=True)})" for s, m in sorted(rep.get("surfaces", {}).items())) or "_none_"),
        "",
    ]
    if rep.get("paths"):
        lines += ["| Path | Status | Zone | Surfaces |", "|---|---|---|---|"]
        lines += [f"| `{_md(p['path'], 200, code=True)}` | {_md(p['status'])} | {p['zone']} | {_md(','.join(p['surfaces']) or '-')} |" for p in rep["paths"]]
        if rep.get("paths_omitted"):
            lines.append(f"| … {rep['paths_omitted']} more path(s) omitted from this list | | | |")
        lines.append("")
    lines += ["## CI", "", "| Check | Status | Conclusion |", "|---|---|---|"]
    lines += [f"| `{_md(c['name'], code=True)}` | {_md(c['status'], code=True)} | {_md(c['conclusion'] or '-', code=True)} |" for c in ci.get("checks", [])] or ["| _none observed_ | | |"]
    lines += ["", "## Parallel Horizon conflicts", ""]
    if rep.get("conflicts"):
        lines += ["| PR | Evidence | Registered | Recent activity | Shared paths | Shared surfaces |", "|---|---|---|---|---|---|"]
        lines += [f"| #{c['pr']} | {_md(c['evidence_kind'])} | {c['registered']} | {c['recent_activity']} | {_md(', '.join(c['paths']) or '-', 240, code=True)} | {_md(', '.join(c['surfaces']) or '-')} |" for c in rep["conflicts"]]
        lines.append("")
    else:
        lines += ["_none observed_", ""]
    lines += ["## Missing evidence", ""] + _reason_table(rep.get("missing_evidence", []))
    lines += ["## Authorization blockers (expected in Shadow Mode — no grant exists)", ""] + _reason_table(rep.get("authorization_blockers", []))
    lines += ["## All reasons", ""] + _reason_table(rep.get("reasons", []))
    lines += ["## Human checks remaining", ""] + [f"- `{_md(h, code=True)}`" for h in rep.get("human_checks_remaining", [])] + [""]
    return "\n".join(lines).rstrip("\n") + "\n"


def render_summary(reports: list[dict]) -> str:
    rows = ["# Horizon Shadow summary", "", "Advisory only — no row below authorises anything.", "",
            "| PR | Recommendation | Zone | CI | Head SHA | Mode | Basis |", "|---|---|---|---|---|---|---|"]
    for r in sorted(reports, key=lambda r: (r.get("pr", {}).get("number") or 0)):
        p = r.get("pr", {})
        rows.append(f"| #{p.get('number', 'n/a')} | {r['recommendation']} | {r.get('zone')} | {r.get('ci', {}).get('overall')} | "
                    f"`{(p.get('head_sha') or 'n/a')[:12]}` | {r.get('observation', {}).get('mode')} | {_md(', '.join(r.get('recommendation_basis', [])[:4]), 120, code=True)} |")
    return "\n".join(rows) + "\n"

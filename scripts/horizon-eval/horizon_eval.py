#!/usr/bin/env python3
"""AWJ Horizon authorization evaluator - DRY-RUN ONLY (AWJ-HORIZON-V2-1C).

Implements the evaluation algorithm of AWJ-HORIZON-V2-1B (Authority & Threat Model,
section 4.2) as a pure function over a JSON evidence snapshot.

    evaluate(case) -> audit record (dict)

What this module is NOT
  * It is not an authorization. ELIGIBLE_SIMULATED never permits a merge.
  * It has no way to act: no network, no subprocess, no GitHub client, no credentials,
    no environment access. It reads JSON in and returns JSON out. (test_static_guards.py
    enforces this by scanning the source.)
  * It cannot treat any grant as authentic in live mode: no independent owner-authenticity
    verifier exists (V2-1B 4.6, decision D2). Live mode therefore always ends in BLOCK.
    ELIGIBLE_SIMULATED is reachable only for explicitly synthetic test fixtures.

Fail-closed rules
  * any missing/ill-typed input        -> BLOCK (never a default value)
  * unknown path                       -> Zone C (default-deny)
  * any unexpected exception           -> BLOCK (EVALUATOR_ERROR)
  * ELIGIBLE_SIMULATED requires zero WAIT/BLOCK/STOP reasons and is re-asserted at the end.

Decision severity: STOP_OWNER_DECISION > BLOCK > WAIT > ELIGIBLE_SIMULATED.
Output is deterministic: identical input -> byte-identical canonical JSON.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

VERSION = "horizon-eval/0.1.0"
CASE_SCHEMA = "horizon-eval-case/1"
AUDIT_SCHEMA = "horizon-eval-audit/1"
HERE = Path(__file__).resolve().parent
POLICY_PATH = HERE / "policy" / "zone_policy.v1.json"
SYNTHETIC_ROOT = "scripts/horizon-eval/fixtures/synthetic/"

DECISIONS = ("ELIGIBLE_SIMULATED", "WAIT", "BLOCK", "STOP_OWNER_DECISION")
SEVERITY_RANK = {"INFO": 0, "WAIT": 1, "BLOCK": 2, "STOP": 3}
SEVERITY_DECISION = {"WAIT": "WAIT", "BLOCK": "BLOCK", "STOP": "STOP_OWNER_DECISION"}
ZONES = ("A", "B", "C", "P")
ZONE_RANK = {z: i for i, z in enumerate(ZONES)}
MODE_RANK = {"shared-read": 0, "shared-write": 1, "exclusive": 2}
ATTESTATION_TYPES = ("PRE_MERGE_REVIEW", "GUARDIAN", "REGRESSION_TEST", "INDEPENDENT_REVIEW", "CODEOWNER_REVIEW")
ZONE_B_EXTRAS = ("REGRESSION_TEST", "GUARDIAN", "INDEPENDENT_REVIEW")
AUTHENTICITY_CONDITIONS = (
    "out_of_band_owner_binding",
    "isolated_hardware_key",
    "allowed_signers_pinned_on_main",
    "signature_binds_content",
    "revocation_path_declared",
    "web_flow_signatures_excluded",
)

TRUNCATION_MARKER = "[[TRUNCATED]]"
SHA_RX = r"[0-9a-f]{40}"
HEX64_RX = r"[0-9a-f]{64}"
TS_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


# ───────────────────────────── helpers ─────────────────────────────

def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def parse_ts(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, TS_FORMAT).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def safe(value, limit: int = 80) -> str:
    """Neutralise untrusted metadata before it enters an audit detail string."""
    text = str(value)
    text = "".join(ch if (ch.isalnum() or ch in " ._()/,:;-#@+") and ord(ch) < 0x2FFF else "?" for ch in text)
    return text[:limit]


def safe_path(value, limit: int = 300) -> str:
    """Paths are repository metadata, but they come from untrusted PRs: keep them readable, drop control/markup chars."""
    text = "".join("?" if (ord(ch) < 32 or ch in "<>\"'`&") else ch for ch in str(value))
    return text[:limit]


def norm_identity(value) -> str:
    """Case/format-insensitive account identity: 'Synthetic-Author', 'synthetic-author[bot]' are the same actor."""
    text = unicodedata.normalize("NFKC", str(value)).strip().casefold()
    return text[:-5] if text.endswith("[bot]") else text


def zmax(*zones: str) -> str:
    return max(zones, key=lambda z: ZONE_RANK[z])


@lru_cache(maxsize=512)
def _glob_rx(pattern: str) -> re.Pattern:
    out, i = [], 0
    while i < len(pattern):
        c = pattern[i]
        if pattern.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif c == "*":
            out.append("[^/]*")
            i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    return re.compile("".join(out) + r"\Z")


def glob_match(pattern: str, path: str) -> bool:
    return _glob_rx(pattern).match(path) is not None


def any_match(patterns, path: str) -> bool:
    return any(glob_match(p, path) for p in patterns)


def any_match_ci(patterns, path: str) -> bool:
    """Case-insensitive variant for PROTECTED paths: on case-insensitive checkouts 'Docs/Autonomous-Engineering'
    and 'docs/autonomous-engineering' are the same directory, so a case variant must not escape the protection."""
    folded = path.casefold()
    return any(glob_match(p.casefold(), folded) for p in patterns)


def unsafe_path(path) -> bool:
    return (
        not isinstance(path, str)
        or not path
        or path.startswith("/")
        or "\\" in path
        or "\x00" in path
        or any(ord(ch) < 32 for ch in path)
        or any(seg in ("..", ".") or seg == "" or seg.endswith((".", " ")) for seg in path.split("/"))
    )


# ───────────────────────────── schema (strict, fail-closed) ─────────────────────────────

def v_str(minlen=1, rx=None, maxlen=200000):
    def chk(v, p, e):
        if not isinstance(v, str) or len(v) < minlen or len(v) > maxlen or (rx and not re.fullmatch(rx, v)):
            e.append(p)
    return chk


def v_int(minimum=0):
    def chk(v, p, e):
        if isinstance(v, bool) or not isinstance(v, int) or v < minimum:
            e.append(p)
    return chk


def v_bool():
    def chk(v, p, e):
        if not isinstance(v, bool):
            e.append(p)
    return chk


def v_ts():
    def chk(v, p, e):
        if parse_ts(v) is None:
            e.append(p)
    return chk


def v_enum(*values):
    def chk(v, p, e):
        if not isinstance(v, str) or v not in values:
            e.append(p)
    return chk


def v_null(spec):
    def chk(v, p, e):
        if v is not None:
            spec(v, p, e)
    return chk


def v_list(item, minlen=0, maxlen=5000):
    def chk(v, p, e):
        if not isinstance(v, list) or len(v) < minlen or len(v) > maxlen:
            e.append(p)
            return
        for i, x in enumerate(v):
            item(x, f"{p}[{i}]", e)
    return chk


def v_map(value_spec):
    def chk(v, p, e):
        if not isinstance(v, dict):
            e.append(p)
            return
        for k, x in v.items():
            if not isinstance(k, str):
                e.append(f"{p}.<key>")
            value_spec(x, f"{p}.{safe(k, 40)}", e)
    return chk


def v_any_obj():
    def chk(v, p, e):
        if not isinstance(v, dict):
            e.append(p)
    return chk


def v_obj(req, opt=None, strict=False):
    opt = opt or {}

    def chk(v, p, e):
        if not isinstance(v, dict):
            e.append(p)
            return
        for k, spec in req.items():
            if k not in v:
                e.append(f"{p}.{k}")
            else:
                spec(v[k], f"{p}.{k}", e)
        for k, spec in opt.items():
            if k in v:
                spec(v[k], f"{p}.{k}", e)
        if strict:
            for k in v:
                if k not in req and k not in opt:
                    e.append(f"{p}.{safe(k, 40)}(unknown)")
    return chk


_SURFACE_MODES = v_map(v_enum("shared-read", "shared-write", "exclusive"))
_CLAIM = v_obj({"horizon_id": v_str(), "task_id": v_str(), "surfaces": _SURFACE_MODES, "claim_order": v_int(1)})

CASE_VALIDATOR = v_obj(
    {
        "schema": v_enum(CASE_SCHEMA),
        "case_id": v_str(),
        "mode": v_enum("live", "synthetic-test"),
        "now": v_ts(),
        "request": v_obj({
            "horizon_id": v_str(), "task_id": v_str(), "task_category": v_str(), "agent_id": v_str(),
            "repository": v_str(), "base_branch": v_str(), "action": v_str(), "pr_number": v_int(1),
        }),
        "evidence": v_obj(
            {
                "fetched_at": v_ts(),
                "source": v_enum("github-readonly", "synthetic-fixture"),
                "main": v_obj({"sha": v_str(rx=SHA_RX)}),
                "grant_store": v_obj({
                    "ref": v_str(), "ref_sha": v_str(rx=SHA_RX), "fetched_at": v_ts(),
                    "kill_switch": v_bool(), "revoked_grant_ids": v_list(v_str()),
                    "grants": v_list(v_obj({
                        "origin": v_obj({"ref": v_str(), "commit_sha": v_str(rx=SHA_RX), "path": v_str()}),
                        "document": v_any_obj(),
                        "content_sha256": v_str(rx=HEX64_RX),
                        "authenticity": v_any_obj(),
                    })),
                }),
                "grant_usage": v_list(v_obj({
                    "grant_id": v_str(), "merges_total": v_int(), "merges_today": v_int(), "open_prs": v_int(),
                })),
                "registry": v_obj({"horizons": v_list(v_obj({
                    "horizon_id": v_str(), "protocol_version": v_enum("v1", "v2"), "owner_agent": v_str(),
                    "status_reported": v_str(), "claim_order": v_int(1), "claimed_surfaces": _SURFACE_MODES,
                    "branch_prefixes": v_list(v_str(), minlen=1), "authors": v_list(v_str(), minlen=1),
                }))}),
                "pr": v_obj(
                    {
                        "number": v_int(1), "state": v_enum("open", "closed"), "draft": v_bool(), "merged": v_bool(),
                        "merge_commit_sha": v_null(v_str(rx=SHA_RX)), "author": v_str(),
                        "head_ref": v_str(), "head_repo": v_str(), "base_repo": v_str(),
                        "title": v_str(minlen=0), "body": v_str(minlen=0),
                        "head_sha": v_str(rx=SHA_RX), "head_pushed_at": v_ts(),
                        "base_sha": v_str(rx=SHA_RX), "base_ref": v_str(),
                        "additions": v_int(), "deletions": v_int(), "changed_files": v_int(),
                        "labels": v_list(v_str(minlen=0)),
                        "files": v_list(v_obj(
                            {"filename": v_str(), "status": v_enum("added", "modified", "removed", "renamed", "copied", "changed"),
                             "additions": v_int(), "deletions": v_int()},
                            {"previous_filename": v_null(v_str()), "patch": v_null(v_str(minlen=0))},
                        ), maxlen=3000),
                        "commits": v_list(v_obj({"sha": v_str(rx=SHA_RX), "message": v_str(minlen=0), "author": v_str()}), minlen=1),
                        "comments": v_list(v_obj({"author": v_str(), "body": v_str(minlen=0)})),
                        "reviews": v_list(v_obj({
                            "reviewer": v_str(), "state": v_enum("APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED"),
                            "commit_sha": v_str(rx=SHA_RX), "body": v_str(minlen=0),
                        })),
                        "claim": v_null(_CLAIM),
                    },
                ),
                "checks": v_list(v_obj({
                    "id": v_int(1), "name": v_str(),
                    "status": v_enum("queued", "in_progress", "completed", "waiting", "requested", "pending"),
                    "conclusion": v_null(v_str()), "head_sha": v_str(rx=SHA_RX), "event": v_str(),
                    "completed_at": v_null(v_ts()), "app": v_str(), "tested_base_sha": v_null(v_str(rx=SHA_RX)),
                })),
                "required_checks": v_obj({
                    "source_ref": v_str(), "source_sha": v_str(rx=SHA_RX), "gate_name": v_str(),
                    "always_names": v_list(v_str(), minlen=1), "path_names": v_list(v_str()), "grace_minutes_no_run": v_int(),
                }),
                "attestations": v_list(v_obj({
                    "type": v_enum(*ATTESTATION_TYPES), "sha": v_str(rx=SHA_RX), "by": v_str(), "result": v_enum("PASS", "FAIL"),
                })),
                "other_prs": v_list(v_obj({
                    "number": v_int(1), "state": v_enum("open", "closed"), "horizon_id": v_null(v_str()),
                    "head_ref": v_str(), "head_repo": v_str(), "author": v_str(), "observed_at": v_ts(), "last_activity_at": v_ts(),
                    "files": v_list(v_str()), "files_complete": v_bool(), "claim": v_null(_CLAIM),
                })),
            },
            {"handoff": v_obj({"claims_merged": v_bool()})},
        ),
    },
    strict=False,
)

GRANT_VALIDATOR = v_obj(
    {
        "schema_version": v_int(1),
        "grant_id": v_str(rx=r"GR-(\d{8}-\d{3}|SYNTHETIC-\d{3})"),
        "status": v_enum("draft", "active", "suspended", "revoked"),
        "owner": v_str(),
        "issued_at": v_ts(), "not_before": v_ts(), "expires_at": v_ts(),
        "horizon_id": v_str(),
        "approved_outcome": v_str(),
        "repositories": v_list(v_str(), minlen=1),
        "base_branches": v_list(v_str(), minlen=1),
        "zones_allowed": v_list(v_enum("A", "B"), minlen=1),
        "task_categories": v_list(v_str(), minlen=1),
        "tasks_allowlist": v_list(v_str()),
        "paths_allow": v_list(v_str(), minlen=1),
        "paths_deny": v_list(v_str()),
        "limits": v_obj({
            "max_merges": v_int(1), "max_merges_per_day": v_int(1), "max_files_per_pr": v_int(1),
            "max_changed_lines": v_int(1), "max_open_prs": v_int(1),
        }, strict=True),
        "agents": v_list(v_str(), minlen=1),
        "required_checks": v_list(v_str(), minlen=1),
        "review_requirements": v_list(v_enum("PRE_MERGE_REVIEW", "GUARDIAN", "INDEPENDENT_REVIEW")),
        "conflict_policy": v_enum("serialize", "stop"),
        "revocation": v_obj({"channel": v_str()}, strict=True),
        "production_gated": v_bool(),
        "audit": v_str(),
    },
    {"synthetic": v_bool()},
    strict=True,
)


def validate_case(case) -> list[str]:
    errs: list[str] = []
    CASE_VALIDATOR(case, "$", errs)
    return sorted(set(errs))[:25]


def validate_grant(doc) -> list[str]:
    errs: list[str] = []
    GRANT_VALIDATOR(doc, "$.grant", errs)
    if isinstance(doc, dict):
        if doc.get("production_gated") is not True:
            errs.append("$.grant.production_gated(must_be_true)")
        if isinstance(doc.get("schema_version"), int) and doc.get("schema_version") != 1:
            errs.append("$.grant.schema_version(unsupported)")
    return sorted(set(errs))[:25]


# ───────────────────────────── policy ─────────────────────────────

def load_policy(path: Path = POLICY_PATH) -> tuple[dict, str]:
    raw = path.read_bytes()
    policy = json.loads(raw.decode("utf-8"))
    for key in ("policy_version", "default_zone", "path_rules", "categories", "hard_deny_patterns",
                "surface_modes", "owner_gated_actions", "supported_actions", "windows", "ci_floor", "financial_names"):
        if key not in policy:
            raise ValueError(f"policy missing {key}")
    if policy["default_zone"] != "C":
        raise ValueError("default_zone must be C (default-deny)")
    return policy, hashlib.sha256(raw).hexdigest()


# ───────────────────────────── reasons ─────────────────────────────

class Reasons:
    def __init__(self):
        self.items: list[dict] = []

    def add(self, severity: str, code: str, detail: str = ""):
        self.items.append({"severity": severity, "code": code, "detail": safe(detail, 160)})

    def blocking(self) -> bool:
        return any(r["severity"] != "INFO" for r in self.items)

    def sorted(self) -> list[dict]:
        uniq = {(r["severity"], r["code"], r["detail"]) for r in self.items}
        return [
            {"severity": s, "code": c, "detail": d}
            for s, c, d in sorted(uniq, key=lambda t: (-SEVERITY_RANK[t[0]], t[1], t[2]))
        ]

    def decision(self) -> str:
        worst = max((SEVERITY_RANK[r["severity"]] for r in self.items), default=0)
        if worst == 0:
            return "ELIGIBLE_SIMULATED"
        return SEVERITY_DECISION[{v: k for k, v in SEVERITY_RANK.items()}[worst]]


# ───────────────────────────── classification ─────────────────────────────

_C_TOKENS = re.compile(
    r"tax_amount|\bvat\b|zatca|ledgerservice|journal_(?:entries|lines)|\bdebit\b|\bcredit\b|tenantscope|tenant_id|"
    r"rbac::|ensurepermission|sanctum|password|api[_-]?key|secret|app_key|"
    r"shell_exec|proc_open|popen|passthru|\bexec\s*\(|\bsystem\s*\(|child_process|process\.env|getenv|\benv\s*\(|\beval\s*\(|new\s+function",
    re.IGNORECASE,
)
_B_TOKENS = re.compile(
    r"\bfetch\s*\(|\baxios\b|xmlhttprequest|sendbeacon|websocket|http::|\bcurl|https?://|file_get_contents|file_put_contents|fopen|"
    r"fsockopen|readfile|\bunlink\s*\(|\.(?:delete|post|put|patch)\s*\(|"
    r"method\s*:\s*['\"](?:post|put|patch|delete)|dangerouslysetinnerhtml|localstorage|router\.push|\bnavigate\s*\(",
    re.IGNORECASE,
)
# Money in backend code is Zone C (V2-1B 3.2: touching an amount/tax/total is financial). In UI files it is a display
# concern (Zone B at least; such lines also fail the presentational allowlist).
_MONEY_TOKENS = re.compile(
    r"\bprice\b|\btotal\b|\bsubtotal\b|\bamount\b|\bbalance\b|\binvoice\b|\bdiscount\b|\bpayment\b|\brefund\b|\bcurrency\b|\bvat\b|\btax\b",
    re.IGNORECASE,
)
# Zone A UI code is a POSITIVE allowlist, not an absence-of-bad-tokens check: every added AND removed line must be
# plain markup/text/attribute material (no calls, brackets, template strings, arrows, comments, URLs, imports...).
_PRESENTATIONAL_LINE = re.compile(r"[\w\s<>/\"'.,:!?\-\u2013\u2014=_#%&|@*\u00b7\u2022\u2026]*")   # no braces: JSX expressions are runtime code
_NOT_PRESENTATIONAL_WORDS = re.compile(
    r"\b(?:import|export|require|eval|function|fetch|new|window|document|process|script|iframe|href|src|action|http|https|"
    r"javascript|dangerouslysetinnerhtml|onclick|onerror|onload|style|xmlhttprequest|beacon|websocket|localstorage|cookie|"
    r"token|password|auth|return|if|else|throw|await|async)\b|//|/\*|=>|\$",
    re.IGNORECASE,
)


def _added_lines(patch: str):
    """GitHub `patch` fields carry no file header, so every '+' line is content (a '+++x' line is the content '++x')."""
    for line in patch.splitlines():
        if line.startswith("+"):
            yield line[1:]


def _removed_lines(patch: str):
    for line in patch.splitlines():
        if line.startswith("-"):
            yield line[1:]


_SAFE_ELEMENTS = ("div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "label", "li", "ul", "ol", "strong", "em", "b", "i", "small",
                  "section", "header", "footer", "main", "nav", "article", "table", "thead", "tbody", "tr", "td", "th", "caption", "br", "hr")
_SAFE_ATTR = r'(?:className|class|aria-label|aria-labelledby|aria-describedby|alt|title|placeholder|lang|dir)\s*=\s*"[^"{}<>`$\\]*"'
_OPEN_TAG = re.compile(r"<(?:" + "|".join(_SAFE_ELEMENTS) + r")(?:\s+" + _SAFE_ATTR + r")*\s*/?>")
_OPEN_TAG_START = re.compile(r"<(?:" + "|".join(_SAFE_ELEMENTS) + r")(?:\s+" + _SAFE_ATTR + r")*\s*(?=$)")
_CLOSE_TAG = re.compile(r"</(?:" + "|".join(_SAFE_ELEMENTS) + r")\s*>")
_BARE_BEHAVIOR_WORDS = frozenset({"disabled", "hidden", "readonly", "required", "checked", "autofocus", "multiple", "selected", "open",
                                  "download", "submit", "reset", "draggable", "contenteditable", "inert", "async", "defer"})
_BARE_ATTR = re.compile(r"^\s*" + _SAFE_ATTR + r"\s*$")
_TAG_END = re.compile(r"^\s*/?>\s*$")


def _presentational_line(line: str) -> bool:
    """Only safe elements (no a/button/input/form/custom components) with whitelisted literal attributes, plus plain text."""
    if len(line) > 300:
        return False
    if _BARE_ATTR.match(line) or _TAG_END.match(line):
        return True
    if line.strip().lower() in _BARE_BEHAVIOR_WORDS:  # a lone boolean attribute on its own JSX line looks like text
        return False
    rest = _OPEN_TAG.sub(" ", line)
    rest = _CLOSE_TAG.sub(" ", rest)
    rest = _OPEN_TAG_START.sub(" ", rest)
    # what is left must be plain text: no markup, no assignments, no expressions, no code words
    return bool(_PRESENTATIONAL_LINE.fullmatch(rest)) and not re.search(r"[<>=]", rest) and not _NOT_PRESENTATIONAL_WORDS.search(rest)


def patch_counts(patch: str) -> tuple[int, int]:
    """(added, removed) lines a GitHub `patch` actually represents. Hunk lines always start with '+', '-', ' ', '\\' or '@@'."""
    lines = patch.splitlines()
    return sum(1 for l in lines if l.startswith("+")), sum(1 for l in lines if l.startswith("-"))


def presentational_only(patch: str) -> bool:
    for line in list(_added_lines(patch)) + list(_removed_lines(patch)):
        if line.strip() and not _presentational_line(line):
            return False
    return True


def path_words(path: str) -> set[str]:
    """camelCase / snake / kebab words of a path, lower-cased, plural 's' removed ('Syntax' -> 'syntax', never 'tax')."""
    words = set()
    for chunk in re.split(r"[^A-Za-z0-9]+", path):
        for w in re.findall(r"[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+", chunk):
            w = w.lower()
            words.add(w)
            if w.endswith("s") and len(w) > 3:
                words.add(w[:-1])
    return words


def is_financial_path(path: str, policy: dict) -> bool:
    spec = policy["financial_names"]
    return any(any_match([root], path) for root in spec["roots"]) and bool(path_words(path) & set(spec["terms"]))


def classify_files(files: list[dict], policy: dict, reasons: Reasons):
    """Return (per_file records, path_zone, behavior_zone, surfaces:set)."""
    rules = policy["path_rules"]
    records, path_zone, behavior_zone, surfaces = [], "A", "A", set()
    for f in files:
        names = [f["filename"]] + ([f["previous_filename"]] if f.get("previous_filename") else [])
        fzone, matched, fsurfaces = "A", [], set()
        for name in names:
            if unsafe_path(name):
                reasons.add("BLOCK", "PATH_UNSAFE", safe_path(name))
                fzone = zmax(fzone, "C")
                continue
            hit = False
            for rule in rules:
                protected = ZONE_RANK[rule["zone"]] >= ZONE_RANK["C"]
                if any_match(rule["patterns"], name) or (protected and any_match_ci(rule["patterns"], name)):
                    hit = True
                    zone = rule["zone"]
                    if rule.get("added_only_zone") and f["status"] == "added" and not f.get("previous_filename"):
                        zone = rule["added_only_zone"]
                    fzone = zmax(fzone, zone)
                    matched.append(rule["id"])
                    fsurfaces.update(rule.get("surfaces", []))
            if is_financial_path(name, policy):
                hit = True
                fzone = zmax(fzone, "C")
                matched.append("financial-names")
            if not hit:
                fzone = zmax(fzone, policy["default_zone"])
                matched.append("<default-deny>")
        # screening needs the text: an absent patch cannot be screened for injection or behaviour (docs included),
        # except a pure rename/copy that changes no lines
        patch0 = f.get("patch")
        if (not isinstance(patch0, str) or patch0 == "") and not (f["status"] in ("renamed", "copied") and f["additions"] + f["deletions"] == 0):
            reasons.add("BLOCK", "PATCH_UNAVAILABLE", safe_path(f["filename"]))
        elif isinstance(patch0, str) and patch0 != "" and patch_counts(patch0) != (f["additions"], f["deletions"]):
            # a non-empty patch that does not account for every reported change is incomplete: omitted lines could hide anything
            reasons.add("BLOCK", "PATCH_INCOMPLETE", safe_path(f["filename"]))
        # behaviour: only raises, never lowers
        bzone = "A"
        behavior_rule = any(r["id"] in matched and r.get("behavior") for r in rules)
        docs_only = set(matched) <= {"docs"}
        if not docs_only and not unsafe_path(f["filename"]):
            patch = f.get("patch")
            if f["status"] in ("removed", "renamed", "copied"):
                bzone = zmax(bzone, "B")
            if not isinstance(patch, str) or patch == "":
                # an uninspectable code change can hide anything (financial, security): never assume a zone bound
                bzone = zmax(bzone, "B")
            else:
                text = "\n".join(list(_added_lines(patch)) + list(_removed_lines(patch)))
                if _C_TOKENS.search(text):
                    bzone = zmax(bzone, "C")
                    reasons.add("INFO", "BEHAVIOR_FINANCIAL_OR_SECURITY_TOKEN", safe_path(f["filename"]))
                elif _MONEY_TOKENS.search(text) and not behavior_rule:
                    bzone = zmax(bzone, "C")
                    reasons.add("INFO", "BEHAVIOR_MONETARY_TOKEN_IN_BACKEND", safe_path(f["filename"]))
                elif _B_TOKENS.search(text) or _MONEY_TOKENS.search(text):
                    bzone = zmax(bzone, "B")
                    reasons.add("INFO", "BEHAVIOR_MONEY_OR_ACTION_TOKEN", safe_path(f["filename"]))
                if behavior_rule and not presentational_only(patch):
                    bzone = zmax(bzone, "B")
                    reasons.add("INFO", "BEHAVIOR_NOT_PRESENTATIONAL", safe_path(f["filename"]))
        records.append({
            "path": safe_path(f["filename"]),
            "previous_path": safe_path(f["previous_filename"]) if f.get("previous_filename") else None, "status": f["status"],
            "zone": zmax(fzone, bzone), "path_zone": fzone, "behavior_zone": bzone,
            "rules": sorted(set(matched)), "surfaces": sorted(fsurfaces),
        })
        path_zone = zmax(path_zone, fzone)
        behavior_zone = zmax(behavior_zone, bzone)
        surfaces.update(fsurfaces)
    return records, path_zone, behavior_zone, surfaces


def surface_modes_for(surfaces: set[str], declared: dict | None, policy: dict) -> dict[str, str]:
    """Effective modes: a changed surface is at least shared-write; C surfaces always exclusive;
    a declaration can only raise the mode, never lower the observed one."""
    exclusive = set(policy["surface_modes"]["always_exclusive"])
    modes = {s: "shared-write" for s in surfaces}
    for s, m in (declared or {}).items():
        if s not in modes or MODE_RANK[m] > MODE_RANK[modes[s]]:
            modes[s] = m
    for s in list(modes):
        if s in exclusive:
            modes[s] = "exclusive"
    return modes


# ───────────────────────────── prompt-injection screening ─────────────────────────────

_INJECTION_PATTERNS = [
    ("INJ-AUTH-CLAIM", re.compile(r"(owner|maintainer|admin|المالك)\b.{0,50}\b(authori[sz]ed?|approved?|delegated?|granted|permit(?:ted)?|فو[ّ]?ض|وافق)", re.S)),
    ("INJ-OVERRIDE", re.compile(r"\b(ignore|disregard|forget|override|bypass|تجاهل|تخط[ىي]?)\b.{0,50}\b(previous|prior|above|instructions?|rules?|polic(?:y|ies)|zones?|gate|checks?|classification|التصنيف|القواعد|التعليمات|المنطقة|البوابة)", re.S)),
    ("INJ-MERGE-NOW", re.compile(r"\b(merge|ادمج)\b.{0,25}\b(now|immediately|asap|right away|الآن|فورا|فوراً)", re.S)),
    ("INJ-DISABLE", re.compile(r"\b(disable|turn off|remove|skip|عط[ّ]?ل|الغ|ألغ)\b.{0,35}\b(ci|gate|protection|ruleset|checks?|tests?|review|البوابة|الحماية|الفحوص|المراجعة)", re.S)),
    ("INJ-ROLE", re.compile(r"(you are now|act as|system prompt|new instructions|from now on you|أنت الآن|تعليمات جديدة)", re.S)),
]
_INVISIBLE = dict.fromkeys(list(range(0x200B, 0x2010)) + list(range(0x202A, 0x202F)) + [0x2060, 0xFEFF], None)


def _normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_INVISIBLE).casefold()
    return re.sub(r"\s+", " ", text)


def scan_injection(pr: dict, files: list[dict]) -> list[dict]:
    """Untrusted text is DATA. A hit never changes classification; it only forces an owner stop."""
    fields: list[tuple[str, str]] = [("pr.title", pr["title"]), ("pr.body", pr["body"])]
    fields += [(f"pr.labels[{i}]", s) for i, s in enumerate(pr["labels"])]
    fields += [(f"pr.comments[{i}]", c["body"]) for i, c in enumerate(pr["comments"])]
    fields += [(f"pr.reviews[{i}]", r["body"]) for i, r in enumerate(pr["reviews"])]
    fields += [(f"pr.commits[{i}]", c["message"]) for i, c in enumerate(pr["commits"])]
    for i, f in enumerate(files):
        if isinstance(f.get("patch"), str):
            fields.append((f"pr.files[{i}].patch", "\n".join(_added_lines(f["patch"]))))
    hits = []
    for field, text in fields:
        norm = _normalise(text)
        for pid, rx in _INJECTION_PATTERNS:
            if rx.search(norm):
                hits.append({"field": field, "pattern": pid})
    return sorted(hits, key=lambda h: (h["field"], h["pattern"]))


# ───────────────────────────── grants & authenticity ─────────────────────────────

def verify_authenticity(grant_entry: dict, doc: dict, mode: str, reasons: Reasons) -> bool:
    """Owner authenticity (V2-1B 4.6). There is NO independent verifier in this repository.

    live            -> always unverified. A GitHub 'Verified' badge, a commit signature, or any
                       self-declared field inside the evidence is not proof of owner intent.
    synthetic-test  -> accepts only explicitly synthetic fixtures whose evidence asserts all six
                       conditions; used solely to exercise the decision logic.
    """
    auth = grant_entry["authenticity"]
    if mode != "synthetic-test":
        reasons.add("BLOCK", "GRANT_AUTHENTICITY_UNVERIFIED",
                    "no independent owner-authenticity verifier exists (V2-1B 4.6 / D2); GitHub badge is not evidence")
        if auth.get("github_verified_badge") is True:
            reasons.add("INFO", "GITHUB_BADGE_IGNORED", "badge not accepted as owner proof")
        return False

    ok = True
    if doc.get("synthetic") is not True or not str(doc.get("grant_id", "")).startswith("GR-SYNTHETIC-"):
        reasons.add("BLOCK", "SYNTHETIC_MODE_REQUIRES_SYNTHETIC_GRANT")
        ok = False
    if not str(grant_entry["origin"]["path"]).startswith(SYNTHETIC_ROOT):
        reasons.add("BLOCK", "SYNTHETIC_GRANT_OUTSIDE_FIXTURE_DIR", grant_entry["origin"]["path"])
        ok = False
    if auth.get("verified_by") != "synthetic-test-verifier":
        reasons.add("BLOCK", "GRANT_AUTHENTICITY_UNVERIFIED", "verifier is not the synthetic test verifier")
        ok = False
    conditions = auth.get("conditions")
    if not isinstance(conditions, dict):
        reasons.add("BLOCK", "GRANT_AUTHENTICITY_UNVERIFIED", "conditions missing")
        return False
    if auth.get("github_verified_badge") is True and not all(conditions.get(c) is True for c in AUTHENTICITY_CONDITIONS):
        reasons.add("BLOCK", "GRANT_AUTH_GITHUB_BADGE_ONLY", "badge present but owner-binding conditions not met")
    for cond in AUTHENTICITY_CONDITIONS:
        if conditions.get(cond) is not True:
            reasons.add("BLOCK", "GRANT_AUTH_CONDITION_FAILED", cond)
            ok = False
    digest = sha256_hex(canon(doc))
    if grant_entry["content_sha256"] != digest or auth.get("signed_content_sha256") != digest:
        reasons.add("BLOCK", "GRANT_CONTENT_HASH_MISMATCH", "grant content differs from the signed content")
        ok = False
    return ok


def select_grant(case: dict, mode: str, reasons: Reasons):
    ev, req = case["evidence"], case["request"]
    store = ev["grant_store"]
    now = parse_ts(case["now"])
    if store["ref"] != "main" or store["ref_sha"] != ev["main"]["sha"]:
        reasons.add("WAIT", "GRANT_STORE_STALE", "grants must be fetched from the current main sha")
    fetched = parse_ts(store["fetched_at"])
    age = (now - fetched).total_seconds()
    if age > 0 and age > 60:
        reasons.add("WAIT", "GRANT_STORE_STALE", f"grant/kill-switch fetch is {int(age)}s old")
    if age < -60:
        reasons.add("BLOCK", "EVIDENCE_FROM_FUTURE", "grant store")
    if store["kill_switch"]:
        reasons.add("BLOCK", "KILL_SWITCH_ACTIVE")

    on_main, untrusted = [], []
    for g in store["grants"]:
        trusted = g["origin"]["ref"] == "main" and g["origin"]["commit_sha"] == store["ref_sha"]
        (on_main if trusted else untrusted).append(g)
    if untrusted:
        reasons.add("BLOCK", "GRANT_FROM_UNTRUSTED_ORIGIN",
                    ",".join(sorted({safe(g["origin"]["ref"], 30) for g in untrusted})))

    candidates = []
    for g in on_main:
        doc = g["document"]
        if isinstance(doc, dict) and doc.get("horizon_id") == req["horizon_id"]:
            candidates.append(g)
    if not candidates:
        reasons.add("BLOCK", "NO_ACTIVE_GRANT", "no grant on main for this horizon")
        return None
    actives = [g for g in candidates if g["document"].get("status") == "active"]
    if len(actives) > 1:
        reasons.add("BLOCK", "GRANT_AMBIGUOUS", f"{len(actives)} active grants for one horizon")
        return None
    chosen = actives[0] if actives else sorted(candidates, key=lambda g: str(g["document"].get("grant_id")))[-1]
    doc = chosen["document"]
    for sib in candidates:
        sd = sib["document"]
        if sib is not chosen and sd.get("status") in ("revoked", "suspended") and str(sd.get("issued_at")) >= str(doc.get("issued_at")):
            reasons.add("BLOCK", "GRANT_SUPERSEDED_BY_REVOCATION", safe(sd.get("grant_id")))
    errs = validate_grant(doc)
    if errs:
        reasons.add("BLOCK", "GRANT_SCHEMA_INVALID", ";".join(errs[:6]))
        return None
    if doc["grant_id"] in store["revoked_grant_ids"]:
        reasons.add("BLOCK", "GRANT_REVOKED", doc["grant_id"])
    if doc["status"] == "revoked":
        reasons.add("BLOCK", "GRANT_REVOKED", doc["grant_id"])
    elif doc["status"] == "suspended":
        reasons.add("BLOCK", "GRANT_SUSPENDED", doc["grant_id"])
    elif doc["status"] != "active":
        reasons.add("BLOCK", "GRANT_NOT_ACTIVE", doc["status"])
    if doc.get("synthetic") is True and mode != "synthetic-test":
        reasons.add("BLOCK", "SYNTHETIC_GRANT_IN_LIVE_MODE", doc["grant_id"])
    if mode == "synthetic-test" and doc.get("synthetic") is not True:
        reasons.add("BLOCK", "SYNTHETIC_MODE_REQUIRES_SYNTHETIC_GRANT", doc["grant_id"])
    verify_authenticity(chosen, doc, mode, reasons)
    return chosen


def check_grant_window(doc: dict, now: datetime, policy: dict, reasons: Reasons):
    nb, exp, iss = parse_ts(doc["not_before"]), parse_ts(doc["expires_at"]), parse_ts(doc["issued_at"])
    if now < nb:
        reasons.add("BLOCK", "GRANT_NOT_YET_VALID", doc["not_before"])
    if now >= exp:
        reasons.add("BLOCK", "GRANT_EXPIRED", doc["expires_at"])
    if exp <= nb or iss > nb:
        reasons.add("BLOCK", "GRANT_WINDOW_INCOHERENT")
    caps = policy["windows"]["grant_max_hours"]
    cap = caps["B"] if "B" in doc["zones_allowed"] else caps["A"]
    if (exp - nb) > timedelta(hours=cap):
        reasons.add("BLOCK", "GRANT_DURATION_EXCEEDS_CAP", f"cap {cap}h")


def check_grant_scope(doc: dict, case: dict, pr: dict, files: list[dict], file_records: list[dict],
                      zone: str, policy: dict, reasons: Reasons):
    req, ev = case["request"], case["evidence"]
    if req["repository"] not in doc["repositories"]:
        reasons.add("BLOCK", "REPOSITORY_OUT_OF_SCOPE", req["repository"])
    if req["base_branch"] not in doc["base_branches"] or pr["base_ref"] != req["base_branch"]:
        reasons.add("BLOCK", "BASE_BRANCH_OUT_OF_SCOPE", pr["base_ref"])
    if req["agent_id"] not in doc["agents"]:
        reasons.add("BLOCK", "AGENT_NOT_AUTHORISED", req["agent_id"])
    if pr["number"] != req["pr_number"]:
        reasons.add("BLOCK", "PR_NUMBER_MISMATCH")
    if zone in ("A", "B") and zone not in doc["zones_allowed"]:
        reasons.add("BLOCK", "ZONE_NOT_IN_GRANT", f"zone {zone}")
    category = req["task_category"]
    spec = policy["categories"].get(category)
    if category not in doc["task_categories"]:
        reasons.add("BLOCK", "CATEGORY_NOT_IN_GRANT", category)
    if spec is None:
        reasons.add("BLOCK", "CATEGORY_UNKNOWN", category)
    else:
        if zone in ZONES and ZONE_RANK[zone] > ZONE_RANK[spec["max_zone"]] and zone in ("A", "B"):
            reasons.add("BLOCK", "ZONE_EXCEEDS_CATEGORY", f"{category} max {spec['max_zone']}")
        for rec in file_records:
            if not set(rec["rules"]) & set(spec["rules"]):
                reasons.add("BLOCK", "CATEGORY_PATH_MISMATCH", rec["path"])
    if zone == "B" and req["task_id"] not in doc["tasks_allowlist"]:
        reasons.add("BLOCK", "TASK_NOT_ALLOWLISTED", req["task_id"])
    hard = policy["hard_deny_patterns"]
    for f in files:  # RAW names: display sanitising/truncation must never influence allow/deny matching
        for name in [f["filename"]] + ([f["previous_filename"]] if f.get("previous_filename") else []):
            if unsafe_path(name):
                continue
            if any_match_ci(hard, name):
                reasons.add("STOP", "HARD_DENY_PATH", safe_path(name))
            if any_match_ci(doc["paths_deny"], name):
                reasons.add("BLOCK", "PATH_DENIED_BY_GRANT", safe_path(name))
            if not any_match(doc["paths_allow"], name):
                reasons.add("BLOCK", "PATH_NOT_ALLOWED_BY_GRANT", safe_path(name))
    lim = doc["limits"]
    if len(files) > lim["max_files_per_pr"]:
        reasons.add("BLOCK", "LIMIT_FILES_EXCEEDED", f"{len(files)}>{lim['max_files_per_pr']}")
    changed = max(pr["additions"] + pr["deletions"], sum(f["additions"] + f["deletions"] for f in files))   # never trust the lower figure
    if changed > lim["max_changed_lines"]:
        reasons.add("BLOCK", "LIMIT_LINES_EXCEEDED", f"{changed}>{lim['max_changed_lines']}")
    usage = [u for u in ev["grant_usage"] if u["grant_id"] == doc["grant_id"]]
    if len(usage) != 1:
        reasons.add("BLOCK", "GRANT_USAGE_UNKNOWN", doc["grant_id"])
    else:
        u = usage[0]
        if u["merges_total"] >= lim["max_merges"] or u["merges_today"] >= lim["max_merges_per_day"]:
            reasons.add("BLOCK", "GRANT_EXHAUSTED", "merge allowance used")
        if u["open_prs"] > lim["max_open_prs"]:
            reasons.add("BLOCK", "GRANT_EXHAUSTED", "open PR allowance exceeded")


# ───────────────────────────── parallel horizons (read-only) ─────────────────────────────

def check_conflicts(case: dict, own_surfaces: dict[str, str], own_files: set[str], doc: dict | None,
                    policy: dict, reasons: Reasons) -> tuple[list[dict], str]:
    ev, req, pr = case["evidence"], case["request"], case["evidence"]["pr"]
    now = parse_ts(case["now"])
    registry = {h["horizon_id"]: h for h in ev["registry"]["horizons"]}
    windows = policy["windows"]
    policy_mode = (doc or {}).get("conflict_policy", "stop")
    own_claim_order = (registry.get(req["horizon_id"]) or {}).get("claim_order", 10**9)
    conflicts, context_zone = [], "A"
    for other in sorted(ev["other_prs"], key=lambda o: o["number"]):
        if other["number"] == pr["number"] or other["state"] != "open":
            continue
        obs = parse_ts(other["observed_at"])
        if (now - obs).total_seconds() > windows["observation_ttl_seconds"]:
            reasons.add("WAIT", "OBSERVATION_STALE", f"PR#{other['number']} must be re-observed")
        last = parse_ts(other["last_activity_at"])
        if (obs - now).total_seconds() > 60 or (last - now).total_seconds() > 60:
            reasons.add("BLOCK", "EVIDENCE_FROM_FUTURE", f"PR#{other['number']}")
        if not other["files_complete"]:
            reasons.add("BLOCK", "OTHER_PR_FILES_INCOMPLETE", f"PR#{other['number']}")
        recent = (now - last) <= timedelta(minutes=windows["unregistered_recent_activity_minutes"])
        horizon = other["horizon_id"]
        claim = other["claim"]
        reg_entry = registry.get(horizon) if horizon else None
        # registration is NOT self-asserted: the claim must match a registry entry AND the branch must carry its prefix
        registered = bool(reg_entry and claim and claim["horizon_id"] == horizon
                          and any(other["head_ref"].startswith(px) for px in reg_entry["branch_prefixes"])
                          and other["head_repo"] == req["repository"]
                          and norm_identity(other["author"]) in {norm_identity(a) for a in reg_entry["authors"]})
        other_files = {f for f in other["files"] if isinstance(f, str)}
        # observed surfaces from the other PR's real file list
        o_recs, _, _, o_surf = classify_files(
            [{"filename": f, "status": "modified", "additions": 0, "deletions": 0} for f in sorted(other_files)],
            policy, Reasons())
        theirs = surface_modes_for(o_surf, (claim or {}).get("surfaces"), policy)
        reported_only = set((claim or {}).get("surfaces", {})) - o_surf
        folded_own = {x.casefold(): x for x in own_files}
        shared_paths = sorted(folded_own[x.casefold()] for x in other_files if x.casefold() in folded_own)
        shared_surfaces = sorted(set(own_surfaces) & set(theirs))
        if not shared_paths and not shared_surfaces:
            continue
        kind = "observed" if not (set(shared_surfaces) & reported_only) else "observed+reported"
        if shared_surfaces and all(s in reported_only for s in shared_surfaces) and not shared_paths:
            kind = "reported"
        entry = {"pr": other["number"], "paths": [safe_path(x) for x in shared_paths[:10]], "surfaces": shared_surfaces,
                 "evidence_kind": kind, "registered": registered, "recent_activity": recent}
        conflicts.append(entry)
        context_zone = zmax(context_zone, "B")
        if not registered:
            code = "UNREGISTERED_HORIZON_ACTIVE" if recent else "UNREGISTERED_PR_OVERLAP"
            reasons.add("STOP", code, f"PR#{other['number']} overlaps with no registered claim")
            continue
        if any(own_surfaces.get(s) == "exclusive" or theirs.get(s) == "exclusive" for s in shared_surfaces):
            context_zone = zmax(context_zone, "C")
            reasons.add("STOP", "CONFLICT_EXCLUSIVE_SURFACE",
                        f"PR#{other['number']} {','.join(s for s in shared_surfaces if 'exclusive' in (own_surfaces.get(s), theirs.get(s)))}")
            continue
        if all(MODE_RANK[theirs[s]] == 0 for s in shared_surfaces) and not shared_paths:
            continue  # their shared-read is compatible with our write
        if policy_mode == "stop":
            reasons.add("STOP", "CONFLICT_POLICY_STOP", f"PR#{other['number']} {','.join(shared_surfaces) or 'path'}")
        else:
            other_order = (registry.get(horizon) or {}).get("claim_order", 0)
            if other_order <= own_claim_order:  # a tie is not "first": serialise
                reasons.add("WAIT", "CONFLICT_SERIALIZE_AFTER", f"PR#{other['number']} claimed earlier")
            else:
                reasons.add("INFO", "CONFLICT_WE_ARE_FIRST", f"PR#{other['number']}")
        reg = registry.get(horizon) or {}
        if reg.get("status_reported") in ("paused", "idle", "completed") and recent:
            reasons.add("INFO", "REPORTED_STATUS_CONTRADICTED_BY_OBSERVATION", f"PR#{other['number']}")
    return conflicts, context_zone


# ───────────────────────────── CI / head / base / reviews ─────────────────────────────

def check_pr_state(case: dict, reasons: Reasons) -> dict:
    ev = case["evidence"]
    pr = ev["pr"]
    recovery: dict = {}
    if pr["merged"]:
        reasons.add("BLOCK", "PR_ALREADY_MERGED", "do not issue a second merge; verify post-merge state instead")
        recovery = {"resume_phase": "POST_MERGE_VERIFY", "merge_commit_sha": pr["merge_commit_sha"]}
        handoff = ev.get("handoff")
        if handoff and handoff.get("claims_merged") is False:
            reasons.add("INFO", "HANDOFF_CONTRADICTS_GITHUB", "GitHub state wins over the handoff narrative")
        return recovery
    if pr["state"] != "open":
        reasons.add("BLOCK", "PR_CLOSED_NOT_MERGED")
    if pr["draft"]:
        reasons.add("WAIT", "PR_DRAFT")
    if pr["head_sha"] == pr["base_sha"]:
        reasons.add("BLOCK", "PR_HEAD_EQUALS_BASE")
    return recovery


def _latest(runs: list[dict]) -> dict:
    return max(runs, key=lambda r: r["id"])


def check_ci(case: dict, doc: dict | None, policy: dict, reasons: Reasons) -> list[dict]:
    ev, pr = case["evidence"], case["evidence"]["pr"]
    now = parse_ts(case["now"])
    rc = ev["required_checks"]
    if rc["source_ref"] != "main" or rc["source_sha"] != ev["main"]["sha"]:
        reasons.add("BLOCK", "CHECK_MANIFEST_NOT_FROM_CURRENT_MAIN")
    floor = policy["ci_floor"]
    if rc["gate_name"] != floor["gate_name"]:
        reasons.add("BLOCK", "MANIFEST_BELOW_POLICY_FLOOR", f"gate name {safe(rc['gate_name'], 30)}")
    for name in floor["always"]:
        if name not in rc["always_names"]:
            reasons.add("BLOCK", "MANIFEST_BELOW_POLICY_FLOOR", f"always-tier check dropped: {name}")
    for name in floor["path"]:
        if name not in rc["path_names"]:
            reasons.add("BLOCK", "MANIFEST_BELOW_POLICY_FLOOR", f"path-tier check dropped: {name}")
    required = {floor["gate_name"], rc["gate_name"]} | set(floor["always"]) | set(rc["always_names"]) | set((doc or {}).get("required_checks", []))
    if doc is not None and floor["gate_name"] not in doc["required_checks"]:
        reasons.add("BLOCK", "GRANT_OMITS_CI_GATE")
    touched = [f["filename"] for f in pr["files"]] + [f["previous_filename"] for f in pr["files"] if f.get("previous_filename")]
    for pattern, name in floor.get("required_when_touched", {}).items():
        if any(any_match([pattern], t) for t in touched):
            required.add(name)
    head = pr["head_sha"]
    pushed = parse_ts(pr["head_pushed_at"])
    considered, ignored_stale, ignored_twin = [], 0, 0
    by_name: dict[str, list[dict]] = {}
    for c in ev["checks"]:
        if c["head_sha"] != head:
            ignored_stale += 1
            continue
        if c["event"] != "pull_request":
            ignored_twin += 1
            continue
        if c["completed_at"] and (parse_ts(c["completed_at"]) - now).total_seconds() > 60:
            reasons.add("BLOCK", "EVIDENCE_FROM_FUTURE", f"check {safe(c['name'], 40)}")
        by_name.setdefault(c["name"], []).append(c)
    spoofed = {n for n, runs in by_name.items() if any(r["app"] != "github-actions" for r in runs)}
    for n in sorted(spoofed & (required | set(rc["path_names"]) | set(floor["path"]))):
        reasons.add("BLOCK", "CI_CHECK_WRONG_APP", f"{safe(n, 60)} also reported by a non-Actions app")
    for n in list(by_name):
        by_name[n] = [r for r in by_name[n] if r["app"] == "github-actions"]
        if not by_name[n]:
            del by_name[n]
    grace = timedelta(minutes=rc["grace_minutes_no_run"])
    for name in sorted(required):
        runs = by_name.get(name)
        if not runs:
            if now - pushed <= grace:
                reasons.add("WAIT", "CI_CHECK_MISSING", f"{name} not started yet for head")
            else:
                reasons.add("BLOCK", "CI_CHECK_NEVER_STARTED", f"{name} absent {int((now - pushed).total_seconds() // 60)}m after head push")
            continue
        last = _latest(runs)
        considered.append(last)
        # each run must record the base it was tested against (workflow run's pull_requests[].base.sha) and it must be today's main
        if last["tested_base_sha"] is None:
            reasons.add("BLOCK", "TESTED_BASE_UNKNOWN", safe(name, 60))
        elif last["tested_base_sha"] != ev["main"]["sha"]:
            reasons.add("WAIT", "CI_TESTED_AGAINST_OLDER_BASE", f"{safe(name, 50)}: main moved since this run; re-run needed")
        if last["status"] != "completed":
            reasons.add("WAIT", "CI_CHECK_PENDING", f"{name} {last['status']}")
        elif last["conclusion"] != "success":
            reasons.add("BLOCK", "CI_CHECK_NOT_SUCCESS", f"{name} {safe(last['conclusion'])}")
        else:
            done = parse_ts(last["completed_at"]) if last["completed_at"] else None
            if done is None:
                reasons.add("BLOCK", "CI_CHECK_NO_COMPLETION_TIME", name)
            elif done < pushed:
                reasons.add("BLOCK", "CI_COMPLETED_BEFORE_HEAD_PUSH", name)
        if len(runs) > 1 and any(r["conclusion"] == "failure" for r in runs if r["id"] != last["id"]):
            reasons.add("INFO", "RERUN_AFTER_FAILURE", name)
    for name in sorted((set(rc["path_names"]) | set(floor["path"])) - required):
        runs = by_name.get(name)
        if not runs:
            continue  # path-conditional (tier=paths) checks may legitimately be absent; CI Gate owns that decision
        last = _latest(runs)
        considered.append(last)
        if last["tested_base_sha"] is None:
            reasons.add("BLOCK", "TESTED_BASE_UNKNOWN", safe(name, 60))
        elif last["tested_base_sha"] != ev["main"]["sha"]:
            reasons.add("WAIT", "CI_TESTED_AGAINST_OLDER_BASE", f"{safe(name, 50)}: main moved since this run; re-run needed")
        if last["status"] != "completed":
            reasons.add("WAIT", "CI_CHECK_PENDING", f"{name} {last['status']}")
        elif last["conclusion"] != "success":
            reasons.add("BLOCK", "CI_CHECK_NOT_SUCCESS", f"{name} {safe(last['conclusion'])}")
    if ignored_stale:
        reasons.add("INFO", "CI_RUNS_FOR_OTHER_HEAD_IGNORED", str(ignored_stale))
    if ignored_twin:
        reasons.add("INFO", "CI_NON_PR_EVENT_RUNS_IGNORED", str(ignored_twin))
    return considered


def check_base(case: dict, reasons: Reasons):
    ev = case["evidence"]
    if ev["pr"]["base_sha"] != ev["main"]["sha"]:
        reasons.add("WAIT", "BASE_MOVED_RETEST", "main advanced after the PR was tested; update + re-run required")


def check_reviews(case: dict, doc: dict | None, zone: str, surfaces_rules: set[str], policy: dict,
                  reasons: Reasons) -> list[dict]:
    ev, pr, req = case["evidence"], case["evidence"]["pr"], case["request"]
    head = pr["head_sha"]
    needed = {"PRE_MERGE_REVIEW"}
    if doc is not None:
        needed |= set(doc["review_requirements"])
    if zone == "B":
        needed |= set(ZONE_B_EXTRAS)
    for rule in policy["path_rules"]:
        if rule["id"] in surfaces_rules:
            needed |= set(rule.get("requires_attestation", []))
    used = []
    reg = {h["horizon_id"]: h for h in ev["registry"]["horizons"]}.get(req["horizon_id"], {})
    internal = {norm_identity(x) for x in [pr["author"], reg.get("owner_agent", "")] + list((doc or {}).get("agents", [])) + list(reg.get("authors", []))}
    agents = set((doc or {}).get("agents", []))
    for typ in sorted(needed):
        atts = [a for a in ev["attestations"] if a["type"] == typ]
        if typ == "INDEPENDENT_REVIEW":
            indep = [a for a in atts if norm_identity(a["by"]) not in internal]
            if len(indep) != len(atts) and atts:
                reasons.add("INFO", "INDEPENDENT_REVIEW_NOT_INDEPENDENT", "same identity as author/agent does not count")
            atts = indep
        on_head = [a for a in atts if a["sha"] == head]
        if any(a["result"] == "FAIL" for a in on_head):
            reasons.add("BLOCK", f"{typ}_FAILED", head[:8])
        elif any(a["result"] == "PASS" for a in on_head):
            used.append(next(a for a in on_head if a["result"] == "PASS"))
        elif atts:
            reasons.add("BLOCK", "HEAD_SHA_CHANGED_AFTER_REVIEW", f"{typ} attests a different sha; review invalidated")
        else:
            reasons.add("WAIT", f"{typ}_MISSING", head[:8])
    blocked: dict[str, bool] = {}
    for r in pr["reviews"]:  # GitHub semantics: only APPROVED / DISMISSED clears a change request; COMMENTED does not
        who = norm_identity(r["reviewer"])
        if r["state"] == "CHANGES_REQUESTED":
            blocked[who] = True
        elif r["state"] in ("APPROVED", "DISMISSED"):
            blocked[who] = False
    for reviewer, is_blocked in sorted(blocked.items()):
        if is_blocked:
            reasons.add("BLOCK", "CHANGES_REQUESTED_OUTSTANDING", safe(reviewer, 40))
    return used


# ───────────────────────────── orchestration ─────────────────────────────

def check_own_pr(case: dict, registry: dict, policy: dict, reasons: Reasons):
    """Identity, provenance and sanity of the PR itself. Registration is bound to who/where, never to PR text."""
    req, pr, ev = case["request"], case["evidence"]["pr"], case["evidence"]
    now = parse_ts(case["now"])
    if not (pr["head_repo"] == pr["base_repo"] == req["repository"]):
        reasons.add("BLOCK", "FORK_OR_FOREIGN_REPOSITORY", f"head {safe(pr['head_repo'], 40)} base {safe(pr['base_repo'], 40)}")
    reg = registry.get(req["horizon_id"])
    if reg is not None:
        if norm_identity(reg["owner_agent"]) != norm_identity(req["agent_id"]):
            reasons.add("BLOCK", "AGENT_NOT_REGISTERED_OWNER", safe(req["agent_id"], 40))
        if not any(pr["head_ref"].startswith(px) for px in reg["branch_prefixes"]):
            reasons.add("BLOCK", "BRANCH_NOT_UNDER_HORIZON_PREFIX", safe(pr["head_ref"], 60))
        allowed = {norm_identity(a) for a in reg["authors"]}
        authors = {norm_identity(pr["author"])} | {norm_identity(c["author"]) for c in pr["commits"]}
        if not authors <= allowed:
            reasons.add("BLOCK", "AUTHOR_NOT_AUTHORISED", f"{len(authors - allowed)} unregistered author(s)")
    if pr["head_sha"] not in {c["sha"] for c in pr["commits"]}:
        reasons.add("BLOCK", "HEAD_NOT_IN_COMMITS")
    if not pr["files"]:
        reasons.add("BLOCK", "PR_HAS_NO_FILES")
    if pr["additions"] != sum(f["additions"] for f in pr["files"]) or pr["deletions"] != sum(f["deletions"] for f in pr["files"]):
        reasons.add("BLOCK", "CHANGE_COUNTERS_INCONSISTENT", "PR totals differ from the per-file counts")
    for f in pr["files"]:
        if f["status"] in ("renamed", "copied") and not f.get("previous_filename"):
            reasons.add("BLOCK", "RENAME_WITHOUT_PREVIOUS_FILENAME", safe_path(f["filename"]))
    if (parse_ts(pr["head_pushed_at"]) - now).total_seconds() > 60:
        reasons.add("BLOCK", "EVIDENCE_FROM_FUTURE", "head push time")
    texts = [pr["title"], pr["body"]] + [c["body"] for c in pr["comments"]] + [r["body"] for r in pr["reviews"]] + [c["message"] for c in pr["commits"]]
    if any(TRUNCATION_MARKER in t for t in texts):
        reasons.add("BLOCK", "UNTRUSTED_TEXT_TRUNCATED", "text was cut before screening; cannot be assessed")


def idempotency_key(case) -> str:
    try:
        r = case["request"]
        head = case["evidence"]["pr"]["head_sha"]
        return sha256_hex(canon([r["horizon_id"], r["task_id"], head, r["action"]]))[:32]
    except (KeyError, TypeError):
        return sha256_hex("invalid-case")[:32]


def eval_context(case, allow_synthetic: bool, wall_clock, policy_sha: str | None = None) -> dict:
    """Everything besides the case that can change a decision. It is part of the record identity, so a stored
    ELIGIBLE record can never be replayed under different flags, clock binding or policy."""
    now = parse_ts(case.get("now")) if isinstance(case, dict) else None
    return {
        "allow_synthetic": bool(allow_synthetic),
        "clock_bound": wall_clock is not None,
        "clock_ok": (wall_clock is None) or (now is not None and abs((now - wall_clock).total_seconds()) <= 300),
        "policy_sha256": policy_sha if policy_sha is not None else load_policy()[1],
    }


def evidence_digest(case, ctx: dict | None = None) -> str:
    """Strict: raises on anything not hashable instead of collapsing to a constant."""
    body = {k: case[k] for k in ("mode", "now", "request", "evidence") if k in case}
    return sha256_hex(canon({"v": VERSION, "case": body, "ctx": ctx or {}}))


_SECRET_RX = re.compile(
    r"ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|[Bb]earer\s+[A-Za-z0-9._~+/=-]{20,}"
)


def _digest_or_unique(case, ctx) -> str:
    try:
        return evidence_digest(case, ctx)
    except Exception:  # unhashable evidence: never collapse to a shared constant (that would let records collide)
        return "unhashable-" + sha256_hex(repr(id(case)))[:24]


def _empty_record(case, mode_label: str, now: str) -> dict:
    return {
        "record_type": AUDIT_SCHEMA, "evaluator_version": VERSION,
        "case_id": case.get("case_id") if isinstance(case, dict) and isinstance(case.get("case_id"), str) else "<invalid>",
        "mode": mode_label, "evaluated_at": now,
    }


def evaluate(case, *, allow_synthetic: bool = False, policy: dict | None = None, wall_clock: datetime | None = None) -> dict:
    """Pure, never raises. Returns the audit record. `would_merge` is always False.

    `now` normally comes from the case so runs are reproducible. A caller that evaluates for real passes
    `wall_clock` (the CLI does): a case whose `now` differs from it by more than 5 minutes is refused, so
    evidence cannot be back-dated to make an expired grant look valid."""
    try:
        return _evaluate(case, allow_synthetic, policy, wall_clock)
    except Exception as exc:  # fail closed on any bug or hostile input
        reasons = Reasons()
        reasons.add("BLOCK", "EVALUATOR_ERROR", type(exc).__name__)
        return _finalise(case if isinstance(case, dict) else {}, reasons, {}, "unknown", None,
                         _safe_ctx(case, allow_synthetic, wall_clock))


def _safe_ctx(case, allow_synthetic, wall_clock):
    try:
        return eval_context(case, allow_synthetic, wall_clock)
    except Exception:
        return {"unavailable": True}


def _evaluate(case, allow_synthetic: bool, policy: dict | None, wall_clock: datetime | None = None) -> dict:
    reasons = Reasons()
    pol, pol_sha = (policy, "inline") if policy is not None else load_policy()
    ctx = _safe_ctx(case, allow_synthetic, wall_clock)
    ctx["policy_sha256"] = pol_sha
    errs = validate_case(case)
    if errs:
        for e in errs:
            reasons.add("BLOCK", "INPUT_INVALID", e)
        return _finalise(case if isinstance(case, dict) else {}, reasons, {"policy_sha256": pol_sha, "policy_version": pol["policy_version"]},
                         case.get("mode", "unknown") if isinstance(case, dict) and isinstance(case.get("mode"), str) else "unknown", None, ctx)

    mode, now = case["mode"], parse_ts(case["now"])
    ev, req, pr = case["evidence"], case["request"], case["evidence"]["pr"]
    facts: dict = {"policy_sha256": pol_sha, "policy_version": pol["policy_version"]}

    if wall_clock is not None and abs((now - wall_clock).total_seconds()) > 300:
        reasons.add("BLOCK", "CLOCK_SKEW", "case 'now' differs from the wall clock by more than 5 minutes")

    # mode / provenance
    if mode == "synthetic-test":
        if not allow_synthetic:
            reasons.add("BLOCK", "SYNTHETIC_MODE_NOT_ENABLED", "synthetic fixtures require explicit opt-in")
        if ev["source"] != "synthetic-fixture":
            reasons.add("BLOCK", "SYNTHETIC_MODE_REQUIRES_FIXTURE_SOURCE")
    elif ev["source"] != "github-readonly":
        reasons.add("BLOCK", "LIVE_MODE_REQUIRES_GITHUB_SNAPSHOT", safe(ev["source"], 30))

    # evidence freshness
    age = (now - parse_ts(ev["fetched_at"])).total_seconds()
    if age > pol["windows"]["evidence_max_age_seconds"]:
        reasons.add("WAIT", "EVIDENCE_STALE", f"snapshot is {int(age)}s old")
    if age < -60:
        reasons.add("BLOCK", "EVIDENCE_FROM_FUTURE")

    # action gate (owner-gated / production operations never autonomous)
    action = req["action"]
    if action in pol["owner_gated_actions"]:
        reasons.add("STOP", "ACTION_OWNER_GATED", action)
    elif action not in pol["supported_actions"]:
        reasons.add("BLOCK", "ACTION_UNKNOWN", safe(action, 40))

    # PR completeness
    if pr["changed_files"] != len(pr["files"]) or pr["changed_files"] >= 3000:
        reasons.add("BLOCK", "FILE_LIST_INCOMPLETE", f"{len(pr['files'])}/{pr['changed_files']}")

    # untrusted text screening
    inj = scan_injection(pr, pr["files"])
    if inj:
        reasons.add("STOP", "INJECTION_SUSPECTED", ",".join(sorted({h["pattern"] for h in inj})))
    facts["injection_flags"] = inj

    # claim / registry
    reg = {h["horizon_id"]: h for h in ev["registry"]["horizons"]}
    if req["horizon_id"] not in reg or reg[req["horizon_id"]]["protocol_version"] != "v2":
        reasons.add("BLOCK", "HORIZON_NOT_REGISTERED_V2", safe(req["horizon_id"], 60))
    claim = pr["claim"]
    if not claim or claim["horizon_id"] != req["horizon_id"] or claim["task_id"] != req["task_id"]:
        reasons.add("BLOCK", "CLAIM_MISSING_OR_MISMATCH")
    # V2-1B 6.3: a claim is branch + `horizon:<id>` label + Horizon-Claim block - all three, all consistent
    horizon_labels = {l for l in pr["labels"] if l.casefold().startswith("horizon:")}
    if horizon_labels != {f"horizon:{req['horizon_id']}"}:
        reasons.add("BLOCK", "HORIZON_LABEL_MISSING_OR_CONTRADICTORY", f"{len(horizon_labels)} horizon label(s)")

    check_own_pr(case, reg, pol, reasons)

    # classification
    file_records, path_zone, behavior_zone, surfaces = classify_files(pr["files"], pol, reasons)
    own_modes = surface_modes_for(surfaces, (claim or {}).get("surfaces"), pol)
    own_paths = {f["filename"] for f in pr["files"]} | {f["previous_filename"] for f in pr["files"] if f.get("previous_filename")}
    if any(f["filename"].startswith(".github/workflows/") and isinstance(f.get("patch"), str) and
           re.search(r"echo\s+['\"]?skip|exit\s+0\b|\|\|\s*true|continue-on-error:\s*true|if:\s*false", "\n".join(_added_lines(f["patch"])))
           for f in pr["files"]):
        reasons.add("STOP", "CI_STEP_HOLLOWING_SUSPECTED", "workflow patch weakens or skips a step")

    # grant
    chosen = select_grant(case, mode, reasons)
    doc = chosen["document"] if chosen and not validate_grant(chosen["document"]) else None
    if doc is not None:
        check_grant_window(doc, now, pol, reasons)

    # conflicts (read-only) - also feeds context_zone
    conflicts, context_zone = check_conflicts(case, own_modes, own_paths, doc, pol, reasons)
    zone = zmax(path_zone, behavior_zone, context_zone)
    if action in ("deploy", "release", "migrate_run", "production_write"):
        zone = zmax(zone, "P")
    facts.update({"zone": zone, "zone_basis": {"path": path_zone, "behavior": behavior_zone, "context": context_zone},
                  "files": file_records, "surfaces": dict(sorted(own_modes.items())), "conflicts": conflicts})

    if zone == "P":
        reasons.add("STOP", "ZONE_P_NEVER_AUTONOMOUS", ",".join(r["path"] for r in file_records if r["zone"] == "P")[:120] or action)
    elif zone == "C":
        offenders = [r["path"] for r in file_records if r["zone"] == "C"][:5]
        reasons.add("STOP", "ZONE_C_OWNER_GATED", ",".join(offenders) or "context")

    if doc is not None:
        check_grant_scope(doc, case, pr, pr["files"], file_records, zone, pol, reasons)

    recovery = check_pr_state(case, reasons)
    considered = check_ci(case, doc, pol, reasons)
    check_base(case, reasons)
    matched_rules = {rid for r in file_records for rid in r["rules"]}
    used_atts = check_reviews(case, doc, zone, matched_rules, pol, reasons)

    # audit comment marker (informational; recovery aid)
    key = idempotency_key(case)
    marker = f"<!-- awj-merge-record:{key} -->"
    agents = set((doc or {}).get("agents", []))
    facts["audit_comment"] = {"marker": marker,
                              "already_posted": any(marker in c["body"] and c["author"] in agents for c in pr["comments"])}

    facts.update({
        "grant": ({"grant_id": doc["grant_id"], "status": doc["status"], "synthetic": doc.get("synthetic") is True,
                   "content_sha256": chosen["content_sha256"]} if doc else None),
        "checks": [{"id": c["id"], "name": safe(c["name"]), "status": c["status"], "conclusion": safe(c["conclusion"]) if c["conclusion"] else None,
                    "head_sha": c["head_sha"], "app": safe(c["app"], 40)} for c in sorted(considered, key=lambda c: c["id"])],
        "review_verdicts": [{"type": a["type"], "sha": a["sha"], "by": safe(a["by"], 60), "result": a["result"]} for a in used_atts],
        "recovery": recovery,
        "human_checks_remaining": ["approved_outcome_matches_pr_intent",
                                   "refetch_grants_and_head_immediately_before_any_real_merge"],
    })
    return _finalise(case, reasons, facts, mode, case, ctx)


def _finalise(case: dict, reasons: Reasons, facts: dict, mode: str, full_case, ctx: dict | None = None) -> dict:
    decision = reasons.decision()
    synthetic = mode == "synthetic-test"
    # last line of defence: eligibility must be explicit, synthetic and reason-free
    if decision == "ELIGIBLE_SIMULATED" and (reasons.blocking() or not synthetic or full_case is None):
        reasons.add("BLOCK", "INVARIANT_ELIGIBLE_WITHOUT_BASIS", "eligibility invariant violated")
        decision = "BLOCK"
    now = case.get("now") if isinstance(case, dict) and isinstance(case.get("now"), str) else "<unknown>"
    record = _empty_record(case, mode, now)
    ev = case.get("evidence") if isinstance(case, dict) and isinstance(case.get("evidence"), dict) else {}
    pr = ev.get("pr") if isinstance(ev.get("pr"), dict) else {}
    main = ev.get("main") if isinstance(ev.get("main"), dict) else {}
    safe_sha = lambda v: v if isinstance(v, str) and re.fullmatch(SHA_RX, v) else None  # noqa: E731
    record.update({
        "decision": decision,
        "would_merge": False,
        "authentic_grant_verified": False,
        "synthetic": synthetic,
        "reasons": reasons.sorted(),
        "pr": {"number": pr.get("number") if isinstance(pr.get("number"), int) else None,
               "head_sha_reviewed": safe_sha(pr.get("head_sha")), "base_sha": safe_sha(pr.get("base_sha")),
               "state": pr.get("state") if pr.get("state") in ("open", "closed") else None},
        "main_sha": safe_sha(main.get("sha")),
        "idempotency_key": idempotency_key(case),
        "evidence_digest": _digest_or_unique(case, ctx),
        "merge_sha": None, "post_merge_checks": None,
        "tool_calls": {"merge": 0, "auto_merge": 0, "update_branch": 0, "writes": 0},
    })
    record["record_id"] = sha256_hex(record["idempotency_key"] + record["evidence_digest"])
    ci = next((c for c in facts.get("checks", []) if c["name"] == "CI Gate"), None)
    record["ci_gate_run_id"] = ci["id"] if ci else None
    record.update(facts)
    return _redact(record)


def _redact(record: dict) -> dict:
    text = canon(record)
    if _SECRET_RX.search(text):
        slim = {k: record[k] for k in ("record_type", "evaluator_version", "case_id", "mode", "evaluated_at", "would_merge",
                                       "idempotency_key", "evidence_digest", "record_id", "synthetic") if k in record}
        slim.update({"decision": "BLOCK", "authentic_grant_verified": False,
                     "reasons": [{"severity": "BLOCK", "code": "AUDIT_REDACTION_TRIGGERED",
                                  "detail": "secret-like content in output; record withheld"}],
                     "tool_calls": record["tool_calls"]})
        return slim
    return record


# ───────────────────────────── CLI (evaluate / print only) ─────────────────────────────

def _load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="AWJ Horizon authorization evaluator - DRY RUN ONLY (never merges).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ev = sub.add_parser("evaluate", help="evaluate one case file and print the audit record")
    ev.add_argument("case", type=Path)
    ev.add_argument("--allow-synthetic-fixtures", action="store_true",
                    help="only for files under fixtures/synthetic/; never for live evidence")
    ev.add_argument("--ledger", type=Path, help="directory for idempotent audit records (local files only; keep it outside the repository)")
    ev.add_argument("--replay", action="store_true",
                    help="evaluate a frozen snapshot at its own recorded time instead of the wall clock (decisions are historical)")
    args = ap.parse_args(argv)

    allow = False
    if args.allow_synthetic_fixtures:
        resolved = args.case.resolve()
        if str(resolved).startswith(str((HERE / "fixtures" / "synthetic").resolve()) + "/"):
            allow = True
        else:
            print("refused: --allow-synthetic-fixtures only applies to files under fixtures/synthetic/", file=sys.stderr)
            return 2
    if allow:
        from contract_runner import load_case  # fixtures are overlays; resolve them (never done for live snapshots)
        case, _ = load_case(args.case)
    else:
        case = _load_json(args.case)
    clock = None if args.replay else datetime.now(timezone.utc)
    if args.ledger:
        from ledger import Ledger, evaluate_recorded
        record = evaluate_recorded(case, Ledger(args.ledger), allow_synthetic=allow, wall_clock=clock)
    else:
        record = evaluate(case, allow_synthetic=allow, wall_clock=clock)
    print(json.dumps(record, indent=2, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

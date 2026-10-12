#!/usr/bin/env python3
"""Read-only GitHub snapshot collector for the dry-run evaluator (AWJ-HORIZON-V2-1C).

Turns the current public GitHub state of one PR into a `horizon-eval-case/1` file with
mode=live / source=github-readonly. It can only READ:
  * every request is `gh api <repos/...path>` - GET is gh's default; no -X/--method/-f/-F/--input
    is ever added (test_static_guards.py asserts this on the source);
  * only paths under repos/<owner>/<repo>/ are accepted;
  * the output is a local JSON file; nothing is posted, merged, labelled or commented.

What it cannot know (left empty/derived conservatively, and therefore blocks live eligibility):
  * attestations (PRE_MERGE_REVIEW, Guardian, ...) are agent-recorded, not on GitHub -> []
  * horizon registry does not exist on main yet -> no horizons
  * grants: read from docs/autonomous-engineering/grants/ on main if the directory exists
    (it does not today). They are never authentic in live mode regardless (V2-1B 4.6 / D2).
  * `head_pushed_at` is approximated by the head commit's committer date (<= real push time).
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from horizon_eval import CASE_SCHEMA, TRUNCATION_MARKER, canon, sha256_hex

GRANTS_DIR = "docs/autonomous-engineering/grants"
CLAIM_RX = re.compile(r"Horizon-Claim:\s*([A-Za-z0-9._-]+)\s*/\s*([A-Za-z0-9._-]+)")
PATCH_LIMIT = 20000
TEXT_LIMIT = 4000


class CollectError(Exception):
    pass


def gh_get(path: str, paginate: bool = False):
    """The ONLY network primitive in this module. GET-only by construction."""
    if not re.fullmatch(r"repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/[A-Za-z0-9_./?=&%:-]+|repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", path):
        raise CollectError(f"refused path: {path[:60]}")
    argv = ["gh", "api", path] + (["--paginate", "--slurp"] if paginate else [])
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0:
        raise CollectError(f"{path.split('?')[0]}: {proc.stderr.strip()[:160]}")
    text = proc.stdout.strip()
    data = json.loads(text) if text else None
    return flatten_pages(data) if paginate else data


def flatten_pages(pages):
    """`--slurp` yields a list of pages; a page is either an array (list endpoints) or an object (e.g. check-runs)."""
    if pages is None:
        return None
    if not isinstance(pages, list):
        raise CollectError("unexpected paginated shape")
    if all(isinstance(p, list) for p in pages):
        return [item for page in pages for item in page]
    if all(isinstance(p, dict) for p in pages):
        merged: dict = {}
        for page in pages:
            for key, value in page.items():
                merged[key] = (merged.get(key, []) + value) if isinstance(value, list) else merged.get(key, value)
        return merged
    raise CollectError("mixed paginated shapes")


def ts(value) -> str | None:
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").strftime("%Y-%m-%dT%H:%M:%SZ")


def clip(text, limit=TEXT_LIMIT) -> str:
    """Untrusted text is screened by the evaluator, so a cut must be visible: a marker makes it unassessable (BLOCK)."""
    text = text or ""
    return text if len(text) <= limit else text[:limit] + TRUNCATION_MARKER


def clip_patch(patch, limit):
    """A patch that does not fit is dropped (None => behaviour unassessable => raised to Zone B), never half-scanned."""
    if patch is None or limit <= 0 or len(patch) > limit:
        return None
    return patch


def names_of(f) -> list[str]:
    return [f["filename"]] + ([f["previous_filename"]] if f.get("previous_filename") else [])


def collect(repo: str, pr_number: int, req: dict, patch_limit: int = PATCH_LIMIT) -> dict:
    base = f"repos/{repo}"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    main = gh_get(f"{base}/branches/main")
    main_sha = main["commit"]["sha"]
    pr = gh_get(f"{base}/pulls/{pr_number}")
    head = pr["head"]["sha"]
    files = gh_get(f"{base}/pulls/{pr_number}/files?per_page=100", paginate=True) or []
    commits = gh_get(f"{base}/pulls/{pr_number}/commits?per_page=100", paginate=True) or []
    comments = gh_get(f"{base}/issues/{pr_number}/comments?per_page=100", paginate=True) or []
    reviews = gh_get(f"{base}/pulls/{pr_number}/reviews?per_page=100", paginate=True) or []
    head_commit = gh_get(f"{base}/commits/{head}")
    runs = gh_get(f"{base}/commits/{head}/check-runs?per_page=100", paginate=True)
    check_runs = (runs or {}).get("check_runs", [])
    wf = gh_get(f"{base}/actions/runs?head_sha={head}&per_page=100")
    event_by_suite = {w["check_suite_id"]: w["event"] for w in (wf or {}).get("workflow_runs", [])}
    # the base each run was created against (GitHub records it on the workflow run's pull_requests[] entry)
    base_by_suite = {w["check_suite_id"]: ((w.get("pull_requests") or [{}])[0].get("base") or {}).get("sha")
                     for w in (wf or {}).get("workflow_runs", [])}

    manifest_file = gh_get(f"{base}/contents/.github/ci-gate/required-checks.json?ref={main_sha}")
    manifest = json.loads(base64.b64decode(manifest_file["content"]).decode("utf-8"))

    try:
        listing = gh_get(f"{base}/contents/{GRANTS_DIR}?ref={main_sha}")
    except CollectError as exc:
        if "404" not in str(exc) and "Not Found" not in str(exc):
            raise
        listing = []
    grants = []
    for entry in listing or []:
        if entry.get("type") == "file" and entry["name"].endswith(".json"):
            blob = gh_get(f"{base}/contents/{entry['path']}?ref={main_sha}")
            doc = json.loads(base64.b64decode(blob["content"]).decode("utf-8"))
            grants.append({"origin": {"ref": "main", "commit_sha": main_sha, "path": entry["path"]},
                           "document": doc, "content_sha256": sha256_hex(canon(doc)), "authenticity": {}})

    others = []
    for o in gh_get(f"{base}/pulls?state=open&per_page=100", paginate=True) or []:
        if o["number"] == pr_number:
            continue
        ofiles = gh_get(f"{base}/pulls/{o['number']}/files?per_page=100", paginate=True) or []
        m = CLAIM_RX.search(o.get("body") or "")
        claim = {"horizon_id": m.group(1), "task_id": m.group(2), "surfaces": {}, "claim_order": 1} if m else None
        others.append({"number": o["number"], "state": "open", "horizon_id": m.group(1) if m else None,
                       "head_ref": o["head"]["ref"], "head_repo": (o["head"].get("repo") or {}).get("full_name", "unknown"),
                       "author": o["user"]["login"], "observed_at": now, "last_activity_at": ts(o["updated_at"]),
                       "files": sorted({n for f in ofiles for n in names_of(f)}), "files_complete": len(ofiles) < 3000, "claim": claim})

    m = CLAIM_RX.search(pr.get("body") or "")
    return {
        "schema": CASE_SCHEMA,
        "case_id": f"LIVE-PR{pr_number}-{head[:8]}",
        "mode": "live",
        "now": now,
        "request": {**req, "pr_number": pr_number},
        "evidence": {
            "fetched_at": now,
            "source": "github-readonly",
            "main": {"sha": main_sha},
            "grant_store": {"ref": "main", "ref_sha": main_sha, "fetched_at": now, "kill_switch": False,
                            "revoked_grant_ids": [], "grants": grants},
            "grant_usage": [],
            "registry": {"horizons": []},
            "pr": {
                "number": pr_number, "state": pr["state"], "draft": bool(pr["draft"]), "merged": bool(pr.get("merged")),
                "merge_commit_sha": pr.get("merge_commit_sha") if pr.get("merged") else None,
                "author": pr["user"]["login"], "title": clip(pr["title"], 300), "body": clip(pr.get("body")),
                "head_ref": pr["head"]["ref"], "head_repo": (pr["head"].get("repo") or {}).get("full_name", "unknown"),
                "base_repo": pr["base"]["repo"]["full_name"],
                "head_sha": head, "head_pushed_at": ts(head_commit["commit"]["committer"]["date"]),
                "base_sha": pr["base"]["sha"], "base_ref": pr["base"]["ref"],
                "additions": pr["additions"], "deletions": pr["deletions"], "changed_files": pr["changed_files"],
                "labels": [l["name"] for l in pr["labels"]],
                "files": [{"filename": f["filename"], "status": f["status"], "additions": f["additions"],
                           "deletions": f["deletions"], "previous_filename": f.get("previous_filename"),
                           "patch": clip_patch(f.get("patch"), patch_limit)} for f in files],
                "commits": [{"sha": c["sha"], "message": clip(c["commit"]["message"], 2000),
                             "author": (c.get("author") or {}).get("login") or c["commit"]["author"]["name"]} for c in commits],
                "comments": [{"author": c["user"]["login"], "body": clip(c["body"])} for c in comments],
                "reviews": [{"reviewer": r["user"]["login"], "state": r["state"] if r["state"] in
                             ("APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED") else "COMMENTED",
                             "commit_sha": r["commit_id"], "body": clip(r.get("body"))} for r in reviews],
                "claim": ({"horizon_id": m.group(1), "task_id": m.group(2), "surfaces": {}, "claim_order": 1} if m else None),
            },
            "checks": [{"id": c["id"], "name": c["name"], "status": c["status"], "conclusion": c["conclusion"],
                        "head_sha": c["head_sha"], "event": event_by_suite.get(c["check_suite"]["id"], "unknown"),
                        "completed_at": ts(c.get("completed_at")), "app": (c.get("app") or {}).get("slug", "unknown"),
                        "tested_base_sha": base_by_suite.get(c["check_suite"]["id"])}
                       for c in check_runs],
            "required_checks": {
                "source_ref": "main", "source_sha": main_sha, "gate_name": manifest["gate_check_name"],
                "always_names": sorted({c["name"] for c in manifest["checks"] if c["tier"] == "always"}),
                "path_names": sorted({c["name"] for c in manifest["checks"] if c["tier"] == "paths"}),
                "grace_minutes_no_run": manifest["grace_minutes_no_run"],
            },
            "attestations": [],
            "other_prs": others,
        },
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Read-only snapshot of one PR for the dry-run evaluator.")
    ap.add_argument("--repo", default="safwan5001-source/Nebrax")
    ap.add_argument("--pr", type=int, required=True)
    ap.add_argument("--horizon", required=True)
    ap.add_argument("--task", required=True)
    ap.add_argument("--category", required=True)
    ap.add_argument("--agent", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--patch-limit", type=int, default=PATCH_LIMIT, help="max characters of each file patch kept in the snapshot")
    args = ap.parse_args(argv)
    req = {"horizon_id": args.horizon, "task_id": args.task, "task_category": args.category, "agent_id": args.agent,
           "repository": args.repo, "base_branch": "main", "action": "merge"}
    snapshot = collect(args.repo, args.pr, req, args.patch_limit)
    args.out.write_text(json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {args.out} (read-only snapshot, {len(snapshot['evidence']['pr']['files'])} files, "
          f"{len(snapshot['evidence']['checks'])} check runs, {len(snapshot['evidence']['other_prs'])} other open PRs)")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CollectError as exc:
        print(f"collect failed (nothing evaluated): {exc}", file=sys.stderr)
        sys.exit(1)

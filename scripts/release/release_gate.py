#!/usr/bin/env python3
"""AWJ production release gate (read-only verifier).

Decides whether one exact commit may be promoted to the `production` branch:

  1. the commit is on `main` (reachable from origin/main) and is a fast-forward of `production`;
  2. every `tier: always` check in .github/ci-gate/required-checks.json reported `success` on THIS sha;
  3. no check run on this sha is still running, and none failed (advisory checks excepted);
  4. it lists the migrations the release carries, because deploy runs `php artisan migrate --force` at boot.

Fail-closed: an API error, a missing required check or an unknown state is "not releasable".
Stdlib only. This script never writes to git, Railway or the database.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / ".github" / "ci-gate" / "required-checks.json"
BAD_CONCLUSIONS = {"failure", "cancelled", "timed_out", "action_required", "startup_failure", "stale"}
MIGRATIONS_DIR = "database/migrations/"


def latest_by_name(check_runs: list[dict]) -> dict[str, dict]:
    """A re-run supersedes the earlier attempt of the same check name."""
    latest: dict[str, dict] = {}
    for run in sorted(check_runs, key=lambda r: (r.get("started_at") or "", r.get("id") or 0)):
        latest[run["name"]] = run
    return latest


def evaluate(manifest: dict, check_runs: list[dict]) -> tuple[bool, list[tuple[str, str, str]]]:
    """Returns (releasable, rows[(check, verdict, detail)])."""
    tiers = {c["name"]: c["tier"] for c in manifest["checks"]}
    runs = latest_by_name([r for r in check_runs if (r.get("app") or {}).get("slug") == "github-actions"])
    rows: list[tuple[str, str, str]] = []
    ok = True

    for name, tier in tiers.items():
        if tier != "always":
            continue
        run = runs.get(name)
        if run is None:
            rows.append((name, "BLOCK", "required check never reported on this commit"))
            ok = False
        elif run.get("status") != "completed":
            rows.append((name, "BLOCK", f"still {run.get('status')}"))
            ok = False
        elif run.get("conclusion") != "success":
            rows.append((name, "BLOCK", f"conclusion={run.get('conclusion')}"))
            ok = False
        else:
            rows.append((name, "PASS", "success"))

    for name, run in sorted(runs.items()):
        if tiers.get(name) == "always" or tiers.get(name) == "advisory":
            continue
        if run.get("status") != "completed":
            rows.append((name, "BLOCK", f"still {run.get('status')}"))
            ok = False
        elif run.get("conclusion") in BAD_CONCLUSIONS:
            rows.append((name, "BLOCK", f"conclusion={run.get('conclusion')}"))
            ok = False
    return ok, rows


def migrations_in(changed_files: list[str]) -> list[str]:
    return sorted(f for f in changed_files if f.startswith(MIGRATIONS_DIR) and f.endswith(".php"))


def git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", older, newer]).returncode == 0


def api_get(repo: str, token: str, path: str, params: str = "") -> dict:
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/{path}{params}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - fixed https host
        return json.load(resp)


def fetch_check_runs(repo: str, token: str, sha: str) -> list[dict]:
    runs: list[dict] = []
    for page in range(1, 11):
        data = api_get(repo, token, f"commits/{sha}/check-runs", f"?per_page=100&page={page}")
        runs += data.get("check_runs", [])
        if len(data.get("check_runs", [])) < 100:
            break
    return runs


def verify(args: argparse.Namespace) -> int:
    sha = args.sha or git("rev-parse", "origin/main")
    sha = git("rev-parse", "--verify", f"{sha}^{{commit}}")
    problems: list[str] = []

    if not is_ancestor(sha, "origin/main"):
        problems.append(f"{sha[:12]} is not on main")
    production = subprocess.run(["git", "rev-parse", "--verify", "origin/production"], capture_output=True, text=True)
    if production.returncode != 0:
        problems.append("branch `production` does not exist yet (owner bootstrap step is missing)")
        prod_sha = None
    else:
        prod_sha = production.stdout.strip()
        if prod_sha == sha:
            problems.append("production is already at this commit")
        elif not is_ancestor(prod_sha, sha):
            problems.append(f"{sha[:12]} is not a fast-forward of production ({prod_sha[:12]})")

    manifest = json.loads(MANIFEST.read_text())
    try:
        ok, rows = evaluate(manifest, fetch_check_runs(args.repo, args.token, sha))
    except (urllib.error.URLError, KeyError, ValueError) as exc:  # fail closed
        ok, rows = False, [("GitHub API", "BLOCK", f"cannot read check runs: {type(exc).__name__}")]
    if not ok:
        problems.append("CI is not green on this exact commit")

    migrations: list[str] = []
    if prod_sha and prod_sha != sha and is_ancestor(prod_sha, sha):
        migrations = migrations_in(git("diff", "--name-only", prod_sha, sha).splitlines())
    if migrations and not args.acknowledge_migrations:
        problems.append(f"{len(migrations)} migration(s) ship with this release; re-run with acknowledge_migrations=true after a DB backup")

    lines = [f"### Release gate for `{sha}`", "", "| Check | Verdict | Detail |", "|---|---|---|"]
    lines += [f"| {n} | {v} | {d} |" for n, v, d in rows]
    lines += ["", f"Migrations carried: **{len(migrations)}**"] + [f"- `{m}`" for m in migrations]
    lines += ["", "**RELEASABLE**" if not problems else "**NOT RELEASABLE**"] + [f"- {p}" for p in problems]
    summary = "\n".join(lines)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        Path(os.environ["GITHUB_STEP_SUMMARY"]).write_text(summary + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as out:
            out.write(f"sha={sha}\nreleasable={'true' if not problems else 'false'}\nmigrations={len(migrations)}\n")
    return 0 if not problems else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify")
    v.add_argument("--repo", required=True)
    v.add_argument("--sha", default="")
    v.add_argument("--token", default=os.environ.get("GITHUB_TOKEN", ""))
    v.add_argument("--acknowledge-migrations", action="store_true")
    v.set_defaults(fn=verify)
    args = parser.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    sys.exit(main())

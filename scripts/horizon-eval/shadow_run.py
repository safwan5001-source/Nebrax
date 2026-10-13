#!/usr/bin/env python3
"""Manual runner for Horizon Shadow Mode (AWJ-HORIZON-V2-2). Run by a person; nothing schedules it.

  # observe live PRs (read-only `gh api` GETs through collect_snapshot.py), write reports to a directory
  python3 shadow_run.py --pr 1391 --pr 1390 --out-dir /tmp/shadow

  # re-render frozen evidence (historical: can never recommend READY_FOR_MANUAL_REVIEW)
  python3 shadow_run.py --snapshot snapshots/live-pr586.json --out-dir /tmp/shadow

Reads GitHub (GET only, via collect_snapshot.gh_get) and writes two local files per PR
(shadow-pr<N>-<head12>-<live|replay>.json / .md) plus shadow-summary.md. It never posts a comment, label, review or status,
never merges, never touches settings. Exit code 0 = every observation produced a report (whatever it recommends);
2 = bad arguments; 1 = an observation could not be made at all (nothing is written for it).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import collect_snapshot as cs
import shadow_observe as so


def write_atomic(path: Path, text: str) -> None:
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".shadow-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        finally:
            raise


def report_stem(rep: dict) -> str:
    """File name derived ONLY from validated fields (int PR number, hex SHA) - never from PR text."""
    pr = rep.get("pr", {})
    number, head = pr.get("number"), pr.get("head_sha")
    if isinstance(number, int) and isinstance(head, str) and re.fullmatch(r"[0-9a-f]{40}", head):
        mode = "replay" if rep.get("observation", {}).get("mode") == "replay-frozen" else "live"
        return f"shadow-pr{number}-{head[:12]}-{mode}"
    return "shadow-unidentified-" + str(rep.get("report_sha256", "x"))[:12]


def load_snapshot(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def request_for(repo: str) -> dict:
    return {**so.REQUEST_DEFAULTS, "repository": repo, "base_branch": "main"}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Horizon Shadow Mode - advisory read-only PR observation (never authorises a merge).")
    ap.add_argument("--repo", default="safwan5001-source/Nebrax")
    ap.add_argument("--pr", type=int, action="append", default=[], help="observe this open PR live (repeatable)")
    ap.add_argument("--snapshot", type=Path, action="append", default=[], help="re-render a frozen snapshot file (repeatable; historical)")
    ap.add_argument("--out-dir", type=Path, required=True)
    ap.add_argument("--patch-limit", type=int, default=cs.PATCH_LIMIT)
    args = ap.parse_args(argv)
    if not args.pr and not args.snapshot:
        print("nothing to observe: pass --pr N and/or --snapshot FILE", file=sys.stderr)
        return 2
    if any(n < 1 for n in args.pr):
        print("--pr must be a positive integer", file=sys.stderr)
        return 2
    args.out_dir.mkdir(parents=True, exist_ok=True)

    reports, failed = [], 0
    jobs = [("live", n) for n in args.pr] + [("replay", p) for p in args.snapshot]
    for kind, item in jobs:
        try:
            if kind == "live":
                case = cs.collect(args.repo, item, request_for(args.repo), args.patch_limit)
                rep = so.observe(case, wall_clock=datetime.now(timezone.utc))
            else:
                rep = so.observe(load_snapshot(item), replay=True)
        except Exception as exc:  # noqa: BLE001 - report which observation failed, write nothing for it
            failed += 1
            print(f"observation failed ({kind} {item}): {type(exc).__name__}: {str(exc)[:160]}", file=sys.stderr)
            continue
        stem = report_stem(rep)
        write_atomic(args.out_dir / f"{stem}.json", so.report_json(rep))
        write_atomic(args.out_dir / f"{stem}.md", so.render_markdown(rep))
        reports.append(rep)
        print(f"{stem}: {rep['recommendation']} (zone {rep.get('zone')}, ci {rep.get('ci', {}).get('overall')}, {rep['observation'].get('mode')})")
    if reports:
        write_atomic(args.out_dir / "shadow-summary.md", so.render_summary(reports))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

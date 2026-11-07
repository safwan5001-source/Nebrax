#!/usr/bin/env python3
"""Selects the test files of ONE shard (PG-SHARD-ADDITIVE-1).

Runs inside a shard job, in the assembled Laravel app (`--app`). It
  1. discovers every `*Test.php` under tests/Feature and tests/Unit (PHPUnit's own default discovery),
  2. keeps those that `shard_proof.assign()` places on this shard (manifest entry, else sha1 mod N — the SAME function
     the exactly-once proof re-derives, so there is no second copy that could drift),
  3. writes all_files.txt / assigned.txt into `--out`, and
  4. rewrites the app's phpunit.xml so PHPUnit runs only those files (the original is kept as phpunit.xml.orig).
Every test file stays on disk: architecture tests read other test files.

Fail-closed: a missing manifest, an unknown shard index, an empty selection, or a phpunit.xml without exactly one
<testsuites> block aborts the job before any test runs. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shard_proof import assign  # noqa: E402

SUITE_DIRS = ("tests/Feature", "tests/Unit")


def discover(app: Path) -> list[str]:
    out = []
    for d in SUITE_DIRS:
        base = app / d
        if not base.is_dir():
            continue
        for dirpath, _, names in os.walk(base):
            for n in names:
                if n.endswith("Test.php"):
                    out.append(Path(dirpath, n).relative_to(app).as_posix())
    return sorted(out)


def load_manifest(path: Path) -> dict:
    if not path.is_file():
        raise SystemExit(f"assignment manifest not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("assignment"), dict):
        raise SystemExit("assignment manifest: unsupported shape (need version 1 and an `assignment` object)")
    return data["assignment"]


def rewrite_phpunit(text: str, shard: int, count: int, files: list[str]) -> str:
    suite = ('<testsuites>\n        <testsuite name="Shard %d/%d">\n%s\n        </testsuite>\n    </testsuites>'
             % (shard, count, "\n".join(f"            <file>{f}</file>" for f in files)))
    new, n = re.subn(r"<testsuites>.*?</testsuites>", lambda m: suite, text, flags=re.S)
    if n != 1 or len(re.findall(r"<testsuites>", text)) != 1:
        raise SystemExit("phpunit.xml: the <testsuites> block was not found exactly once")
    return new


def select(app: Path, shard: int, count: int, manifest: dict, out: Path) -> dict:
    if count < 2 or not 1 <= shard <= count:
        raise SystemExit(f"bad shard {shard}/{count}")
    all_files = discover(app)
    if not all_files:
        raise SystemExit("no test files discovered")
    mine = [f for f in all_files if assign(f, count, manifest) == shard - 1]
    if not mine:
        raise SystemExit(f"shard {shard}/{count} was assigned no test files")
    cfg = app / "phpunit.xml"
    text = cfg.read_text(encoding="utf-8")
    new = rewrite_phpunit(text, shard, count, mine)
    out.mkdir(parents=True, exist_ok=True)
    (out / "all_files.txt").write_text("\n".join(all_files) + "\n", encoding="utf-8")
    (out / "assigned.txt").write_text("\n".join(mine) + "\n", encoding="utf-8")
    (app / "phpunit.xml.orig").write_text(text, encoding="utf-8")
    cfg.write_text(new, encoding="utf-8")
    return {"shard": shard, "count": count, "discovered": len(all_files), "assigned": len(mine),
            "by_manifest": sum(1 for f in mine if f in manifest), "by_hash_fallback": sum(1 for f in mine if f not in manifest)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--app", required=True, help="assembled Laravel app root")
    ap.add_argument("--shard", type=int, required=True, help="1-based shard index")
    ap.add_argument("--count", type=int, required=True)
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True, help="directory for all_files.txt / assigned.txt")
    a = ap.parse_args(argv)
    info = select(Path(a.app), a.shard, a.count, load_manifest(Path(a.manifest)), Path(a.out))
    print(f"shard {info['shard']}/{info['count']}: {info['assigned']} of {info['discovered']} test files "
          f"({info['by_hash_fallback']} placed by hash fallback)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Exactly-once proof for a sharded test suite (PG-SHARD-GATE-1).

The `proof` job of a CI Gate shard group runs this over the artifacts of every shard job. It fails (exit 1,
every violation printed) unless the shards TOGETHER ran each test exactly once:

  per shard k in 1..N, directory <root>/shard-k/ with
    all_files.txt   test files discovered by the selector BEFORE selection
    assigned.txt    the files assigned to this shard
    inventory.txt   `phpunit --list-tests` of the UNSHARDED configuration, as seen by this shard
    planned.txt     `phpunit --list-tests` of the SHARDED configuration of this shard
    junit.xml       what the shard actually executed
  <root>/tracked_test_files.txt   `git ls-files` test files (the tree under test)

Invariants (each is an error when violated):
  1. exactly N shard directories, no extra, every required file present and non-empty;
  2. every shard discovered the same files, and they include every tracked test file;
  3. assignments are pairwise disjoint (no duplicate), their union is the discovered set (no drop), and each
     equals the pure function `assign()` (manifest entry, else sha1 mod N): nobody hand-edited a list;
  4. the unsharded inventory is identical in every shard and non-empty;
  5. the union of the planned lists equals that inventory as a multiset (no test dropped, none duplicated);
  6. per shard: executed test count == planned count, no failure/error, executed files are inside the assignment.

Planned lists are only ever compared with inventories (same producer, same format); executed results are compared
by count and by file, never by re-parsing `--list-tests` text into JUnit names. Stdlib only.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

REQUIRED = ("all_files.txt", "assigned.txt", "inventory.txt", "planned.txt", "junit.xml")
TEST_FILE = re.compile(r"(tests/(?:Feature|Unit)/.+)$")


def assign(path: str, n: int, manifest: dict) -> int:
    """The single assignment function: manifest entry (0-based, in range) else sha1(path) mod n."""
    s = manifest.get(path)
    if isinstance(s, int) and not isinstance(s, bool) and 0 <= s < n:
        return s
    return int(hashlib.sha1(path.encode("utf-8")).hexdigest(), 16) % n


def _lines(p: Path) -> list[str]:
    return [l.strip() for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def _tests(p: Path) -> list[str]:
    """`--list-tests` entries (` - Class::method ...`)."""
    out = []
    for l in p.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^\s*-\s+(\S.*)$", l)
        if m:
            out.append(m.group(1).strip())
    return out


def _junit(p: Path) -> tuple[int, int, set[str]]:
    """(testcases, failing testcases, test files executed)."""
    root = ET.parse(p).getroot()
    class_file = {}
    for s in root.iter("testsuite"):
        if s.get("file") and "::" not in (s.get("name") or ""):
            class_file[s.get("name")] = s.get("file")
    total = bad = 0
    files: set[str] = set()
    for tc in root.iter("testcase"):
        total += 1
        if any(ch.tag.lower() in ("failure", "error") for ch in tc):
            bad += 1
        f = class_file.get(tc.get("class") or "") or tc.get("file") or ""
        m = TEST_FILE.search(f.replace("\\", "/"))
        files.add(m.group(1) if m else (f or "?"))
    return total, bad, files


def verify(root: Path, shards: int, manifest: dict | None = None) -> list[str]:
    manifest = manifest or {}
    errors: list[str] = []
    if not isinstance(shards, int) or shards < 2:
        return [f"shard count must be an integer >= 2, got {shards!r}"]
    present = sorted(d.name for d in root.glob("shard-*") if d.is_dir())
    wanted = [f"shard-{k}" for k in range(1, shards + 1)]
    if present != sorted(wanted):
        errors.append(f"shard directories {present} != expected {sorted(wanted)} (a shard is missing or an extra one appeared)")
    data: dict[int, dict] = {}
    for k in range(1, shards + 1):
        d = root / f"shard-{k}"
        missing = [f for f in REQUIRED if not (d / f).is_file()]
        if missing:
            errors.append(f"shard {k}: missing {missing}")
            continue
        try:
            data[k] = {"all": _lines(d / "all_files.txt"), "assigned": _lines(d / "assigned.txt"),
                       "inventory": _tests(d / "inventory.txt"), "planned": _tests(d / "planned.txt"),
                       "junit": _junit(d / "junit.xml")}
        except (ET.ParseError, OSError, UnicodeDecodeError) as e:
            errors.append(f"shard {k}: unreadable artifact ({e})")
    tp = root / "tracked_test_files.txt"
    tracked = set(_lines(tp)) if tp.is_file() else None
    if tracked is None:
        errors.append("tracked_test_files.txt missing (the proof cannot tie the shards to the tree under test)")
    elif not tracked:
        errors.append("tracked_test_files.txt is empty")
    if len(data) != shards:
        return errors  # the cross-shard invariants below need every shard

    alls = [tuple(sorted(v["all"])) for v in data.values()]
    if len(set(alls)) != 1:
        errors.append("shards discovered different test-file sets")
    discovered = set(alls[0])
    if not discovered:
        errors.append("no test files discovered")
    if tracked is not None and not tracked <= discovered:
        errors.append(f"tracked test files not discovered: {sorted(tracked - discovered)[:5]}")

    assigned = {k: v["assigned"] for k, v in data.items()}
    for k, a in assigned.items():
        if len(a) != len(set(a)):
            errors.append(f"shard {k}: a file is listed twice in its assignment")
    count = collections.Counter(f for a in assigned.values() for f in set(a))
    dup = sorted(f for f, n in count.items() if n > 1)
    if dup:
        errors.append(f"files assigned to more than one shard (duplicated): {dup[:5]}")
    dropped = sorted(discovered - set(count))
    if dropped:
        errors.append(f"discovered files assigned to no shard (dropped): {dropped[:5]}")
    stray = sorted(set(count) - discovered)
    if stray:
        errors.append(f"assigned files that were never discovered: {stray[:5]}")
    for k, a in assigned.items():
        want = {f for f in discovered if assign(f, shards, manifest) == k - 1}
        if set(a) != want:
            errors.append(f"shard {k}: assignment differs from the pure assignment function "
                          f"(extra {sorted(set(a) - want)[:3]}, missing {sorted(want - set(a))[:3]})")

    invs = [tuple(sorted(v["inventory"])) for v in data.values()]
    if len(set(invs)) != 1:
        errors.append("shards saw different unsharded inventories")
    inventory = collections.Counter(invs[0])
    if not inventory:
        errors.append("the unsharded inventory is empty")
    planned_union: collections.Counter = collections.Counter()
    for v in data.values():
        planned_union.update(v["planned"])
    if planned_union != inventory:
        lost = list((inventory - planned_union).items())[:3]
        extra = list((planned_union - inventory).items())[:3]
        errors.append(f"union of planned tests != unsharded inventory (dropped {lost}, duplicated/extra {extra})")

    for k, v in data.items():
        total, bad, files = v["junit"]
        if total != len(v["planned"]):
            errors.append(f"shard {k}: executed {total} tests but planned {len(v['planned'])}")
        if bad:
            errors.append(f"shard {k}: {bad} failing test(s)")
        outside = sorted(files - set(v["assigned"]))
        if outside:
            errors.append(f"shard {k}: executed files outside its assignment: {outside[:3]}")
    return errors


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--root", required=True, help="directory holding shard-1..shard-N and tracked_test_files.txt")
    ap.add_argument("--shards", type=int, required=True)
    ap.add_argument("--manifest", default=None, help='optional JSON {"assignment": {file: shard_index_0_based}}')
    a = ap.parse_args(argv)
    manifest = {}
    if a.manifest:
        manifest = json.loads(Path(a.manifest).read_text(encoding="utf-8")).get("assignment", {})
    errors = verify(Path(a.root), a.shards, manifest)
    for e in errors:
        print(f"::error::{e}")
    print("SHARD PROOF FAILED" if errors else f"SHARD PROOF OK: {a.shards} shards ran every test exactly once")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

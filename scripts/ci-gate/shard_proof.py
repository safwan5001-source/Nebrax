#!/usr/bin/env python3
"""Exactly-once proof for a sharded test suite (PG-SHARD-GATE-1/2).

The `proof` job of a CI Gate shard group runs this over the artifacts of every shard job. It fails (exit 1,
every violation printed) unless the shards TOGETHER ran each test exactly once, judged by TEST IDENTITY
(`Class::method` plus the data-set key), not by counts or file names alone.

  per shard k in 1..N, directory <root>/shard-k/ with
    all_files.txt   test files discovered by the selector BEFORE selection
    assigned.txt    the files assigned to this shard
    inventory.txt   `phpunit --list-tests` of the UNSHARDED configuration, as seen by this shard
    planned.txt     `phpunit --list-tests` of the SHARDED configuration of this shard
    junit.xml       what the shard actually executed (`--log-junit`, ParaTest-merged)
  <root>/tracked_test_files.txt   `git ls-files` test files (the tree under test)

Identity formats (verified against PHPUnit 11.5 + ParaTest 7 + Laravel `artisan test --parallel`):
  list-tests   ` - Tests\\Feature\\XTest::method`   ` - …::method#3`   ` - …::method"label"`
  JUnit        class="Tests\\Feature\\XTest" name="method"   name="method with data set #3"   name='method with data set "label"'
Both reduce to one canonical id: `Class::method` or `Class::method with data set #3` / `… "label"`.

Invariants (each is an error when violated):
  1. exactly N shard directories, no extra; every artifact present, non-empty and well-formed (the list header is
     present and every entry parses; JUnit parses, has testcases, and its own `tests` summary equals the testcases);
  2. every shard discovered the same files, and they include every tracked test file;
  3. assignments are pairwise disjoint (no duplicate), their union is the discovered set (no drop), and each
     equals the pure function `assign()` (manifest entry, else sha1 mod N): nobody hand-edited a list;
  4. the unsharded inventory is identical in every shard and non-empty;
  5. the union of the planned lists equals that inventory as a multiset of ids (none dropped, none duplicated);
  6. per shard, the EXECUTED ids equal the PLANNED ids as a multiset: a test that did not run, ran twice, ran with a
     different identity (same count), or ran in the wrong shard is named; no failures; executed files are inside the
     shard's assignment.

Stdlib only.
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
LIST_HEADER = "Available tests:"
LIST_ENTRY = re.compile(r"^ - (\S.*)$")
LIST_ID = re.compile(r"^(?P<cls>[A-Za-z_\\][A-Za-z0-9_\\]*)::(?P<m>[A-Za-z_][A-Za-z0-9_]*)(?P<ds>#.+|\".*\")?$", re.S)
EXAMPLES = 3


def assign(path: str, n: int, manifest: dict) -> int:
    """The single assignment function: manifest entry (0-based, in range) else sha1(path) mod n."""
    s = manifest.get(path)
    if isinstance(s, int) and not isinstance(s, bool) and 0 <= s < n:
        return s
    return int(hashlib.sha1(path.encode("utf-8")).hexdigest(), 16) % n


def canonical(cls: str, method: str, dataset: str | None) -> str:
    return f"{cls}::{method}" + (f" with data set {dataset}" if dataset else "")


def parse_list(text: str) -> tuple[list[str], list[str]]:
    """(canonical ids, problems) for a `phpunit --list-tests` output. Strict after the header: truncated or
    garbled output must not look like a smaller suite."""
    ids, problems, seen = [], [], False
    for raw in text.splitlines():
        line = raw.rstrip("\r")
        if not seen:
            seen = line.strip() == LIST_HEADER
            continue
        if not line.strip():
            continue
        m = LIST_ENTRY.match(line)
        idm = LIST_ID.match(m.group(1)) if m else None
        if idm is None:
            problems.append(f"unparseable line {line[:80]!r}")
            continue
        ids.append(canonical(idm["cls"], idm["m"], idm["ds"]))
    if not seen:
        problems.append(f"missing header {LIST_HEADER!r} (empty, truncated or not a --list-tests output)")
    return ids, problems


def parse_junit(p: Path) -> tuple[list[tuple[str, str, bool]], list[str]]:
    """([(canonical id, test file, failed)], problems) from a JUnit log."""
    root = ET.parse(p).getroot()
    problems: list[str] = []
    if root.tag not in ("testsuites", "testsuite"):
        return [], [f"unexpected root element {root.tag!r}"]
    class_file = {s.get("name"): s.get("file") for s in root.iter("testsuite") if s.get("file") and "::" not in (s.get("name") or "")}
    rows, total = [], 0
    for tc in root.iter("testcase"):
        total += 1
        cls, name = tc.get("class") or "", tc.get("name") or ""
        if not cls or not name:
            problems.append("a testcase lacks class or name")
            continue
        f = (tc.get("file") or class_file.get(cls) or "").replace("\\", "/")
        m = TEST_FILE.search(f)
        failed = any(ch.tag.lower() in ("failure", "error") for ch in tc)
        rows.append((f"{cls}::{name}", m.group(1) if m else (f or "?"), failed))
    if not rows:
        problems.append("no testcases")
    tops = [s for s in (root if root.tag == "testsuites" else [root]) if s.tag == "testsuite"]
    claimed = [s.get("tests") for s in tops]
    if claimed and all(c is not None and c.isdigit() for c in claimed) and sum(int(c) for c in claimed) != total:
        problems.append(f"summary says {sum(int(c) for c in claimed)} tests but the log holds {total} (truncated or altered)")
    return rows, problems


def _lines(p: Path) -> list[str]:
    return [l.strip() for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def _diff(a: collections.Counter, b: collections.Counter) -> list[str]:
    return [f"{k!r}x{n}" if n > 1 else repr(k) for k, n in list((a - b).items())[:EXAMPLES]]


def verify(root: Path, shards: int, manifest: dict | None = None) -> list[str]:
    manifest = manifest or {}
    errors: list[str] = []
    if not isinstance(shards, int) or isinstance(shards, bool) or shards < 2:
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
        empty = [f for f in REQUIRED if (d / f).stat().st_size == 0]
        if empty:
            errors.append(f"shard {k}: empty artifact {empty}")
            continue
        try:
            inv, p1 = parse_list((d / "inventory.txt").read_text(encoding="utf-8"))
            pln, p2 = parse_list((d / "planned.txt").read_text(encoding="utf-8"))
            exe, p3 = parse_junit(d / "junit.xml")
            all_files, assigned = _lines(d / "all_files.txt"), _lines(d / "assigned.txt")
        except (ET.ParseError, OSError, UnicodeDecodeError) as e:
            errors.append(f"shard {k}: unreadable artifact ({e})")
            continue
        for name, probs in (("inventory.txt", p1), ("planned.txt", p2), ("junit.xml", p3)):
            for pr in probs[:EXAMPLES]:
                errors.append(f"shard {k}: {name}: {pr}")
        if p1 or p2 or p3:
            continue
        data[k] = {"all": all_files, "assigned": assigned, "inventory": inv, "planned": pln, "executed": exe}
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
    planned_in: dict[str, set[int]] = collections.defaultdict(set)
    for k, v in data.items():
        planned_union.update(v["planned"])
        for t in v["planned"]:
            planned_in[t].add(k)
    if planned_union != inventory:
        errors.append(f"union of planned tests != unsharded inventory (dropped {_diff(inventory, planned_union)}, "
                      f"duplicated/extra {_diff(planned_union, inventory)})")

    for k, v in data.items():
        planned, ran = collections.Counter(v["planned"]), collections.Counter(t for t, _, _ in v["executed"])
        if not planned:
            errors.append(f"shard {k}: planned no tests")
        if ran != planned:
            missing, extra = _diff(planned, ran), _diff(ran, planned)
            elsewhere = [f"{t} (planned in shard {sorted(planned_in[t])})" for t in list(ran - planned)
                         if t in planned_in and k not in planned_in[t]][:EXAMPLES]
            msg = f"shard {k}: executed tests differ from the plan (not executed {missing}, unplanned/duplicated {extra})"
            if elsewhere:
                msg += f"; executed in the wrong shard: {elsewhere}"
            errors.append(msg)
        elif sum(ran.values()) != sum(planned.values()):  # unreachable by construction; kept as a belt for refactors
            errors.append(f"shard {k}: executed {sum(ran.values())} tests but planned {sum(planned.values())}")
        bad = sum(1 for _, _, failed in v["executed"] if failed)
        if bad:
            errors.append(f"shard {k}: {bad} failing test(s)")
        outside = sorted({f for _, f, _ in v["executed"]} - set(v["assigned"]))
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

#!/usr/bin/env python3
"""يلخّص ملف JUnit إلى مجاميع ومجموعة (صنف::اختبار، حالة). تجربة exp/ci-sqlite-parallel فقط."""
import collections, json, sys
import xml.etree.ElementTree as ET


def outcomes(path):
    cases = collections.Counter()
    for tc in ET.parse(path).getroot().iter("testcase"):
        key = f"{tc.get('classname') or tc.get('class') or ''}::{tc.get('name')}"
        status = "passed"
        for child in tc:
            tag = child.tag.lower()
            if tag in ("failure", "error", "skipped"):
                status = tag
                break
        cases[(key, status)] += 1
    return cases


def totals(cases):
    by = collections.Counter()
    for (_, status), n in cases.items():
        by[status] += n
    return {"total": sum(by.values()), **dict(by)}


if __name__ == "__main__":
    c = outcomes(sys.argv[1])
    print(json.dumps(totals(c), sort_keys=True))

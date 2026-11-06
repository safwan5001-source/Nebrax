"""exp/ci-pg-shards: دالة الإسناد النقية الوحيدة. تُستعمل في خطوة الاختيار وفي فحص الإثبات بالتعريف نفسه (لا نسختان).

الوحدة = ملف صنف اختبار تحت tests/Feature أو tests/Unit ينتهي بـ Test.php (اكتشاف PHPUnit الافتراضي، متكرر في المجلدات).
shard(file) = manifest[file] إن وُجد وكان < n، وإلا sha1(file) mod n. فكل ملف (حتى الجديد غير المسجَّل) له شريحة واحدة بالضبط.
"""
import hashlib
import json
import os
import xml.etree.ElementTree as ET

SUITE_DIRS = ("tests/Feature", "tests/Unit")


def discover(app_root):
    out = []
    for d in SUITE_DIRS:
        base = os.path.join(app_root, d)
        for dirpath, _, names in os.walk(base):
            for n in names:
                if n.endswith("Test.php"):
                    out.append(os.path.relpath(os.path.join(dirpath, n), app_root).replace(os.sep, "/"))
    return sorted(out)


def assign(path, n, manifest):
    s = manifest.get(path)
    if isinstance(s, int) and 0 <= s < n:
        return s
    return int(hashlib.sha1(path.encode("utf-8")).hexdigest(), 16) % n


def load_manifest(path):
    if not path or not os.path.isfile(path):
        return {}
    return json.load(open(path, encoding="utf-8")).get("assignment", {})


def junit_by_file(junit_path, strip_prefix):
    """{relative test file: [(classname, test name, status, time)]} من JUnit، بالملف المعلن على testsuite الصنف (لا على التابع)."""
    root = ET.parse(junit_path).getroot()
    class_file = {}
    for s in root.iter("testsuite"):
        nm, f = s.get("name") or "", s.get("file")
        if f and "::" not in nm:
            class_file[nm] = f
    res = {}
    for tc in root.iter("testcase"):
        cls = tc.get("class") or ""
        f = class_file.get(cls) or tc.get("file") or ""
        rel = f.replace(strip_prefix, "", 1).lstrip("/") if f else "?"
        st = "passed"
        for ch in tc:
            if ch.tag.lower() in ("failure", "error", "skipped"):
                st = ch.tag.lower()
                break
        res.setdefault(rel, []).append((tc.get("classname") or "", tc.get("name") or "", st, float(tc.get("time") or 0)))
    return res

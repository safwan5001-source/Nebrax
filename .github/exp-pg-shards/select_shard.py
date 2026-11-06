#!/usr/bin/env python3
"""يولّد phpunit.xml للشريحة: قائمة <file> صريحة لملفاتها فقط. كل ملفات الاختبار تبقى على القرص (اختبارات المعمار تقرأ ملفات اختبار أخرى).
يكتب في --out-dir: all_files.txt (كل ما اكتُشف)، assigned.txt (ما أُسنِد لهذه الشريحة)، plan.json."""
import argparse, json, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shard_lib import assign, discover, load_manifest

ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True); ap.add_argument("--shard", type=int, required=True); ap.add_argument("--count", type=int, required=True)
ap.add_argument("--manifest", required=True); ap.add_argument("--out-dir", required=True)
a = ap.parse_args()
manifest = load_manifest(a.manifest)
allf = discover(a.root)
mine = [f for f in allf if assign(f, a.count, manifest) == a.shard - 1]
os.makedirs(a.out_dir, exist_ok=True)
open(os.path.join(a.out_dir, "all_files.txt"), "w").write("\n".join(allf) + "\n")
open(os.path.join(a.out_dir, "assigned.txt"), "w").write("\n".join(mine) + "\n")
cfg = os.path.join(a.root, "phpunit.xml")
text = open(cfg, encoding="utf-8").read()
open(cfg + ".orig", "w", encoding="utf-8").write(text)
suite = '<testsuites>\n        <testsuite name="Shard %d/%d">\n%s\n        </testsuite>\n    </testsuites>' % (
    a.shard, a.count, "\n".join("            <file>%s</file>" % f for f in mine))
new, n = re.subn(r"<testsuites>.*?</testsuites>", lambda m: suite, text, count=1, flags=re.S)
if n != 1:
    sys.exit("phpunit.xml: <testsuites> block not found exactly once")
open(cfg, "w", encoding="utf-8").write(new)
json.dump({"shard": a.shard, "count": a.count, "discovered": len(allf), "assigned": len(mine),
           "from_manifest": sum(1 for f in mine if f in manifest), "from_hash_fallback": sum(1 for f in mine if f not in manifest)},
          open(os.path.join(a.out_dir, "plan.json"), "w"))
print(f"shard {a.shard}/{a.count}: {len(mine)} of {len(allf)} test files ({sum(1 for f in mine if f not in manifest)} by hash fallback)")

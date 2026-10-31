#!/usr/bin/env python3
"""يولّد GAP-LEDGER.md من gap-status.json + السجل الرئيسي. تشغيل: python3 gap-ledger.py"""
import json, re, pathlib
d = pathlib.Path(__file__).parent
ids = []
for line in (d / "AWJ-APP-BUILDER-MASTER-GAP-REGISTER.md").read_text(encoding="utf-8").splitlines():
    m = re.match(r"\| ([A-Z]+-\d+) \|", line)
    if m:
        ids.append(m.group(1))
st = json.loads((d / "gap-status.json").read_text(encoding="utf-8"))
unknown = [k for k in st if k not in ids]
assert not unknown, f"معرّفات غير موجودة في السجل: {unknown}"
closed = [i for i in ids if st.get(i, {}).get("s") == "closed"]
partial = [i for i in ids if st.get(i, {}).get("s") == "partial"]
opened = [i for i in ids if i not in st]
out = ["# سجل حالة الفجوات (مُولَّد من `gap-status.json` — لا يُحرَّر يدوياً)", "",
       f"**الإجمالي {len(ids)}** · ✅ مغلقة بدليل **{len(closed)}** · 🟡 جزئية **{len(partial)}** · ⏳ مفتوحة **{len(opened)}**", "",
       "## ✅ مغلقة (بدليل)", "| الفجوة | الشريحة | الدليل |", "|---|---|---|"]
out += [f"| {i} | {st[i]['slice']} | {st[i]['ev']} |" for i in closed]
out += ["", "## 🟡 جزئية", "| الفجوة | الشريحة | المنجز / المتبقي |", "|---|---|---|"]
out += [f"| {i} | {st[i]['slice']} | {st[i]['ev']} |" for i in partial]
out += ["", "## ⏳ مفتوحة", ", ".join(opened), ""]
(d / "GAP-LEDGER.md").write_text("\n".join(out), encoding="utf-8")
print(len(ids), len(closed), len(partial), len(opened))

# AWJ Signature V3 — مختبر الهوية البصرية

اتجاهان بصريان (**نَسَق** و**ليوان**) فوق Unified UX Foundation. داخل Design Lab فقط: لا يُبنى مع `web/` ولا يُفعَّل في الإنتاج.

| المسار | المحتوى |
|---|---|
| `index.html` | المستكشف: اتجاه واحد أو مقارنة جنباً إلى جنب (`?embed=1` للعرض المنفرد بعرض النافذة الحقيقي) |
| `signature.css` / `signature.js` | حزمتا الهوية + لوحة التحكم + تجهيزات الفاتورة + الاستعادة |
| `nav-icons.js` | قاموس الأيقونات الموحَّد للتنقل والإجراءات المشتركة (35، من Lucide، **مولَّد** — لا يُعدَّل يدوياً) |
| `tools/` | توليد قاموس الأيقونات، ولقطات قبل/بعد (التنقل وتنقيح ليوان) ومقارناتها |
| `foundation/` | نسخة مجمّدة من وقت تشغيل الأساس الذي يعتمد عليه V3 (المصدر الأصلي ومجموعة اختباراته في PR #2099) |
| `previews/` | 8 معاينات رئيسية 2× + `nav/` (قبل/بعد التنقل) + `liwan/` (7 لوحات مقارنة لتنقيح ليوان R1) + `liwan-r2/` (6 لوحات R2) |
| `out/` | مخرجات الاختبار (39 لقطة + 64 لقطة تنقل) — مُستثناة من Git |
| `checks.json` | نتائج آخر تشغيل كامل |

## المعاينة

- **على الكمبيوتر:** افتح `design-lab/signature/index.html` مباشرة في المتصفح. لا بناء ولا خادم.
- **على الآيفون، دون نشر:** شغّل خادماً محلياً من جذر المستودع، ثم افتح العنوان من الآيفون على الشبكة نفسها:
  ```bash
  python3 -m http.server 8080
  # http://<عنوان-IP-للكمبيوتر>:8080/design-lab/signature/index.html
  # عرض التطبيق وحده بملء الشاشة: …/index.html?embed=1&id=liwan&r=dashboard
  ```

## الفحوص

Playwright من التثبيت العام أو من `web/node_modules` (بعد `npm ci` في `web/`)، وaxe-core من `web/node_modules`.

```bash
node design-lab/scripts/signature.mjs                      # 370 تهيئة + 31 اختبار تفاعل
node design-lab/scripts/signature.mjs --shots --scale=2    # + 39 لقطة → out/screens (مخرجات اختبار)
node design-lab/scripts/signature.mjs --previews           # يعيد توليد المعاينات الثماني في previews/
node design-lab/signature/tools/gen-nav-icons.mjs                       # يعيد توليد nav-icons.js من lucide-react في web/node_modules
node design-lab/signature/tools/signature-nav-previews.mjs --tag=after  # 32 لقطة تنقل → out/nav/after
node design-lab/signature/tools/signature-nav-previews.mjs --tag=after --commit && python3 design-lab/signature/tools/nav-previews-webp.py
node design-lab/signature/tools/liwan-previews.mjs --tag=after            # 88 لقطة (ليوان + مرجع نَسَق) → out/liwan/after
node design-lab/signature/tools/liwan-previews.mjs --tag=after --commit && python3 design-lab/signature/tools/liwan-previews-webp.py  # يحتاج لقطات before بالطريقة نفسها
# R2: --set=liwan-r2 --only=dashboard-390,nav-sheet,nav-rail --langs=ar,en ثم: python3 …/liwan-previews-webp.py liwan-r2
```

التوثيق: `design-lab/docs/AWJ-SIGNATURE-V3-*.md` و`docs/AWJ-SIGNATURE-V3-NAV-ICONS-REPORT.md` و`docs/AWJ-SIGNATURE-V3-LIWAN-REFINEMENT-REPORT.md` و`docs/AWJ-SIGNATURE-V3-LIWAN-R2-REPORT.md`.

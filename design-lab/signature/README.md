# AWJ Signature V3 — مختبر الهوية البصرية

اتجاهان بصريان (**نَسَق** و**ليوان**) فوق Unified UX Foundation. داخل Design Lab فقط: لا يُبنى مع `web/` ولا يُفعَّل في الإنتاج.

| المسار | المحتوى |
|---|---|
| `index.html` | المستكشف: اتجاه واحد أو مقارنة جنباً إلى جنب (`?embed=1` للعرض المنفرد بعرض النافذة الحقيقي) |
| `signature.css` / `signature.js` | حزمتا الهوية + لوحة التحكم + تجهيزات الفاتورة + الاستعادة |
| `foundation/` | نسخة مجمّدة من وقت تشغيل الأساس الذي يعتمد عليه V3 (المصدر الأصلي ومجموعة اختباراته في PR #2099) |
| `previews/` | 8 معاينات رئيسية 2× |
| `out/` | مخرجات الاختبار (39 لقطة) — مُستثناة من Git |
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
node design-lab/scripts/signature.mjs                      # 370 تهيئة + 14 اختبار تفاعل
node design-lab/scripts/signature.mjs --shots --scale=2    # + 39 لقطة → out/screens (مخرجات اختبار)
node design-lab/scripts/signature.mjs --previews           # يعيد توليد المعاينات الثماني في previews/
```

التوثيق: `design-lab/docs/AWJ-SIGNATURE-V3-*.md`.

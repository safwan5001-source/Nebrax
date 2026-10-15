# أدوات التحقق (لإعادة إنتاج الأدلة)

ليست جزءاً من التطبيق ولا CI. المسارات داخلها مسارات الجلسة؛ عدّلها عند إعادة التشغيل.
- `final-values.mjs` — القيم الـ13 النهائية لـCore-Dark وجدول التباين والفصل والتمايز (`node final-values.mjs`).
- `tuning-search.mjs` — بحث عدّي ضمن قيود AA (هامش ≥0.12) عن hover/active/muted اللذين حسّنا فصل Active/Hover.
- `capture-and-measure.mjs <outDir> BEFORE,AFTER,INK` — Playwright على خادم تطوير (`npm run dev -- -p 3001`، Demo Mode): لقطات + تباين حيّ + hover + تركيز لوحة المفاتيح + فيض أفقي على 8 مقاسات. **بلا أي حقن CSS**: التطبيق يرسم ما يشحنه. حارس يفشل التشغيل إن لم يطابق لون الشريط المتوقع. `AFTER_BG` متغير بيئة اختياري.
- `unchanged-check.mjs <outDir>` — لقطات Core-Light/Default/Ink للمقارنة بكسلياً قبل/بعد.
- `compose.py <rawDir> <outDir> <ref>` — يركّب BEFORE | AFTER | Ink-Dark (Pillow). يستورد `contrast-scan.mjs` = `npx esbuild web/e2e/helpers/contrast-scan.ts --format=esm`.

# أدوات المقارنة (للاستعمال التجريبي فقط)

نصوص **لإعادة إنتاج** الأدلة؛ ليست جزءاً من التطبيق ولا من CI. المسارات داخلها مسارات الجلسة (`/tmp/...`، `/opt/pw-browsers/...`) فعدّلها عند إعادة التشغيل.

## `round-2/` (الجولة الحالية: INK | A | C | M)
- `r2-final.mjs` — **القيم الـ13 لكل من C وM** + جدول التباين والفصل والتمايز (`node r2-final.mjs`).
- `palette-search.mjs` — بحث عدّي عن hover/active وعن بديل الأزرق المتوسط (يشرح اختيار القيم).
- `capture-and-measure.mjs <outDir> [INK,A,C,M]` — Playwright على خادم التطوير (`npm run dev -- -p 3001`، Demo Mode): يلتقط ويقيس التباين الحيّ (ألوان محسوبة بتركيب الخلفيات)، hover، تركيز لوحة المفاتيح، فيض أفقي على 8 مقاسات. تُحقن قيم المرشّح كـ`<style>` في `<head>` **بعد الـhydration** (React يُزيل أي عنصر غريب من `<html>`) وفيه **حارس** يُفشل التشغيل إن لم تتغيّر خلفية الشريط فعلاً. يستورد `contrast-scan.mjs` = ناتج `npx esbuild web/e2e/helpers/contrast-scan.ts --format=esm` (المسح نفسه في e2e الرسمي).
- `compose.py <rawDir> <outDir> <lightRefDir>` — يركّب اللقطات 4-up (Pillow).
- `unchanged-check.mjs <outDir>` — يلتقط Core-Light/Default/Ink لإثبات عدم تغيّرها.

## `round-1/`
أدوات الجولة الأولى (A | B | B-AA).

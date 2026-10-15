# أدوات المقارنة (للاستعمال التجريبي فقط)

هذه نصوص **قابلة للتشغيل لإعادة إنتاج** الأدلة؛ ليست جزءاً من التطبيق ولا من CI.

- `capture-and-measure.mjs <outDir> [A,B,BAA]` — يشغّل Playwright على خادم التطوير (`npm run dev -- -p 3001`، Demo Mode) ويلتقط اللقطات ويقيس التباين. قيم B/B-AA تُحقن كـ`<style>` في `<head>` **بعد الـhydration** (React يُزيل أي عنصر غريب من `<html>`)، وفيه حارس يُفشل التشغيل إن لم تتغيّر خلفية الشريط فعلاً.
  يستورد `contrast-scan.mjs` = ناتج `npx esbuild web/e2e/helpers/contrast-scan.ts --format=esm` (المسح نفسه المستعمل في e2e الرسمي).
- `compose.py <rawDir> <outDir> <lightRefDir>` — يركّب اللقطات A | B | B-AA (Pillow).
- `candidate-contrast.mjs` — جدول تباين القيم المرشّحة قبل أي التقاط (يستعمل `contrastRatio` من مولّد التوكنز).

المسارات في النصوص مسارات الجلسة (`/tmp/...`، `/opt/pw-browsers/...`)؛ عدّلها عند إعادة التشغيل.

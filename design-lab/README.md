# AWJ Design Lab

مساحة تصميم **معزولة** لاستكشاف الجيل القادم من تجربة أَوْج وهويته البصرية. ليست جزءاً من `web/` ولا تُبنى ولا تُنشر معه.

## الحدود (ثابتة لكل مراحل المختبر)

| ممنوع | السبب |
|---|---|
| استيراد أي شيء من `web/src` أو استدعاء أي API | النموذج يجب ألا يلمس العزل أو الصلاحيات أو البيانات |
| بيانات إنتاجية | كل البيانات مولّدة داخل الملف ومُعلَّمة «تجريبية» |
| تعديل `globals.css` أو `tailwind.config.ts` أو أي مكوّن حي | لا استبدال للواجهات الحالية قبل خطة ترحيل معتمدة |
| تعديل قواعد المحاسبة أو قاعدة البيانات | المختبر عرض فقط؛ القيد المعروض «معاينة توضيحية» |

## المحتوى

```
design-lab/
  README.md                     هذا الملف
  docs/01-UX-AUDIT.md           تدقيق مختصر للحالة الحالية
  docs/02-DESIGN-DIRECTIONS.md  الاتجاهات الثلاثة + المقارنة + التوصية
  docs/PHASE-0-REPORT.md        تقرير المرحلة 0 وبوابة الاعتماد
  docs/03-VISUAL-EXPLORATION-V2.md  الاستكشاف البصري V2: أسطرلاب · مشربية · كوفي
  docs/AWJ-UX-RESEARCH-AND-DESIGN-STRATEGY.md   البحث العالمي + المعمارية الموحّدة + القرارات M1–M12
  docs/AWJ-UX-RESEARCH-IMPLEMENTATION-REPORT.md تقرير تنفيذ مرحلة البحث
  docs/research/                ملفات البحث: 12 مصدراً رسمياً، و208 قواعد بروابطها
  docs/AWJ-UX-FOUNDATION-PHASE-1-REPORT.md       تقرير المرحلة 1: الغلاف، المكوّنات المرجعية، M2، طبقة الهوية
  foundation/index.html         مستكشف الأساس الموحّد (المرحلة 1) فوق رموز v3 حرفياً
  foundation/screens/           28 لقطة 2× (الشاشات الأربع، جوال/لوحي/محمول/2560، داكن، LTR، الهوية)
  foundation/checks.json        نتائج 151 تهيئة + 24 اختبار تفاعل + قياسات M2 وعقد الهوية
  scripts/foundation.mjs        فحوص المرحلة 1 (مصفوفة + تفاعل + لقطات)
  directions-v2/index.html      مستكشف V2 التفاعلي (هويات جديدة كلياً)
  directions-v2/screens/        لقطات 2× (جوال، محمول، عريض 2560) + لوحي/LTR/حالات
  directions/index.html         مستكشف الاتجاهات التفاعلي (ملف واحد، بلا تبعيات بناء)
  directions/screens/           لقطات Phone/Tablet/Laptop/Dark/LTR/States
  directions/checks.json        نتائج فحص الأخطاء والتجاوز وaxe-core
  directions/perf.json          قياس زمن العرض
  scripts/capture.mjs           فحص المصفوفة الكاملة + اللقطات
  scripts/interactions.mjs      اختبارات تفاعل حقيقية (نقر/لوحة مفاتيح)
```

## التشغيل

```bash
# افتح مباشرة في المتصفح
open design-lab/directions/index.html      # أو xdg-open على Linux

# الفحوص: Playwright من التثبيت العام أو من web/node_modules (بعد npm ci في web/)، وaxe-core من web/node_modules.
# إن لم يكن متصفح Playwright المطابق مثبّتاً: CHROMIUM_PATH=/path/to/chrome node …
# capture.mjs يخرج برمز 1 عند أي خطأ صفحة أو تمرير أفقي أو مخالفة axe؛ interactions.mjs عند أي اختبار فاشل.
node design-lab/scripts/capture.mjs            # 84 تهيئة: أخطاء + تجاوز أفقي + WCAG
node design-lab/scripts/capture.mjs --shots    # + لقطات PNG (المحفوظة في المستودع مُحوَّلة إلى WebP للحجم)
node design-lab/scripts/interactions.mjs       # 43 اختبار تفاعل
LAB=v2 node design-lab/scripts/capture.mjs --shots --scale=2   # مصفوفة V2 (87 تهيئة) + لقطات 2×
LAB=v2 node design-lab/scripts/interactions.mjs                # 43 اختبار تفاعل على V2
node design-lab/scripts/foundation.mjs                         # المرحلة 1: 151 تهيئة + 24 اختبار تفاعل
node design-lab/scripts/foundation.mjs --shots --scale=2       # + 28 لقطة WebP
ONLY=mash/inv LAB=v2 node design-lab/scripts/capture.mjs --shots  # إعادة تصوير شاشة واحدة (لا يمثّل المصفوفة الكاملة)
```

## المراحل

| المرحلة | الحالة | الناتج |
|---|---|---|
| 0 — الاكتشاف والاتجاهات | مكتملة · **لم يُعتمد أي اتجاه** | تدقيق + 3 اتجاهات (قلم، ميزان، فجر) |
| 0.2 — الاستكشاف البصري V2 | مكتمل · تجريبي غير معتمد | 3 هويات جديدة (أسطرلاب، مشربية، كوفي) + مستكشف + تقرير |
| 0.3 — البحث واستراتيجية النظام الموحّد | **مكتمل · بانتظار الاعتماد** | بحث 12 مصدراً + تقييم بالأدلة + معمارية موحّدة + مصفوفة الوحدات + خطة V3 + قرارات M1–M12 |
| 1 — Unified UX Foundation | **مكتملة في المختبر · بانتظار المراجعة** | غلاف موحّد + مكوّنات مرجعية + مقارنة M2 مقاسة + طبقة هوية L4 بمدقّق عقد + 4 شاشات إثبات. M2 غير معتمد، ولا تفعيل لـ v3 (M8) |
| 2 — خارطة الترحيل | لم تبدأ | مهام مستقلة قابلة للدمج في `web/` عبر v3 |

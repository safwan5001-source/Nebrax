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
ONLY=mash/inv LAB=v2 node design-lab/scripts/capture.mjs --shots  # إعادة تصوير شاشة واحدة (لا يمثّل المصفوفة الكاملة)
```

## المراحل

| المرحلة | الحالة | الناتج |
|---|---|---|
| 0 — الاكتشاف والاتجاهات | مكتملة · **لم يُعتمد أي اتجاه** | تدقيق + 3 اتجاهات (قلم، ميزان، فجر) |
| 0.2 — الاستكشاف البصري V2 | **مكتمل · بانتظار الاعتماد** | 3 هويات جديدة (أسطرلاب، مشربية، كوفي) + مستكشف + تقرير |
| 1 — نظام التصميم + النموذج الكامل | لم تبدأ (بوابة اعتماد) | تطبيق مستقل يغطي الوحدات العشر + توثيق النظام |
| 2 — خارطة الترحيل | لم تبدأ | مهام مستقلة قابلة للدمج في `web/` عبر v3 |

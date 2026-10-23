# AWJ ERP — P3-A-02 Implementation Report

**المهمة:** Storefront Background Contract & Compatibility

**المستودع:** `safwan5001-source/Nebrax`

**الحالة:** مكتملة برمجيًا، والـ PR مفتوح للمراجعة — لم يتم الدمج أو النشر.

## ملخص التنفيذ

استُكملت المهمة انطلاقًا من أحدث `main` عند SHA `99f0935d085a19eaf54a232401aca62d02632bd7`. أُضيف عقد مستقل باسم `StorefrontBackground` لمستوى مستند العرض، مع دعم `solid` و`gradient` و`media` ومرجع وسائط للجوال وطبقة لونية محدودة. العقد مستقل عن `SectionBackground` الحالي ولم يُعدّل ذلك العقد.

تم توحيد التمثيل القانوني للمطبع المباشر: يعيد TypeScript وPHP القيمة `null` عند غياب الخلفية أو عدم صلاحيتها. أما إعداد العرض النهائي فيحتفظ بالحقل الاختياري غائبًا عند عدم وجود قيمة صالحة، ولذلك لا يُضاف مفتاح `background` إلى المستندات القديمة. ظل `backgroundColor` محفوظًا، وتظل الخلفية الجديدة ذات الأولوية عند وجودها وصلاحيتها البنيوية.

أضيف تحقق صارم قبل أن يسقط المطبع المتساهل أي خلفية مؤلفة غير صالحة، وربط هذا التحقق بمسارات حفظ المسودة والنشر القديم وحفظ النسخ والنشر والجدولة والتنفيذ المجدول. لا توجد Migration أو تغييرات في قاعدة البيانات.

## الملفات الجديدة والمعدلة

### ملفات جديدة

- `app/Support/Commerce/StorefrontBackgroundNormalizer.php` — السلطة PHP لعقد الخلفية وتحققه.
- `web/src/modules/store-experience-builder/presentation/storefront-background.ts` — عقد ومطبع Web.
- `storefront/src/lib/presentation/storefront-background.ts` — توأم العقد في Storefront، مطابق بايتًا ببايت مع نسخة Web.
- `tests/Fixtures/presentation/storefront-background.json` — fixture مشتركة للحالات العابرة للغات.
- `web/src/modules/store-experience-builder/__tests__/storefront-background.test.ts` — اختبارات Web.
- `storefront/src/lib/presentation/__tests__/storefront-background.test.ts` — اختبارات Storefront.
- `deliverables/AWJ_STOREFRONT_BACKGROUND_P3A02_IMPLEMENTATION_REPORT.md` — هذا التقرير.

### ملفات معدلة

- `web/src/modules/store-experience-builder/presentation/config.ts` — إدراج العقد الجديد مع إبقاء `backgroundColor` والتوافق القديم.
- `storefront/src/lib/presentation/config.ts` — الإدراج المناظر في Storefront.
- `app/Support/Commerce/StorefrontPresentationNormalizer.php` — تطبيع الخلفية الجديدة بصورة additive.
- `app/Support/Commerce/StorefrontPresentationPublishValidator.php` — رفض authored background غير الصالحة قبل الإسقاط الصامت.
- `app/Services/Commerce/StorefrontPresentationService.php` — تغطية الحفظ والنشر القديم.
- `app/Services/Commerce/StorefrontPresentationVersionService.php` — تغطية حفظ النسخ والنشر والجدولة والتنفيذ المجدول.
- `tests/Feature/StorefrontPresentationNormalizerTest.php` — اختبارات PHP للـ fixture والأولوية والتوافق.

لم تُعدّل `SectionBackground` أو `presentationCssVars` أو renderer أو media resolver أو UI أو قاعدة البيانات.

## الملفات المستعادة من ZIP وما أُعيد بناؤه

استُخدمت الحزمة كمرجع فقط ولم تُنسخ بصورة عمياء، لأن مساراتها كانت مسطحة ولأنها غير مختبرة. أُعيد استخدام منطق الملفات التالية بعد تحديد المسارات الفعلية:

- `StorefrontBackgroundNormalizer.php` أُعيد وضعه تحت `app/Support/Commerce/`.
- `storefront-background.ts` أُعيد بناؤه كتوأم مستقل في مساري Web وStorefront، مع إصلاح `null`/`undefined` وتنسيق Biome.
- `storefront-background.test.ts` أُعيد بناؤه كاختبارين بمواضع import صحيحة لكل حزمة.
- `storefront-background.json` أُعيد وضعه تحت `tests/Fixtures/presentation/`.
- فروقات `StorefrontPresentationNormalizer.php` و`StorefrontPresentationNormalizerTest.php` و`StorefrontPresentationPublishValidator.php` وخدمتي العرض والنسخ طُبّقت على نسخ `main` الحالية، لا على نسخ ZIP مباشرة.

لم تُستخدم نسخة ZIP من `config.ts` أو `media-ref.test.ts` لأنها كانت تشير إلى ملفات/مسارات أخرى أو تتضمن تغييرات غير مرتبطة بالمهمة. لم تُستبدل ملفات المشروع الحالية بها.

## نتائج الاختبارات وBuild وCI

### محليًا

- Web contract test: **نجح — 10/10**.
- Storefront contract test: **نجح — 10/10**.
- Web `npm run build`: **نجح**، مع فحص TypeScript.
- Storefront Biome check بعد الإصلاح: **نجح**.
- Storefront contract test بعد الإصلاح: **نجح — 10/10**.
- Storefront build المحلي وصل إلى TypeScript compilation، لكنه أظهر أخطاء إعداد بيئة عند توليد الصفحات بسبب عدم ضبط `SPREE_API_URL` و`AWJ_COMMERCE_API_URL`. لم تُعتبر تلك النتيجة نجاح Build محليًا كاملًا.
- PHP لم يكن مثبتًا في Sandbox، لذلك لم تُدّعَ اختبارات PHP محليًا.

### GitHub Actions — PR #1568

الدورة النهائية بعد إصلاح Biome نجحت بالكامل: **9/9 فحوص ناجحة، 0 فاشلة، 0 معلّقة**.

- PHP Laravel 11 على SQLite: **ناجح**.
- PHP Laravel 11 على PostgreSQL: **ناجح**.
- Storefront CI — lint + typecheck + unit tests: **ناجح** في تشغيلَي push وpull request.
- Web CI — Next.js build: **ناجح** في تشغيلَي push وpull request.
- Store Brand QA — merchant preview visual QA: **ناجح**.
- Store Brand QA — published footer visual QA: **ناجح**.
- CI Gate: **ناجح**.

الدورة الأولى فشلت بسبب تنسيق واستيرادات Biome في الملف الجديد فقط؛ أُصلح ذلك في الالتزام الثاني، ثم نجحت الدورة النهائية كاملة. لا توجد اختبارات CI معلقة أو فاشلة حاليًا.

## المخاطر والأعمال المتبقية

- لا يزال تنفيذ UI أو Renderer أو Media Resolver خارج هذه المهمة؛ العقد والتطبيع فقط أصبحا جاهزين لهذه الشرائح اللاحقة.
- تحقق readiness/evidence والتباين الخاص بخلفية media في renderer/publish gate المتخصص لم يُنفذ هنا لأنه يتطلب شريحة مستقلة خارج نطاق Contract وNormalization وCompatibility.
- Storefront build المحلي يحتاج متغيرات البيئة الخاصة بخدمات Spree وAWJ Commerce؛ هذا ليس فشلًا في عقد الخلفية، وقد أثبت CI فحص Storefront المطلوب بنجاح.
- لا توجد Migration، ولا تغيير في Tenant Isolation أو قواعد التحقق الأمني.
- لا ينبغي دمج PR قبل مراجعة المالك رغم نجاح CI.

## Branch وPR وSHAs

- **Branch:** `claude/p3-a-02-storefront-background-contract`
- **PR:** [#1568 — خلفية المتجر العامة تلتزم بعقد موحّد وآمن](https://github.com/safwan5001-source/Nebrax/pull/1568)
- **Base SHA:** `99f0935d085a19eaf54a232401aca62d02632bd7`
- **Head SHA:** `e16e7de90fe21c1c7b659cc8a5d10d057906f58e`
- **حالة PR:** مفتوح، `CLEAN`، غير مدموج، وغير منشور.

## الخطوة التالية المقترحة

مراجعة PR #1568 من المالك، مع التركيز على قرار العقد و`null` canonical وأولوية `background` على `backgroundColor`. بعد الموافقة الصريحة فقط يمكن للمالك دمج PR؛ ولا يُنفذ أي UI أو Renderer أو Media Resolver ضمن هذه المهمة الحالية.

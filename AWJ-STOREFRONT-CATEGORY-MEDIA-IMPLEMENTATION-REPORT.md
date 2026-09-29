# Implementation Report — Storefront Category Image & Color Presentation

## الحالة

تم تنفيذ المهمة على مستودع **أَوْج / Nebrax** من أحدث `origin/main`، وفتح Branch وPR مستقلين. لا يوجد Merge أو Deploy.

## Git / PR

| الحقل | القيمة |
|---|---|
| Base SHA | `7bd9e904` (`origin/main` عند بدء التنفيذ) |
| Branch | `fix/storefront-category-image-color` |
| Head SHA | `a768c5c17d5960393d9c7931e94f9a574988ca45` |
| PR | [#1110 — Fix AWJ storefront category image and color presentation](https://github.com/safwan5001-source/Nebrax/pull/1110) |
| Merge | لم يتم |
| Deploy | لم يتم |

## السبب الجذري

كان عقد `store/v1/categories` يعيد اللون فقط، ولا يوفّر مساراً عاماً آمناً لصورة الفئة. لذلك كان storefront يعرض صورة افتراضية/عرضاً محايداً بدلاً من صورة التاجر أو لونه المعتمد.

أثناء مراجعة CI ظهر أثر جانبي مهم: `CommerceCategoryController` يعيد استخدام `StorefrontCategoryResource`، وإضافة المفتاح `image` بشكل دائم كسرت عقد OpenAPI المغلق لمسار `commerce/v1` (`image` حقل فعلي غير موثّق). عولج ذلك بجعل `image` إسقاطاً إضافياً لمسارات `storefront.v1.*` فقط، مع إبقاء عقد commerce/mobile كما هو.

## التنفيذ

- إضافة إسقاط `image: { url, alt } | null` إلى عقد storefront فقط، مع عدم كشف `image_path` الداخلي.
- إضافة endpoint عام `store/v1/media/categories/{id}`، ونسخة legacy غير الإنتاجية، مع:
  - التحقق من الفئة النشطة.
  - التحقق من نشر الفئة على قناة المتجر المحلولة.
  - عزل المستأجر/السياق عبر `StorefrontContext` و`BranchScope`.
  - بث الملف من `DocumentStorageService` وإرجاع 404 عند الغياب أو عدم النشر أو فشل القراءة.
- تمرير الصورة واللون عبر TypeScript mapper مع بقاء الصورة اختيارية وعدم توليد صور اصطناعية.
- تطبيق أولوية العرض: **صورة التاجر، ثم اللون المعتمد بعد التحقق، ثم العرض المحايد**.
- تحقيق parity في معاينتي customizer وweb builder.
- إضافة اختبارات backend لعقد صورة الفئة والعزل، واختبارات storefront للـ mapper وحالات العرض الثلاث.

## الملفات المعدلة

- `app/Http/Controllers/Api/StorefrontMediaController.php`
- `app/Http/Resources/StorefrontCategoryResource.php`
- `routes/api_storefront.php`
- `tests/Feature/StorefrontCategoryMediaTest.php`
- `storefront/src/lib/commerce/types.ts`
- `storefront/src/lib/commerce/mappers.ts`
- `storefront/src/lib/commerce/__tests__/mappers.test.ts`
- `storefront/src/components/home/CategoriesSection.tsx`
- `storefront/src/components/home/__tests__/CategoriesSection.test.tsx`
- `storefront/src/components/customizer/StorefrontPreviewCanvas.tsx`
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx`

## الاختبارات والنتائج

| الفحص | النتيجة |
|---|---|
| PHP syntax checks للملفات المعدلة | نجح: لا أخطاء syntax في الملفات الثلاثة |
| `git diff --check` | نجح |
| Storefront focused Vitest | نجح: 2 test files، 31/31 tests |
| Storefront full `pnpm test` | نجح: 98 test files، 663/663 tests |
| Storefront `pnpm check` | نجح |
| Storefront locale parity | نجح |
| Storefront TypeScript `tsc --noEmit` | نجح |
| Web `npm run test` | نجح: 321 test files، 2334/2334 tests |
| Web `npm run build` | نجح، مع lint/type validation و179 صفحة مولّدة |
| Storefront production build محلياً | اكتمل التجميع وفحص TypeScript، لكن خطوة prerender أظهرت رسائل بيئية متوقعة لغياب `SPREE_API_URL` و`AWJ_COMMERCE_API_URL`؛ هذا الأمر ليس جزءاً من Storefront CI، وقد نجحت فحوصات CI المعتمدة |

## CI / الإصلاح اللاحق

الجولة الأولى من CI فشلت في Laravel لأن عقد OpenAPI الخاص بـ commerce رفض المفتاح غير الموثق `image` في اختبارين. اختبار `StorefrontCategoryMediaTest` نفسه مرّ.

بعد قصر الحقل على مسارات `storefront.v1.*` ودفع `a768c5c1`، اكتملت الجولة الأحدث بنجاح **8/8 checks**:

- CI — `php artisan test (L11, sqlite)`: **passed**
- CI — `php artisan test (L11, pgsql)`: **passed**
- Storefront CI — lint/typecheck/test: **passed**
- Web CI — Next.js build: **passed**
- Store Brand QA — merchant preview visual QA: **passed**
- Store Brand QA — published footer visual QA: **passed**

## المخاطر والمتبقي

- صور الفئات القديمة التي لا تملك `image_path` ستستمر في استخدام اللون أو العرض المحايد، وهذا مقصود ومتوافق للخلف.
- تعتمد الصورة على توفر التخزين الذي يستخدمه `DocumentStorageService` وعلى نشر الفئة في قناة المتجر؛ أي فشل يعيد 404 بشكل fail-closed.
- لم تتم إضافة migration جديدة؛ الحقول الموجودة في `ProductCategory` استُخدمت كما هي.
- لا توجد أعمال متبقية مطلوبة ضمن نطاق المهمة.

## تأكيد النطاق

تم فتح Branch وPR مستقلين فقط. **لم يتم Merge، ولم يتم Deploy، ولم تُجرَ أي تغييرات جانبية خارج نطاق المهمة.**

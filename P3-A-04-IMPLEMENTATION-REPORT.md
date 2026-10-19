# P3-A-04 — Global Background Renderer & Preview Parity

## الملخص التنفيذي

أُضيف resolver محدود وآمن لعرض الخلفية العامة الصلبة والتدرجية في معاينة Store Experience Builder وفي wrapper المتجر المنشور. يحافظ على `backgroundColor` القديم عند غياب العقد الجديد، يحل ألوان `ColorRef` من الأدوار أو قيم hex المطَبّعة، ويعكس الاتجاهات المنطقية `to-start`/`to-end` بين RTL وLTR. كما أضيفت اختبارات resolver للطرفين.

**هذه المراجعة ليست تنفيذًا مكتملًا لمتطلبات P3-A-04 ولا ينبغي دمجها بوصفها مكتملة.** لم يتم تنفيذ رسم خلفية الوسائط، اختيار المصدر المحمول، focal point، overlay، ولا إثبات تكافؤ الصفحات/المسارات أو المرئي. أُبقيت الوسائط fail-closed ولم يُمسّ حاجز النشر `global_media_background_not_ready`. أُنشئ PR مسودة لتقييم/مراجعة الجزء المنجز فقط؛ يلزم استكمال البنود المتبقية في PR قبل الدمج.

## ما نُفّذ

- `resolveStorefrontBackgroundStyle` في Web وStorefront: يخرج CSS فقط من عقد مطبّع؛ solid يخرج `backgroundColor`، وgradient ينتج `linear-gradient()` باستخدام `cssGradientDirection` الحالي، والغياب يحافظ على لون الخلفية القديم.
- ربط الـresolver بجذر `StorefrontPreviewCanvas` وبـtheme wrapper في مجموعة `(storefront)` المنشورة. التعديل في layout يخص مجموعة storefront فقط، وليس checkout/account/wholesale.
- اختبار legacy fallback، solid، التدرج وعكس اتجاه `to-end` في RTL/LTR، والسلوك fail-closed للوسائط.

## الملفات المعدلة

- `web/src/modules/store-experience-builder/presentation/storefront-background-render.ts` — resolver.
- `web/src/modules/store-experience-builder/StorefrontPreviewCanvas.tsx` — تطبيق ناتج resolver على canvas.
- `web/src/modules/store-experience-builder/__tests__/storefront-background-render.test.ts` — اختبارات resolver.
- `storefront/src/lib/presentation/storefront-background-render.ts` — نظير resolver للـruntime المنشور.
- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx` — تمرير الناتج إلى theme wrapper.
- `storefront/src/lib/presentation/__tests__/storefront-background-render.test.ts` — اختبارات resolver المنشور.

لم تُعدل ملفات PHP أو قواعد البيانات أو بوابة النشر.

## المعمارية والدليل

الـresolver وظيفة pure تتلقى الـpresentation وdir، وتعيد خصائص CSS محددة. تستعمل `resolveRoleHex` لحل الأدوار، و`cssGradientDirection` نفسه الذي يطبق دلالات الاتجاه المنطقي المعتمدة. لا تقرأ الدالة URL من العقد ولا تبني CSS من نص غير موثوق. قيم المتجر المنشور تدخل عبر `readPublishedPresentation`/`normalizePresentationConfig` الموجودين. طبقة Web preview تستخدم نفس قواعد حل اللون/الاتجاه ونفس شكل الناتج؛ ومع ذلك لم تُثبت مطابقة DOM/pixels عمليًا.

## الاختبارات والبناء

- Web: `vitest run` على اختبار renderer الجديد، اختبارات contract الحالية، واختبار خلفية Canvas: **3 ملفات، 22 اختبارًا ناجحًا**.
- `git diff --check`: ناجح.
- TypeScript الشامل في Web: **غير ناجح**؛ كشف أخطاء TypeScript موجودة في عدة اختبارات أخرى (مثل قيم `decorative: boolean` مقابل literal `true`). جرى إصلاح أخطاء الأنواع الخاصة بالـresolver، لكن لا يمكن وصف فحص المشروع كاملًا بأنه ناجح.
- اختبارات Storefront: لم تعمل. مجلد Storefront لا يحتوي `vitest` مثبتًا، ومحاولة التثبيت توقفت لأن pnpm رفض سكربتات البناء (esbuild/core-js). محاولة تشغيل Vitest Web على إعداد Storefront توقفت لغياب `@vitejs/plugin-react`.
- Build/CI: لم يُشغّل بنجاح أو يُثبت.
- Visual QA/screenshots: لم تُجرَ؛ لذلك لا يوجد ادعاء بتكافؤ إنتاجي أو بصري.

## المخاطر والنواقص التي تمنع اعتبار P3-A-04 مكتملة

1. خلفية media غير مرسومة في المعاينة أو runtime؛ لا اختيار desktop/mobile، لا focal point، ولا overlay. resolver يعيد fallback فقط عمدًا.
2. لم تُضف اختبارات صفحات homepage/product/category/content أو تأكيد عدم التعرض في checkout/account/wholesale، ولا اختبارات header/footer/cards/sections unaffected.
3. لم يجرِ اختبار end-to-end أو لقطة مرئية تثبت التكافؤ.
4. اختبارات Storefront والبناء وCI غير متاحة في هذه البيئة الحالية بسبب تبعيات/بناء الحزم.
5. يلزم تأكيد أن لون fallback الثابت `#f8f9fa` مناسب فقط عندما تكون الخاصية legacy غير موجودة؛ إعدادات normalized الحالية تعيّن اللون الافتراضي.

## النشر الآمن

لم تتغير `global_media_background_not_ready` ولا validator PHP. وسائط الخلفية تظل draft-only، ولم يُنشأ أي synthetic media أو endpoint أو URL مخزن. لا Merge ولا Deploy ولا Production Release.

## بيانات PR

- Branch: `p3-a-04-global-background-renderer`
- PR: https://github.com/safwan5001-source/Nebrax/pull/1570 (Draft)
- Base: `main` — SHA `8c74051b5e6d0c917babf97902954c1dc9b16ee2`
- Head (initial implementation commit): `eb224df58a3507a3d5d8b3c9a7122efc6508a7ae`

هذا PR مسودة جزئية فقط، وليس جاهزًا للدمج حتى استكمال وسائط الخلفية والاختبارات/التحقق المبين أعلاه.

## المرحلة التالية الموصى بها

استكمال P3-A-04 قبل الدمج: وصل `background.media` و`background.mobile` إلى مصدر Web preview الآمن وإلى `presentation_media` المنشور (إذا وُجد تفويض صالح فقط)، عرض stills باستخدام proxy/responsive sources الحالية دون animation/eager loading، تطبيق overlay وfocal point بنفس semantics، ثم تغطية routes/surfaces المطلوبة وإجراء اختبارات Storefront وtypecheck/build وvisual QA. الإبقاء على حاجز نشر الوسائط دون تغيير؛ تسليم إجازة النشر/contrast لـP3-A-06.

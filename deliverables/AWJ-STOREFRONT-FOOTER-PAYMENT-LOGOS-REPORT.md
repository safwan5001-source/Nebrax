# AWJ ERP — Storefront Footer Payment Logos

## ما تم

- أضيف إعداد `footer.paymentLogos` اختياري داخل وثيقة مظهر المتجر الحالية، من دون صفحة أو نظام تخصيص جديد.
- الإعداد يدعم التشغيل والإيقاف، واختيار وترتيب `mada` و`visa` و`mastercard` و`apple_pay`، وثلاثة أنماط (`inline` و`cards` و`strip`)، وثلاثة أحجام، وإظهار العنوان أو إخفاءه.
- غياب الإعداد يحافظ على المتاجر القائمة كما هي ويعطّل العرض افتراضيًا. عند أول تفعيل تكون البطاقات والحجم المتوسط والعنوان والشعارات الأربعة هي القيم الافتراضية.
- رُبط الإعداد بالمحرر الحالي والمعاينة المباشرة وبمسار الحفظ والنشر الحالي، ثم بالتذييل المنشور لكل متجر.
- أضيف شريط أفقي `nowrap` قابل للتمرير داخل عرضه على الجوال، مع محاذاة منطقية تصلح لـRTL وLTR، وأس surfaces بيضاء ثابتة للبطاقات/الشريط في الوضعين الفاتح والداكن.
- تُحفظ نسب الشعارات وألوانها، ولا تُمدّد (`height` محدد و`width: auto`).
- يعيد محرر Web استخدام سجل العلامات الحالي. ينسخ Storefront أثناء `predev` و`prebuild` الملفات الأربعة فقط من `web/public/payment-brands/` إلى مجلد عام مولّد ومتجاهل من Git، فلا توجد نسخة أصول ثانية في المستودع.
- التغيير عرض بصري Beta فقط؛ لا يقرأ تفعيل Moyasar، ولا يغيّر Checkout، ولا ينشئ PaymentIntent، ولا يلمس المحاسبة أو المخزون أو ZATCA.

## الملفات المتغيرة

### العقد والحفظ

- `app/Support/Commerce/StorefrontFooterNormalizer.php`
- `tests/Fixtures/presentation/footer-design.json`
- `web/src/modules/store-experience-builder/presentation/payment-logos.ts`
- `web/src/modules/store-experience-builder/presentation/footer-design.ts`
- `web/src/modules/store-experience-builder/footer-edit.ts`
- `storefront/src/lib/presentation/payment-logos.ts`
- `storefront/src/lib/presentation/footer-design.ts`

### المحرر والمعاينة

- `web/src/modules/store-experience-builder/FooterEditor.tsx`
- `web/src/modules/store-experience-builder/CanvasFooter.tsx`
- `web/src/modules/store-experience-builder/CanvasPaymentLogos.tsx`
- `web/src/modules/store-experience-builder/messages.ts`

### المتجر المنشور والأصول والترجمة

- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx`
- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/FooterPaymentLogos.tsx`
- `storefront/scripts/sync-payment-brands.mjs`
- `storefront/package.json`
- `storefront/messages/{ar,en,de,es,fr,pl}.json`
- `.gitignore`

### الاختبارات

- `web/src/modules/store-experience-builder/__tests__/footer-design.test.ts`
- `web/src/modules/store-experience-builder/__tests__/footer.editor.test.tsx`
- `web/src/modules/store-experience-builder/__tests__/footer.canvas.test.tsx`
- `storefront/src/lib/presentation/__tests__/footer-design.test.ts`
- `storefront/src/components/layout/FooterPaymentLogos.test.tsx`
- `storefront/src/components/layout/Footer.test.tsx`
- `tests/Feature/StorefrontFooterDesignTest.php`
- `tests/Feature/StorefrontPresentationDraftApiTest.php`
- `tests/Feature/StorefrontPresentationPublishApiTest.php`

## الاختبارات والنتائج

- Web — اختبارات عقد/محرر/معاينة التذييل: **83 ناجحًا**.
- Storefront — اختبارات العقد والمكوّن والتذييل والتوافق القديم والتخطيطات: **98 ناجحًا**.
- تطابق مفاتيح اللغات الست: **ناجح**.
- Biome للملفات المتغيرة في Storefront: **ناجح**.
- `git diff --check`: **ناجح**.
- تطابق توأمي `payment-logos.ts` و`footer-design.ts` بين Web وStorefront: **ناجح**.
- اختبارات PHP المطلوبة أضيفت للعقد، ودورة الحفظ/إعادة التحميل/النشر، وعزل متجرين. لم تعمل محليًا لأن بيئة التسليم لا تحتوي PHP ولا Composer manifest/vendor للتطبيق؛ يلزم اعتماد نتيجتها من CI.

## Build / CI

- Web production build (Next.js 15.5.19): **ناجح بالكامل**؛ شمل فحص الأنواع وتوليد 204 صفحات.
- Storefront production build (Next.js 16.2.11، Webpack): **نجح التجميع** ثم توقف فحص Next النهائي بسبب export قائم خارج النطاق في `account/(authenticated)/layout.tsx`. كشف الفحص أيضًا exports قائمة في مساري media API؛ لم تُعدّل ضمن هذه المهمة.
- Turbopack عُلّق أثناء محاولة بلا شبكة؛ أعيد التحقق بـWebpack مع السماح المقيد بخطوط Google.
- CI على PR: يُراجع بعد رفع تقرير التسليم، ولا Merge ولا Deploy ضمن هذه المهمة.

## المخاطر والمتبقي

- سجل العلامات الحالي يضع حقوق Apple Pay في حالة `granted`، بينما mada وVisa وMastercard في حالة `unverified`. الميزة تعيد استخدام الأصول كما هي ولا توسّع الحقوق؛ يلزم استبدالها بالأصول الرسمية عند الحصول عليها وفق سياسة السجل.
- تعتمد مزامنة Storefront على بنية monorepo الحالية (`storefront` بجوار `web`) ويحرسها فشل `predev/prebuild` إذا غاب المصدر.
- قبل استقبال عملاء حقيقيين يجب إعادة تقييم سياسة عرض الشعارات وربطها بوسائل الدفع المقبولة فعليًا عند الحاجة. لم تُبنَ هذه المرحلة الإضافية الآن التزامًا بنطاق Beta.
- يلزم إغلاق أخطاء Next القائمة خارج النطاق لكي يصبح Storefront build أخضر بالكامل، ثم تأكيد اختبارات PHP في CI.

## GitHub

- Branch: `feat/storefront-footer-payment-logos`
- PR: [#1733](https://github.com/safwan5001-source/Nebrax/pull/1733)
- Base: `main`
- Base SHA: `74ce4e9095739e61a8aa91a9100a1aa0a57f7c0c`
- Implementation Head SHA وقت إنشاء PR: `9df7cc5f8077b6132370709f832cd082884ed9fa`
- لا Merge ولا Deploy.

## الخطوة التالية

مراجعة CI ونتائج اختبارات PHP على PR #1733، ثم معالجة أي فشل يخص هذه الميزة فقط وطلب موافقة المالك قبل الدمج أو النشر.

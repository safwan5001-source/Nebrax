# AWJ ERP — Storefront Footer Payment Logos

## ما تم

- أضيف إعداد `footer.paymentLogos` اختياري داخل وثيقة مظهر المتجر الحالية، من دون صفحة أو نظام تخصيص جديد.
- الإعداد يدعم التشغيل والإيقاف، واختيار وترتيب `mada` و`visa` و`mastercard` و`apple_pay`، وثلاثة أنماط (`inline` و`cards` و`strip`)، وثلاثة أحجام، وإظهار العنوان أو إخفاءه.
- غياب الإعداد يحافظ على المتاجر القائمة كما هي ويعطّل العرض افتراضيًا. عند أول تفعيل تكون البطاقات والحجم المتوسط والعنوان والشعارات الأربعة هي القيم الافتراضية.
- رُبط الإعداد بالمحرر الحالي والمعاينة المباشرة وبمسار الحفظ والنشر الحالي، ثم بالتذييل المنشور لكل متجر.
- أضيف شريط أفقي `nowrap` قابل للتمرير داخل عرضه على الجوال، مع محاذاة منطقية تصلح لـRTL وLTR، وأسطح بيضاء ثابتة للبطاقات/الشريط في الوضعين الفاتح والداكن.
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
- `web/src/modules/store-experience-builder/store-preview.css`

### المتجر المنشور والأصول والترجمة

- `storefront/src/app/[country]/[locale]/(storefront)/layout.tsx`
- `storefront/src/components/layout/Footer.tsx`
- `storefront/src/components/layout/FooterPaymentLogos.tsx`
- `storefront/src/app/globals.css`
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
- Design drift ratchet بعد استبدال ألوان TSX الثابتة بسطح شعارات دلالي: **ناجح**.
- `git diff --check`: **ناجح**.
- تطابق توأمي `payment-logos.ts` و`footer-design.ts` بين Web وStorefront: **ناجح**.
- اختبارات PHP المطلوبة أضيفت للعقد، ودورة الحفظ/إعادة التحميل/النشر، وعزل متجرين. لم تعمل محليًا لأن بيئة التسليم لا تحتوي PHP ولا Composer manifest/vendor للتطبيق. في CI: SQLite **ناجح** (18:38)، وPostgreSQL **ناجح في الإعادة على SHA نفسه** (19:00) بعد فشل أول عابر لم يعرض GitHub له test annotation قابلًا للتشخيص.

## Build / CI

- Web production build (Next.js 15.5.19): **ناجح بالكامل**؛ شمل فحص الأنواع وتوليد 204 صفحات.
- Storefront production build المحلي (Next.js 16.2.11، Webpack): **نجح التجميع** ثم توقف فحص Next النهائي بسبب export قائم خارج النطاق في `account/(authenticated)/layout.tsx`. الفحص الرسمي `storefront (lint + typecheck + test)` في CI: **ناجح** في تشغيلَي `push` و`pull_request`.
- CI للمعاينة: `merchant preview visual QA` و`published footer visual QA`: **ناجحان**.
- PHP CI: SQLite **ناجح**، وPostgreSQL **ناجح بعد إعادة الوظيفة الفاشلة وحدها على SHA نفسه**؛ لم يتكرر الفشل الأول.
- Web CI: **فاشل بسبب قاعدة الفرع، لا بسبب الميزة**. التعليق الوحيد بعد إصلاح design drift هو `openapi-model.drift.test.ts`: أضاف commit القاعدة #1731 رموز `payment_unavailable` و`payment_not_payable` و`payment_provider_unavailable` من دون تحديث نموذج OpenAPI الملتزم. لم يُعدّل لأنه متعلق بأفق المدفوعات وخارج نطاق هذا PR.
- `CI Gate`: **فاشل تبعًا لفشل Web أعلاه**. لا Merge ولا Deploy ضمن هذه المهمة.

## المخاطر والمتبقي

- سجل العلامات الحالي يضع حقوق Apple Pay في حالة `granted`، بينما mada وVisa وMastercard في حالة `unverified`. الميزة تعيد استخدام الأصول كما هي ولا توسّع الحقوق؛ يلزم استبدالها بالأصول الرسمية عند الحصول عليها وفق سياسة السجل.
- تعتمد مزامنة Storefront على بنية monorepo الحالية (`storefront` بجوار `web`) ويحرسها فشل `predev/prebuild` إذا غاب المصدر.
- قبل استقبال عملاء حقيقيين يجب إعادة تقييم سياسة عرض الشعارات وربطها بوسائل الدفع المقبولة فعليًا عند الحاجة. لم تُبنَ هذه المرحلة الإضافية الآن التزامًا بنطاق Beta.
- يلزم إصلاح انحراف OpenAPI الخاص بـ#1731 في مساره الأصلي لكي يصبح Web CI/CI Gate أخضرين. لا ينبغي ضم ذلك الإصلاح إلى هذا PR المستقل.
- لو تكرر تذبذب PostgreSQL مستقبلًا، فمخرجات CI محفوظة في artifact باسم `test-output-pgsql`؛ إعادة هذه الدورة نجحت بلا تعديل للكود.

## GitHub

- Branch: `feat/storefront-footer-payment-logos`
- PR: [#1733](https://github.com/safwan5001-source/Nebrax/pull/1733)
- Base: `main`
- Base SHA: `74ce4e9095739e61a8aa91a9100a1aa0a57f7c0c`
- Feature Head SHA قبل تحديث التقرير: `76f458e1a3bbb585f8d78e4ea706a2fda438b58c`
- لا Merge ولا Deploy.

## الخطوة التالية

إصلاح انحراف OpenAPI في PR مستقل تابع لـ#1731، ثم إعادة تقييم بوابة CI وطلب موافقة المالك قبل أي دمج أو نشر.

# AWJ Storefront Product Media — Implementation Report

**التاريخ:** 2026-09-18
**المستودع:** `safwan5001-source/Nebrax`
**المثال المتحقق منه:** أناناس شرائح قودي 270 ج
**النطاق:** Product Media → Commerce Listing → Public Storefront API → Storefront mapping → Product Card / Product Detail

## Root Cause

بيانات الصورة ليست مفقودة من `Product Media` ولا يتم إسقاطها من الـPublic Storefront API. عند المنتج المنشور، يقوم `StorefrontProductController` بحل المعرض عبر `ProductMediaGalleryService`، ثم يضع أول وسيط في `thumbnail_url`، ويضع المعرض الكامل في `media` عند صفحة التفاصيل. كما أن `StorefrontProductResource::mediaPayload()` يحول كل وسيط إلى رابط `/store/v1/media/{id}` المحروس.

نقطة الانقطاع هي **الوصول إلى رابط الصورة من المتصفح**. المسار الإنتاجي `store/v1/media/{id}` يمر عبر `ResolveStorefrontDomain`، الذي يحسم Tenant/Storefront/SalesChannel من Host. عند استدعاء الـAPI من Next.js، يمرر الخادم ترويسة `X-Storefront-Forwarded-Host` مع سر بوابة خادمي. أما عند تحميل الصورة مباشرة من `<img>`، فلا يرسل المتصفح هذه الترويسة الخادمية؛ لذلك لا يستطيع Laravel حل سياق المتجر، وينتهي الطلب عادةً بـ404. النتيجة هي أن بيانات المنتج تصل بالاسم والسعر والتصنيف، بينما يفشل تحميل الصورة ويظهر الـplaceholder.

المشكلة ليست WebP: عقد الوسائط يحفظ `mime_type` ويخدم الملف من الـdisk، وWebP مدعوم كنوع صورة. وليست مشكلة placeholder أو تصميم؛ `ProductCard` يستخدم `product.thumbnail_url || null` بصورة صحيحة. كما أن Product Detail يعتمد على `media`، ولذلك كان معرضه معرضًا لنفس فشل الوصول المباشر.

## Repository Evidence

| المرحلة | الدليل | النتيجة |
|---|---|---|
| AWJ Product Media | `ProductMedia` يخزن `disk`, `path`, `mime_type`, `sort_order` مع عزل tenant | الصورة موجودة كصف بيانات قابل للحل |
| Gallery resolution | `ProductMediaGalleryService::resolveGallery()` يعيد وسائط المنتج بترتيب `sort_order`, `created_at`, `id` | primary/cover هو أول عنصر حتميًا |
| Commerce publication | `StorefrontProductController` يقرأ المنتجات المنشورة فقط على `salesChannelId()` ويشترط `is_active` | حدود النشر مستمرة |
| Public API listing | `StorefrontProductResource` يرسل `thumbnail_url` من أول gallery item حتى عندما تكون `detailed=false` | الصورة تخرج من API للقائمة |
| Public API detail | المورد يرسل `media` عند `detailed=true` | بقية الصور متاحة للتفاصيل |
| Media serving | `StorefrontMediaController` يتحقق من النشر، الـdisk، ووجود الملف قبل إرجاع البايتات | لا توجد bypass للصورة |
| Host resolution | `ResolveStorefrontDomain` يعتمد على Host أو forwarded host موثوق بسر خادمي | direct browser image request يفتقد السياق |
| Storefront UI | `ProductCard` يستهلك `thumbnail_url` و`MediaGallery` يستهلك `media` | لا يوجد إسقاط في مكوّنات العرض |

## What Was Changed

تم تنفيذ أصغر إصلاح ضمن حدود المشكلة: إضافة **Same-origin Next.js server proxy** لصور AWJ فقط.

1. أضيف المسار `storefront/src/app/api/storefront/media/[id]/route.ts`.
2. الـproxy يستقبل طلب الصورة من المتصفح، ويقرأ Host الوارد من طلب storefront على الخادم، ثم يستدعي نفس Laravel endpoint مع `X-Storefront-Forwarded-Host` و`X-Storefront-Gateway-Secret` من بيئة الخادم فقط.
3. بقيت كل قرارات النشر والعزل والتخزين في Laravel كما هي؛ الـproxy لا يقرأ storage مباشرة ولا يضيف نظام صور جديدًا.
4. أضيف في `mappers.ts` تحويل محدود فقط للروابط التي تطابق `/store/v1/media/{id}` إلى `/api/storefront/media/{id}`. أي URL آخر يبقى دون تغيير للتوافق الرجعي.
5. يستمر `thumbnail_url = null` عند غياب الصورة، وبذلك يستمر الـplaceholder الحالي.
6. لم تتغير Theme Tokens أو مكونات التصميم أو schema أو API publication queries.

## Files Changed

- `storefront/src/app/api/storefront/media/[id]/route.ts`
- `storefront/src/lib/commerce/mappers.ts`
- `storefront/src/lib/commerce/__tests__/mappers.test.ts`
- `tests/Feature/StorefrontCatalogApiTest.php`

لا توجد schema migrations، ولا تغييرات في الجداول، ولا refactoring خارج مسار الوسائط.

## API Contract Before / After

- **Laravel API contract:** لم يتغير. ما زال يعيد `thumbnail_url` و`media[].url` كرابط media محروس، ويستمر في تطبيق publication وtenant/storefront boundaries.
- **Storefront rendering boundary:** تغير داخليًا فقط: روابط Laravel media المعروفة يتم استهلاكها عبر proxy same-origin؛ الصور الخارجية لا تتغير.
- **No-image behavior:** لم يتغير؛ `null` يؤدي إلى placeholder الحالي.

## Tests Executed and Results

| الاختبار | النتيجة |
|---|---|
| `pnpm vitest run src/lib/commerce/__tests__/mappers.test.ts src/components/products/__tests__/ProductCard.test.tsx` | **PASS — 38 tests** |
| `pnpm exec tsc --noEmit` | **PASS** |
| `pnpm exec biome check ...` على الملفات المتغيرة | **PASS** |
| `pnpm build` داخل `storefront` | **PASS**؛ ظهر route `/api/storefront/media/[id]` في المخرجات |
| `php artisan test --filter='StorefrontCatalogApiTest|ProductMediaGalleryTest'` | **لم يُشغّل**: PHP غير مثبت في sandbox (`php: command not found`) |

يوجد تحذير React `act(...)` معروف في اختبار `ProductCard` الموجود مسبقًا؛ الاختبار نفسه نجح. أثناء build ظهرت تحذيرات بيئية عن غياب `AWJ_COMMERCE_API_URL` و`NEXT_PUBLIC_SITE_URL` في sandbox، لكن build اكتمل بنجاح ولم تكن هذه التغييرات سبب فشل.

## Tenant Isolation / Security Verification

- الـproxy لا يتجاوز `StorefrontMediaController` ولا يقرأ `ProductMedia.path` مباشرة.
- Laravel ما زال يشترط `CommerceListing.is_published=true` على قناة المتجر المحلولة قبل خدمة البايتات.
- Host المتجر يمر من Next.js server إلى Laravel عبر نفس header والسر الموجودين في `storefrontFetch()`؛ السر لا يصل إلى المتصفح.
- أي media id غير منشور أو غير موجود أو ملفه غير موجود يبقى 404 من Laravel، والـproxy يعيد status نفسه دون كشف إضافي.
- لا توجد إمكانية مقصودة لطلب media من tenant/storefront آخر عبر تغيير id فقط، لأن Laravel يعيد تطبيق سياق Host والنشر والعزل.
- الاختبار المضاف يثبت أن المنتج المنشور يعيد thumbnail في listing وgallery في detail، بينما اختبارات الكتالوج الحالية تغطي عدم كشف المنتجات غير المنشورة والقنوات/المستأجرين الآخرين.

## Risks / Remaining Issues

الخطر المتبقي منخفض: proxy الصور يضيف hop خادميًا واحدًا، وقد يزيد latency قليلًا مقارنة برابط backend مباشر. تمت المحافظة على `Cache-Control` من endpoint الأصلي لتقليل ذلك.

لم يتم تشغيل اختبارات Laravel بسبب غياب PHP في بيئة التنفيذ الحالية، لذلك يجب تشغيلها في CI أو بيئة Laravel قبل الدمج. كما يجب اختبار smoke فعلي على domain production مع صورة WebP منشورة؛ لا يوجد Deploy ضمن هذه المهمة.

## Git Information

- **Branch:** `fix/storefront-product-media-proxy`
- **PR:** لم يتم إنشاء PR بناءً على الطلب
- **Base SHA:** `85e3dec6abd20e79707d2fcd68ddff90c4f9f3a9`
- **Head SHA:** `2a7fa467d5fa80e2eb54b300d508cc2a8b8f7772`
- **Merge:** لم يتم
- **Deploy:** لم يتم

## Next Recommended Step

شغّل اختبارات Laravel التالية في CI/بيئة PHP: `StorefrontCatalogApiTest`, `ProductMediaGalleryTest`, واختبارات publication/security ذات الصلة، ثم نفّذ smoke test على متجر AWJ المنشور لمنتج «أناناس شرائح قودي 270 ج» للتأكد من أن بطاقة المنتج وصفحة التفاصيل تحملان WebP عبر proxy. بعد مراجعة النتائج يمكن فتح PR؛ لا يُنصح بالـmerge أو deploy قبل نجاح اختبارات Laravel وsmoke test.

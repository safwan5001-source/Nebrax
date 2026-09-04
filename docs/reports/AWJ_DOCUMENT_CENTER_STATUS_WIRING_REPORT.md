# تقرير إصلاح اتساق حالة الذكاء المستندي في مركز المستندات

**المهمة:** ربط شاشة إعدادات مركز المستندات بالجاهزية الفعلية بعد نجاح اتصال Google Gemini، دون تغيير إعدادات المزود أو بوابة الشبكة.
**الفرع:** `cursor/document-center-status-wiring-b8de`
**Base SHA:** `d30a52ab022e39e52da1b9e32df6a5336849d82a` (`main`)
**Head SHA:** `d6661b7793c1b0ce64125296ba05949482a5e57a`
**Implementation SHA:** `669593541386873d0480231c816ec6f9a69ed634`
**PR:** [#639](https://github.com/safwan5001-source/Nebrax/pull/639) — للمراجعة فقط.

**NOT MERGED / NOT DEPLOYED**

---

## 1. السبب الجذري

ثلاث ظواهر في `/documents/settings`، وثلاثة أسباب مستقلة:

### 1.1 شبكة مقفلة / استخراج غير مفعّل رغم نجاح Gemini

البطاقة الأولى في [`web/src/app/(app)/documents/settings/page.tsx`](web/src/app/(app)/documents/settings/page.tsx) كانت **نصوصاً ثابتة** (`providerNetworkLocked` + `statusExtractionUnavailable` + `retentionDisabled`). لا تقرأ منصة التكامل ولا سياسة المستأجر.

نجاح `Test Connection` يثبت فقط: مفتاح + نموذج + `allow_document_sending` + بوابة `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED` مفتوحة بما يكفي لـ ping. لا يكتب `engine_enabled` ولا يعيّن `primary_provider` ولا يحدّث واجهة المستأجر.

الاستخراج الفعلي يبقى اقتران المنطق القائم في `DocumentOperationsService` (طابور غير `sync` + بوابة الشبكة + `DocumentExtractionPolicy::enabled()` + جاهزية المزود الأساسي) **و** بوابة المستأجر `DocumentIntelligencePolicy::shouldProcessDocumentType()` عند الجدولة. لم تُنشأ سياسة جاهزية ثانية.

### 1.2 تناقض سياسة الاحتفاظ

مفهومان مختلفان:

- **احتفاظ الأصل لدى المستأجر** (`document_intelligence.retention_mode`) — قسم مستقل في إعدادات الذكاء المستندي.
- **سياسة الحذف الزمني للمنصة** (`GET /document-governance` → `policy.enabled` + `retention_days`، الافتراض 365 يوماً ومفعّلة).

الشارة في البطاقة الأولى كانت دائماً «معطلة»، بينما البطاقة الرابعة تربط `policy.enabled` فتعرض «مفعّلة». العطل عرض، لا كتابتان متعارضتان في القاعدة.

### 1.3 مفاتيح i18n الخام `documentCenterReview.typeDeliveryNote`

سقوط next-intl عند مفتاح غائب. نصوص الأنواع (`typeDeliveryNote` = سند تسليم) تحت `documentCenterIntake`. المكوّن كان يستدعي `useTranslations('documentCenterReview')`. قائمة المركز تستخدم المجموعة الصحيحة أصلاً.

---

## 2. ماذا تغيّر

| ملف | التغيير |
|---|---|
| [`app/Services/DocumentCenter/DocumentOperationsService.php`](app/Services/DocumentCenter/DocumentOperationsService.php) | `extractionReadiness()` علني يعيد الأعلام الأربعة + `ready` بنفس اقتران الجدولة السابق. `tenantOverview` يقرأ `ready` من هنا. |
| [`app/Http/Controllers/Api/DocumentOperationsController.php`](app/Http/Controllers/Api/DocumentOperationsController.php) | `GET /document-governance` يرفق `extraction_readiness` (booleans فقط). |
| [`web/src/app/(app)/documents/settings/page.tsx`](web/src/app/(app)/documents/settings/page.tsx) | البطاقة الأولى مربوطة بالجاهزية؛ شارة الاحتفاظ الزمني تتبع `policy.enabled`. غياب الحمولة = fail-closed (مقفلة / غير جاهز). |
| [`web/src/components/documents/document-intelligence-settings.tsx`](web/src/components/documents/document-intelligence-settings.tsx) | تسميات الأنواع عبر `documentTypeTranslationKey` + `documentCenterIntake`. |
| `web/src/messages/ar.json` / `en.json` | مفتاح `statusExtractionAvailable` فقط. |

لا مسار جديد. لا أسرار مزود في الحمولة.

---

## 3. ماذا لم يتغيّر (صراحة)

- لا تفعيل تلقائي لـ `engine_enabled` أو اختيار `primary_provider`
- لا تغيير `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED` أو مفتاح/نموذج Gemini أو `APP_KEY`
- لا تغيير سلوك الاستخراج أو المحاسبة أو المخزون أو ZATCA أو عزل المستأجر
- سياسة احتفاظ الأصل لدى المستأجر تبقى مستقلة عن سياسة الحذف الزمني للمنصة في الواجهة والـ API

إعداد منصة مقصود ليصبح الاستخراج فعّالاً (خارج هذا الـ PR): تشغيل محرك الاستخراج + المزود الأساسي = Gemini + طابور غير متزامن. نجاح الاختبار وحده لا يكفي.

---

## 4. القيود المحاسبية

لا قيد. لا `LedgerService`. لا حركة مخزون. لا ZATCA.

---

## 5. الاختبارات

| مجموعة | النتيجة |
|---|---|
| `DocumentGovernanceReadinessTest` (5) | نجحت |
| انحدار: `DocumentIntelligenceSettingsTest` + `DocumentOperationsGovernanceTest` + `GeminiExtractionTenantGateTest` | 37 نجحت |
| `php artisan test` كاملاً | **2269 نجحت، 1 skipped** |
| Vitest مركّز (إعدادات + أنواع + حارس i18n) | 10 نجحت |
| `npm run test` | **1391 نجحت** |
| `npm run build` | نجح (Next.js 15.5.19) |

لا مفتاح Gemini حي. لا تغيير مسار استخراج.

---

## 6. التحقق اليدوي بعد النشر (خارج هذا الـ PR)

لا نشر هنا. بعد نشر لاحق منفصل: فتح `/documents/settings` يجب أن يعكس `extraction_readiness` الحي (شبكة مفتوحة إن بقيت بوابة الإنتاج كذلك) وشارة احتفاظ زمني متسقة، وأسماء أنواع بالعربية/الإنجليزية. إن بقي الاستخراج «غير مفعّل» فالمطلوب فحص محرك الاستخراج المركزي والمزود الأساسي والطابور في Platform Admin — لا إعادة اختبار Gemini كحل للعرض.

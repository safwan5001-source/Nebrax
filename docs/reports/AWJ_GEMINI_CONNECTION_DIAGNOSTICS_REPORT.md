# تقرير تشخيص اختبار اتصال Gemini

**المهمة:** تشخيص آمن لفشل اختبار اتصال Google Gemini في منصة التشغيل.
**الفرع:** `cursor/gemini-connection-diagnostics-b8de`
**Base SHA:** `2197e2bfffac8cc88517b653a5b4c7a4dd48e7ef` (`main`)
**Head SHA:** `e2219718c6676118438ba08975dab73e951314fb`
**PR:** [#636](https://github.com/safwan5001-source/Nebrax/pull/636) — للمراجعة فقط.

**NOT MERGED / NOT DEPLOYED**

---

## 1. السبب الجذري لفجوة التشخيص

ثلاث طبقات تخفي سبب فشل الاختبار الحالي. هذا مؤكد من الكود، وليس تخميناً لسبب إنتاج معيّن.

1. **الواجهة تتجاهل رسالة الخلفية لـ Gemini.** `testAiProvider` كان يستبدل `response.data.message` بـ `connectionFailed` / `connectionSucceeded`. بطاقة المزود تعرض فقط `آخر اختبار: فشل` من `last_test_status` ولا تقرأ `last_test_message_safe`.
2. **الخلفية لا تعيد رمزاً مستقراً.** `DocumentProviderException::$safeCode` موجود في مسار الاستخراج لكنه لا يُمرَّر في `POST /api/platform/integrations/document_ai/test` (كان العقد `{ ok, message }` فقط).
3. **تصنيف مسار الاختبار كان خشناً أو ناقصاً:** 401 و403 مدموجان؛ 404 يسقط في رفض عام؛ أي 2xx يُعد نجاحاً بلا فحص شكل `generateContent`؛ `ConnectionException` كانت تصعد 422 برسالة عامة **دون** تحديث آخر اختبار؛ بوابة الشبكة تفشل برسالة عربية بلا رمز.

### ما نعرفه عن فشل الإنتاج دون تخمين السبب

ظهور «آخر اختبار: فشل» يعني أن `testConnection` أعاد `failed()` ثم كُتبت `last_test_status` — أي أن المسار **ليس** 422 غير الملتقط (مهلة/شبكة غير مصنّفة). المرشحون الباقون (بوابة `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED` / HTTP من Google / تحقق محلي لناقص مفتاح أو نموذج) **لا يمكن تمييزهم** قبل هذا العقد.

لم نفترض أن المفتاح أو النموذج أو الحصة أو إعداد Google هو السبب. لم يُغيَّر `APP_KEY` ولا إعدادات Railway/Vercel ولا مفتاح Gemini ولا إعدادات المستأجر.

---

## 2. التنفيذ

مسار **اختبار الاتصال** لـ `google_gemini` فقط. `extract()` و`assertSuccessful` الخاصة بالاستخراج بلا تغيير سلوكي.

- مصنّف [`GeminiConnectionDiagnostic`](app/Services/DocumentCenter/GeminiConnectionDiagnostic.php): يقرأ HTTP status و`error.status` و`error.details[].reason` من قائمة بيضاء. **لا ينسخ** `error.message` ولا جسم الطلب ولا الرؤوس. يولّد رسالة عربية ثابتة من جدول داخلي. `redact()` يستبدل المفتاح المخزّن إن ظهر في أي سلسلة صادرة.
- [`ProviderConnectionTestResult`](app/Services/DocumentCenter/ProviderConnectionTestResult.php): حقول اختيارية `errorCode` و`httpStatus` (OpenAI/Anthropic بلا تغيير سلوكي).
- [`GoogleGeminiDocumentExtractionProvider::testConnection`](app/Services/DocumentCenter/GoogleGeminiDocumentExtractionProvider.php): مفتاح/نموذج ناقص، بوابة شبكة، استجابة HTTP، جسم 2xx غير مطابق، و`Throwable` (مهلة مقابل شبكة).
- [`PlatformIntegrationService::testDocumentAiProvider`](app/Services/PlatformIntegrationService.php): لـ Gemini فقط يعيد `error_code` و`http_status` الاختياري، ويحفظ `last_test_error_code` / `last_test_http_status` داخل JSON المشفّر. `normalizeDocumentAiConfiguration` يحافظ عليها عند الحفظ. لا هجرة.
- الواجهة: [`gemini-diagnostics.ts`](web/src/app/platform/integrations/gemini-diagnostics.ts) يربط الرمز بمفتاح ترجمة. الإشعار بعد الاختبار يعرض السبب المترجم. البطاقة تبقي الحالة + الختم الزمني وتضيف سطر السبب من `last_test_error_code`. لا عرض لـ `http_status` ولا لنص Google ولا لـ `last_test_message_safe`.

---

## 3. تصنيف الأخطاء الآمن

| الرمز | المصدر |
|---|---|
| `gemini_api_key_missing` | مفتاح فارغ محلياً |
| `gemini_model_missing` | نموذج فارغ محلياً |
| `gemini_provider_network_disabled` | بوابة `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED` |
| `gemini_auth_failed` | 401 أو `UNAUTHENTICATED` أو `API_KEY_INVALID` |
| `gemini_permission_denied` | 403 أو `PERMISSION_DENIED` |
| `gemini_model_unavailable` | 404 أو `NOT_FOUND` |
| `gemini_rate_limited` | 429 أو `RESOURCE_EXHAUSTED` |
| `gemini_timeout` | 408 / `DEADLINE_EXCEEDED` / مهلة اتصال |
| `gemini_upstream_unavailable` | 5xx / `UNAVAILABLE` / فشل شبكة غير مهلة |
| `gemini_invalid_response` | 2xx بجسم غير متوقع |
| `gemini_connection_failed` | أي فشل آخر |

`http_status` يُحفظ داخلياً ويُعاد في JSON الاختبار كعدد صحيح اختياري. الواجهة لا تعرضه.

---

## 4. الملفات

| ملف | الغرض |
|---|---|
| `app/Services/DocumentCenter/GeminiConnectionDiagnostic.php` | تصنيف آمن + رسائل ثابتة + redact |
| `app/Services/DocumentCenter/ProviderConnectionTestResult.php` | `errorCode` / `httpStatus` اختياريان |
| `app/Services/DocumentCenter/GoogleGeminiDocumentExtractionProvider.php` | مسار `testConnection` فقط |
| `app/Services/PlatformIntegrationService.php` | عقد الاختبار + حفظ الرمز |
| `tests/Feature/GeminiConnectionDiagnosticTest.php` | محاكاة HTTP + عدم تسريب المفتاح + صلاحيات |
| `web/src/app/platform/integrations/gemini-diagnostics.ts` | رمز → مفتاح ترجمة |
| `web/src/app/platform/integrations/gemini-diagnostics.test.ts` | مطابقة AR/EN |
| `web/src/app/platform/integrations/page.tsx` | إشعار + سطر السبب على البطاقة |
| `web/src/app/platform/integrations/gemini-card.test.tsx` | سلوك البطاقة بعد الاختبار |
| `web/src/app/platform/integrations/page.test.tsx` | مفاتيح الترجمة |
| `web/src/messages/ar.json` / `en.json` | نصوص التشخيص |
| `docs/reports/AWJ_GEMINI_CONNECTION_DIAGNOSTICS_REPORT.md` | هذا التقرير |

---

## 5. تغيير عقد API

`POST /api/platform/integrations/document_ai/test`  
صلاحية كما هي: `auth:sanctum` + `EnsurePlatformAdministrator:platform:manage`.

لـ `provider=google_gemini` (HTTP 200 لنتائج الاختبار المعروفة):

```json
{ "data": { "ok": false, "message": "مفتاح Gemini غير صالح أو تم رفضه.", "error_code": "gemini_auth_failed", "http_status": 401 } }
```

نجاح:

```json
{ "data": { "ok": true, "message": "نجح اختبار اتصال Google Gemini.", "error_code": null } }
```

OpenAI/Anthropic يبقيان `{ ok, message }` بلا `error_code`.

نظرة عامة `GET /platform/integrations` قد تتضمن `last_test_error_code` و`last_test_http_status` داخل إعداد المزود العام (ليست أسراراً؛ `api_key` يبقى مخفياً ومقنّعاً).

---

## 6. مراجعة أمنية

- التشفير: `configuration` ما زال `encrypted:array`. الإخفاء: `api_key` → `api_key_masked` / `has_api_key` فقط.
- المفتاح يبقى في رأس `x-goog-api-key` لا في URL.
- المصنّف لا يقرأ إلا حقول Google المسموحة (`status`, `details[].reason`). لا يُنسخ `error.message` ولا `details[].metadata`.
- لا `Log::` لجسم Google أو المفتاح أو الرؤوس.
- `redact()` دفاع إضافي إن ظهر المفتاح المخزّن في سلسلة صادرة.
- الاختبارات تحقن `gemini-test-secret-abcd` داخل رسالة Google وmetadata وتؤكّد غيابه من JSON و`last_test_message_safe` و`error_code`.
- مسار الاستخراج لم يُوسَّع ليعيد جسم Google.
- لم تُضف هجرات، ولم يُغيَّر `APP_KEY`، ولم تُنقل ملكية المزود للمستأجر.

### إثبات عدم تسريب السر

في `GeminiConnectionDiagnosticTest` جسم الخطأ المحاكى يحتوي صراحةً على السر في `error.message` و`details.metadata.api_key`. الرد العام و`last_test_message_safe` و`error_code` لا يتضمنون السر ولا عبارة Google `API key not valid` ولا اسم الرأس `x-goog-api-key`. فشل الاختبار يُبقي `api_key` المخزّن كما هو.

---

## 7. الاختبارات والنتائج

تجميع Laravel مطابق لـ CI في `/tmp/nibras-app` (PHP 8.3 محلياً؛ CI يستخدم 8.4). SQLite. لا مفتاح Gemini حي.

| الأمر | النتيجة |
|---|---|
| `php artisan test --filter=GeminiConnectionDiagnosticTest` | **16 passed (161 assertions)** |
| `php artisan test --filter='GeminiIntegrationSettingsTest\|DocumentExtractionProviderTest\|GeminiExtractionTenantGateTest\|PlatformIntegrationSettingsTest'` | **24 passed (223 assertions)** |
| `php artisan test` كامل | **2258 passed, 1 skipped, 0 failed (15914 assertions)** — 137.25s |
| `npx vitest run` لملفات التكامل/التشخيص | **18 passed** |
| `npm run build` | نجح (Next.js 15.5.19، يشمل فحص الأنواع) |

تغطية الخلفية: نجاح؛ 401/UNAUTHENTICATED؛ 403؛ 404؛ 429؛ مهلة `ConnectionException`؛ شبكة؛ جسم 200 تالف؛ سقوط 400؛ مفتاح ناقص؛ نموذج ناقص؛ بوابة شبكة؛ السر لا يظهر في الرد ولا في الرسالة؛ فشل لا يمسح الإعداد؛ `platform:read` ومستأجر → 403؛ عقد OpenAI بلا `error_code`.

---

## 8. البناء / اللنت

- PHP: المجموعة الكاملة خضراء.
- Next.js: `npm run build` نجح مع lint + typecheck.
- لا هجرات جديدة. حارس قائمة النسخ في CI يشمل `app/Services/DocumentCenter`.

---

## 9. المخاطر والمتبقي

- سبب فشل الإنتاج الحالي **ما زال غير مؤكد**. هذا الـ PR يجعل الاختبار يصرّح بالرمز الآمن.
- إن ظهر بعد النشر `gemini_provider_network_disabled` فالمطلوب قرار تشغيل منفصل لتفعيل `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED` — **خارج هذا الـ PR**.
- OpenAI/Anthropic لم يُعاد تصنيف اختبارهما.
- `http_status` يظهر في JSON الاختبار والنظرة العامة كعدد؛ الواجهة لا تعرضه. إن رُغب بحجبه عن GET لاحقاً فذلك تقليص عقد منفصل.
- لم يُتحقق من الواجهة في متصفح إنتاجي (لا أدوات متصفح هنا). التحقق عبر Vitest + build.

---

## 10. الخطوة التالية الموصى بها

1. مراجعة PR #636 ثم دمجه.
2. نشر الخلفية والواجهة معاً.
3. **إعادة تشغيل Test Connection مرة واحدة** في الإنتاج كمدير منصة، وقراءة `error_code` (والإشعار المترجم) دون تغيير المفتاح أو النموذج مسبقاً.
4. معالجة السبب الظاهر وفق الرمز فقط بعد تلك القراءة.

**NOT MERGED / NOT DEPLOYED.**

# تقرير إصلاح تحقق استجابة اختبار اتصال Gemini

**المهمة:** قبول استجابة `generateContent` الشرعية في اختبار اتصال Google Gemini دون اشتراط نص استخراج.
**الفرع:** `cursor/gemini-connection-valid-response-b8de`
**Base SHA:** `af0542c9f2d0d63dff03f503ae9a75575eb9e361` (`main`)
**Head SHA:** `234f92153fe864870329cbd32b68396c1775b0a9`
**PR:** [#638](https://github.com/safwan5001-source/Nebrax/pull/638) — للمراجعة فقط.

**NOT MERGED / NOT DEPLOYED**

---

## 1. السبب الجذري

رمز الإنتاج `gemini_invalid_response` يصدر فقط من `GeminiConnectionDiagnostic::fromSuccessfulResponse()` عندما يكون HTTP 2xx والجسم JSON لكن `hasOutputText()` يعيد `false`.

`hasOutputText()` كان يشترط `candidates[0].content.parts[].text` غير فارغ. هذا تحقق **استخراج**، لا تحقق اتصال.

طلب الاختبار كان:

```
POST .../v1beta/models/{model}:generateContent
generationConfig.maxOutputTokens = 16
prompt = "Reply with exactly OK."
```

نماذج Gemini 3.x (ومنها `gemini-3.8-flash`) تفكّر افتراضياً، ورموز التفكير تُحسب ضمن `maxOutputTokens`. بميزانية 16 تُستهلك في التفكير فيُعاد مرشح بلا نص ظاهر.

`gemini-2.5-flash` → `gemini_model_unavailable` يبقى 404 حقيقياً من Google، خارج هذا الإصلاح. لم يُغيَّر المفتاح ولا النموذج في الإنتاج.

---

## 2. شكل الاستجابة الذي سبب الرفض الخاطئ

الجسم الخام لا يُحفظ عمداً. الشكل الأقرب وفق العقد الرسمي وسلوك نماذج التفكير مع سقف 16:

```json
{
  "candidates": [
    {
      "content": { "role": "model" },
      "finishReason": "MAX_TOKENS",
      "index": 0
    }
  ],
  "usageMetadata": {
    "candidatesTokenCount": 0,
    "thoughtsTokenCount": 16
  },
  "modelVersion": "gemini-3.8-flash"
}
```

أو مرشح فيه `finishReason` فقط بلا `content`. كلاهما `GenerateContentResponse` شرعي؛ الاتصال والمفتاح والنموذج نجحوا.

---

## 3. العقد الرسمي المستخدم للمقارنة

[GenerateContentResponse](https://ai.google.dev/api/generate-content#GenerateContentResponse) (`v1beta`):

- الحقول: `candidates[]`, `promptFeedback`, `usageMetadata`, `modelVersion`, `responseId`
- `Candidate.content` اختياري
- `finishReason` قد يكون `STOP` أو `MAX_TOKENS` أو `SAFETY` مع محتوى فارغ
- لا مرشحين إلا إذا كانت المشكلة في الـ prompt — عندها يُفحص `promptFeedback.blockReason`

---

## 4. ما تغيّر

مسار **اختبار الاتصال** فقط.

- [`GeminiConnectionDiagnostic::fromSuccessfulResponse()`](app/Services/DocumentCenter/GeminiConnectionDiagnostic.php) يستخدم `isRecognizableGenerateContentResponse()` بدل `hasOutputText()`.
- يُقبل 2xx JSON إذا وُجدت مصفوفة `candidates` غير فارغة من كائنات، **أو** كائن `promptFeedback` (حظر الـ prompt حسب المواصفة).
- لا يُشترط `parts.text`. يُقبل `MAX_TOKENS` / `STOP` / `SAFETY` و`content` فارغ وأجزاء `thought`.
- يبقى `gemini_invalid_response` للجسم غير المعروف: غير JSON، `{unexpected:true}`، `candidates` ليست مصفوفة، مصفوفة مرشحين فارغة بلا `promptFeedback`.
- [`testConnection()`](app/Services/DocumentCenter/GoogleGeminiDocumentExtractionProvider.php): `maxOutputTokens` من 16 إلى 256. **لا** `thinkingConfig`.
- `extract()` بلا تغيير.

تعليق في الكود: نجاح الاتصال ≠ نجاح الاستخراج.

---

## 5. لماذا التحقق الجديد صحيح

اختبار الاتصال يثبت: الوصول للنقطة، قبول المفتاح، إتاحة النموذج، وجسم Gemini قابل للتعرّف. لا يثبت نجاح استخراج مستند.

كل 2xx لا يُعد نجاحاً: الجسم يجب أن يطابق عقد `GenerateContentResponse`. النص الظاهر شرط استخراج لاحق.

---

## 6. الملفات

| ملف | الغرض |
|---|---|
| `app/Services/DocumentCenter/GeminiConnectionDiagnostic.php` | مصادق اتصال بدل `hasOutputText` |
| `app/Services/DocumentCenter/GoogleGeminiDocumentExtractionProvider.php` | `maxOutputTokens` 256 في الاختبار فقط |
| `tests/Feature/GeminiConnectionDiagnosticTest.php` | أشكال شرعية + أجسام تالفة + انحدار |
| `docs/reports/AWJ_GEMINI_CONNECTION_VALID_RESPONSE_FIX_REPORT.md` | هذا التقرير |

---

## 7. سلوك API

عقد `POST /api/platform/integrations/document_ai/test` بلا تغيير شكلي (`ok`, `message`, `error_code`, `http_status`).

التغيير السلوكي: 2xx بشكل `GenerateContentResponse` بلا نص ظاهر → `ok: true` و`error_code: null` بدل `gemini_invalid_response`.

رموز الخطأ القائمة كما هي. لا رمز جديد.

---

## 8. مراجعة أمنية

- لا يُنسخ `error.message` ولا جسم Google ولا الرؤوس.
- لا سجلات للمفتاح أو `x-goog-api-key` أو الإعداد المفكوك.
- الاختبارات تحقن السر في جسم 2xx ناجح وفي أخطاء Google؛ الرد و`last_test_message_safe` لا يتضمنانه.
- التشفير والإخفاء بلا تغيير.
- فشل الاختبار لا يمسح الإعداد المخزّن.
- صلاحية Platform Admin كما هي.

---

## 9. الاختبارات والنتائج

محاكاة HTTP فقط. لا مفتاح حي.

| الأمر | النتيجة |
|---|---|
| `php artisan test --filter=GeminiConnectionDiagnosticTest` | **22 passed (264 assertions)** |
| `php artisan test --filter='GeminiIntegrationSettingsTest\|DocumentExtractionProviderTest\|GeminiExtractionTenantGateTest\|PlatformIntegrationSettingsTest'` | **24 passed (223 assertions)** |
| `php artisan test` كامل | **2264 passed, 1 skipped, 0 failed (16017 assertions)** — 138.42s |

تغطية إضافية: نص عادي؛ `MAX_TOKENS` بلا نص؛ مرشح `finishReason` فقط؛ أجزاء `thought`؛ `promptFeedback.blockReason` بلا مرشحين؛ `finishReason: SAFETY` بلا نص؛ `{unexpected:true}` / HTML / جسم فارغ / `candidates` غير مصفوفة / مرشحون فارغون بلا تغذية راجعة. انحدار 401/403/404/429/مهلة/شبكة/سر/صلاحيات بقي أخضر. لا تغيير واجهة → لا `npm run build`.

---

## 10. البناء / CI

PHP: المجموعة الكاملة خضراء محلياً (PHP 8.3 / SQLite؛ CI يستخدم 8.4). لا هجرات. لا تغيير واجهة.

---

## 11. المخاطر والمتبقي

- `gemini-2.5-flash` ما زال قد يعيد `gemini_model_unavailable` إن لم يكن النموذج متاحاً للمفتاح — قرار تشغيلي خارج هذا الـ PR.
- رفع `maxOutputTokens` إلى 256 يقلّل جوع التفكير ولا يلغي الحاجة للمصادق المتساهل.
- لم يُرسل `thinkingConfig` لتفادي 400 عبر أجيال النماذج.
- الجسم الخام للإنتاج لم يُلتقط (تصميم أمني). الشكل أعلاه مستنتج من العقد + سلوك التفكير + سقف 16.

---

## 12. الخطوة التالية الموصى بها

1. مراجعة PR #638 ثم دمجه.
2. نشر الخلفية.
3. إعادة Test Connection مرة واحدة على **`gemini-3.8-flash`** دون تغيير المفتاح.
4. الإبقاء على `gemini-2.5-flash` خارج هذا الإصلاح ما دام 404.

**NOT MERGED / NOT DEPLOYED.**

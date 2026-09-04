# تقرير إصلاح حفظ/اختبار تكامل Gemini

**المهمة:** إصلاح UX حفظ واختبار Google Gemini في منصة التشغيل (بطاقة المزود).
**الفرع:** `cursor/gemini-integration-save-test-ux-90be`
**Base SHA:** `46e81e5ba2d41a6d63e6f30fdd43079842797ac7` (`main`)
**Head SHA:** يُحدَّث بعد دمج هذا التقرير في الـ commit.
**PR:** [#634](https://github.com/safwan5001-source/Nebrax/pull/634) — للمراجعة فقط.

**NOT MERGED / NOT DEPLOYED**

---

## 1. السبب الجذري

المشكلة **واجهة** وليست مسار حفظ خلفي ناقص.

- بطاقة المزود `AiProviderCard` كانت تعرض **اختبار الاتصال فقط**. زر الحفظ موجود في بطاقة محرك الاستخراج أعلى الصفحة (`saveAi` → `PUT /platform/integrations/document_ai`).
- `testAiProvider` كان يرسل `{ provider }` ثم يستدعي `await load()`.
- `load()` يستدعي دائماً `setAiForm(hydrateAiForm(...))` من الحالة المخزّنة. القيم غير المحفوظة (النموذج، التفعيل، السماح بإرسال المستندات، المفتاح المكتوب) تُستبدل.
- الخلفية كانت صحيحة أصلاً: `PlatformIntegrationService::testDocumentAiProvider` يختبر الإعداد المخزّن؛ `normalizeDocumentAiConfiguration` يحتفظ بالمفتاح إن تُرك فارغاً ويمسحه فقط عند `clear_api_key`؛ الـ overview يعيد `has_api_key` / `api_key_masked` بلا نص صريح.

لم يُغيَّر `APP_KEY`، ولم تُنقل ملكية المزود للمستأجر، ولم يُحفظ المفتاح في `tenants.settings`.

---

## 2. التغيير

أصغر إصلاح آمن، Gemini فقط:

- **لا مسار حفظ ثانٍ.** زر حفظ Gemini يستدعي `saveAi()` الحالي (`PUT document_ai` + كلمة مرور مدير المنصة).
- **لا حفظ تلقائي عند الاختبار.** الاختبار يبقى على الإعداد المخزّن فقط (`POST` بـ `{ provider: "google_gemini" }`).
- عند اختلاف حقول Gemini غير السرّية، أو كتابة مفتاح جديد، أو تفعيل «مسح المفتاح المخزن»: تعطيل اختبار Gemini + نص `saveBeforeTest`.
- بعد أي اختبار AI: تحديث نظرة عامة (آخر اختبار) **دون** `hydrateAiForm` / `load()`. بعد حفظ ناجح يبقى `hydrateAiForm` (يفرغ حقل المفتاح ويعرض الحالة المقنّعة).
- OpenAI و Anthropic بلا أزرار حفظ/تعطيل جديدة. التعديل المشترك الوحيد: عدم إعادة hydrate النموذج بعد أي اختبار AI حتى لا يمسح اختبار OpenAI حقول Gemini غير المحفوظة.
- إشعارات الاختبار عبر مفاتيح الواجهة (`connectionSucceeded` / `connectionFailed`). لا تُعرض أسرار في الإشعار.
- المفاتيح الحالية (`save` / `test` / `saved`) بقيت لبطاقات التخزين/المحرك.

لا تغيير سلوكي في `PlatformIntegrationService` أو المسارات.

---

## 3. الملفات

| ملف | الغرض |
|---|---|
| `web/src/app/platform/integrations/ai-form.ts` | استخراج `hydrateAiForm` + `isGoogleGeminiDirty` |
| `web/src/app/platform/integrations/page.tsx` | حفظ ظاهر على بطاقة Gemini، كلمة المرور، تعطيل الاختبار عند dirty، عدم hydrate بعد الاختبار |
| `web/src/messages/ar.json` / `en.json` | مفاتيح `saveSettings` / `saving` / `savedSuccessfully` / `saveBeforeTest` / `testConnection` / `testing` / `connectionSucceeded` / `connectionFailed` |
| `web/src/app/platform/integrations/ai-form.test.ts` | hydrate + dirty |
| `web/src/app/platform/integrations/ai-provider-actions.test.ts` | الاختبار لا يُعطَّل بتعطيل المحرك؛ Gemini dirty + لا hydrate بعد الاختبار |
| `web/src/app/platform/integrations/page.test.tsx` | إغفال المفتاح الفارغ + نصوص AR/EN |
| `web/src/app/platform/integrations/gemini-card.test.tsx` | مسار المكوّن: dirty → حفظ PUT → اختبار POST → بقاء النموذج |
| `tests/Feature/GeminiIntegrationSettingsTest.php` | حفظ/إعادة تحميل/سر/اختبار/صلاحيات |

---

## 4. الأمان ومعالجة الأسرار

- عقد الحفظ الحالي دون تغيير: كلمة مرور مدير المنصة إلزامية (`current_password`).
- المفتاح لا يُعاد في JSON ولا يُنسخ إلى حقل النموذج عند hydrate.
- إرسال `api_key` فارغ يُبقي السر المخزّن؛ `clear_api_key: true` يحذف مفتاح Gemini فقط.
- اختبار الاتصال يستخدم النموذج/المفتاح **المخزّنين**؛ المفتاح في رأس `x-goog-api-key` لا في الـ URL؛ حقول POST الإضافية المضلِّلة تُتجاهل.
- مستخدم مستأجر و`platform:read` لا يقدران على PUT/POST.
- لا مفاتيح إنتاج في المستودع أو الاختبارات (سر الاختبار: `gemini-test-secret-abcd`).
- لا كتابة على `tenants.settings`، لا نقل ملكية المزود للمستأجر، لا تغيير `APP_KEY`.

---

## 5. نتائج الاختبارات

تجميع Laravel مطابق لـ CI في `/tmp/nibras-app` (PHP 8.3 محلياً؛ CI يستخدم 8.4). SQLite.

| الأمر | النتيجة |
|---|---|
| `php artisan test --filter=GeminiIntegrationSettingsTest` | **6 passed (63 assertions)** |
| `php artisan test --filter='DocumentExtractionProviderTest\|PlatformIntegrationSettingsTest\|GeminiExtractionTenantGateTest'` | **18 passed (160 assertions)** |
| `php artisan test` كامل | **2242 passed, 1 skipped, 0 failed (15753 assertions)** — 131.90s |
| `npx vitest run` في `web/` | **219 files, 1381 passed** — 23.79s |
| `npx vitest run src/app/platform/integrations/{gemini-card.test.tsx,ai-form.test.ts,ai-provider-actions.test.ts,page.test.tsx}` | **13 passed** |
| `npm run build` | نجح (Next.js 15.5.19، يشمل فحص الأنواع) |
| `npm run lint` (`next lint`) | غير قابل للتشغيل غير التفاعلي: لا إعداد ESLint في `web/` فيطلب معالج الإعداد. Web CI لا يشغّل lint منفصلاً؛ البناء يتضمّن «Linting and checking validity of types» ونجح. |

تشغيل `php artisan test` الأول بدون `php8.3-gd` و`poppler-utils` أسقط 8 اختبارات بيئية (صور الموظفين/الباركود + عدّ صفحات PDF). بعد تثبيت الامتدادين كما يفعل CI: المجموعة كاملة خضراء. لا علاقة لتلك الإخفاقات بمسار Gemini.

---

## 6. سيناريو QA اليدوي (بيئة وهمية فقط — لا مفتاح إنتاج)

لا متصفح إنتاج ولا مفتاح Gemini حقيقي في هذا التشغيل. الخطوات لمراجع بشري على بيئة وهمية:

1. منصة التشغيل → تكاملات → بطاقة **Google Gemini**.
2. تفعيل المزود، النموذج `gemini-2.5-flash`، مفتاح وهمي، السماح بإرسال المستندات، مسح المفتاح **إيقاف**.
3. بدون حفظ: زر الاختبار معطّل ونص «احفظ التغييرات قبل اختبار الاتصال».
4. إدخال كلمة مرور مدير المنصة → **حفظ الإعدادات**.
5. إعادة تحميل الصفحة: التفعيل/النموذج/السماح باقية؛ المفتاح مقنّع وغير ظاهر نصاً.
6. **اختبار الاتصال**: ينجح أو يفشل حسب المفتاح الوهمي؛ الحقول المعروضة لا تُفرَّغ.
7. مسار منفصل: تفعيل «مسح المفتاح المخزن عند الحفظ» → حفظ → `has_api_key` يختفي ومفاتيح OpenAI/Anthropic إن وُجدت تبقى.

---

## 7. المخاطر والعمل المتبقي

- OpenAI/Anthropic Save UX خارج النطاق عمداً.
- الاختبار يبقى على الإعداد المخزّن؛ من يغيّر الحقول ثم يختبر دون حفظ يختبر القيمة القديمة — هذا مقصود ويُحمى بتعطيل الزر.
- لا تنفيذ احتفاظ، لا دلالات استخراج، لا استحقاقات، لا محاسبة/مخزون/ZATCA.

**الخطوة التالية:** مراجعة PR #634 ثم الدمج يدوياً عند الموافقة. لا دمج ولا نشر من هذا الوكيل.

---

## 8. Git

- **Branch:** `cursor/gemini-integration-save-test-ux-90be`
- **Base SHA:** `46e81e5ba2d41a6d63e6f30fdd43079842797ac7`
- **PR:** [#634](https://github.com/safwan5001-source/Nebrax/pull/634)
- **الحالة:** **NOT MERGED / NOT DEPLOYED**

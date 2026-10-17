# AWJ AI-07 — ربط تكامل Anthropic الموجود بـ AI Gateway

**الحالة:** Draft PR — لا Merge ولا Deploy ولا تفعيل. **الافتراضي بعد هذا التغيير = السلوك السابق حرفياً (Mock).**
**Base SHA:** `3cf914235f2044c0a7b7a0357b240d6edc1b3086` · **Head SHA / CI:** انظر §10.

---

## 1. الخلاصة التنفيذية

| السؤال | الجواب |
|---|---|
| هل Anthropic موجود فعلاً؟ | **نعم** — إعداد منصة (`document_ai`) مشفّر ومُدقَّق، **وعميل HTTP فعلي** (`AnthropicDocumentExtractionProvider`) لكنه مقصور على استخراج المستندات. |
| هل أُنشئ نظام مفاتيح/جداول/صفحات جديدة؟ | **لا.** صفر migrations، صفر صفحات جديدة، صفر تخزين مفاتيح جديد. |
| كيف رُبط؟ | المساعد يستدعي **العميل نفسه** عبر دالة `converse()` أُضيفت إليه، ويقرأ الإعداد نفسه عبر قارئ للقراءة فقط في `PlatformIntegrationService`. |
| هل صار مفعّلاً؟ | **لا.** يلزم 5+ شروط صريحة من المالك (§8). المزوّد الافتراضي `mock`، وقراءة المستندات عبر AI الخارجي **معطّلة بنيوياً** (الأداة لا تُعرض للنموذج). |

---

## 2. نتائج الفحص (الأسئلة الخمسة)

### 2.1 أين تُخزَّن المفاتيح وكيف تُشفَّر؟
- الجدول `platform_integration_settings` (نموذج `PlatformIntegrationSetting`)، العمود `configuration` مُعرَّف `encrypted:array` (تشفير Laravel بـ `APP_KEY`) و`$hidden`.
- الواجهة الإدارية العليا (`PlatformIntegrationService`) تعرض **نسخة مقنَّعة فقط** (`has_api_key` + آخر محارف)، وكل تحديث يُدقَّق. المفتاح لا يُعاد قراءته من أي API.
- لا تخزين للمفاتيح في `.env` ولا في إعدادات المستأجر.

### 2.2 كيف تُدار حالة التفعيل واختيار النموذج؟
- مزوّدو `document_ai`: `openai | anthropic | google_gemini`، لكل منهم `enabled` و`model` و`api_key` ومهلات.
- بوابة الشبكة العامة `DocumentProviderNetworkGate` (متغير `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED`) تمنع أي طلب خارجي ما لم تُفعَّل.
- النموذج يُختار من إعداد المنصة؛ **لا اسم نموذج في الكود**.

### 2.3 هل يوجد عميل API فعلي قابل لإعادة الاستخدام؟
- **نعم جزئياً:** `AnthropicDocumentExtractionProvider` فيه العميل (ترويسات `x-api-key`/`anthropic-version`، مهلات، retry=0، تحويل 401/403/429/5xx إلى أخطاء آمنة) لكنه يبني طلب استخراج مستندات فقط.
- أُضيفت له `converse(config, payload)`: نفس التحقق ونفس بوابة الشبكة ونفس العميل ونفس تحويل الأخطاء، تعيد الاستجابة المفكوكة فقط. لا عميل ثانٍ.

### 2.4 كيف رُبط بـ AI Gateway دون تكرار؟
```
AiAssistantGateway ──► AnthropicAssistantProvider (واجهة AiExternalAssistantProvider)
                           ├─ PlatformIntegrationService::aiProviderConfiguration()  (قراءة فقط، المفتاح لا يخرج منه)
                           └─ AnthropicDocumentExtractionProvider::converse()        (العميل الوحيد)
```
- `AnthropicAssistantProvider` لا يحوي `Http`/`Log`/`Crypt`/نص `api_key` (يحرسه اختبار).
- تعريف الأدوات للنموذج يُشتق من الأداة نفسها (`description()` و`inputSchema()` على `AiAssistantTool`) — لا مخطط ثانٍ بجانب `validate()`.
- أسماء الأدوات تُحوَّل (`finance.income_statement` → `finance_income_statement`) لقيد Anthropic ثم تُعاد.

### 2.5 الحدود المالية والتدقيق والموافقات والعزل
| الضابط | التطبيق |
|---|---|
| الميزانية | حجز ذرّي **قبل** الاستدعاء الأول يغطي استدعاءين (تخطيط + صياغة) بسقف مخرجات؛ تسوية بالاستخدام الفعلي؛ سقف منصة وسقف مستأجر (`AiBudgetService`). |
| التسعير | جدول `config('ai_assistant.pricing.anthropic')` من `AI_ASSISTANT_ANTHROPIC_PRICING` (فارغ افتراضياً) ⇒ **تسعير مجهول = فشل مغلق** `pricing_unknown`. |
| الفشل | أي فشل بعد الإرسال يخضع لسياسة `failure_charge` القائمة؛ استجابة بلا `usage` سليم = فشل مغلق. |
| الصلاحيات | `AiAssistantPolicy::authorize` كما هي (منصة ∩ مستأجر ∩ موافقة ∩ فاعل طازج ∩ صلاحية الأداة). الأدوات تُنفَّذ بعد **إعادة التفويض** وبـ`validate()` المغلق. النموذج لا يمرّر معرّف مستأجر. |
| الموافقة الخارجية | إقرار مستقل صريح لكل مستأجر `ai_assistant_external.acknowledged` (مجموعة Settings منفصلة كي لا تتحول موافقة Mock القديمة إلى موافقة إرسال خارجي). غيابه ⇒ `external_provider_not_acknowledged` (403) **قبل أي طلب**. يُسحب تلقائياً عند تعطيل المساعد. |
| العزل | كل أداة تقرأ عبر `ReportService` بنطاق المستأجر والفرع؛ اختبار عزل بين مستأجرين. |
| التدقيق | `AiAuditRecorder` (قائمة بيضاء META_KEYS، append-only) + مفاتيح جديدة: `external_ack`، `composed`، `grounded`، `results_digested` — أعداد/أعلام فقط، لا نصوص ولا أرقام مالية. |

---

## 3. تصميم التدفق (إرسال خارجي من مرحلتين)

1. **تخطيط:** رسالة المستخدم (عربية/إنجليزية) + أدوات التقارير المعتمدة المعروضة (`offeredToModel()`: قائمة الدخل، أعمار الذمم المدينة/الدائنة). `tool_choice=auto`.
2. **تنفيذ آمن:** كل `tool_use` ⇒ تفويض طازج ⇒ `validate()` ⇒ `ReportService`. أداة غير معروفة/غير معروضة/مستندات ⇒ رفض.
3. **تحويل النتيجة إلى ملخص منزوع الهوية** (`AiToolResultDigest`): أرقام عشرية نصية، الأطراف `Party-N`، بلا أسماء/معرّفات/مصادر/نطاق، سقف صفوف يتقلص ليلائم ميزانية التوكنات، تحذيرات برموزها فقط.
4. **صياغة:** استدعاء ثانٍ بالملخص فقط.
5. **حارس الإجابة** (`AiAnswerGuard`): تنقية محارف التحكم/الاتجاه، تقصير، **تحقق من التأريض الرقمي** (كل رقم ≥3 خانات أو كسري يجب أن يوجد في الملخص؛ يدعم الأرقام الهندية-العربية)؛ إجابة غير مؤرَّضة تُحجب وتُستبدل برسالة ثابتة (ع/E). ثم تُستعاد أسماء الأطراف محلياً من `Party-N`.
6. البطاقات/الجداول في الواجهة تُقرأ مباشرة من `ReportService` وليس من نص النموذج.

## 4. ما يُرسَل وما لا يُرسَل
- يُرسَل: نص سؤال المستخدم + ملخص أرقام منزوع الهوية + تعليمات النظام (تاريخ اليوم/المنطقة الزمنية/اللغة).
- لا يُرسَل أبداً: أسماء الأطراف، المعرّفات، الفرع/المستأجر/المستخدم، محتوى مركز المستندات، المفاتيح.
- **قراءة المستندات عبر AI الخارجي معطّلة:** أداة المستندات `AiExplicitInvocationOnly` لا تُعرض للنموذج، ولو طلبها النموذج تُرفض (اختبار).

## 5. التغييرات
**Backend (بلا migrations):** `AiExternalAssistantProvider` (جديد) · `AnthropicAssistantProvider` (جديد) · `AiToolResultDigest` (جديد) · `AiAnswerGuard` (جديد) · `AiAssistantGateway` (اختيار مزوّد + إقرار + مسار خارجي + تسوية) · `AiAssistantToolRegistry::offeredToModel` · `AiAssistantTool::description/inputSchema` · `AnthropicDocumentExtractionProvider::converse` · `PlatformIntegrationService::aiProviderConfiguration` · `AiAssistantStatusService` · `AiAssistantConsentService` + Request/Controller · `Settings` (مجموعة `ai_assistant_external`) · `AiAssistantDenied` · `AiAuditRecorder` · `config/ai_assistant.php`.
**Web:** حالة `external_provider_not_acknowledged` + شارة «Anthropic» + قسم إقرار الإرسال الخارجي في إعدادات الموافقة (ar/en).

## 6. الاختبارات
- **PHP جديدة:** `AiAnthropicProviderTest` (29)، `AiAnswerGuardTest` (14). تغطي: دورة عربية وإنجليزية، إزالة الهوية واستعادة الأسماء، حجب الإجابة غير المؤرَّضة، أداة مخترعة/مستندات، منع صلاحية الأداة، معطيات غير صالحة، بوابات التفعيل (10 حالات)، المنصة مغلقة/مزوّد مجهول، Mock افتراضي، انقطاع/فشل الاستدعاء الثاني/غياب usage، تغطية الحجز للاستدعاءين، سقف المستأجر، عزل المستأجرين، دورة الإقرار والتدقيق، عدم تسرّب الحالة، رفض إقرار مع Mock، وأن `tools/run` الصريح لا يستدعي المزوّد أبداً.
- **PHP محدَّثة:** `AiAssistantGatewayTest`، `AiMeteringTest`، `AiPaidProviderDisabledTest` (حرّاس المسح المصدري عُدّلت عمداً لتعكس وجود مزوّد خارجي خلف البوابات).
- **Web:** vitest (modules/intelligence + components/intelligence) 209 ناجح، يشمل حالات الإقرار الخارجي والشارة.
- النتائج التفصيلية (الحزمة الكاملة، Build، CI): §9–§10.

## 7. المخاطر المتبقية
| الخطر | التخفيف / القرار المطلوب |
|---|---|
| `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED` بوابة **مشتركة** مع استخراج مستندات مركز المستندات: تفعيلها لأجل المساعد يفتح أيضاً مسار الاستخراج (الذي له مفاتيح تفعيل وموافقات خاصة به). | قرار مالك: قبول البوابة المشتركة أو فصلها في مهمة لاحقة. |
| لا واجهة لضبط ميزانيات المنصة/المستأجر (`AiBudgetService::setCaps`) | الضبط عبر Tinker/مهمة لاحقة؛ بلا ميزانية ⇒ `budget_not_configured` (فشل مغلق). |
| دقة التسعير يدوية (JSON في env) | مجهول ⇒ رفض؛ تحقّق المالك من أسعار النموذج المختار. |
| النموذج قد يصوغ نصاً بأرقام صحيحة لكن بتفسير خاطئ | الحارس يضمن الأرقام لا التفسير؛ البطاقات الأصلية تُعرض إلى جانب النص مع وسم «مكتوب بنموذج خارجي». |
| اسم الطرف يُستعاد محلياً من `Party-N`؛ إن ذكر النموذج رمزاً غير موجود يبقى كما هو | لا تسرب؛ الأثر تجميلي. |

## 8. قائمة تفعيل المالك (لم تُنفَّذ — تحتاج موافقة صريحة)
1. إعداد المنصة: مزوّد Anthropic في تكاملات الإدارة العليا — `enabled` + مفتاح + نموذج (الواجهة الحالية).
2. `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED=true` (انظر خطر البوابة المشتركة).
3. `AI_ASSISTANT_ANTHROPIC_PRICING` بأسعار النموذج المختار.
4. `AI_ASSISTANT_PROVIDER=anthropic` (مع بقاء `AI_ASSISTANT_DOCUMENTS_ENABLED` معطّلاً).
5. ميزانية المنصة وميزانية المستأجر.
6. المستأجر: موافقة المساعد + **الإقرار الخارجي** من شاشة الإعدادات.
7. تجربة بمستأجر واحد قبل التوسّع، ومراقبة سجل التدقيق والاستهلاك.

> التراجع الفوري: `AI_ASSISTANT_PROVIDER=mock` (أو تعطيل مزوّد المنصة) — بلا ترحيل ولا فقد بيانات.

## 9. نتائج التحقق
| الفحص | النتيجة |
|---|---|
| `php artisan test` كاملاً (SQLite محلي) | **7584 ناجح، 142 متخطّى، 26 فاشل** — الـ26 كلها اختبارات Fuel بسبب غياب امتداد `bcmath` في هذه البيئة (`bcmul()` غير معرّفة)، وتنجح في CI؛ تأكّد بتشغيل `--filter=Fuel` (26 فاشل / 45 ناجح) وهي نفسها الحالة قبل التغيير. لا فشل خارج Fuel. |
| Web vitest (modules/intelligence + components/intelligence) | 209/209 |
| `npm run build` | ناجح |
| `tsc --noEmit` | 55 خطأ سابق في وحدات أخرى (store-experience-builder) — عدد مطابق قبل/بعد، **صفر** في intelligence |
| Playwright ai-03/ai-04 | لم تُشغَّل في هذه الجولة (لم يتغير أي مسار تنقل؛ التغطية بـ vitest) |

## 10. Base / Head / CI
- Base: `3cf914235f2044c0a7b7a0357b240d6edc1b3086`
- Head / CI: يُسجَّل في تعليق PR بعد اكتمال الفحوص.

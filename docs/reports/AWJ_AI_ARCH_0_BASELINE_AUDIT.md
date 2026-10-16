# AWJ Intelligence — AI-ARCH-0 Baseline Architecture Audit

> مراجعة معمارية للقراءة فقط. لا تمثل هذه الوثيقة موافقة على تفعيل مزوّد أو إرسال بيانات أو دمج أو نشر.

## 1. بيانات التسليم ونطاق المراجعة

| البند | القيمة |
|---|---|
| تاريخ المراجعة | 2026-10-16 (UTC) |
| مستودع المصدر | `safwan5001-source/Nebrax` |
| فرع التقرير | `docs/ai-arch-0-baseline-audit-20261016` |
| Base SHA (`origin/main`) | `5fb6f2331cc82e2d37dce6d79e512658e7cd834c` |
| Head SHA للكود الذي تمت مراجعته | `5fb6f2331cc82e2d37dce6d79e512658e7cd834c` |
| PR #1543 Head SHA (الخطة المقترحة فقط) | `d4782f48fdd3abf19e29a256f50f93f75e967239` |
| Draft PR لهذا التقرير | يُحدّث بعد فتح المسودة |
| الملفات المعدلة | `docs/reports/AWJ_AI_ARCH_0_BASELINE_AUDIT.md` فقط |
| حالة CI/Build لهذا التقرير | لم تُشغّل بعد؛ تقرير Markdown فقط |

تم تثبيت `origin/main` أولاً ثم إنشاء فرع مستقل منه. تمت قراءة خطة AWJ Intelligence من PR #1543 دون دمجها أو تعديل فرعها. الـ Base والـ Head الخاصان **بلقطة كود النظام محل التدقيق** متطابقان؛ أما commit التقرير نفسه فهو تغيير توثيقي فقط، ويظل SHA الحالي له ظاهرًا في Draft PR لتجنب ادعاء أن التقرير جزء من لقطة النظام المدققة.

### حدود المنهج

- تمت مراجعة الكود والإعدادات والاختبارات ذات الصلة فقط؛ لم يُراجع المستودع كاملاً.
- لم تُقرأ أو تُغيّر أي مفاتيح سرية، ولم تُغيّر إعدادات منصة أو مستأجر أو قاعدة بيانات.
- لم يُستدعَ OpenAI أو Anthropic أو Gemini، بما في ذلك زر/مسار `test connection` الذي قد ينشئ طلبًا مدفوعًا ويكتب نتيجة فحص.
- أوصاف «الإنتاج» أدناه مبنية على ملفات النشر داخل المستودع فقط. حالة Render/Redis/worker/storage والمفاتيح الفعلية في البيئة الحية **غير متحققة**.
- تصنيفات الأدلة: **منفّذ** = مسار كود فعّال؛ **مهيأ/معطّل افتراضيًا** = موجود خلف بوابة؛ **مرحلي** = قيمة/واجهة موجودة بلا إنفاذ كامل؛ **غير متحقق** = لا تكفي الشيفرة لإثبات حالة التشغيل.

## 2. الملخص التنفيذي والقرار

القرار المقترح هو بناء AWJ Intelligence كطبقة تنسيق وقراءة صغيرة فوق الضوابط الحالية، لا كمنظومة ERP أو مركز مستندات أو مركز مساعدة بديل. توجد بالفعل إدارة مركزية مشفرة لاتصالات OpenAI وAnthropic وGemini، وسجل تدقيق للإعدادات، ومسار Document Center متعدد المستأجرين، وخدمات تقارير مالية حتمية. لكن هذه العناصر لا تكوّن مساعدًا عامًا اليوم، وبعض الإعدادات الحالية خاصة بالمستندات ولا يجوز تفسيرها كموافقة لإرسال بيانات مالية أو موارد بشرية.

| المجال | القرار | السبب |
|---|---|---|
| مخزن اتصال المزوّد والمفتاح | **Reuse + Extend** | إعادة استخدام الملكية المركزية والتشفير والإخفاء والتدقيق؛ إضافة ملفات استخدام feature-specific بلا مخزن أسرار ثانٍ. |
| محولات استخراج المستند | **Isolate transport by feature** | المحولات الحالية تبني prompts وschemas لاستخراج مستند. تُشارك هوية الاتصال والحوكمة، لا payload أو prompt الخاص بالاستخراج. |
| Document Center | **Reuse** | intake/storage/scan/extract/review/governance/retention موجودة؛ لا upload أو evidence store جديد. |
| موافقة المستأجر | **Extend separately** | `allow_document_sending` وسياسة `document_intelligence` تخصان المستندات؛ يلزم opt-in مستقل للمساعد ولكل فئة بيانات. |
| RBAC ونطاق الفرع/المخزن | **Reuse + re-evaluate per tool call** | السياقات والسياسات الحالية هي مصدر الصلاحية، لكن يجب رفض النطاق الممنوع صراحةً وعدم الاعتماد على prompt أو session قديمة. |
| تقارير AR/AP/P&L | **Reuse deterministic services** | `ReportService` يحسب النتائج من بيانات النظام؛ النموذج يشرح النتيجة فقط ولا يولد SQL أو أرقامًا. |
| Help Center | **Reuse content and context map** | المحتوى الثنائي وربط المسارات موجودان؛ المطلوب index مشتق لا CMS أو route tree جديد. |
| القياس وحدود التكلفة | **Extend before paid rollout** | القياس الحالي لا يحتسب الفشل، ولا يحجز الحصة ذريًا، والتكلفة غير محسوبة؛ غير كافٍ لمساعد متعدد المستأجرين. |

**قرار الإطلاق:** لا يوصى بتفعيل نموذج مدفوع لمساعد عام قبل AI-FOUND-1. البداية الآمنة هي gateway مغلق افتراضيًا، mock/offline، وسياسة موافقة مستقلة، ثم pilot قراءة مالية ضيق. رصيد Anthropic الترويجي البالغ 100 دولار وسيلة تطوير مؤقتة فقط، وليس ميزانية إنتاج أو ضمان استمرارية.

## 3. الوضع الحالي كما يثبته الكود

### 3.1 إدارة المنصة واتصالات الذكاء الاصطناعي

تعرّف `PlatformIntegrationService` أربعة مجالات إعداد: التخزين، الماسح، معالجة المستند، و`document_ai`. داخل `document_ai` توجد مفاتيح `openai` و`anthropic` و`google_gemini`، مع مزوّد رئيسي واثنين fallback كحد أقصى، model، timeouts، attempts، حدود عمليات/صفحات شهرية، `allow_document_sending`، وحقول معلنة للمنطقة وسياسة الاحتفاظ.

الإعداد صف واحد عالمي للمنصة ولا يحمل `tenant_id`. `PlatformIntegrationSetting::$casts` يستخدم `encrypted:array` ويخفي `configuration` عند serialization. الواجهة تستقبل نسخة masked فقط. تحديث الإعداد يتطلب `platform:manage` وإعادة إدخال كلمة مرور مدير المنصة، بينما اختبار الاتصال يتطلب `platform:manage` لكنه لا يطلب كلمة المرور مرة أخرى؛ كما يكتب metadata للفحص في الإعداد وسجل التدقيق.

تفعيل engine يتطلب أن يكون المزوّد المحدد enabled، وأن توجد key وmodel، وأن يكون `allow_document_sending=true`. لكن اختبار الاتصال يستطيع تشغيل طلب محدود قبل تفعيل engine أو موافقة إرسال المستند. لذلك هو عملية إدارية ذات أثر وتكلفة محتملة، وليس read-only diagnostic. لم يتم تشغيله في هذا التدقيق.

الواجهة الحالية غير متناظرة تمامًا: بطاقة Gemini توفر حفظًا/تشخيصًا على مستوى البطاقة وحالة dirty أوضح، بينما OpenAI وAnthropic يعتمدان أكثر على حفظ النموذج العام ورسائل اختبار أبسط. هذا فرق UX، لا دليل على فرق في تشفير المفاتيح.

### 3.2 Document Center

المسار الحالي متكامل وظيفيًا على مستوى الكود:

1. ينشئ intake batch/file داخل `TenantContext` و`BranchContext`.
2. يحفظ الملف في تخزين خاص، يجري الفحص الأولي وhash، ثم يرسل scan job.
3. لا يسمح الاستخراج قبل نتيجة scan مقبولة، ويعيد العامل تثبيت سياق المستأجر والفرع.
4. يتحقق `DocumentExtractionService` مرة أخرى من بوابات المنصة والشبكة وسياسة المستأجر وحالة scan والملف قبل إرسال المحتوى.
5. يجرب primary ثم fallbacks المسجلة عبر `DocumentExtractionProviderRegistry`.
6. يطبع extraction normalized، ثم يعرض review/readiness، ويمكن إنشاء draft محاسبي فقط بعد المراجعة؛ لا يوجد posting ذاتي.
7. يسجل governance events ويدعم hold/redaction overlay/purge محكوم.

العزل متعدد الشركات موجود في النماذج والخدمات والـ jobs: `BaseModel` يطبق `TenantScope`، ونماذج المستند Branch-scoped، والإنشاء يأخذ tenant/branch من السياق الموثوق لا من payload العميل. مفاتيح المزوّد مركزية وليست per-tenant. المستأجر يملك opt-in ومعايير نوع المستند، لا مفتاح API مستقل.

هناك حدود تشغيلية مهمة:

- `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED=false` افتراضيًا؛ الاتصال الخارجي fail-closed.
- `DOCUMENT_DURABLE_STORAGE_ENABLED=false` افتراضيًا؛ التخزين المتين ليس مثبت التفعيل في الإنتاج.
- ملف `render.yaml` المراجع يصف web/database ولا يثبت وجود queue worker/Redis أو تخزين متين. هذا لا يثبت أن الإنتاج غير مجهز، لكنه يجعل الجاهزية **غير متحققة من المستودع**.
- `DocumentIntelligencePolicy` ينفذ opt-in وأنواع المستندات المسموح بها. في المقابل، `retention_mode` و`attaches_original_to_record` يظهران كإعداد/تفضيل، بينما planner/runner الحالي يطبق سياسة الاحتفاظ العالمية للمنصة؛ لذا لا ينبغي وصفهما كسياسة احتفاظ مستأجر منفذة بالكامل.
- تعليمات normalizer تعامل نص المستند كبيانات غير موثوقة وتمنع اتباع تعليماته وتطلب schema صارمة. هذا أساس جيد ضد prompt injection، لكنه لا يغني عن عزل الأدوات والـ authorization في المساعد العام.

### 3.3 الأمن: المستأجر والمستخدم والنطاق والحقول

المسارات الاعتيادية تمر عبر Sanctum و`EnsureUserPrincipal` ثم `SetTenant` و`SetBranch`. `SetTenant` يطابق tenant المضيف مع Tenant المستخدم ويتحقق من نشاط المستأجر والمستخدم في كل طلب. `SetBranch` لا يقبل `X-Branch-Id` إلا إذا كان UUID تابعًا للمستأجر ومتاحًا للمستخدم.

يعيد `/me` permissions و`tenant_id` و`branch_ids` و`warehouse_ids`. الملاحظة الحرجة أن القائمة الفارغة في نموذج الوصول الحالي تعني **غير مقيّد/الكل**، لا «لا شيء». أي gateway جديد يجب أن يستخدم helpers الحالية التي تعيد `null` للدلالة على unrestricted، ولا يعيد تفسير JSON الخام.

تطبق `EnsurePermission` صلاحيات RBAC، وتطبق التقارير `ReportBranchScope` و`ReportWarehouseScope`. عند طلب نطاق ممنوع، بعض helpers الحالية تصل إلى تقاطع فارغ ثم تعود إلى كل النطاق المسموح للمستخدم. هذا لا يتجاوز صلاحيات المستخدم، لكنه قد يوسّع الاستعلام خلافًا لنية السؤال. أداة AI يجب أن ترفض branch/warehouse الممنوع صراحةً بدل fallback.

توجد سياسة حساسية واضحة لتكلفة المنتجات عبر `SensitiveCostPolicy` وصلاحية `products.view_cost`، لكن لا توجد بعد taxonomy موحدة لكل حقول finance/HR. كما أن redaction في Document Center طبقة عرض/تصدير؛ الأصل غير القابل للتغيير يبقى موجودًا وقد يكون أرسل إلى مزوّد الاستخراج. يجب ألا تقرأ أداة المساعد payload الخام عندما تكون النسخة projected/redacted هي المصرح بها.

### 3.4 تقارير pilot المالي

`ReportService` يوفر حسابات حتمية لـ income statement وaging receivable/payable من قيود وفواتير النظام، مستخدمًا قيم minor-unit integer وتحويل `Money::toRiyal`. لا حاجة ولا مبرر لـ SQL مولّد من النموذج.

قيود التصميم التي يجب تثبيتها في العقد:

- مسارات التقارير محمية حاليًا بـ `reports.view` وتطبق نطاق الفرع، لكن أي drill-down إلى عميل/مورد يحتاج صلاحية الكيان أيضًا.
- income statement فترة `from/to`، بينما balance sheet «as of `to`». Aging له `as_of` وbuckets محددة ويعتمد الرصيد المتبقي للوثائق؛ يجب عرض basis وعدم مساواته تلقائيًا بحساب control ledger.
- بعض controllers تستخدم `Request` مباشرة بدل request DTO موحد؛ على أدوات AI أن تفرض ISO dates وtimezone وحدود فترة صريحة.
- `Money::toRiyal` يحمل افتراض SAR في الاسم/العرض، بينما Tenant يملك `currency`. ينبغي أن يرجع عقد الأداة currency صريحة، وأن يقيد pilot بـ SAR أو يحل التعدد قبل التوسع.

أصغر allowlist مقترحة:

| الأداة | الخدمة الحتمية | المدخلات | الحواجز |
|---|---|---|---|
| `finance.getIncomeStatement` | `ReportService::incomeStatement` | `from`, `to`, `branch_ids` | `reports.view`، فترة صحيحة، فروع مصرح بها صراحةً |
| `finance.getReceivablesAging` | `ReportService::aging('receivable')` | `as_of`, `branch_ids` | `reports.view`، نطاق فرع، basis واضح |
| `finance.getPayablesAging` | `ReportService::aging('payable')` | `as_of`, `branch_ids` | نفس الحواجز |

لا تشمل المرحلة الأولى account ledger أو journal entries أو arbitrary filters أو partner statement. يمكن إضافة partner statement لاحقًا فقط مع تقاطع `reports.view` وصلاحية partner المعني. تعيد الأدوات DTO متضمنة الفترة/التاريخ، العملة، النطاق الفعلي، generated-at، basis، وروابط عميقة مصرح بها. دور النموذج تلخيص الأرقام لا إنشاؤها.

### 3.5 Help Center

`web/src/modules/help-center/content.ts` هو مصدر المحتوى الثنائي الحالي: slugs وcategories وkeywords وsections وactions وrelated articles، مع بحث محلي حتمي. `context.ts` هو خريطة route-to-article المركزية، وتستخدمها صفحات ومكونات Help Center الحالية. لا يوجد backend CMS أو vector store أو RAG.

المقترح هو توليد artifact/index للقراءة فقط من هذا المصدر في build أو عبر عقد مشترك، مع citation إلى `slug/locale/section`. لا ينبغي إنشاء محتوى موازٍ يدويًا أو شجرة routes أو بحث مستقل. كما يجب ترشيح actions/deep links بصلاحيات المستخدم؛ ظهور شرح لا يعني السماح بتنفيذ action.

## 4. مصفوفة الأدلة

| القدرة | مسار الكود والرمز | الحالة | الخطر/الحد | التوصية |
|---|---|---|---|---|
| حماية إدارة المنصة | `routes/api.php`؛ `EnsurePlatformAdministrator` | منفّذ | فصل read/manage موجود | إعادة الاستخدام؛ لا تعرض أسرارًا للمساعد |
| تخزين إعداد التكامل | `app/Models/PlatformIntegrationSetting.php`؛ `$casts`, `$hidden` | منفّذ | عالمي، لا tenant owner | مصدر اتصال مركزي واحد |
| تحديث الإعداد | `app/Services/PlatformIntegrationService.php::update` | منفّذ | يغير كل config ويطلب password | إبقاء write path خارج assistant |
| المزوّدون | `PlatformIntegrationService::AI_PROVIDER_KEYS` | منفّذ | محصور في document AI حاليًا | connection resolver عام مع feature profiles |
| primary/fallback | `PlatformIntegrationService::normalizeDocumentAiConfiguration` | منفّذ | fallback قد يغير جهة مشاركة البيانات | تقاطع provider allowlist لكل feature/tenant |
| readiness | `PlatformIntegrationService::assertDocumentAiConfiguration`; `DocumentProviderConfiguration::isOperationallyReady` | منفّذ | `allow_document_sending` وثيقة فقط | لا تعممه على finance/HR |
| اختبار الاتصال | `PlatformIntegrationService::test`; `testDocumentAiProvider` | منفّذ | طلب خارجي وكتابة audit/metadata وتكلفة محتملة | عملية privileged واضحة؛ قياس كلفتها |
| إخفاء الأسرار | `PlatformIntegrationService::publicConfiguration` | منفّذ | يحتاج منع logging downstream أيضًا | server-only + redaction tests |
| تدقيق الإعداد | `app/Models/PlatformIntegrationAuditEvent.php` | منفّذ | changed keys بلا قيم، جيد؛ لا يغطي assistant | سجل assistant مستقل metadata-first |
| UI integrations | `web/src/app/platform/(console)/integrations/page.tsx`, `payload.ts`, `ai-form.ts` | منفّذ | UX غير متناظر بين البطاقات | توحيد لاحقًا، ليس ضمن ARCH-0 |
| network gate | `app/Services/DocumentCenter/DocumentProviderNetworkGate.php`; `config/document_center.php` | مهيأ/معطل افتراضيًا | حالة الإنتاج غير متحققة | fail-closed مستقل لكل feature |
| provider registry | `app/Services/DocumentCenter/DocumentExtractionProviderRegistry.php` | منفّذ | محولات extraction لا chat | مشاركة الاتصال فقط، عزل payload |
| OpenAI extraction | `app/Services/DocumentCenter/OpenAIDocumentExtractionProvider.php` | منفّذ | إرسال محتوى لطرف خارجي | schema/consent/metering |
| Anthropic extraction | `app/Services/DocumentCenter/AnthropicDocumentExtractionProvider.php` | منفّذ | نفس الخطر | نفس الحواجز |
| Gemini extraction | `app/Services/DocumentCenter/GoogleGeminiDocumentExtractionProvider.php` | منفّذ | نفس الخطر | نفس الحواجز |
| حقن prompt بالمستند | `app/Services/DocumentCenter/DocumentExtractionNormalizer.php::instruction` | منفّذ جزئيًا | النص غير موثوق لكن ليس sandbox كاملاً | لا أدوات للمستند؛ فصل instructions/data |
| intake والعزل | `DocumentFileIntakeService`, `DocumentBatch`, `DocumentFile` | منفّذ | يعتمد صحة contexts | لا تعيد بناء upload/evidence |
| scan | `DocumentProcessingService`; `Jobs/ScanDocumentFile.php` | منفّذ | scanner runtime غير متحقق | لا extraction قبل clean admission |
| extraction orchestration | `DocumentExtractionService::process` | منفّذ | retries/fallback قد تزيد التكلفة | idempotency + atomic reservation |
| tenant document policy | `DocumentIntelligencePolicy` | منفّذ للاستخراج | لا يوافق على finance/HR | سياسة `ai_assistant` مستقلة |
| usage events | `DocumentProviderUsageEvent`; `DocumentUsageReportingService` | منفّذ جزئيًا | النجاح فقط؛ cost null؛ quota غير ذري | meter attempts/tokens/cost/reservations |
| حدود شهرية | `DocumentExtractionService::withinUsageLimit` | منفّذ جزئيًا | events tenant+branch-scoped رغم config عالمي؛ سباق | تحديد معنى global/tenant، hard stop ذري |
| retention | `DocumentRetentionPlanner`, `DocumentRetentionRunner` | منفّذ عالميًا | تفضيل tenant لا يقود التنفيذ | توثيق precedence أو إنفاذ حقيقي لاحقًا |
| durable storage | `DocumentStorageService`; `config/document_center.php`; `render.yaml` | غير متحقق للإنتاج | الافتراضي local/non-durable | gate deployment قبل AI-DOC-4 |
| review/draft | `DocumentReviewController`; `DocumentReviewReadinessPolicy` | منفّذ | خطر خلط review مع posting | read-only assistant؛ human approval باقٍ |
| tenant boundary | `TenantContext`, `TenantScope`, `BaseModel`, `SetTenant` | منفّذ | session/caches قد تصبح stale | resolve actor والسياق كل invocation |
| branch boundary | `SetBranch`, `BranchScope`, `ReportBranchScope` | منفّذ | forbidden empty intersection قد يتسع | reject explicit unauthorized scope |
| warehouse boundary | `ReportWarehouseScope`; `/me` scope payload | منفّذ | empty means unrestricted | استخدم helpers، لا raw arrays |
| RBAC | `Rbac`, `EnsurePermission` | منفّذ | صلاحية endpoint قد لا تكفي لحقل حساس | policy registry للأداة/الكيان/الحقل |
| field sensitivity | `SensitiveCostPolicy` | منفّذ لنطاق محدود | لا taxonomy عامة | deny-by-default للحقول عالية الحساسية |
| تقارير مالية | `ReportService`; `ReportController` | منفّذ | تواريخ/عملة/basis تحتاج عقدًا أوضح | wrappers حتمية allowlisted |
| Help content | `web/src/modules/help-center/content.ts` | منفّذ | client TS وليس backend knowledge API | build artifact مشتق واحد |
| Help context | `web/src/modules/help-center/context.ts` | منفّذ | الروابط قد تكشف actions غير مسموحة | filter by actor permissions |
| مساعد عام | لا يوجد gateway/tool registry/conversation store في `main` | غير موجود | بناء مباشر على provider يسبب bypass | AI-FOUND-1 أولاً |

## 5. نموذج أسبقية الإعداد والصلاحية

لا يجوز لأي طبقة أدنى أن توسع سماح طبقة أعلى. الترتيب المقترح لكل استدعاء أداة أو مزوّد:

1. **بوابات المنصة:** feature kill switch، اتصال مزوّد صالح، network gate، قائمة models، hard global budget، ومتطلبات الإقامة/الاحتفاظ.
2. **سياسة المستأجر:** entitlement، opt-in للمساعد، data-category consent (`financial_summary`, `document_projected_text` وغيرهما)، provider allowlist، وحد tenant hard budget.
3. **هوية الفاعل:** مستخدم نشط الآن، permission للأداة، tenant مطابق، branch/warehouse effective scope، وfield sensitivity.
4. **العقد الحتمي:** أداة allowlisted، schema validated، period/filter limits، query cost limits، وعدم وجود arbitrary SQL/URL/tool.
5. **اختيار المزوّد:** من تقاطع ما تسمح به الطبقات السابقة فقط. الفشل أو fallback لا يوسع الموافقة إلى مزوّد آخر.

أي رفض في أي طبقة يوقف العملية قبل بناء prompt وقبل حجز/إرسال البيانات. يجب فصل مفاهيم الملكية:

| الشيء | المالك المقترح |
|---|---|
| API key/provider account والفاتورة الخارجية | المنصة |
| السماح بتشغيل feature/provider/data category | المنصة ∩ المستأجر |
| السماح بقراءة السجل/الحقل الحالي | المستخدم وفق RBAC والنطاق |
| حصة المنصة | platform hard cap |
| حصة الشركة | tenant hard cap مستقل، لا مجرد dashboard |
| القياس | tenant + actor + feature + tool + provider + model + request id |

تظل المفاتيح server-only في مخزن اتصال واحد. يضاف feature profile يشير إلى الاتصال المركزي بدل نسخ المفتاح داخل إعداد المستأجر. لا يكفي `allow_document_sending` للموافقة على `financial_summary`، ولا يكفي opt-in الشركة لمنح مستخدم غير مخول صلاحية تقرير.

## 6. المعمارية الدنيا الآمنة المقترحة

```text
Next.js assistant surface
        |
        v
Laravel AI Gateway (auth + tenant + current actor re-check)
        |
        +--> Policy engine (platform ∩ tenant ∩ actor ∩ field)
        +--> Allowlisted deterministic tools
        |       +--> ReportService wrappers
        |       +--> Help Center derived index
        |       +--> Document Center projected/read models (later)
        +--> Meter reservation / immutable audit
        +--> Feature-specific provider adapter
                +--> central encrypted provider connection
```

خصائص الحد الأدنى:

- gateway واحد داخل Laravel؛ لا اتصال مزوّد من المتصفح ولا `NEXT_PUBLIC_*` key.
- conversation input محدود الحجم، مع system instructions ثابتة وفصل واضح بين التعليمات وtool output.
- tool registry مغلق، input/output schemas، timeouts، عدد خطوات محدود، وعدم تنفيذ SQL أو shell أو URL يختاره النموذج.
- authorize **قبل** قراءة البيانات، ثم إعادة فحص قبيل tool invocation؛ لا تعتمد على permission snapshot داخل المحادثة.
- النتائج المالية من الخدمة الحتمية وتُعرض مع citation داخلي وscope/period/currency/basis.
- cache معطلة مبدئيًا. إن أضيفت: المفتاح يتضمن tenant، actor authorization version، branch/warehouse scope، tool، filters، sensitivity policy وlocale؛ TTL قصير، ولا raw documents؛ revocation invalidation.
- audit metadata-first: request ID، actor/tenant، tool، filters hash، provider/model، token/latency/outcome/policy decision. لا تخزن prompt أو PII الخام افتراضيًا.
- meter يحجز حدًا أعلى ذريًا قبل الطلب، ويسوي actual usage بعده، ويحتسب الفشل/retry/test. hard stop منفصل للمنصة والمستأجر.
- لا production fallback لمزوّد لم يوافق عليه المستأجر أو لا يحقق data residency المطلوبة.

## 7. الفجوات والمخاطر

| الخطر | دليل/سيناريو | الضابط المطلوب قبل التفعيل |
|---|---|---|
| Tenant bleed | مفاتيح مزوّد مشتركة وLLM layer جديدة قد تتجاوز `TenantScope` | tenant ID من context فقط، policy tests، no cross-tenant cache |
| Branch/warehouse bleed | empty scope يعني unrestricted وforbidden filter قد fallback | canonical effective scope + reject explicit forbidden IDs |
| Revoked access | conversation قد تستمر بعد تغيير الدور | إعادة تحميل actor/permissions في كل request/tool call |
| Malicious document | محتوى مستند يحاول تغيير التعليمات أو استدعاء أداة | documents data-only، projected view، no tools from document text |
| PII/financial disclosure | موافقة المستند لا تشمل finance/HR | feature/data-category consent منفصل + minimization |
| Secret disclosure | logging أو browser bundle | اتصال server-only، masking، secret scanning/log tests |
| Cross-tenant caching | cache key ناقص | تعطيل أولي أو key كامل وauthorization version |
| Cost runaway | النجاح فقط يُقاس؛ retries/failures والسباق | atomic reservation، hard caps، pricing catalog، alerts/kill switch |
| Provider outage | fallback قد ينقل البيانات إلى طرف غير موافق | authorized intersection؛ fail closed عند عدم وجود بديل |
| Data residency | `data_region` قيمة معلنة لا يثبت الكود إنفاذها | contractual/provider validation + deployment decision |
| Retention mismatch | tenant preference لا يقود runner الحالي | توضيح policy source وإنفاذه قبل ادعاء compliance |
| Non-durable evidence | repository defaults لا تثبت durable storage/worker | deployment gate وrunbook وhealth evidence |
| Hallucinated figures | نموذج حر يحسب أو يولد query | deterministic tools؛ totals from service؛ citations |
| Currency/date ambiguity | Riyal helper وRequest غير موحد | explicit currency/timezone/ISO period contract |

## 8. خطة التنفيذ المرحلية

### AI-FOUND-1 — Secure foundation

النطاق: gateway داخلي مغلق افتراضيًا، tool registry فارغ/Mock، provider connection resolver يعيد استخدام المخزن المركزي دون إعادة استخدام extraction payload، feature profile، سياسة tenant `ai_assistant` مستقلة، actor re-authorization، audit/usage reservation، global/tenant hard stops، وkill switch.

بوابة القبول:

- لا يمكن للمتصفح رؤية مفتاح، ولا يوجد اتصال خارجي عند الإعداد الافتراضي.
- اختبارات tenant/branch/warehouse/revocation والسياسة المتقاطعة تمر.
- لا يستطيع `allow_document_sending` وحده تفعيل finance أو HR.
- retries/failures/tests تُقاس، والحجز الذري يمنع تجاوز hard cap في concurrency test.
- fallback لا يخرج عن provider allowlist وresidency.

### AI-READ-2 — Read-only finance pilot

النطاق: الأدوات الثلاث فقط لـ P&L وAR aging وAP aging، wrappers فوق `ReportService`، DTO صريح للعملة/الفترة/basis/scope/citations، وحدود query/time/token.

بوابة القبول:

- parity tests تقارن tool output بخدمة التقرير نفسها، بما فيها minor units والتقريب.
- permission + explicit scope rejection + tenant isolation tests تمر.
- لا SQL مولّد، لا ledger/journal drill-down، ولا action/write tool.
- إجابات Arabic/English تذكر التاريخ/الفترة والعملة ومصدر الرقم.

### AI-UX-3 — Contextual assistant UI

النطاق: واجهة عربية/إنجليزية في Next.js، حالات disabled/consent/quota/provider unavailable، deep links مصرح بها، وإعادة استخدام Help Center context.

بوابة القبول:

- accessible keyboard/screen-reader flow، ولا secrets أو raw policy internals في client.
- تبديل tenant/branch/logout/revocation يلغي السياق ولا يعيد استخدام cache قديمة.
- روابط help/actions لا تظهر إلا بعد permission filtering.
- لا تفعيل provider أو تغيير policy من محادثة المستخدم.

### AI-DOC-4 — Grounded Document Center assistance

النطاق: قراءة projected/redacted review data والمحتوى المسموح فقط من Document Center، مع citation إلى document/file/review section، ومن دون upload/storage/scan/extraction pipeline جديد.

بوابة القبول:

- يتطلب consent منفصلًا لاستخدام document data في المساعد، إضافة إلى ضوابط الاستخراج الحالية.
- لا يصل إلى quarantined/unscanned/purged/held data بصورة تخالف السياسة.
- prompt-injection corpus يثبت أن نص المستند لا يختار الأدوات أو يغير tenant/scope.
- readiness مثبتة للتخزين المتين والworker والretention في البيئة المستهدفة.

### خارج النطاق صراحةً

- posting/approval/payment/tax filing أو أي write tool.
- HR/payroll أو بيانات شخصية حساسة إضافية.
- arbitrary SQL، code execution، browser action، أو URL fetching.
- إنشاء Help Center CMS أو vector database أو Document Center جديد.
- مفاتيح per-tenant أو billing passthrough قبل قرار منتج/تعاقد مستقل.
- تغيير migration/schema أو config حي أو provider/model أو deployment ضمن هذه المهمة.
- دمج PR #1543 أو هذا التقرير أو نشرهما.

## 9. الاختبارات المقترحة

### اختبارات يجب إضافتها في PRs التنفيذية

- مصفوفة platform disabled / tenant disabled / actor denied / field denied، مع إثبات deny wins.
- cross-tenant IDs وroute binding وcache poisoning.
- branch/warehouse unrestricted-vs-empty semantics ورفض scope الممنوع صراحةً.
- revocation بين رسالتين وبين planning وtool invocation.
- provider allowlist/fallback/residency وnetwork kill switch.
- secret masking في API/log/exceptions/browser bundle.
- atomic quota reservations مع requests متزامنة، واحتساب failure/retry/test.
- finance parity، currency، date boundaries، fiscal-close behavior، aging basis.
- malicious prompts داخل invoices/attachments وoversized/encoded payloads.
- redacted/projected document output وعدم تسرب raw extraction.
- Help citations وpermission-filtered deep links باللغتين.

### الفحوصات المنفذة في هذا التدقيق

| الفحص | النتيجة |
|---|---|
| مزامنة `origin/main` وقراءة SHA | Pass |
| جلب وقراءة PR #1543 دون merge | Pass؛ Draft مفتوح، Head موثق أعلاه |
| بحث ساكن وتتبع routes/services/models/config/tests ذات الصلة | Pass |
| مراجعة إعدادات النشر داخل المستودع | Pass؛ لا تعد إثباتًا لحالة الإنتاج |
| استدعاء provider أو `test connection` | **Skipped عمدًا**؛ قد يكون مدفوعًا/ذا أثر |
| Laravel/Next full suite | **Not run**؛ غير ضروري لتغيير Markdown فقط |
| فحص تنسيق diff | Pass |

نجاح checks التاريخية الظاهرة في PR #1543 لا يُسجل كاختبارات شغّلها هذا التدقيق.

## 10. المجهولات والقرارات المطلوبة

1. **ملكية الفاتورة:** هل تتحمل المنصة التكلفة بالكامل، أم توجد حصص/خطط مدفوعة للشركات؟ يلزم قرار Product/Finance قبل AI-FOUND-1 hard-cap schema.
2. **موافقة البيانات:** تحديد taxonomy أولية للفئات (`financial_summary`, `document_projected_text`، وما هو محظور) ونص موافقة المستأجر.
3. **المزوّد والإقامة:** الجهات والمناطق وشروط عدم التدريب/الاحتفاظ المعتمدة تعاقديًا؛ حقل الإعداد الحالي وحده لا يثبت ذلك.
4. **العملة:** هل pilot مقصور على SAR أم يجب جعل report DTO متعدد العملات أولاً؟
5. **معنى الحصة الحالية:** هل حدود document provider عالمية فعلًا أم مقصود بها لكل tenant/branch؟ الكود والإعداد يعكسان معنيين مختلفين.
6. **الاحتفاظ:** هل tenant retention preference مطلوب أن يتغلب على/يضيق policy المنصة؟ يحتاج precedence قرارًا ثم اختبارًا.
7. **جاهزية التشغيل:** إثبات worker/Redis، durable storage، scanner، backups، network gate، ومراقبة الاستهلاك في البيئة المستهدفة.
8. **حفظ المحادثات:** هل هناك حاجة عمل فعلية لها؟ التوصية الابتدائية عدم حفظ prompt/response الخام، وتحديد retention/DSAR قبل أي persistence.
9. **الحقول الحساسة:** تعيين Data Owner لبناء field policy registry قبل finance drill-down أو HR.

## 11. الملفات التي تمت مراجعتها

### الخطة والتوجيه

- `docs/plans/ai/AWJ_INTELLIGENCE_MASTER_PLAN.md` من PR #1543 فقط.
- `docs/plans/help-center/AWJ_HELP_CENTER_V2_MASTER_PLAN.md`.
- `deploy/DEPLOY.md`, `render.yaml`.

### إدارة المنصة والتكاملات

- `routes/api.php`.
- `app/Http/Middleware/EnsurePlatformAdministrator.php`.
- `app/Http/Controllers/Api/PlatformIntegrationController.php`.
- `app/Http/Requests/UpdatePlatformIntegrationRequest.php`.
- `app/Models/PlatformIntegrationSetting.php`.
- `app/Models/PlatformIntegrationAuditEvent.php`.
- `app/Services/PlatformIntegrationService.php`.
- `database/migrations/2025_01_01_000119_create_document_processing_platform.php`.
- `web/src/app/platform/(console)/integrations/page.tsx`.
- `web/src/app/platform/(console)/integrations/payload.ts`.
- `web/src/app/platform/(console)/integrations/ai-form.ts`.

### Document Center والمزوّدون والحوكمة

- `config/document_center.php`.
- `app/Models/DocumentBatch.php`, `app/Models/DocumentFile.php`, `app/Models/DocumentProviderUsageEvent.php`.
- `app/Http/Controllers/Api/DocumentIntakeController.php`.
- `app/Http/Controllers/Api/DocumentReviewController.php`.
- `app/Services/DocumentCenter/DocumentFileIntakeService.php`.
- `app/Services/DocumentCenter/DocumentStorageService.php`.
- `app/Services/DocumentCenter/DocumentProcessingService.php`.
- `app/Services/DocumentCenter/DocumentExtractionService.php`.
- `app/Services/DocumentCenter/DocumentExtractionProviderRegistry.php`.
- `app/Services/DocumentCenter/DocumentExtractionNormalizer.php`.
- `app/Services/DocumentCenter/DocumentUsageReportingService.php`.
- `app/Services/DocumentCenter/DocumentRetryService.php`.
- `app/Services/DocumentCenter/DocumentReviewReadinessPolicy.php`.
- `app/Services/DocumentCenter/DocumentIntelligencePolicy.php`.
- `app/Services/DocumentCenter/DocumentRetentionPlanner.php`.
- `app/Services/DocumentCenter/DocumentRetentionRunner.php`.
- `app/Services/DocumentCenter/DocumentProviderNetworkGate.php`.
- `app/Services/DocumentCenter/OpenAIDocumentExtractionProvider.php`.
- `app/Services/DocumentCenter/AnthropicDocumentExtractionProvider.php`.
- `app/Services/DocumentCenter/GoogleGeminiDocumentExtractionProvider.php`.
- `app/Jobs/DocumentCenter/ScanDocumentFile.php`, `app/Jobs/DocumentCenter/ExtractDocumentFile.php`.
- `web/src/components/document-center/document-upload-dialog.tsx`.
- `web/src/components/documents/document-intelligence-settings.tsx`.

### المستأجر والصلاحيات والتقارير والمساعدة

- `app/Tenancy/TenantContext.php`, `app/Tenancy/TenantScope.php`, `app/Tenancy/BranchScope.php`.
- `app/Models/BaseModel.php`, `app/Models/Tenant.php`, `app/Models/User.php`.
- `app/Http/Middleware/SetTenant.php`, `app/Http/Middleware/SetBranch.php`, `app/Http/Middleware/EnsurePermission.php`.
- `app/Http/Controllers/Api/AuthController.php`.
- `app/Support/Rbac.php`.
- `app/Support/ReportBranchScope.php`, `app/Support/ReportWarehouseScope.php`.
- `app/Support/SensitiveCostPolicy.php`.
- `app/Services/Reporting/ReportService.php`.
- `app/Http/Controllers/Api/ReportController.php`.
- `app/Http/Requests/GeneralReportRequest.php`.
- `app/Support/Money.php`.
- `web/src/modules/help-center/content.ts`, `web/src/modules/help-center/context.ts`.
- `web/src/app/(app)/help/page.tsx`, `web/src/app/(app)/help/[slug]/page.tsx`.

### الاختبارات التي تمت قراءتها ولم تُشغّل

- `tests/Feature/PlatformIntegrationSettingsTest.php`.
- `tests/Feature/GeminiIntegrationSettingsTest.php`.
- `tests/Feature/GeminiConnectionDiagnosticTest.php`.
- `tests/Feature/DocumentExtractionProviderTest.php`.
- `tests/Feature/DocumentCenterIsolationMatrixTest.php`.
- `tests/Feature/DocumentCenterIntakeCrossTenantTest.php`.
- `tests/Feature/DocumentBranchScopeTest.php`.
- `tests/Feature/ReportEffectiveScopeTest.php`.
- `tests/Feature/ReportStatementsTest.php`.
- `tests/Feature/FinancialStatementsTest.php`.
- `tests/Feature/UserAccessScopeTest.php`.

## 12. النتيجة والخطوة التالية

لا يوجد مانع معماري من بناء pilot آمن إذا أعيد استخدام services والسياسات الحالية وبدأ العمل بـ AI-FOUND-1. المانع الحالي هو غياب طبقة موافقة/صلاحية/قياس خاصة بالمساعد، وليس غياب مزوّدي AI أو البيانات الحتمية.

**الخطوة التالية المقترحة:** اعتماد قرارات الملكية والموافقة والحصة والإقامة والعملـة في القسم 10، ثم كتابة design contract لـ AI-FOUND-1 واختباراته دون تفعيل أي مزوّد. يبقى هذا التقرير وPR #1543 في حالة Draft/Review؛ لا merge ولا deploy ضمن AI-ARCH-0.

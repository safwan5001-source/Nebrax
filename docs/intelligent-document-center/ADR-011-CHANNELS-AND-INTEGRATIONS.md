# ADR-011 — Channels and Integrations

- **Status:** Accepted
- **Scope:** PR-11
- **Decision owner:** Intelligent Document Center and application-platform boundaries

## Context

كان استقبال مركز المستندات يمر حصراً بمسار الويب اليدوي: ينشئ المتحكم `DocumentBatch` ثم يفوض الملف إلى `DocumentFileIntakeService`. هذا المسار هو المالك الفعلي لفحص بايتات الملف، MIME الحقيقي، الحجم، الصفحات، SHA-256، التخزين الخاص، التعويض عند الفشل، وحالة الحجر والتنزيل الموقّع. ينشأ tenant وbranch للحزمة والملف من `TenantContext` و`BranchContext` فقط.

تحتاج المرحلة إلى عقد استقبال محايد للمصادر ومنع إعادة تسليم الرسالة، من دون تحويل هذه الحاجة إلى ربط WhatsApp أو بريد أو endpoint عام. لا يملك المستودع وقت هذا القرار طبقة inbound API credential أو OAuth machine identity معتمدة ومحددة النطاق للمستأجر: Sanctum الحالي هو لحساب مستخدم أو مسؤول منصة، و`PlatformIntegrationService` خاص بإعدادات بنية تحتية مشفرة لا بهوية قناة tenant.

> لا يجوز أن تصبح `tenant_id` أو `branch_id` أو checksum أو storage key أو workflow أو scan status أو credential المرسلة من المصدر سلطة تشغيلية. المرجع الخارجي دليل تدقيق، لا تفويضاً للنطاق.

## Decision

يبني PR-11 عقداً **داخلياً** فقط: `DocumentSourceConnector` مع `DocumentSourceEnvelope` immutable و`DocumentSourceReceipt`. التنفيذ الأول هو `WebDocumentSourceConnector` لقناة `web` المحلولة من هوية داخلية موثوقة. تبقى `api` قيمة معروفة في العقد لكنها ترفض بالكود الثابت `document_source_not_supported`؛ لا يوجد route أو API key أو OAuth أو webhook أو مزود في هذه المرحلة.

| طبقة | القرار الملزم |
|---|---|
| حد المصدر | لا ينشأ المغلف إلا من `fromResolvedIdentity()` داخل كود موثوق. يقبل نوع مستند معروفاً ومرجعاً خارجياً بعد trim/length validation و`UploadedFile` وmetadata بالقائمة البيضاء فقط. |
| canonicalization | core محايد لحالة الأحرف: لا يخفض identifier أو reference ولا يدمج `CaseRef-A` و`caseref-a` تلقائياً. تفوض canonicalization للقناة؛ `web` وحدها توثق lowercase، وأي قناة مستقبلية تبقى case-sensitive حتى ينص عقدها خلاف ذلك. يحسب fingerprint من القيمة canonical الخاصة بالقناة. |
| metadata | المفاتيح قليلة ومحددة، والقيم JSON-safe صغيرة بعمق اثنين كحد أقصى. ترفض مفاتيح password/secret/token/credential/authorization/raw/payload وtenant/branch/checksum/storage/workflow/scan/processing، فلا تخزن ولا تؤثر في السياق. |
| هوية القناة | `document_channel_identities` كيان `BranchScoped` بحالة `active` أو `disabled` واسم إداري وfingerprint SHA-256 وقيمة عرض مقنّعة. لا تحفظ القيمة الخارجية الخام ولا credential أو token أو webhook secret. |
| حل الهوية | `DocumentChannelIdentityResolver` يفرغ السياق مؤقتاً، ويستعلم فقط عن `(channel, fingerprint)` ذي uniqueness العالمي، ويرفض النتيجة إن خالف tenant للممثل الداخلي. ثم تستعيد السياقات الأصلية. هذا حل ضيق ضروري قبل وجود السياق، لا تجاوز دائم لنطاق المستأجر. |
| التفويض | قبل ضبط سياق الهوية، يفحص `DocumentSourceAccessGate` مستخدمًا نشطًا مطابق tenant وصلاحية `documents.center.manage` ووصول الفرع وقرار `document_center.core` لعملية `WRITE`، بما فيه entitlement وحالة التطبيق. إدارة الهوية تتطلب `documents.center.settings`. |
| الاستقبال | تضبط الخدمة tenant/branch من صف الهوية ضمن `try/finally` قصير، وتحسب البصمة من `DocumentFileInspector`، وتنشئ حزمة `source_type=web` ثم تستدعي `DocumentFileIntakeService::ingest()` و`complete()` حصراً. لا تنسخ قواعد MIME أو التخزين أو الحجر. |
| replay | `document_source_receipts` يحتفظ بهوية القناة والقناة وfingerprint المرجع canonical الخاص بالقناة ومرجع مقنّع وSHA-256 الخادمي وعلاقات الحزمة/الملف. uniqueness على `(document_channel_identity_id, channel, external_reference_fingerprint)` يمنع النسخ حتى مع السباق. |
| نتائج replay | المرجع نفسه مع SHA نفسه يعيد الحزمة والملف القائمين ودلالة `idempotentReplay=true`. المرجع نفسه مع SHA مختلف يسجل `document_source_conflict_rejected` آمنًا ويرمي `document_source_reference_conflict`. لا يعرض السر أو البصمة أو object key. |
| السباق والفشل | تقفل المعاملة الهوية ثم تعيد receipt قائم كقرار replay فقط؛ تسجل الخدمة replay أو conflict بعد commit وخارج المعاملة، فيبقى حدث `document_source_conflict_rejected` محفوظاً مرة واحدة حتى لمسار انتظار القفل. مسار `QueryException` يعيد قراءة الفائز ويطبق المقارنة نفسها. إذا تراجع transaction بعد إنشاء الملف، يحذف كائن التخزين الذي كتبته المحاولة الخاسرة؛ وفشل التخزين قبل هذا لا ينشئ receipt نجاح. |

## Immutability and audit

تكون receipts وسجل `document_source_audit_events` append-only، وهما `BranchScoped` ومربوطان بـforeign keys مقيّدة (`restrict`) كي يبقى دليل الاستقبال متماسكاً. تسجل الأحداث `document_source_received` و`document_source_replayed` و`document_source_conflict_rejected` و`document_source_rejected` وأحداث إنشاء/تعطيل/تفعيل الهوية. يسجل conflict بعد إغلاق معاملة قرار القفل، فلا يسحبه rollback؛ ولا يسجل مرتين لأن قرار receipt القائم يعالج في نقطة واحدة. يستعمل السجل metadata المقنّعة نفسها فقط.

لا يستعمل connector `DocumentWorkflowService` كسجل تدقيق عام. تبقى الخدمة المذكورة مالكة انتقالات الحزمة فقط؛ والاستقبال يستدعيها من خلال `DocumentFileIntakeService` للانتقالات الصحيحة `draft → receiving → received`.

## Safe projections and manual compatibility

لا يتغير `DocumentIntakeController` ولا routes الرفع اليدوي ولا `source_type=manual` ولا بنية مورد الإدخال القائم. تضاف إلى إسقاطات قائمة وتفاصيل المراجعة علاقة receipt اختيارية تتضمن القناة واسم الهوية الإداري وقيمة الهوية والمرجع الخارجي المقنّعين ووقت الاستقبال فقط. يمكن لواجهة المراجعة ترشيح القناة من الخادم عبر `channel=web`؛ لا تعرض هذه المرحلة شاشة إدارة أو صفحة قنوات وهمية، إذ لا توجد قناة خارجية قابلة لإدارتها للمستخدم بعد.

## Explicitly excluded effects

لا ينشئ PR-11 Invoice أو Purchase أو Expense أو DeliveryNote أو Partner أو Product أو Unit. لا يستدعي `post()` أو `LedgerService` ولا يكتب JournalEntry أو JournalLine أو Payment أو StockMovement. لا يغير retention أو purge أو quarantine أو signed download.

| العملية | الحساب | مدين | دائن |
|---|---|---:|---:|
| استقبال مستند من قناة | لا قيد | — | — |
| replay مطابق | لا قيد | — | — |
| إنشاء/تعطيل هوية قناة | لا قيد | — | — |

كذلك لا يفعّل PR-11 WhatsApp أو Meta أو Gmail أو Outlook أو Drive أو Dropbox أو Slack أو Telegram، ولا أي اتصال شبكة صادر لمزود، ولا AI أو extraction أو التخزين الدائم R2/S3 أو Redis أو worker أو ClamAV أو Render أو polling أو scheduler.

## Rejected alternatives and deferrals

| البديل المرفوض أو المؤجل | سبب القرار |
|---|---|
| endpoint عام يعتمد على tenant/branch في الطلب | يفوض المصدر في اختيار نطاقه، ويخالف عزل Nebrax. |
| API key أو Basic secret جديد في جدول القنوات | لا توجد منصة اعتماد معتمدة؛ كما يمنع القرار تخزين secret في سجل تشغيلي. |
| إعادة استخدام Platform Integration settings لهوية قناة | تلك إعدادات بنية تحتية لمنصة الإدارة وليست credential inbound للمستأجر. |
| نسخ فحص الملف أو التخزين في كل connector | ينتج مسارات أمنية مختلفة ويضعف فحص MIME/SHA والحجر والتعويض القائمين. |
| وضع replay في الذاكرة أو الواجهة | لا يحمي من تعدد العمليات أو إعادة المحاولة أو السباق؛ القيد الفريد قاعدة بيانات. |
| استعمال workflow event لتدقيق القناة | يخلط حدث تدقيق بلا انتقال مع آلة حالات الحزمة ويخالف ملكية الخدمة. |
| واجهة Providers أو قناة API تجريبية | تعد المستخدم بقدرة لا تملك اعتماداً أو مزوداً أو endpoint عام حالياً. |

يتطلب endpoint عام مستقبلي مشروع منصة API منفصلاً يسلم credential server-side محدد tenant/branch والصلاحية، وعقد تحقق وتدوير أسرار وسياسات rate limiting. يتطلب تفعيل أي مزود لاحق قراراً مستقلاً وADR وتكاملًا مصرحاً به؛ لا يغير هذا PR ذلك القفل.

## Verification

تغطي اختبارات PR-11 قبول قناة `web` من خلال inspector وintake الموجودين، SHA الخادمي والحجر، replay المطابق، تعارض المرجع والمحتوى بعد قرار القفل مع حدث conflict واحد محفوظ، uniqueness لمرساة receipt، تعطيل الهوية، عزل tenant والفرع، RBAC وentitlement وحالة التطبيق، رفض metadata الحساسة وscope spoofing و`api` غير المدعومة، وفصل canonicalization العام الحساس لحالة الأحرف عن lowercase المعلن لقناة `web`، وفشل ملف وتخزين بلا receipt نجاح أو object orphan، وإسقاط مراجعة مقنّع مع فلتر قناة خادمي. تثبت الاختبارات أيضاً صفر Invoice/Purchase/Expense/DeliveryNote/JournalEntry/Payment/StockMovement. يختبر CI نفس الهجرة وقيودها على SQLite وPostgreSQL.

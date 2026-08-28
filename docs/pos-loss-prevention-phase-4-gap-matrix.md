# POS Loss Prevention — Phase 4: Gap Matrix

> أُنجز هذا التدقيق على `main` عند الالتزام `cb32bf7b` (بعد دمج PR #537 Phase 3 وPR #539)
> وقبل كتابة أي كود لـ Phase 4. المرجع الوظيفي هو المهمة المرفقة
> `ClaudeCode_Nebrax_POS_Loss_Prevention_Phase4`. لا مصدر حقيقة موازٍ يُنشأ: كل إشارة جديدة
> تشير إلى `PosSessionEvent`/`PosException`/`PosInvestigationCase`/`PosLpDigest` القائمة عبر
> معرّفات أو تُلحق بها، ولا تنسخها ولا تعدّل أدلة Phase 1–3.

## المبدأ الحاكم

> **مؤشرات المراجعة والاستثناءات تساعد في ترتيب أولوية المراجعة والتحقيق، ولا تُثبت وحدها
> وجود مخالفة.**

Phase 4 يقوّي جودة الدليل ويغلق فجوات مؤجَّلة عالية القيمة **قبل** أي ذكاء اصطناعي/تعلّم آلي:
ربط المرتجع بين الكاشيرين، النشاط خارج نوافذ عمل دفاعية، ترقية تعديلات السلة الحساسة نحو دليل
خادمي حيث يكون ذلك ممكناً تقنياً، حماية التكرار/الإعادة (idempotency)، تكامل سلامة الأحداث
المتأخرة (فقط إن وُجدت بنية عدم اتصال قائمة)، وضوابط وقائية حتمية وطابور «يحتاج انتباه» داخل
`/pos/audit`.

## منهج التصنيف

كل إشارة مقترحة صُنِّفت كما يلي قبل أي كتابة كود:

- **A — خادمي حصراً (server_authoritative):** يُنفَّذ مباشرة.
- **B — هجين لكنه دفاعي (hybrid but defensible):** يُنفَّذ مع توثيق تحفّظ/مصدر صريح، ولا
  يُنتج نتيجة إيجابية كاذبة عند غياب البيانات الموثوقة.
- **C — غير موثوق أو ربط ناقص:** لا يُنفَّذ؛ يوثَّق الربط الناقص بدقة بدل اختلاقه.

## نتائج التدقيق التفصيلية

| # | السؤال | النتيجة |
|---|---|---|
| 1 | هل يوجد ربط خادمي موثوق من المرتجع إلى **كاشير البيع الأصلي**؟ | نعم، لكن عبر **البيانات العلائقية** لا عبر حمولة حدث `return_recorded` القائم. `invoices.created_by` يُختم خادمياً من `$request->user()->id` في `PosController::checkout` (`app/Http/Controllers/Api/PosController.php:102`) — لا يُقبل من العميل أبداً. `return_documents.original_id`/`original_type` يشيران إلى تلك الفاتورة. |
| 2 | هل مسار مرتجع POS المقفل بالجلسة (`PosReturnService`) يمكن أن ينتج حالة عابرة للكاشير أصلاً؟ | **لا.** `assertSourceMatchesSession` (`app/Services/Accounting/PosReturnService.php:99-115`) يفرض أن يتم المرتجع في **نفس الجلسة المفتوحة** التي تمت فيها الفاتورة الأصلية، و`requireOpenForCheckout` يفرض `session.opened_by === actor`. فمرتجعات شاشة POS نفسها كاشير واحد بالتصميم دوماً. |
| 3 | هل يوجد مسار يُرجَّع فيه فاتورة POS من شخص آخر/خارج الجلسة الأصلية؟ | **نعم** — `POST /returns` العام (`app/Http/Controllers/Api/ReturnController.php`) لا يمنع إرجاع فاتورة POS (`invoices.pos_session_id` غير فارغ) وليس مقفلاً بجلسة. هذا هو السيناريو الحقيقي العابر للكاشير، لكنه يحمل خللاً قائماً: `StoreReturnRequest` لا يتحقق من `created_by` مطلقاً، و`ReturnController::store` لا يحقن `$request->user()->id`، فـ`return_documents.created_by` **دائماً `NULL`** على هذا المسار اليوم. كما أنه لا يُصدر أي `PosSessionEvent` (يحدث ذلك فقط داخل `PosSessionService::recordReturn`، المستدعاة فقط من `PosReturnService`). |
| 4 | هل يوجد مصدر دفاعي لـ«ساعات العمل» في POS؟ | `Branch.working_hours` نص حر غير مهيكل — غير دفاعي. `pos_sessions.shift_id` **يختاره العميل** عند فتح الجلسة (`PosSessionController::open`، `$data['shift_id']` من جسم الطلب) — غير خادمي أيضاً. **لكن** `Employee.shift_id → Shift` (`start_time`/`end_time`/`work_days`، مع حساب عبور منتصف الليل الآمن الجاهز في `Shift::netMinutes()`) حقل تديره الموارد البشرية عبر `User::employee()` (`app/Models/User.php:95-98`) ولا يستطيع الكاشير تغييره بنفسه. هذا هو المصدر الدفاعي الوحيد المطابق لمستوى ١ من تسلسل المهمة («جدول موظف معتمَد»). |
| 5 | هل توجد آلية idempotency عامة لـ POS؟ | لا. أنماط `idempotency_key` موجودة فقط في الوقود/ZATCA/مركز المستندات/استحقاقات المنصة — لا شيء لأحداث تدقيق POS. |
| 6 | هل توجد بنية مزامنة عدم اتصال/أحداث متأخرة في POS؟ | لا — تأكيد عدم وجود طابور، ولا فصل `observed_at`/`received_at`، ولا طبقة مزامنة أجهزة؛ فقط مسودات سلة `localStorage` وTelemetry فوري fire-and-forget. وفق §٩/§٢١ من المهمة: **مؤجَّل صراحةً**، لا يُبنى. |
| 7 | هل منع الاعتماد الذاتي (self-approval) مطبَّق في كل المسارات؟ | فقط في `PosOverrideApproval::approve()` (`app/Services/Pos/PosAuditService.php:300-302`). **غير مطبَّق** في مساري `pos.variance.approve` (`acknowledgeDifference`، `settleVariance` في `app/Services/Accounting/PosSessionService.php`) — فجوة حقيقية. |
| 8 | أي مرشّحي «ضبط وقائي» خادميون فعلاً (لا Telemetry بعد الفعل)؟ | إنشاء `refund` (`PosReturnService::create`)، `cash_out` (`PosSessionService::recordCashMovement`)، وفتح الدرج اليدوي (`CashDrawerService::openManually`) عمليات خادمية حقيقية يمكن ضبطها **قبل** تنفيذها. أما `item_remove`/`price_override`/`discount_change`/`cart_cancel` فهي Telemetry من العميل **بعد** أن عدّل العميل سلّته محلياً فعلاً — مُصنَّفة بصورة صحيحة أصلاً في Phase 1 ولا يمكن جعلها «أكثر إنفاذاً» بلا محرك سلة خادمي (خارج النطاق، شرط توقّف صريح). |

## مصفوفة التصنيف الكاملة (A/B/C)

### A — خادمي حصراً، يُنفَّذ

| الإشارة/القدرة | المصدر الخادمي | ملاحظة |
|---|---|---|
| idempotency/replay protection لأحداث السلة الحساسة وطلبات الاعتماد | `client_event_id` جديد على `pos_session_events`، مُتحقَّق في `PosAuditService` | يحمي إعادة إرسال الشبكة من تكرار الدليل أو تغييره |
| `repeated_hold_discard` | `cart_discarded` من `PosHeldSaleService` | خادمي بالكامل (server cart event) |
| `manual_drawer_without_transaction_proximity` | `cash_drawer_open_attempt` (mode=manual) + قرب `checkout_completed`/حركة نقد | كلا الطرفين خادميان |
| `approval_replay` | `PosOverrideApproval` + `override_requested`/`override_consumed` | يتحقق من idempotency أعلاه أيضاً |
| توسعة الضبط الوقائي: `refund`، `cash_out`، `manual_drawer_open` | عمليات خادمية حقيقية تُمنع/تُعلَّق **قبل** التنفيذ | إعادة استخدام `audit_operation_policies`/`PosOverrideApproval` القائمة، بلا محرك جديد |
| تعزيز فصل المهام (SoD) لمسارات `pos.variance.approve` | علم إعداد اختياري افتراضه معطَّل | يحمي المستأجرين ذوي الكاشير الوحيد، متوافق مع «السياسة تُضبط ولا تُفرَض» |
| طابور «يحتاج انتباه» (Needs Attention) | قراءة مجمَّعة من `pos_exceptions`/`pos_investigation_cases`/`PosOverrideApproval`/`PosLpDigest` القائمة | لا مصدر حقيقة جديد، لا حالة مراجعة موازية |

### B — هجين لكنه دفاعي، يُنفَّذ مع تحفّظ صريح

| الإشارة | الشرط الموثوق | التحفّظ الصريح |
|---|---|---|
| `cross_cashier_refund` | `invoices.created_by` **موجود** وفاتورة POS (`pos_session_id` غير فارغ) | **لا يُطلَق أبداً** إن كان `original_sale_actor_id` أو `return_actor_id` فارغاً (بيانات قديمة/مفتقدة) — لا نتيجة كاذبة |
| `outside_operating_hours` | `User → Employee → Shift` قابل للحل إلى وردية فعّالة | لمن لا يملك هذا الربط: **لا إشارة إطلاقاً**، لا تخمين ٩–٥ أبداً؛ المنطقة الزمنية من `tenants.timezone` (نمط Phase 3 نفسه) موثّقة كتحفّظ (ليست لكل فرع) |
| `override_then_cancel` | `override_consumed` (خادمي) ثم `cart_cancelled`/`payment_cancelled` (client_observed) على نفس `cart_id`/`correlation_id` | يرث تصنيف الثقة الأدنى لطرفه العميلي، تماماً كقواعد Phase 2 المختلطة |
| `repeated_cancel_before_checkout` | `cart_cancelled`/`payment_cancelled` (client_observed) | نفس مستوى ثقة `item_removal_rate` القائمة — سابقة معتمَدة من Phase 2 |

### C — غير موثوق/ربط ناقص، مؤجَّل وموثَّق فقط

| البند | سبب التأجيل |
|---|---|
| إنفاذ خادمي حقيقي لـ `item_remove`/`price_override`/`discount_change`/`cart_cancel` | لا محرك سلة خادمي يملك الحالة الحقيقية قبل/بعد؛ أي «حظر» سيكون واجهياً فقط بعد أن نفّذ العميل التعديل محلياً — شرط توقّف صريح (§22). يبقى التصنيف `client_observed` كما هو من Phase 1، مع تعزيز حقول الهوية/الجلسة/الوقت الخادمية القائمة أصلاً (انظر توثيق تعزيز الأدلة). |
| سلامة الأحداث دون اتصال/متأخرة (Offline/Delayed) | لا بنية مزامنة عدم اتصال قائمة في POS اليوم (مؤكَّد بالتدقيق) — §21 يمنع بناء محرك عدم اتصال جديد في هذا PR. |
| نظام جدولة موظفين عام جديد | `Employee.shift_id`/`Shift` قائمان ويكفيان؛ بناء نظام مستقل ممنوع صراحة (§21). |
| اعتماد `Branch.working_hours` النصي كمصدر ساعات عمل | نص حر غير قابل للتفسير الآلي الموثوق؛ استخدامه كان سيعني تخمين نمط لا مصدراً معتمَداً. |
| ضبط وقائي حقيقي على «إلغاء سلة عالية القيمة» (`cart_cancel`) كعملية مانعة | العملية نفسها Telemetry عميلي بعد الفعل — لا مسار خادمي حقيقي يمكن اعتراضه قبل الإلغاء الفعلي؛ يبقى الاكتشاف (`repeated_cancel_before_checkout`, `override_then_cancel`) دون منع. |

## قيود معمارية مُلزَمة (مستمرة من Phase 2/3)

1. **حارس قائمة النسخ في CI** يُفشل البناء لأي مجلد فرعي جديد تحت `app/` غير مُدرَج صراحةً.
   كل ملفات Phase 4 PHP الجديدة **مسطّحة**: نماذج في `app/Models/`، خدمات في
   `app/Services/Pos/` أو `app/Services/Accounting/` (تعديل قائم لا ملف جديد لأغلبها)، تحكّم في
   `app/Http/Controllers/Api/` (تعديل قائم).
2. **لا كتابة في `journal_entries`/`journal_lines` من أي مسار Phase 4.** كل الإضافات أدلة
   append-only، استثناءات مشتقّة، أو بوابات موافقة — بلا أي أثر محاسبي جديد.
3. **لا صلاحية جديدة إلا لعملية محمية مختلفة حقاً.** يُعاد استخدام `pos.audit.*`،
   `pos.override.approve`، `pos.investigations.*` القائمة لكل قدرات Phase 4؛ لا صلاحية جديدة
   أُضيفت (راجع `docs/pos-loss-prevention-preventive-controls.md` للتفصيل النهائي إن استُحدثت
   صلاحية واحدة إبان التنفيذ).
4. **لا أسماء أدوار مباشرة.** كل بوابة عبر `Rbac::allows()`/`EnsurePermission` كما في كل الأطوار
   السابقة.

## ملاحظات ترحيل وتشغيل

الهجرة الجديدة إضافية بحتة (عمود idempotency جديد على `pos_session_events` فقط)، لا تُعاد كتابة
بيانات تاريخية. الأحداث التاريخية بلا `client_event_id` تبقى صالحة كما هي. لا حاجة لأي backfill.

[Task: ClaudeCode_Nebrax_POS_Loss_Prevention_Phase4]

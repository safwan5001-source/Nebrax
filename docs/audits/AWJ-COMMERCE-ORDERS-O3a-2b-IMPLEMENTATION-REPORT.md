# AWJ-COMMERCE-ORDERS-O3a-2b — تقرير التنفيذ

**المرجع:** `docs/plans/store/ADR-28-COMMERCE-ORDER-LIFECYCLE.md` §3–§5، §7، §8. **فوق:** O3a-1 (#1774) وO3a-2a (#1775) المدموجتين، وO1a-N1 (#1776).
**الطبيعة:** إلغاء طلب المتجر بواسطة موظف مخوّل. **معطَّل افتراضياً** خلف بوابة نشر؛ لا تفعيل لأي مستأجر، لا Merge/Deploy، لا واجهة (O3b)، لا عقد جمهور (O3c).

## 1. ما نُفِّذ

| البند | التنفيذ |
|---|---|
| الخدمة | `CommerceOrderLifecycleService::cancel(order, actor, reason, note)` — تنسّق الخدمات القائمة: `CommercePaymentIntentService::cancelWithinTransaction` (انتقال النية فقط) و`CommerceOrderReservationService::releaseActive`. |
| المعاملة (قاعدة بيانات فقط) | قفل **النية** ← قفل **الطلب** ← صفوف **الحجز** (يطابق الاتجاه القائم ولا يعكس أي مسار؛ المحاولة لا تُقفل، تُقرأ SELECT عادياً للفحص). فحوص المصفوفة بالترتيب: `already_posted` ← `payment_paid` ← `payment_collected` ← `payment_captured` (`hasCapture`) ← `payment_authorized`. ثم إلغاء النية + تحرير الحجز + كتابة `cancelled_at/by/reason/note` — **ذرّياً**؛ أي فشل يتراجع كله. |
| بعد الالتزام النهائي فقط | `DB::afterCommit` → `OrderCancellationCleanup::run` (O3a-2a): إغلاق المحاولات لدى المزوّد. يُهمَل عند التراجع، ويؤجَّل لو عُشِّشت الخدمة داخل معاملة أكبر، ولا يرمي أبداً، ويعيد المطابِق المجدول ما فشل. |
| idempotency | طلب ملغى أصلاً ⇒ يُعاد كما هو بلا أي أثر ولا تنظيف ولا تغيير للسبب/الفاعل/الوقت الأصلية. نية ملغاة سابقاً (مكنسة/مسار قديم) ⇒ إقفال إداري للطلب (صف 9). |
| حالة سباق مغلقة | التقاط محاولة لا يأخذ قفل النية (يكتب صفّ المحاولة أولاً) فقد يظهر بين فحصنا وفحص الانتقال الداخلي؛ كان يخرج خطأً عاماً — يُحوَّل الآن إلى 409 `payment_captured` ويتراجع كل شيء (اكتُشف باختبار PostgreSQL). |
| API | `POST commerce/orders/{id}/cancel` (`CommerceStaffOrderCancellationController`). الجسم: `reason` من القائمة المعتمدة (`reason_code` اسم ADR بديل مقبول)، `note` ≤ 500 إلزامي عند `other`. 200 ← تفاصيل الموظف (O1a)، 409 `{message, reason}`، 422 (مسودة/مدخل)، 404 موحَّد، 403. |
| الصلاحية | `commerce.orders.cancel` في `Rbac::PERMISSIONS` — owner/admin عبر `*` فقط؛ لا `MATRIX` ولا دور مخزَّن. + `EnsureApplicationActive:commerce.storefront` + رفض المقيَّد بمخازن (403). لا توسيع لأي صلاحية أخرى. |
| البوابة | `config('commerce.order_cancellation_enabled')` (`config/commerce.php`، env `COMMERCE_ORDER_CANCELLATION_ENABLED`، **الافتراضي `false`**): مغلقة ⇒ المسار 404 بلا تحقق. |
| المسار القديم لإلغاء النية (D-9-R1) | البوابة مفتوحة وللنية طلب: `payment-intents/{id}/cancel` يتطلب `payments.manage` (المسار) **و**`commerce.orders.cancel` وجسم `reason`، ويُفوَّض إلى الخدمة نفسها (فلا يبقى «طلب مؤكَّد بنية ملغاة»). **مغلقة (الافتراضي) ⇒ السلوك القديم حرفياً.** |
| القراءة | `CommerceStaffOrderController::detailData()` مستخرجة (نفس الكود) ليعيد المسار الجديد المسلسل نفسه؛ `show` بسلوك مطابق. |

## 2. القيود المحاسبية الناتجة

**لا قيود.** الإلغاء لا يكتب قيداً ولا فاتورة ولا سنداً ولا إشعاراً دائناً ولا حركة مخزون (الحجز وعد لا حركة، عقد Commerce #2/#6). مثبَّت باختبارات قبل/بعد (القيود/السطور/الفواتير/السندات/الإشعارات/`StockMovement`/الحجوزات) وبحارس ساكن يمنع ذكر الخدمات المحاسبية/المخزنية، وبرفض الطلب المرحَّل (`already_posted`) دون عكس.

## 3. الملفات

| الملف | |
|---|---|
| `app/Services/Commerce/CommerceOrderLifecycleService.php` | جديد |
| `app/Services/Commerce/CommerceOrderCancellationException.php` | جديد (رموز المصفوفة) |
| `app/Http/Controllers/Api/CommerceStaffOrderCancellationController.php` | جديد |
| `app/Http/Controllers/Api/CommerceStaffOrderController.php` | استخراج `detailData()` وجعل `guard()` عامة (بلا تغيير سلوك) |
| `app/Http/Controllers/Api/CommercePaymentIntentController.php` | تفويض المسار القديم (البوابة مفتوحة فقط) |
| `app/Support/Rbac.php` | `commerce.orders.cancel` |
| `config/commerce.php` | جديد — البوابة |
| `routes/api.php` | `POST commerce/orders/{id}/cancel` |
| `CLAUDE.md` | قسم O3a-2b |
| `tests/Feature/CommerceOrderCancellationTest.php` | جديد — 31 اختباراً |
| `tests/Feature/CommerceOrderCancellationPostgresTest.php` | جديد — 9 اختبارات PostgreSQL (fork) |
| `tests/Feature/CommerceModuleBoundaryTest.php`، `CommerceOrderCancellationFactsTest.php`، `CommerceIntentCancelSeparationTest.php` | تحديث حارسات «لا مسار إلغاء» لتقبل مسار الموظف الوحيد وبوابته المغلقة |

لا `database/`: **لا هجرة** (أعمدة الإلغاء والحراس من O3a-1).

## 4. الاختبارات

**المصفوفة (`CommerceOrderCancellationTest`، SQLite + PostgreSQL):** البوابة مغلقة افتراضياً (404 موحَّد) · الصفوف 1–11 (COD مفتوح يُلغى · COD محصَّل يُمنع · إلكتروني بلا محاولة يُلغى ويتحرر الحجز · محاولة حيّة تُغلق بعد الالتزام · `authorized`/`captured`/`paid`/`مرحَّل` تُمنع بالرمز الصحيح وبلا أي تغيير · نية ملغاة سابقاً إقفال إداري · إلغاء متكرر idempotent · مسودة 422) · طلب بلا نية · السبب القائمة و`other`+ملاحظة · RBAC (owner/admin ✔؛ accountant/staff/self_service ✘؛ `payments.manage`+العرض ✘؛ دور مخصص بالصلاحية ✔) · الصلاحية ليست ضمنية في أي دور مدمج · عزل المستأجر/IDOR (404 مطابق للمفقود) · مقيَّد المخازن 403 · قدرة معطّلة 403 · غير مصادق 401 · تراجع كامل بفشل بعد انتقال النية (لا اتصال بالمزوّد) · تعشيش: لا تنظيف قبل الالتزام الخارجي ولا إطلاقاً عند تراجعه · فشل المزوّد بعد الالتزام ثم المطابِق · `late_capture` لا يحوّل الملغى إلى مدفوع ولا يُحيي الحجز · لا أثر محاسبي/مخزني · حفظ السجل وسطوره ومنع الحذف · المسار القديم (مغلق: كما كان؛ مفتوح: صلاحيتان + تفويض + رفض المصفوفة) · حارس ساكن (لا `cancel()` العامة/`PaymentOrchestrator`/`closeActiveAttempts`/خدمات محاسبية).

**التزامن على PostgreSQL حقيقي (`CommerceOrderCancellationPostgresTest`، `pcntl_fork`، تفشل ولا تتخطّى إن غاب pcntl):** إلغاء ↔ التقاط (5 جولات بترتيبي بدء: لا «ملغى ∧ مدفوع»، `late_capture` عند التقاط بعد الإلغاء، رفض بالرمز الصحيح) · إلغاء ↔ **ترتيب أقفال مسار الترحيل** محاولة←نية←طلب (6 جولات: لا `40P01`) · إلغاء ↔ تحصيل COD (فائز واحد بالضبط) · إلغاء ↔ المكنسة الحقيقية (يتقارب إلى طلب ملغى وتحرير واحد) · إلغاءان متزامنان (كلاهما يرجع بالحالة نفسها، أثر واحد) · تراجع كامل بفشل بعد انتقال النية وتحرر كل الأقفال · فشل المزوّد بعد الالتزام والمطابِق · **لا أقفال صف** على النية/الطلب/الحجز **ولا معاملة مفتوحة** أثناء اتصال التنظيف بالمزوّد (اتصال ثانٍ بـ`FOR UPDATE NOWAIT`).
*حد معلن:* اختبار «إلغاء ↔ ترحيل» يعيد ترتيب أقفال مسار الترحيل ولا يشغّل ترحيلاً محاسبياً كاملاً؛ رفض `already_posted` نفسه مختبَر بترحيل حقيقي في الاختبار العادي.

**إثبات الحساسية (طفرات):** حذف `releaseActive` ⇒ 5 إخفاقات · تنظيف فوري قبل الالتزام ⇒ 3 · تعطيل فحص الترحيل ⇒ `row 8` يفشل · إزالة تحويل رفض الالتقاط ⇒ يفشل سباق PostgreSQL بخطأ عام (حدث فعلاً فأُصلح).

**التشغيل المحلي (مشروع Laravel مولَّد):** الاختبارات الجديدة 35 + 9 خضراء؛ المتأثرة (`CommerceOrderCancellationFactsTest`، `CommerceModuleBoundaryTest`، `CommerceStaffOrderApiTest`، `CommerceIntentCancel*`، `CommerceInvoiceOnPaymentTest`…) خضراء. الحزمة الكاملة: SQLite 9624 ناجحاً / 30 فاشلاً · PostgreSQL 9884 / 44. الفشل المحلي كله خارج الشريحة: `Fuel*` (bcmath غير مثبّت)، `PostgresTestLockTimeoutTest` (PGOPTIONS)، `StorefrontMediaApiTest`/`ProductMediaR2ReadTest`/`CommerceWorkspace*Media*`/`ImportJob*`/`Ai*`/`Document*` (بيئة محلية وتشغيل SQLite وPostgreSQL بالتوازي على الجهاز نفسه) — **ولا تظهر في CI**. فشل واحد كان من الشريحة: حارس O3a-2a (`no_deployment_gate_route…`) يفترض غياب أي مسار إلغاء — حُدِّث ليقبل مسار الموظف الوحيد وبوابته المغلقة.

## 5. CI

التشغيلة الأولى (Head `4d5291b`): فشل **اختبار واحد** على كلا المحرّكين — حارس O3a-2a أعلاه (أُصلح). Head `5918ac7`: SQLite ✅ · PostgreSQL ✅ · CI Gate ✅. Head `6968e12` (بعد إصلاح P2 §5.1): SQLite ✅ · PostgreSQL ✅ · CI Gate ✅. Head `02c23a1` (بعد إصلاح P2 §5.2): SQLite ✅ · PostgreSQL ✅ · CI Gate ✅.

## 5.1 مراجعة Codex P2 — حارس القدرة على المدخل المفوَّض

**الملاحظة:** والبوابة مفتوحة و`commerce.storefront` معطّلة/معلّقة، كان `payment-intents/{id}/cancel` (بـ`payments.manage` فقط على مساره) يُلغي الطلب ويكتب الحقائق ويحرر الحجز بينما المسار المخصَّص يردّ 403.
**المعالجة:** الفرع المفوَّض يستدعي المنطق الوحيد القائم `EnsureApplicationActive::authorize($request, 'commerce.storefront')` (بعد فحص الصلاحيتين) — مدخلان لإلغاء واحد بقيد واحد. **البوابة مغلقة ⇒ السلوك القديم حرفياً** (لا حارس جديد على المسار القديم).
**الدليل:** اختبار `the_delegated_legacy_route_enforces_the_same_capability_guard_as_the_dedicated_route` — مفتوحة: المدخلان 403 وبلا أي تغيير؛ مغلقة: المسار القديم ينجح كما كان. SQLite وPostgreSQL (32 اختباراً للصنف). الطفرة (حذف الاستدعاء) تُفشله.

## 5.2 مراجعة Codex P2 — فحص الالتقاط قبل قبول نية ملغاة سابقاً

**الملاحظة:** إن ألغت المكنسة/المسار القديم نية إلكترونية ثم وصل التقاط متأخر، يُبقي `completeCaptured` النية ملغاة ويَسِم المحاولة `late_capture`. كان `assertCancellable` يعود مبكراً لأي نية ملغاة (صف 9) دون فحص الالتقاط، فيُسجّل إلغاءً للطلب ويردّ 200 رغم دخول مال فعلاً. ADR-28 §3 يسمح بالإقفال الإداري فقط «لا `captured`».
**المعالجة (خدمة فقط؛ لا تغيير في العقد العام ولا البوابة ولا قواعد مالية):** النية الملغاة تمرّ الآن بفحص الدفع الإلكتروني نفسه عبر `hasCaptureEvidence`: محاولة `captured` (الحاجز القائم) **أو** أثر مبلغ ملتقَط (`captured_minor > 0` / `captured_at`) أياً كانت حالتها اللاحقة **أو** وسم `late_capture` ⇒ **409 `payment_captured`** بلا أي تغيير. فحص `authorized` يبقى للنية غير الملغاة فقط (لا تضييق على الصف 9 بما يتجاوز ADR). فحوص `paid`/`collected` للنية غير الملغاة كما كانت. طلب بلا نية يبقى قابلاً للإلغاء.
**الاختبارات (SQLite + PostgreSQL):** `row_9_is_refused_when_a_late_capture_already_arrived_under_the_cancelled_intent` (التسلسل الحقيقي: إلغاء قديم ← صفحة حيّة ← التقاط ← `completeCaptured`؛ الرفض لا يغيّر الطلب/الحجز/النية/المحاولات/الحقائق المحاسبية بلقطة قبل/بعد) · `row_9_checks_every_capture_indicator_not_only_the_captured_status` (`captured_minor`، `captured_at`، `late_capture` وحده) · `row_9_still_allows_the_administrative_closure_when_nothing_was_captured` (لا تضييق). تزامن PostgreSQL: `a_late_capture_racing_the_administrative_closure…` (5 جولات بترتيبي بدء: إما الرفض `payment_captured` وبلا تغيير، أو إقفال سبق الالتقاط فيُوسم `late_capture` ويبقى الطلب ملغى؛ لا نية `paid`). **طفرتان:** إعادة الخروج المبكر للنية الملغاة تُفشل اختباري الرفض؛ الاكتفاء بـ`hasCapture` يُفشل اختبار المؤشرات. النتيجة: 35 اختباراً للصنف على المحرّكين، و9 لصنف PostgreSQL (3 مرات).

## 6. أثر التغيير على العقود القديمة

| العقد | الأثر |
|---|---|
| عقد المشتري/الجمهور (`store/v1`, `commerce/v1`, المسلسلات العامة، OpenAPI) | **لا تغيير** (`status` يبقى `confirmed`؛ يحرسه اختبار O3a-1) — O3c لاحقاً |
| `payment-intents/{id}/cancel` | البوابة مغلقة (الافتراضي): **حرفياً كما كان**. مفتوحة: صلاحيتان وجسم `reason` وتفويض (ADR D-9-R1) |
| `commerce/orders` GET (O1a) | بلا تغيير (استخراج `detailData` فقط) |
| الدفع/الحجز/الترحيل/المكنسة | بلا تعديل في كودها أو ترتيب أقفالها |
| الصلاحيات | صلاحية جديدة منفصلة؛ لا تغيير لأي دور |

## 7. المخاطر والمتبقي

| البند | ملاحظة |
|---|---|
| التقاط متأخر على صفحة بقيت حيّة | `late_capture` للمراجعة البشرية (D-15)؛ الفجوة قصيرة ويغطيها المطابِق |
| COD المحصَّل لا يُلغى | مقصود (D-9-C1): يلزم مسار استرداد/مرتجع (RT) |
| الطلب بنية `authorized` | يُمنع (D-9-C2) حتى انتهاء/إغلاق المحاولة |
| عميل قديم يعرض الملغى نشطاً | لا يتغيّر عقد الجمهور هنا؛ **لا يُفتح الإلغاء في الإنتاج قبل O3c** (البوابة مغلقة) |
| مكنسة الدفع الإلكتروني | تُبقي «طلباً مؤكَّداً بنية ملغاة» كما كان (سلوك قائم)؛ سياسة O3d (إلغاء تلقائي) مستقلة |
| اختبار الترحيل المتزامن | إعادة ترتيب أقفال لا ترحيل كامل (§4) |
| `fork` في CI | يعتمد pcntl كاختبارات PostgreSQL القائمة |

## 8. Git

- **Branch:** `claude/commerce-orders-o3a-2b`
- **Base SHA:** `7ce615a311014f43c8f5896ed4e81216bf9cfec4` (`main` بعد #1776)
- **Head SHA (الكود والاختبارات):** `02c23a14c53089faa3e52519ba109991bb0bc6d4` — CI أخضر. ما بعده commit لهذا التقرير فقط.
- **PR:** [#1777](https://github.com/safwan5001-source/Nebrax/pull/1777)

## 9. الخطوة التالية

**O3b** — واجهة الموظف (O1b): زر «إلغاء الطلب» + حوار السبب + حالة `cancelled`، بصلاحية `commerce.orders.cancel`. ثم **O3c** (عقد الجمهور وقرار D-9-P1) الذي هو **شرط فتح البوابة** في الإنتاج. لا شيء منهما هنا.

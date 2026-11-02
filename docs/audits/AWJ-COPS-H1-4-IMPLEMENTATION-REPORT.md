# COPS-H1-4 — Implementation Report (قبول التاجر ورفضه)

| البند | القيمة |
|---|---|
| Slice | COPS-H1-4 — حقائق القبول + `accept`/`reject` + حراس القاعدة + `operational_status` المشتق + `commerce.orders.manage` + دمج القبول في `attention` |
| Branch | `claude/cops-h1-4-acceptance` |
| Base SHA | `d5e1be954cb1360c7a5f4bd5c37fa6258949d908` (`origin/main` بعد إغلاق H1-3، #1930) |
| PR / Head SHA / Merge SHA | تُسجَّل في وصف الـPR وفي `AWJ_COPS_HORIZON_HANDOFF.md` (الملف لا يضمّن هاشه) |
| الحالة | Implemented → Merged عند اجتياز البوابات · Not deployed · Not activated · Not env-verified |
| العقد | `ADR-29` §2.1، §2.2 (+ §2.2.1 الجديد)، §2.4 · Revision 1 صف H1-4 · ADR-28 §3 (مصفوفة الإلغاء) |
| قرارات المالك | R-3 · R-5 · R-6 · R-6b (معتمدة في ADR-29 §0) · تفويض COPS-H1-4 الذاتي (2026-11-02) |

---

## 0. الخلاصة

- **القبول** فعل موظف يكتب حقيقتين ثابتتين (`accepted_at`، `accepted_by_user_id`) على طلب **لقطته** `manual`، بعد أن يصبح دفعه جاهزاً (R-5)، ويكتب الحدث `order.accepted` آخر المعاملة. لا قيمة جديدة في `status` ولا عمود حالة مخزَّن.
- **الرفض** ليس انتقالاً جديداً: هو `CommerceOrderLifecycleService` نفسه بسبب `merchant_rejected` — الأقفال والمصفوفة والتحرير والتنظيف بعد الالتزام والحدث `order.cancelled` حرفياً، مع قاعدة إضافية: قبل القبول ولطلب `manual` فقط (في الخدمة **وفي القاعدة**).
- **مغلق افتراضياً:** بوابة `commerce.order_acceptance_enabled` مغلقة ⇒ المساران 404، والإتمام لا يقرأ الإعداد ولا يكتب العمود، والمُسقِط والمصالحة سلوك ما قبل H1-4 حرفياً. الرفض يتطلب أيضاً بوابة الإلغاء.
- **لا أثر محاسبي ولا مخزني ولا ضريبي:** القبول لا يلمس النية ولا الحجز ولا أي مستند؛ الرفض يتبع أثر الإلغاء القائم (تحرير الحجز وإلغاء النية فقط). **لا قيد محاسبي جديد في هذه الشريحة** (جدول القيود الإلزامي: لا عمليات مالية جديدة).

## 1. الملفات

| الملف | التغيير |
|---|---|
| `database/migrations/2026_12_30_010000_add_acceptance_facts_to_commerce_orders.php` | **جديد.** `acceptance_mode`، `accepted_at`، `accepted_by_user_id` (FK `nullOnDelete`) + حراس PG/SQLite (6 قواعد) + `down()` يرفض متى وُجدت حقائق |
| `database/migrations/2026_12_30_020000_extend_commerce_order_guards_for_merchant_acceptance.php` | **جديد، مُشغِّلات/قيود فقط.** حارس الإلغاء بالقائمة الموسَّعة + قاعدة «الرفض قبل القبول لطلب يدوي»؛ نوع الحدث `order.accepted` في CHECK/مُشغّل الشكل؛ `down()` يرفض متى وُجد رفض أو حدث قبول ويعيد التعريفات السابقة |
| `app/Models/CommerceOrder.php` | ثوابت `REJECTION_REASON`/`ACCEPTANCE_*`، `acceptedBy()`، `isManualAcceptance()`، `isAccepted()`، `effectiveAcceptanceMode()`، `awaitsManualAcceptance()`؛ `CANCELLATION_REASONS` **لم تتغيّر** |
| `app/Models/CommerceOrderEvent.php` · `app/Events/CommerceOrderAccepted.php` · `CommerceOrderEventRecorder` | النوع `order.accepted` (بلا `data`) وحدث نطاقه بعد الالتزام |
| `app/Services/Commerce/CommerceOrderLifecycleService.php` | `accept()`، `reject()`، مسار مشترك `performCancellation()` (يستعمله `cancel()` بلا تغيير سلوك)، `acceptAction()`/`rejectAction()` و`acceptanceBlocker()`/`rejectionBlocker()` (استرشادية بلا أقفال) |
| `app/Services/Commerce/CommerceOrderAcceptanceException.php` | **جديد.** رموز: `not_confirmed`، `already_cancelled`، `not_manual`، `already_accepted`، `payment_pending`، `payment_not_ready` |
| `app/Services/Commerce/CommerceOrderCancellationException.php` | رمزا الرفض `not_manual`، `already_accepted` |
| `app/Services/Commerce/CommerceOrderStatusProjector.php` | **جديد.** المُسقِط الوحيد لـ`operational_status` (نقي، عرض فقط) + كتلة `acceptance` |
| `app/Services/Commerce/CommerceChannelOperationsSettingsService.php` | `acceptanceModeForNewOrder()` — المستهلك الوحيد للجدول خارج الخدمة؛ بلا استعلام والبوابة مغلقة |
| `app/Services/Commerce/CommerceOrderService.php` | لقطة `acceptance_mode` في `createFromCheckout` (حين `manual` فقط) |
| `app/Services/Commerce/CommerceOrderAttentionQuery.php` | `awaiting_acceptance` من الحالة بلا نافذة، مع إبقاء `new_order`/48 ساعة؛ البوابة مغلقة ⇒ استعلام H1-2 حرفياً |
| `app/Http/Controllers/Api/CommerceStaffOrderAcceptanceController.php` | **جديد.** `accept` و`reject` |
| `app/Http/Controllers/Api/CommerceStaffOrderController.php` · `app/Support/CommerceOrderStaffSerializer.php` | `operational_status` و`acceptance` (القائمة والتفاصيل، بلا استعلام إضافي لكل صف)؛ `accept_action`/`reject_action` في التفاصيل |
| `app/Support/Rbac.php` · `routes/api.php` | الصلاحية `commerce.orders.manage` (owner/admin عبر `*` فقط)؛ مساران جديدان |
| `tests/Feature/CommerceOrderAcceptanceTest.php` | **جديد، 30 اختباراً** (SQLite وPostgreSQL) |
| `tests/Feature/CommerceOrderAcceptancePostgresTest.php` | **جديد، 7 سباقات** على PostgreSQL (fork) |
| `tests/Feature/CommerceChannelOperationsSettingsTest.php` · `CommerceOrderFeedTest.php` · `CommerceModuleBoundaryTest.php` | تحديث مقصود: المستهلك الأول للإعداد (لقطة القبول) مع حارس أضيق «مستدعٍ واحد»، حدث النطاق الجديد، تسجيل المسارين |
| `CLAUDE.md` · `ADR-29` §2.2.1 | التوثيق |

لا تغيير في Checkout (سوى اللقطة خلف البوابة)، ولا في الدفع أو الالتقاط أو الترحيل أو المكنسة أو الحجز أو ZATCA.

## 2. القرارات التصميمية

1. **اللقطة لا الإعداد الحي** (ADR-01 §5): تغيير وضع القناة لاحقاً لا يغيّر تفسير الطلبات القائمة (مختبر).
2. **الوضع الفعّال:** `manual` = لقطة يدوية **و**بوابة مفتوحة. إغلاق البوابة بعد فتحها يجعل الطلبات اليدوية غير المقبولة تلقائية (لا تعلق بلا مسار قبول ولا تظهر في المصالحة).
3. **الرفض عبر مسار الإلغاء نفسه:** استُخرج جسم `cancel()` إلى `performCancellation()` بلا تغيير سلوك للإلغاء (كل اختبارات الإلغاء القائمة خضراء بلا تعديل). `merchant_rejected` **ليس** في `CANCELLATION_REASONS` فلا يقبله مسار الإلغاء العام (422) — لا التفاف على صلاحية الرفض.
4. **قاعدة «قبل القبول» في القاعدة أيضاً** (`merchant_rejected` يتطلب `acceptance_mode = manual` و`accepted_at IS NULL`)، مختبرة بـSQL خام.
5. **R-5 للقبول لا للرفض:** الطلب الإلكتروني غير المدفوع لا يُقبل (409 `payment_pending`) ولا يظهر في الطابور، لكنه **يُرفض** لأنه إلغاء (يُلغي النية ويحرّر الحجز وفق المصفوفة). المدفوع/المحصَّل/الملتقَط ⇒ 409 والمسار RT.
6. **المصالحة:** `awaiting_acceptance` بلا نافذة (الانتظار هو الحاجة)؛ `new_order` كما هو (توافق H1-2). لا تعريف جديد للتنفيذ أو الجدولة.
7. **المُسقِط** نقي (يحرسه اختبار ساكن) ولا يحكم أي انتقال؛ الانتقالات تفحص الحقائق تحت الأقفال.
8. **SQLite:** إضافة مفتاح أجنبي عبر مُنشئ المخطط تعيد بناء الجدول فتُسقط مُشغِّلات الإلغاء بصمت (اكتُشف باختبارات حراس الإلغاء القائمة). الحل: `ALTER TABLE … ADD COLUMN … REFERENCES … ON DELETE SET NULL` الأصلية — الدلالة نفسها بلا إعادة بناء.

## 3. الاختبارات (محلياً)

| الفحص | النتيجة |
|---|---|
| `CommerceOrderAcceptanceTest` (30) SQLite | ✅ 30/30 |
| `CommerceOrderAcceptanceTest` (30) PostgreSQL 16 | ✅ 30/30 |
| `CommerceOrderAcceptancePostgresTest` (7 سباقات × 5–6 جولات) | ✅ 7/7 — قبول×رفض، قبول×إلغاء، 3 قبولات متزامنة، رفض×التقاط، رفض×المكنسة، قبول×التقاط، قبول×تحصيل COD؛ بلا `40P01`، تسلسل التغذية متصل في كل جولة |
| اختبارات الطفرة | ✅ إزالة فحص جاهزية الدفع ⇒ يفشل سباق قبول×التقاط واختبار الدفع الإلكتروني؛ إزالة قاعدة الرفض قبل القبول ⇒ يفشل سباق قبول×رفض واختبار المصفوفة (والقاعدة ترفض) |
| الأجنحة المجاورة (الإلغاء، الأحداث، التغذية، إعدادات التشغيل، حدود الوحدة، طلبات الموظف) SQLite | ✅ 140 ناجح، 26 متخطٍّ (PostgreSQL فقط) |

أرقام الأجنحة الموسَّعة على PostgreSQL وCI (sqlite، pgsql، الأداء المخصص، CI Gate) تُسجَّل في وصف الـPR وHandoff.

## 4. الأمان والعزل

- **RBAC:** القبول `commerce.orders.manage`؛ الرفض `commerce.orders.manage` **و**`commerce.orders.cancel` (اختبار: manage وحدها ⇒ 403 للرفض؛ cancel وحدها ⇒ 403 للاثنين؛ الاثنتان ⇒ 200). الصلاحية الجديدة في `PERMISSIONS` وليست في أي دور من `MATRIX` (اختبار). accountant/staff/self_service ⇒ 403؛ بلا رمز ⇒ 401؛ المقيَّد بمخازن ⇒ 403؛ القدرة `commerce.storefront` معطَّلة ⇒ 403.
- **العزل:** طلب مستأجر آخر وطلب غير موجود ⇒ 404 بالرسالة نفسها بلا أي أثر (اختبار)؛ `tenant_id` في الجسم ⇒ 422.
- **حراس القاعدة (المحرّكان):** لا إنشاء مقبولاً أو بوضع غير `manual`/NULL؛ الوضع لا يتغيّر؛ الفاعل لا يوجد بلا وقت؛ القبول لطلب `manual` مؤكَّد غير ملغى وبفاعل فقط؛ الجمود بعده (الفاعل ⇒ NULL مسموح لحذف المستخدم)؛ لا حذف لمقبول؛ `merchant_rejected` قبل القبول لطلب يدوي فقط؛ نوع حدث غير معروف مرفوض.
- **الأحداث:** `order.accepted` بلا `data` (لا PII)، الفاعل موظف؛ حدث النطاق `CommerceOrderAccepted` بعد الالتزام بمعرّفات فقط (اختبار)؛ الرفض `order.cancelled` بـ`reason: merchant_rejected` فقط (الملاحظة لا تدخل السجل).
- **لا أثر مالي:** اختبار يثبت عدم تغيّر القيود والسندات والفواتير وحركات المخزون والحجز والنية عند القبول.

## 5. المخاطر والمتبقي

| البند | المعالجة |
|---|---|
| مرشّح `operational_status` في قائمة الموظف | غير مبني: يحتاج ترجمة الإسقاط إلى SQL (مصدر ثانٍ للقواعد). القرار في H1-5 |
| واجهة الموظف (أزرار القبول/الرفض، تسمية `merchant_rejected`) | H1-5 |
| التذكير/التصعيد المخزَّنان | بلا مستهلك حتى H3-6 |
| الطلب المقبول يبقى في `attention` بسبب `new_order` حتى نهاية نافذته | مقصود للتوافق؛ الإقرار لكل طلب H3-4 |
| فتح البوابة إنتاجياً | يتطلب قرار تفعيل منسَّقاً يشمل بوابة الإلغاء (ADR-29 §2.2) — **غير مفوَّض** |

## 6. الخطوة التالية

دمج H1-4 بعد اجتياز البوابات، تسجيل الـSHA في Handoff والمتتبّع، **ثم التوقف**: H1-5 (واجهة الموظف) يبدأ بأمر صريح جديد من المالك.

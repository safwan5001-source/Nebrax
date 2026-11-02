# COPS-H2-1 — Implementation Report (نواة تنفيذ طلب المتجر)

| البند | القيمة |
|---|---|
| Slice | COPS-H2-1 — نطاق الشريحة: النطاق، حراس القاعدة، الانتقالات، الأحداث، قيد الإلغاء، عقد قراءة الموظف |
| Branch | `claude/cops-h2-1-fulfillment-core` (Base: `4768967a9`) |
| PR / Merge SHA | تُسجَّل مجمَّعةً في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md` (قاعدة منع سلسلة PRs الـSHA) |
| الحالة | Implemented · Tested · عند الدمج Merged · **Not deployed · Not activated** (`COMMERCE_ORDER_FULFILLMENT_ENABLED` مغلقة) |
| العقد | `AWJ_COPS_H2_0_DECISION_AND_EXECUTION_PLAN.md` §2 + §3.0–3.1 (القرارات الـ13 + AR-1..AR-3) + §4.1 (1–13) + §5 |

## 0. الخلاصة

- جدول `commerce_order_fulfillments` (صف كسول فريد لكل طلب) يكتبه `CommerceOrderFulfillmentService` وحده؛ حراس PostgreSQL وSQLite للإدراج والأضلاع والنسخة والثبات والحذف.
- سبعة إجراءات + تحديث تفاصيل؛ `expected_version` إلزامي؛ الهدف المتحقق idempotent؛ ثمانية أنواع أحداث بقائمة بيضاء ولكلٍّ حدث نطاق.
- قيد الإلغاء (الصف 14) **وكل مسارات إلغاء النية القديمة** عبر الكاتب الوحيد؛ مُشغّل قاعدة منفصل لـ`cancelled_at`.
- **لا أثر مالي أو مخزني أو حجز.** البوابة مغلقة افتراضياً؛ إغلاقها لا يُخفي حقائق قائمة.

## 1. الملفات

| الملف | التغيير |
|---|---|
| `database/migrations/2026_12_31_010000_create_commerce_order_fulfillments_table.php` | **جديد.** الجدول + حراس PG (دالة/مُشغّل) وSQLite (مُشغّلات) + مُشغّل حارس إلغاء الطلب + توسيع قيد شكل الأحداث بثمانية أنواع؛ `down()` يرفض مع وجود حقائق |
| `app/Models/CommerceOrderFulfillment.php` | **جديد.** `CompanyWide`، بلا `$fillable`، ثوابت الحالات/الأسباب |
| `app/Services/Commerce/CommerceOrderFulfillmentService.php` | **جديد.** الكاتب الوحيد (`act`, `updateDetails`, `actions`) |
| `app/Services/Commerce/CommerceOrderFulfillmentException.php` · `…LockedException.php` | **جديد.** رموز `reason` ثابتة؛ الثاني حارس AR-2 |
| `app/Http/Controllers/Api/CommerceStaffOrderFulfillmentController.php` | **جديد.** `POST …/fulfillment/{action}` و`PATCH …/fulfillment` |
| `app/Events/CommerceOrderFulfillment*.php` (×8) | **جديد.** حدث نطاق لكل نوع (معرّفات فقط) |
| `app/Services/Commerce/CommercePaymentIntentService.php` | الحارس في `cancelWithinTransaction` (الكاتب الوحيد لـ`cancelled`) |
| `app/Services/Commerce/CommerceOrderLifecycleService.php` · `…CancellationException.php` | الصف 14 في `assertCancellable`، قفل صف التنفيذ بعد الطلب، تحويل الحارس إلى `fulfillment_in_transit/completed` (لا `payment_captured`) |
| `app/Http/Controllers/Api/CommercePaymentIntentController.php` | المسار القديم: 422 برمز ثابت (الالتقاط داخل `domain()`) |
| `app/Models/CommerceOrder.php` · `CommerceOrderEvent.php` · `CommerceOrderEventRecorder.php` | علاقة `fulfillment()`، الأنواع/`DATA_KEYS`/`DOMAIN_EVENTS` |
| `app/Services/Commerce/CommerceOrderStatusProjector.php` · `app/Support/CommerceOrderStaffSerializer.php` · `CommerceStaffOrderController.php` | إسقاط حالة التنفيذ، كتلة `fulfillment` (تغيب مع غياب الصف)، `fulfillment_actions` (بوابة+صلاحية)، مرشّح `fulfillment_status` |
| `routes/api.php` · `config/commerce.php` | المسارات + البوابة `order_fulfillment_enabled` (false) |
| `tests/Feature/CommerceOrderFulfillmentTest.php` (27) · `…PostgresTest.php` (9) | **جديد** |
| `tests/Feature/CommerceOrderFeedTest.php` · `CommerceModuleBoundaryTest.php` | امتداد مقصود (حدث نطاق لكل نوع جديد؛ سطرا المسارين) |
| `CLAUDE.md` · ADR-29 §0/§2.3.1 · خطة H2-0 · Handoff · المتتبّع | التوثيق وسجل اعتماد القرارات التسعة |

## 2. قرارات تنفيذية داخل العقد

1. **`type` لا يُبدَّل مع الإرسال** (حارس القاعدة يمنع تغيير النوع والحالة في تحديث واحد): التبديل `local_delivery↔carrier` بـ`PATCH` قبل الإرسال؛ الإرسال لناقل يتطلب `carrier_name` (422 ودفاعاً في القاعدة).
2. **ملاحظة الفشل** عبر `fail` (`note`) وتُحدَّث بـ`PATCH` (`note`) بعد فشل مسجَّل فقط؛ لا تدخل الأحداث.
3. **رمز الحدث `details_updated`** يحمل أسماء الحقول بأكواد قصيرة (`type,carrier,number,url,courier,phone,note`) ≤ 64 حرفاً — لا قيم.
4. **موجز القائمة**: `fulfillment: {status, type}` يظهر فقط حين يوجد صف (لا مفتاح لغيره ⇒ الاستجابات القديمة حرفياً).
5. **الإلغاء-أولاً (مراجعة Codex على H2-0):** كل انتقال لاحق يعيد فحص نية قائمة غير ملغاة بحالة جاهزة؛ المخرج إلغاء الطلب بمساره (الصف 9).
6. المسار القديم للإلغاء يرفض بـ422 (لا 409) كسائر رفوضه، والجسم يحمل `reason` إضافياً؛ المسار الجديد/المفوَّض بـ409.

## 3. الاختبارات والنتائج (محلياً)

| الفحص | النتيجة |
|---|---|
| `CommerceOrderFulfillmentTest` (SQLite) | ✅ 27/27 (7540 تأكيداً): البوابة، الأضلاع الكاملة، الأهلية، النسخة، التفاصيل، الأحداث، الإلغاء وكل مسارات AR-2، AR-1، AR-3، RBAC/العزل، لا أثر مالي/مخزني، ساكنة، القاعدة |
| `CommerceOrderFulfillmentPostgresTest` (PostgreSQL حقيقي) | ✅ 9/9 (531 تأكيداً): نقرة مزدوجة، فائز واحد بين إجراءين، بدء×إلغاء الطلب، إرسال×إلغاء الطلب، **إرسال×إلغاء النية القديم (الإلغاء-أولاً)**، بدء×تحصيل COD، بدء×التقاط، تسليم×فشل، 4 طلبات متوازية — بالاتجاهين، بلا `40P01`، التغذية متصلة |
| ضابط سلبي | إزالة حارس AR-2 تُفشل 3 اختبارات (سباق PG + اختبارا المسارات القديمة) ثم أُعيد |
| انحدار Commerce على PostgreSQL | انظر وصف الـPR (أُجري `CommerceOrder|CommerceIntent|CommerceStaff|CommercePaymentIntent|StorefrontCheckout|CommerceCheckout|OnlineOrderStockHold|BranchIsolationGuard|CommerceModuleBoundary`) |
| بوابة الأداء المخصصة | **بلا تغيير** (50ms p95، الحمل والمنهجية) — لا اختبار أداء جديد |

## 4. الأمان والعزل

- **RBAC:** `commerce.orders.manage` (owner/admin عبر `*` فقط، لا زرع)؛ `view` وحده: قراءة بلا `fulfillment_actions`؛ المقيَّد بمخازن 403 (يُرفع في H2-2)؛ بلا رمز 401.
- **العزل:** طلب مستأجر آخر 404 موحَّد **قبل** 428/422؛ حراس القاعدة تمنع طلباً/مخزناً من مستأجر آخر.
- **المدخلات:** مفاتيح غير معروفة وtenant_id ⇒ 422؛ رابط التتبع https فقط؛ هاتف الساعي 0–9؛ رموز تحكم مرفوضة.
- **لا PII/ناقل/تتبع/ساعٍ/ملاحظة في الأحداث** (اختبار).
- **لا أثر مالي أو مخزني:** اختبار عدّاد (قيود/بنود/حركات/فواتير/سندات/حجوزات/ترحيل) + فحص ساكن لمراجع الخدمة.

## 5. المخاطر والمتبقي

| البند | المعالجة |
|---|---|
| طلب عالق في `delivery_failed` حين يستحيل الرجوع | قصور متعمَّد معلن (AR-1) — يُحسم في H6-2/D-11؛ واجهة H2-3 تعرض النص الثابت |
| التسليم ≠ تحصيل COD ولا أثر محاسبي | معلن؛ H5 محجوبة |
| رؤية المقيَّد بمخازن | 403 حتى H2-2 |
| لا كتلة عامة/تتبع ضيف | H2-4/H2-5 |
| حارس `cancelled_at` المباشر دفاع لا تسلسل | التسلسل الصحيح بقفل الطلب والتنفيذ (مثبت بسباقات PG) |

## 6. الخطوة التالية

دمج H2-1 بعد اجتياز البوابات، ثم **H2-2** تلقائياً (تفويض المالك: H2-1 … H2-6 بالتتابع). لا نشر ولا تفعيل.

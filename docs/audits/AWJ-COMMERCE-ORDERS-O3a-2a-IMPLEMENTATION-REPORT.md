# AWJ-COMMERCE-ORDERS-O3a-2a — تقرير التنفيذ

**المرجع:** `docs/plans/store/ADR-28-COMMERCE-ORDER-LIFECYCLE.md` §4 و§4.1 (الشروط المسبقة P-1…P-6).
**الطبيعة:** إعادة هيكلة بلا تغيير سلوك عام لإلغاء **نية الدفع**، تمهيداً لـO3a-2b. **لا** إلغاء طلب فعلي، **لا** migration، **لا** تغيير محاسبي/مخزني، **لا** واجهة، **لا** بوابات نشر، **لا** Merge/Deploy.

## 1. ما نُفِّذ

| الشرط | التنفيذ |
|---|---|
| **P-1** فصل الانتقال عن التنظيف | `CommercePaymentIntentService::cancelWithinTransaction()` — قفل صف النية + الفحوص (`collected`/`paid`/ملغاة/`hasCapture`) + التحديث **فقط**. لا مزوّد، لا إغلاق محاولات، لا قفل محاولة، لا تحرير حجز. يصحّ استدعاؤها داخل معاملة أكبر. |
| **P-1** السلوك العام محفوظ | `cancel()` = `cancelWithinTransaction()` ثم التنظيف (إغلاق المحاولات ثم تحرير الحجز، بالترتيب نفسه) عبر `DB::afterCommit`: **فور الالتزام** عند الاستدعاء المنفرد (كما كان)، ويُؤجَّل إلى **الالتزام النهائي للمعاملة الخارجية** عند التعشيش، ويُهمَل عند تراجعها. رسائل الرفض وقواعده كما هي. |
| **P-2/P-3** التنظيف بعد الالتزام وبلا أقفال | `OrderCancellationCleanup::run($intent)` → `CommerceOnlinePaymentService::closeActiveAttemptsIsolated()`: لكل محاولة نشطة `PaymentOrchestrator::cancel` (المزوّد + قفل صف المحاولة في معاملته القصيرة). **لا يرمي أبداً** (`Throwable` لكل محاولة يُسجَّل `report()`)، ويعيد `{closed, skipped, failed, remaining}`؛ `cannot_cancel` (المحاولة لم تعد نشطة) = متخطّاة لا فشل. لا معاملة ولا `lockForUpdate` في الصنف (يحرسه اختبار ساكن). |
| إعادة المحاولة الدائمة | `OrderCancellationCleanup::runPending()` + الأمر المجدول `commerce:close-cancelled-order-attempts` (كل 5 دقائق، `withoutOverlapping`، `onOneServer`): نوايا إلكترونية `cancelled` ما زالت لها محاولات `created/pending_customer/authorized` — **العمل المتبقي مشتقّ من الحالة نفسها فلا جدول جديد**. نافذة: بعد دقيقتين من الإلغاء (لا يزاحم التنظيف الفوري) وحتى 7 أيام؛ دفعة محدودة (`--limit`)؛ كل نية تحت سياق مستأجرها ويُستعاد السياق؛ أقدم أولاً. المحاولات تنتهي أصلاً بحدّ TTL المزوّد فلا تبقى عالقة للأبد. |
| **P-4** ترتيب الأقفال | لا تعديل لأي مسار قائم (ترحيل/التقاط/مكنسة/تحصيل). الإلغاء يقفل النية فقط داخل معاملته؛ المحاولة تُقفل **بعد** التحرّر (ما كان سيعكس ترتيب الترحيل `المحاولة → النية → الطلب` لو عُشِّش التنظيف). |
| **P-6** | اختبار ساكن: مستدعو `->cancel(` العامة لنية الدفع محصورون في `CommercePaymentIntentController` و`CommerceUnpaidOrderSweeper`؛ خدمة الإلغاء المقبلة (O3a-2b) تستعمل `cancelWithinTransaction`. |

**الفرق الوحيد الموثَّق عن السلوك السابق:** كان فشل التنظيف بأي استثناء **غير** `PaymentOrchestrationException` يخرج من `cancel()` بعد التزام الحالة؛ الآن يُسجَّل ولا يُرمى (الحالة ملتزمة ومتسقة والمطابِق يعيد المحاولة) — تنفيذاً لـADR-28 §4 («الاستجابة تعكس حالة المعاملة لا نتيجة التنظيف»). `closeActiveAttempts()` القديمة (تستعملها `start()`) **لم تتغيّر**.

## 2. الملفات

| الملف | |
|---|---|
| `app/Services/Commerce/CommercePaymentIntentService.php` | `cancelWithinTransaction()` + `cancel()` عبر `afterCommit` |
| `app/Services/Commerce/OrderCancellationCleanup.php` | جديد |
| `app/Services/Commerce/CommerceOnlinePaymentService.php` | `closeActiveAttemptsIsolated()` (إضافة؛ القديمة بلا تغيير) |
| `app/Console/Commands/CloseCancelledOrderAttemptsCommand.php` | جديد |
| `routes/console.php` | الجدولة |
| `tests/Feature/CommerceIntentCancelSeparationTest.php` | جديد — 14 اختباراً (SQLite + PG) |
| `tests/Feature/CommerceIntentCancelPostgresTest.php` | جديد — 5 اختبارات PostgreSQL حقيقي (`pcntl_fork`) |

لا `database/`، لا `web/`، لا `CLAUDE.md`، لا مسارات HTTP، لا Rbac.

## 3. الاختبارات

**جديدة (`CommerceIntentCancelSeparationTest`، 14):** `cancel()` العامة بسلوك مطابق (إغلاق المحاولة الحيّة وتحرير الحجز) ورفضاتها الأربعة (التقاط، ملغاة، مدفوعة) · `cancelWithinTransaction` لا يمسّ المحاولات ولا الحجز ولا يتصل بالمزوّد وبقية الرفضات كما هي · **التعشيش:** لا تنظيف ولا اتصال بالمزوّد قبل الالتزام النهائي، وبعده يجري · **التراجع:** معاملة خارجية فاشلة ⇒ النية والمحاولة والحجز كما كانت والمزوّد لم يُستدعَ · **فشل المزوّد أثناء التنظيف:** النية ملغاة والحجز محرَّر والمحاولة ما زالت `created`، ثم المطابِق: لا يلمس الإلغاء الحديث، يحتسب «ما زال معلّقاً» عند استمرار العطل، ينجح عند العودة، وإعادة تشغيله بلا اتصال إضافي (idempotent) · النافذة (7 أيام) والحدّ · سياق المستأجر واستعادته · الأمر مجدول ولا أثر محاسبي/مخزني/على النية · ضمانات ساكنة (P-2/P-6).

**PostgreSQL حقيقي (`CommerceIntentCancelPostgresTest`، 5):**
1. المزوّد يُستدعى **بعد** الالتزام وبلا معاملة مفتوحة، واتصال ثانٍ يقفل صفوف النية والطلب والحجز بـ`FOR UPDATE NOWAIT` **أثناء** استدعاء المزوّد ⇒ كلها حرّة.
2. التعشيش: لا اتصال بالمزوّد والمعاملة الخارجية مفتوحة؛ والأقفال محرَّرة وقت الاتصال بعد الالتزام.
3. **عدم الجمود:** 5 جولات بترتيبي بدء بين الإلغاء ومسار يمسك المحاولة ثم النية (ترتيب الترحيل) ⇒ لا `40P01`، والتنظيف يكتمل.
4. إلغاءان متزامنان ⇒ واحد ينجح فقط وأثر تنظيف واحد.
5. التقاط يسابق الإلغاء المعاد هيكلته ⇒ لا حالة هجينة (`paid` ∧ `cancelled`)، والتقاط على نية ملغاة ⇒ `late_capture`.

**اختبار طفرة (mutation) لإثبات قدرة الاختبارات على الكشف:** أعدتُ مؤقتاً التنظيف داخل معاملة `cancelWithinTransaction` (السلوك المرفوض في ADR-28): فشل **9 اختبارات** منها اختبارا القفل والتعشيش واختبار الجمود (ثم أُعيد الكود الصحيح).

**القائمة القائمة بلا تعديل:** `CommercePaymentIntentTest`، `OnlineOrderStockHoldTest`، `CommerceOnlinePaymentTest`، `CommerceInvoiceOnPaymentTest`، `CommerceOrderReservationServiceTest`، `StorefrontOnline*` — **116 ناجحاً** (SQLite) بلا أي تعديل في ملفاتها.

RESULTS_PLACEHOLDER

## 4. المخاطر والمتبقي

| البند | ملاحظة |
|---|---|
| فجوة بين الالتزام والتنظيف | قبل أن يغلق المطابِق المحاولة (حتى ~5 دقائق) قد تبقى صفحة دفع حيّة لنية ملغاة؛ بدء جديد مرفوض والتقاط متأخر ⇒ `late_capture` للمراجعة البشرية (D-15، كما كان قبل الهيكلة). |
| الفرق الموثَّق | فشل تنظيف غير `PaymentOrchestrationException` يُسجَّل ولا يُرمى (تحسين مقصود، §1). |
| رد `afterCommit` لا يصمد لانهيار العملية | يعوّضه المطابِق المجدول. |
| مطابِق بنافذة 7 أيام ودفعة 100 | أقدم أولاً؛ المحاولات تنتهي بـTTL المزوّد فلا تسدّ الدفعة للأبد. إن لزم لاحقاً تأجيل لكل نية فبعمود/جدول (خارج هذه الشريحة بلا migration). |
| اختبارات التعشيش في `RefreshDatabase` | تعمل لأن معاملة الاختبار تُعامَل كأساس (`afterCommit` يُنفَّذ عند التزام المعاملة الداخلية)؛ اختبارات PostgreSQL تعمل بلا معاملة مُغلِّفة لإثبات السلوك الحقيقي. |
| لا استدعاء لـ`cancelWithinTransaction` بعد | الخدمة المستهلِكة هي O3a-2b؛ هنا حارس ساكن وفحوص وحدة فقط. |

## 5. Git

- **Branch:** `claude/commerce-orders-o3a-2a`
- **Base SHA:** `a9ba9bd58c7ecb2e9a6464c5714cdf36fbbf5aa6` (`main` بعد ADR-28)
- **Head SHA / PR:** في وصف الـPR.

## 6. المرحلة التالية — O3a-2b

`CommerceOrderLifecycleService::cancel` + `POST commerce/orders/{id}/cancel` + `commerce.orders.cancel` + تفويض مسار إلغاء النية بصلاحيتين + اختبارات المصفوفة (14 حالة) والتزامن. تعتمد على **O3a-1** (أعمدة الإلغاء) و**هذه الشريحة** (`cancelWithinTransaction` + التنظيف بعد الالتزام). لا تُفتح قبل دمجهما وقرار بوابة النشر (D-9-G1).

# AWJ-PAY-H4-04a — الدفع الإلكتروني لطلب المتجر (Storefront → Moyasar) — تقرير التنفيذ

**الحالة:** مبني ومختبَر (SQLite + PostgreSQL) · **مغلق افتراضياً** · لا Deploy/Production Migration/Live · EXT-01 معلّق (لا مفاتيح Moyasar).
**النطاق المنفَّذ:** كل ما لا يحتاج قرار G3. **المؤجَّل بقرارك:** الطرف (D-05) · الفاتورة وترحيل A13 (D-13+EXT-05) · الحجز وانتهاء الطلب غير المدفوع (D-14) · سلوك الالتقاط المتأخر الآلي (D-15) — راجع `AWJ-PAY-H4-G3-DECISION-PROPOSAL.md`.

## القاعدة المعمارية (لا نظام موازٍ)
يعيد استعمال: `CommercePaymentIntent` (نية واحدة لكل طلب، يُضاف `method=online`/`status=paid`) · `PaymentOrchestrator` (محاولات، idempotency، `sync` رتيب، التقاط متأخر) · `MoyasarAdapter` (Invoices API المستضافة) · `PaymentWebhookInbox` و`PaymentAttemptReconciler` كما هما (يطبّقان على محاولات المتجر دون تعديل) · `CommerceOrderReference` (ملكية الضيف بمرجع موقَّع). **لا جدول نوايا/محاولات جديد** ولا Checkout موازٍ؛ `payment_attempts.payable_key = commerce_payment_intent:<id>`.

## الرحلة
1. `GET store/v1/checkout/payment-methods` ⇒ لكل وسيلة `online: true|false` (بوابة جاهزة مرتبطة بها) — **المفتاح غائب والبوابة مغلقة** فيبقى شكل الاستجابة حرفياً كما كان (عقد الرحلة المشترك مع الواجهة يحرسه `FlowersEndToEndJourneyTest`).
2. `PATCH checkout/payment` (قائم) ثم `POST checkout/complete` (قائم): وسيلة مرتبطة ببوابة جاهزة (والبوابة المنصّية مفتوحة، ولطلب متجر ويب فقط) ⇒ طلب `confirmed` + نية `online/pending` في **المعاملة نفسها**؛ الاستجابة تحمل `order_reference` (حين البوابة مفتوحة فقط) و`payment.requires_action=true` (للنية الإلكترونية فقط). وسيلة مرتبطة بوابتها غير جاهزة ⇒ رفض 422 وتراجع كامل (لا سقوط صامت إلى COD). بلا وسيلة مختارة ⇒ COD/الاستلام كما كان.
3. `POST store/v1/checkout/payment-intent` `{order_id}` + ترويسة `X-Order-Reference` ⇒ يبدأ/يستأنف محاولة ويعيد `checkout_url` (صفحة Moyasar المستضافة) و`status`. المبلغ والعملة والبوابة وعنوان العودة **كلها من الخادم** (لا مدخل عميل؛ حقل زائد ⇒ 422).
4. عودة المتصفح إلى `https://<نطاق المتجر الموثَّق>/checkout/payment-return` (مسار ثابت من الإعداد) **لا تُثبت شيئاً**.
5. `GET store/v1/orders/{order}/payment-status` (+ المرجع) ⇒ حقيقة الخادم: يستعلم المزوّد (`sync`، بحدّ أدنى 3 ثوانٍ بين استعلامين) ثم يعيد `awaiting_payment|pending|paid|failed|expired|cancelled|under_review` و`can_retry`.
6. التقاط مؤكَّد ⇒ حدث `CommercePaymentAttemptCaptured` ⇒ `completeCaptured` تحت قفل صف النية ⇒ `pending → paid` **مرة واحدة** (idempotent عبر القراءة/المستمع/الـwebhook/المطابِق/`payments:complete-commerce-captures`).

## الفشل والتكرار والانقطاع
| الحالة | السلوك |
|---|---|
| فشل/انتهاء/إلغاء المحاولة | `failed/expired/cancelled` + `can_retry`؛ البدء التالي ينشئ محاولة جديدة بمفتاح (نية، ترتيب) فيتقاطع طلبان متزامنان على محاولة واحدة |
| تكرار البدء | يستأنف المحاولة النشطة نفسها بلا استدعاء مزوّد ثانٍ |
| انقطاع المزوّد عند البدء | المحاولة `created` تُستأنف بمفتاحها الثابت (لا تحصيل مزدوج) ويردّ 503 `payment_provider_unavailable` |
| انقطاع المزوّد عند القراءة | آخر حالة معروفة؛ التقارب لاحقاً بالـwebhook/المطابِق |
| صفحة انتهت محلياً | القراءة/البدء يسألان المزوّد أولاً (قد يكون التُقط) ثم تُنهى المحاولة؛ لا يعلق العميل |
| مبلغ/عملة التقاط غير مطابقة | `under_review`: لا تثبيت للدفع، مراجعة بشرية |
| التقاط متأخر (محاولة منتهية/ملغاة أو نية ملغاة أو دفع بمحاولة أخرى) | يُقبل ويُوسم `late_capture`؛ يظهر في `GET commerce/payment-intents` (`attempts[].review_reasons`)؛ لا استرداد آلي ولا إعادة تفعيل (D-15 المحافظ) |
| دفع ناجح مع محاولة ثانية مفتوحة | تُلغى الثانية محلياً؛ التقاطها لاحقاً يُوسم للمراجعة |
| إيقاف منصة طارئ | يمنع البدء/الاستئناف فقط؛ التحقق مما التقطه المزوّد لا يُمنع |

## الأمان والعزل
- مغلق افتراضياً: `PAYMENTS_COMMERCE_ONLINE_CHECKOUT_ENABLED=false` ⇒ المساران 404 والإتمام COD حرفياً؛ ويشترط أيضاً تفعيل المدفوعات للمستأجر (ضابط H1-02).
- الملكية بمرجع موقَّع (ترويسة، لا استعلام)؛ كل فشل ملكية/عبور مستأجر أو قناة ⇒ 404 موحَّد.
- عنوان العودة من نطاق المتجر **الموثَّق والنشط** حصراً (نطاق قيد التحقق لا يُستعمل أبداً).
- موظفون: `GET commerce/payment-intents` بـ`payments.view`؛ `collect` مرفوض للنية الإلكترونية؛ `cancel` يغلق المحاولات الجارية ويُرفض إن وُجد التقاط/دفع؛ كلاهما بـ`payments.manage` ومعزول بالمستأجر.
- رموز أخطاء عامة جديدة (إضافية): `payment_unavailable` (503) · `payment_not_payable` (409) · `payment_provider_unavailable` (503) — مضافة إلى OpenAPI.

## ما لا يفعله (G3)
لا فاتورة، لا سند، لا قيد 1170/1130، لا حجز، لا حركة مخزون، لا ZATCA؛ `posting_status` للمحاولة يبقى فارغاً. الأثر الوحيد: التقاط لدى المزوّد + نية `paid`. لذلك لا يُفتح لمستأجر حي قبل إغلاق G3 وEXT-05.

## الاختبارات
`StorefrontOnlinePaymentTest` (29): البوابة المغلقة والتوافق · الرحلة الكاملة وتثبيت الدفع مرة واحدة · الفشل/الانتهاء/الانقطاع · التقارب (مستمع/أمر دوري) · عدم تطابق المبلغ · الالتقاط المتأخر والمزدوج · الملكية والعزل بين المستأجرين · رفض مدخلات العميل · RBAC · غياب أي أثر محاسبي/مخزني. `CommerceOnlinePaymentPostgresConcurrencyTest` (3، PostgreSQL + pcntl): بدء متزامن ⇒ محاولة واحدة · تثبيت متزامن ⇒ دفع واحد · التقاط يسابق إلغاء الإدارة ⇒ لا حالة هجينة. مع بقاء كل اختبارات Checkout/Payments/OpenAPI القائمة خضراء.

## الملفات
`database/migrations/2026_12_09_010000_add_online_payment_to_commerce_payment_intents.php` (عمود `paid_at` فقط، إضافي) · `app/Services/Commerce/{CommerceOnlinePaymentService,CommerceOnlinePaymentException,CommerceReturnUrlResolver}.php` · `app/Support/CommercePayable.php` · `app/Http/Controllers/Api/StorefrontOnlinePaymentController.php` · `app/Events/CommercePaymentAttemptCaptured.php` + `app/Listeners/CompleteCommerceOnlinePayment.php` + `app/Console/Commands/CompleteCommerceCapturesCommand.php` · تعديلات صغيرة: `PaymentOrchestrator` (عنوان عودة + حدث الالتقاط) · `PaymentAttemptContext`/`MoyasarAdapter` (`returnUrl`) · `CommercePaymentIntent(+Service)` · `StorefrontCheckoutController` · `CommercePaymentIntentController` · `PublicApiErrorCode` · `config/payments.php` · `routes/{api_storefront,console}.php`.

## المتبقي
H4-05 (واجهة المتجر: `PaymentStage` وصفحات العودة/الانتظار/الفشل و6 لغات و`capabilities.ts` → `built`) مؤجَّلة بقرارك (الواجهة البصرية) · تكافؤ `/commerce/v1` (الجوّال) · EXT-01 (دفعة Sandbox حقيقية من المتجر) · H4-01/02/03 بعد اعتماد G3.

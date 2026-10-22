# AWJ-PAYMENTS-HZ-01 — الخطة الرئيسية للأفق

STATUS: **مقترحة — عند G0.** لا تمنح إذن تنفيذ كود.
DATE: 2026-10-22 · BASE: `origin/main` @ `d1874065f580c805706c2b4cda7eb612708550e1`

> الوسوم: `VERIFIED` مثبت من كود `main` أو وثيقة رسمية للمزوّد بتاريخ الخطة · `TO VERIFY` غير مثبت · `PROPOSAL` مقترح · `D-xx` قرار في §13 · `C-xx` تعارض في §11 · `EXT-xx` تبعية خارجية في سجل المخاطر.

---

## 1. الخلاصة

- **الأساس المبني (VERIFIED):** بيان طرق الدفع وسياسة القنوات، `PaymentGateway` مشفّر لكل مستأجر، قيد مقاصة البوابة عند التحصيل (1170)، تسوية دفعية بعمولة (5510)، `CustomerRefund`، `CommercePaymentIntent` (COD/الاستلام)، نمط webhook موقّع (موصلات التوصيل)، idempotency وrollout controls قابلة لإعادة الاستخدام.
- **الناقص:** طبقة التنسيق كاملة (محوّلات، محاولات، صندوق أحداث، مسارات، واجهات)، استرداد البوابة، تسوية حقيقية (ضريبة الرسوم/الاستردادات/الفروقات)، النزاعات، الدفع الإلكتروني للمتجر، أجهزة POS، المدفوعات المدمجة.
- **المعمارية:** سياق **Payment Orchestration** واحد يملك المحاولات وأحداث المزوّد والمحوّلات، ويسلّم كل أثر مالي للخدمات القائمة. `PaymentGateway` يتوسّع ليصبح «اتصال التاجر» بنمطين `byog`/`platform`. لا جدول نوايا عام يستبدل `CommercePaymentIntent`.
- **الترتيب:** H0 قرارات ← H1 أساس ← H2 BYOG وروابط الفواتير ← H3 استرداد وتسوية ومطابقة ← H4 المتجر ← H5 النزاعات ← H6 أجهزة POS ← H7 المدفوعات المدمجة ← H8 التحصين والإغلاق. H6-01 وH7-01 يمكن أن يبدآ مبكراً حيث لا تبعية.

---

## 2. الوضع الحالي (Evidence Matrix — مختصرة)

| القدرة | الدليل | الحالة | الفجوة |
|---|---|---|---|
| قيد مقاصة البوابة | `app/Services/Accounting/PaymentService.php:321-358` | ✅ | لا مستدعٍ آلي |
| أدوار المدفوعات | `app/Support/AccountingRoles.php:153-179` (1170، 5510، 1180) | ✅ | لا أدوار للنزاع/عمولة المنصة/الاستقطاعات |
| تسوية البوابة | `PaymentGatewaySettlementService::post` | 🟡 | غير موصولة بأي مسار؛ ضريبة الرسوم والاستقطاعات/الاعتمادات مرفوضة؛ بنود موجبة فقط |
| عكس السند | `PaymentReversalService` + `POST payments/{id}/reverse` | ✅ | يرفض عكس تحصيل مسوّى (صحيح) |
| استرداد العميل | `CustomerRefundService`، `customer-refunds/*` | ✅ | `method ∈ {cash,bank}` فقط (`StoreCustomerRefundRequest.php:19`) |
| إعداد البوابة | `app/Models/PaymentGateway.php`، `PaymentGatewayService` | 🟡 | لا مسار/واجهة؛ حذف فعلي و`payments.payment_gateway_id` `nullOnDelete`؛ قائمة مزوّدين بلا خيارات سعودية |
| Webhook وارد | نمط `delivery-connectors/{connector}/events` (`routes/api.php:218`) + `WebhookSignature` + تسامح 300ث + dedupe | ✅ نمط | لا مستقبِل دفع |
| Idempotency | `EnforceUserIdempotency`، `EnforceApiIdempotency`، `PosCheckoutAttempt` | ✅ | — |
| ضوابط التفعيل | `ZatcaRolloutControl` (مستأجر + إيقاف منصة + تدقيق) | ✅ نمط | — |
| الطوابير | `Dockerfile:58` `QUEUE_CONNECTION=sync`؛ المجدول عبر cron خارجي غير موجود في المستودع | ⚠️ | لا عامل خلفية |
| نية دفع Commerce | `CommercePaymentIntent` (`unique(commerce_order_id)`)؛ `markCollected` يغيّر الحالة فقط | 🟡 | لا سند، لا محاولات، لا «إلكتروني» |
| Checkout | `CommerceCheckoutService::complete()` معاملة + `Idempotency-Key` | ✅ | لا حجز مخزون؛ لا جسر طلب→فاتورة (PR-COM-10B) |
| الهوية ↔ الطرف | `CustomerPartnerLinkService::link` يدوي بفاعل | 🟡 | `Payment` يتطلب `Partner` |
| واجهة دفع المتجر | `storefront/src/lib/commerce/capabilities.ts:95-110` `design_only` | 🟡 | العقد الناقص معلن فيه |
| POS | tender `{payment_method_id, amount}`؛ البطاقة ⇒ بنك مباشرةً؛ `StorePosSaleRequest.php:51` يرفض مفاتيح إضافية | ✅ | لا مرجع عملية، لا مقاصة، لا جهاز دفع، المرتجع `cash`/`credit` فقط |
| أجهزة | `app/Services/Pos/Hardware/*` + `local-hardware-bridge` (درج نقد فقط، أوامر HMAC) | 🟡 نمط | لا تكامل جهاز دفع |
| مطابقة بنكية / نزاعات | — | ❌ | — |

---

## 3. المعمارية المستهدفة

### 3.1 السياقات

```text
┌──────────────── Payment Orchestration ────────────────┐
│ PaymentOrchestrator · GatewayAdapterRegistry           │
│ ProviderEventInbox  · AttemptReconciler (أمر مجدول)    │
│ PaymentsRolloutControl (مستأجر + إيقاف منصة)           │
└───┬───────────────────────┬────────────────────────┬──┘
    │ Payables              │ الأثر المالي (قائم)     │ الإعداد
    ▼                       ▼                        ▼
 InvoicePaymentRequest   PaymentService→Ledger     PaymentGateway (اتصال التاجر)
 CommercePaymentIntent   CustomerRefundService     PaymentMethod / ChannelAvailability
 PosTerminalRequest      PaymentGatewaySettlement  AccountingRoles
                         PaymentDisputeService(جديد، عبر Ledger)

Terminal Integration (منفصل): PosPaymentTerminal · TerminalAdapter · Bridge/Cloud → PosService
Platform Payments (مشروط G6): نفس PaymentGateway بنمط platform + Onboarding لدى الشريك
```

| السياق | يملك | لا يملك |
|---|---|---|
| اتصال التاجر | المزوّد، البيئة، الأسرار، الحالة، مفتاح webhook، القدرات المتحقق منها | قيود، طرق دفع |
| Payables | المبلغ والعملة والطرف والانتهاء | حالة المزوّد |
| Orchestration | المحاولات، الأحداث، آلة الحالات، المراجع، correlation | الكتابة في الدفتر |
| Financial Core | السند، الاسترداد، التسوية، النزاع، القيد | استدعاء المزوّد |
| Terminal | الجهاز، الإقران، أمر البيع، دفعة الجهاز | الفاتورة (عبر `PosService`) |

### 3.2 عقد Payable

```php
interface Payable {
    public function payableKey(): string;
    public function amountDueMinor(): int;              // يُعاد حسابه من المصدر عند كل محاولة
    public function currency(): string;
    public function partnerIdForAccounting(): ?string;  // null ⇒ لا ترحيل (D-05)
    public function allocationTargets(): array;
    public function assertStillPayable(): void;
}
```

### 3.3 عقد المحوّل

```php
interface GatewayAdapter {
    public function provider(): string;
    public function capabilities(): GatewayCapabilities;
    public function verifyCredentials(ConnectionCredentials $c): CredentialCheck;
    public function createCheckout(AttemptContext $ctx): HostedCheckout;          // Hosted/redirect فقط
    public function fetchPayment(string $providerPaymentId): ProviderPaymentSnapshot; // الحقيقة
    public function verifyWebhook(RawWebhook $w, ConnectionCredentials $c): VerifiedWebhook;
    public function capture(CaptureContext $ctx): ProviderResult;
    public function void(VoidContext $ctx): ProviderResult;
    public function refund(RefundContext $ctx): ProviderResult;                   // idempotency = refund_attempt.id
    public function fetchSettlements(SettlementQuery $q): iterable;               // حيث يدعمها المزوّد
}
```

قواعد: لا شبكة داخل معاملة؛ مفتاح idempotency ثابت لكل استدعاء؛ تطبيع إلى هللات صحيحة؛ الأسرار لا تغادر المحوّل؛ نطاقات المزوّد ثابتة لكل بيئة (لا URL من المستأجر). كل محوّل يجتاز **حزمة اختبار عقد مشتركة** على عيّنات المزوّد الرسمية. `FakeAdapter` للاختبار فقط، غير قابل للاختيار في الإنتاج.

### 3.4 نموذج البيانات (إضافي فقط — يُنفَّذ في شرائحه)

**توسيع قائم**

| الجدول | الإضافة | الشريحة |
|---|---|---|
| `payment_gateways` | `connection_mode`، `status`، `webhook_key` (unique)، `credential_version`، `previous_webhook_secret` + `previous_secret_expires_at`، `capabilities` json، `verified_at`، `deactivated_at`، `provider_account_ref`؛ توسيع `PROVIDERS` | H1-01 / H7-01 |
| `customer_refunds` | `method` يقبل `gateway`، `payment_gateway_id`، `refund_attempt_id` unique | H3-01 |
| `payment_gateway_settlement_items` | `item_type` (`collection`/`refund`/`dispute`/`adjustment`)، `customer_refund_id`، `payment_dispute_id` | H3-02 / H5-01 |
| `payment_gateway_settlements` | أعمدة ضريبة الرسوم المستعملة فعلياً + لقطة الحسابات/السياسة | H3-02 |
| `commerce_payment_intents` | `method` يقبل `online` | H4-04 |
| `payments` | لا أعمدة جديدة؛ مرجع الجهاز في `reference`/`payment_details` القائمين | H6-01 |

**جداول جديدة**

| الجدول | المفاتيح الحرجة | التصنيف |
|---|---|---|
| `payment_attempts` | `UNIQUE(tenant_id, idempotency_key)`؛ `UNIQUE(payment_gateway_id, provider_payment_id)` جزئي؛ محاولة نشطة واحدة لكل Payable (فهرس جزئي)؛ `capture_status` و`dispute_status` عمودان مستقلان؛ CHECK `captured ≥ refunded` | D-07 |
| `payment_attempt_postings` | مجموعة الترحيل الواحدة لكل التقاط: `attempt_id`، `payment_id`، `role` (`allocated`/`unallocated`)؛ `UNIQUE(attempt_id, role)` + `UNIQUE(payment_id)`؛ كل سندات الالتقاط وروابطها تُنشأ وتُرحَّل في **معاملة واحدة** (لا حالة وسيطة بعد انهيار)؛ وجود أي صف = المجموعة مكتملة | CompanyWide |
| `payment_provider_events` | `UNIQUE(payment_gateway_id, provider_event_id)`؛ جسم مشفّر ≤ 64KB + هاش؛ لا DELETE | CompanyWide |
| `payment_refund_attempts` | `UNIQUE(payment_gateway_id, provider_refund_id)` | CompanyWide |
| `invoice_payment_requests` | `token_hash` unique؛ المبلغ ≤ المتبقي | BelongsToBranch (يرث فرع الفاتورة) |
| `payments_rollout_controls` + `_events` | نمط ZATCA (مستأجر + منصة، حدث لكل تغيير) | تشغيلي منصة |
| `payment_connection_events` | سجل إداري append-only بلا أسرار | CompanyWide |
| `payment_disputes` | `UNIQUE(payment_gateway_id, provider_dispute_id)` | CompanyWide |
| `pos_payment_terminals` | `UNIQUE(tenant_id, provider, terminal_ref)`؛ ربط `pos_device_id` | BranchScoped |
| `pos_terminal_requests` | `UNIQUE(tenant_id, branch_id, idempotency_key)` | BranchScoped |

كل المبالغ `bigint` هللات؛ `tenant_id` FK بنمط المستودع؛ الاحتفاظ D-20.

---

## 4. آلة الحالات والضمانات

ثلاثة أبعاد **مستقلة** على المحاولة (لا حالة واحدة رتيبة تخلطها)، وبُعد رابع مشتق:

```text
(1) الالتقاط  capture_status (رتيب):
    created ─► pending_customer ─► authorized ─► captured
       │              ├─► expired         └─► voided
       └─► cancelled  └─► failed

(2) الاسترداد  مشتق من refunded_minor مقابل captured_minor:  none ─► partial ─► full

(3) النزاع  dispute_status (لكل نزاع في payment_disputes، وملخّصه على المحاولة):
    none ─► open ─► won | lost        (قد يتكرر لنزاعات لاحقة)

(4) التسوية  مشتقة من بنود التسوية:  unsettled ─► in_payout ─► settled
```

- كل التركيبات مسموحة متى كان `capture_status = captured`: نزاع على المتبقي بعد استرداد جزئي، أو استرداد بعد كسب نزاع.
- **المبلغ القابل للاسترداد** = `captured_minor − refunded_minor − Σ مبالغ النزاعات المفتوحة أو الخاسرة`. الاسترداد أثناء نزاع مفتوح ممنوع افتراضياً ما لم يسمح به المزوّد (TO VERIFY لكل مزوّد).
- كل بُعد رتيب داخل نفسه؛ لا انتقال للخلف.
- الأثر المالي: الوصول إلى `captured` ⇒ **مجموعة ترحيل واحدة** ذرّية (سند 1170/1130 واحد، أو سندان مخصّص + غير مخصّص للدفعة الزائدة)؛ الاسترداد المؤكد ⇒ `CustomerRefund`؛ النزاع ⇒ D-06؛ غير ذلك لا شيء.

| الخطر | الضمان |
|---|---|
| حدث مكرر | dedupe بمعرّف الحدث + بصمة الجسم (مختلف ⇒ 409 وتنبيه) |
| خارج الترتيب / متأخر | لا تطبيق من الجسم؛ `fetchPayment()` دائماً؛ رتبة رتيبة؛ التقاط بعد انتهاء محلي يُقبل ويُرفع `late_capture_requires_action` (D-15) |
| تزامن | `lockForUpdate` على المحاولة؛ ترتيب أقفال: المحاولة ← Payable ← الفاتورة/الطلب ← (PaymentService) السند ← مِرساة المستأجر |
| ترحيل مزدوج / جزئي | `payment_attempt_postings` بـ`UNIQUE(attempt_id, role)` + إنشاء كل سندات الالتقاط وروابطها في معاملة واحدة + فحص وجود المجموعة داخل قفل المحاولة؛ إعادة الحدث بعد انهيار إما تجد المجموعة كاملة أو لا تجد شيئاً |
| مبلغ/عملة مختلفان | `requires_review` بلا ترحيل |
| ملتقط غير مرحّل | `AttemptReconciler` يعيد الترحيل idempotently؛ تنبيه بعد 10 دقائق |
| فترة مقفلة | D-12: يُرفض الترحيل، تبقى المحاولة `captured_unposted` مع تنبيه؛ لا تغيير تلقائي للتاريخ |
| عودة المتصفح | ليست دليل دفع؛ تطلق `fetchPayment()` فقط |

---

## 5. المحاسبة

> كل القيود عبر الخدمات القائمة ← `LedgerService`. مثال: فاتورة 1,150.00 (1,000.00 + ضريبة 150.00). ما يعتمد على قرار معلّم.

| # | الحدث | مدين | دائن | الحالة |
|---|---|---|---|---|
| A1 | التقاط إلكتروني | 1170 مقاصة 1,150.00 | 1130 العملاء + طرف 1,150.00 | مبني (PAY-V2-5) |
| A2 | صرف بعمولة 25.00 + ضريبة 3.75 | البنك 1,121.25 · 5510 25.00 · `tax_input` 3.75 | 1170 1,150.00 | الضريبة بعد **D-04** |
| A3 | دفعة جزئية 500 | 1170 500.00 | 1130 500.00 | مبني |
| A4 | دفعة زائدة 1,200 | سند 1: 1170 1,150 / 1130 1,150 مخصّص · سند 2: 1170 50 / 1130 50 غير مخصّص (رصيد دائن) — **معاملة واحدة، مجموعة ترحيل واحدة** | | **D-26** |
| A5 | استرداد (بعد إشعار دائن قائم) | 1130 + طرف 1,150.00 | 1170 1,150.00 | بعد تأكيد المزوّد (**D-03**) |
| A6 | صرف يخصم استرداداً: تحصيل 2,000، استرداد 1,150، عمولة 40 | البنك 810.00 · 5510 40.00 · 1170 (بند استرداد) 1,150.00 | 1170 (تحصيل) 2,000.00 | H3-02 |
| A7 | خسارة نزاع مؤقتة | 1130 + طرف 1,150.00 | 1170 1,150.00 | **D-06** |
| A8 | رسوم نزاع 60 | دور رسوم النزاع 60.00 | 1170 60.00 | **D-06** |
| A9 | كسب النزاع | `LedgerService::reverse` لـ A7 | | **D-06** |
| A10 | عمولة المنصة المقتطعة (H7) | البنك صافي · دور عمولة المنصة · `tax_input` إن وُجدت فاتورة | 1170 إجمالي | **D-17** |
| A11 | POS بطاقة (افتراضي، بلا تغيير) | بنك الطريقة | 1130 | مبني |
| A12 | POS بطاقة بطريقة مرتبطة بمستحوذ | 1170 | 1130 | **D-09** (اختياري، مطفأ افتراضياً) |
| A14 | استرداد بطاقة POS لبيع A11 (بنك مباشر) | 1130 + طرف | **بنك الطريقة الأصلي** (مسار `CustomerRefund` `method=bank` القائم) | H6-04 |
| A15 | استرداد بطاقة POS لبيع A12 (مستحوذ مرتبط) | 1130 + طرف | 1170 (مسار البوابة A5) | H6-04 |
| A13 | طلب متجر مدفوع مسبقاً | قيود الفاتورة القائمة (`InvoiceService::post`) ثم A1 مخصّصاً | | **D-13** |

قواعد: **الاسترداد يعكس حساب التحصيل الأصلي** (A14/A15: لا يُقيَّد على 1170 ما لم يُحصَّل عليه)؛ لا قيد تعويضي وهمي للفروقات (D-21)؛ لا افتراض استرداد العمولة؛ لا تعديل لقيد مرحّل؛ «مطابقة» = معادلة صريحة `Σ التحصيلات − Σ الاستردادات − Σ النزاعات = الصافي + الرسوم (+ ضريبة الرسوم) ± تسويات معتمدة`؛ تقرير أعمار 1170 لكل محاولة.

**ZATCA/الضريبة:** الدفع لا يغيّر ضريبة الفاتورة ولا XML/QR/السلسلة؛ لا رسوم إضافية على العميل (D-30)؛ ضريبة رسوم المزوّد على مستند المزوّد لا على فاتورة المبيعات؛ الدفعات المقدمة لطلبات المتجر تتجنّب بالفوترة عند تأكيد الدفع (D-13) ما لم يقرر الرأي الضريبي غير ذلك.

---

## 6. الأمن والخصوصية

| الضابط | التصميم |
|---|---|
| حدود المستأجر للـwebhook | `POST /api/payment-webhooks/{provider}/{webhookKey}`؛ المستأجر من الاتصال (نقطة `withoutGlobalScope` واحدة موثقة كنمط موصلات التوصيل) ثم `TenantContext::set`/`forget` |
| التوقيع | لكل محوّل حسب الوثيقة الرسمية (Tap `hashstring` VERIFIED؛ HyperPay جسم مشفّر VERIFIED والخوارزمية TO VERIFY؛ Moyasar TO VERIFY) |
| استعلام موثوق | إلزامي قبل أي أثر مالي |
| الصلاحيات | `payment_gateways.manage` (owner/admin) للأسرار؛ `payments.view/manage`؛ `customer_refunds.manage`؛ `payment_disputes.*`؛ عتبة موافقة للاسترداد (D-28) |
| الأسرار | `encrypted` cast + `credential_version` + نافذة سماح؛ تدوير مفتاح التطبيق/تشفير مغلّف (D-10) |
| PCI | Hosted/redirect فقط؛ هدف SAQ A (TO VERIFY مع QSA) |
| السجلات | منع الأجسام والرؤوس الحساسة؛ قناع؛ رسائل عميل مطبّعة |
| تحديد المعدّل | webhook لكل اتصال؛ صفحة الدفع لكل رمز وIP؛ إنشاء المحاولة لكل رابط |
| روابط الدفع | رمز ≥32 بايت، هاش فقط، صلاحية، أقل بيانات |
| Sandbox | لا ينتج سنداً مرحّلاً في دفتر مستأجر حقيقي (D-27) |
| PDPL | أقل بيانات شخصية؛ حذف الأجسام الخام بعد مدة (D-20)؛ موقع الاستضافة EXT-07 |
| التدقيق | `payment_connection_events` + الصندوق الوارد + أحداث الضوابط |

نموذج التهديدات (انتحال، عبور مستأجر، تلاعب بالمبلغ، replay، تسرب أسرار، تعداد بطاقات، DoS، إنكار، رفع صلاحية، ترحيل مزدوج) ومخففاتها في سجل المخاطر، وكل بند له اختبار سلبي في مصفوفة القبول.

---

## 7. تجربة الاستخدام

الالتزام بـ`DESIGN_SYSTEM.md` (لون هوية واحد، بلا زخرفة/glassmorphism، أخضر/أحمر دلاليان مع أيقونة، `formatRiyal` و`𞸁`، الجداول هي البطل، حالات فارغ/تحميل/خطأ، RTL أولاً، الجوال بطاقات).

| الشاشة | المسار | المرحلة |
|---|---|---|
| الإعدادات ← المدفوعات (اتصالات، تحقق، تفعيل، تدوير، سجل) + بطاقة في التكاملات | `/finance-settings/payments`، `/integrations` | H1-05 |
| طلب دفع من الفاتورة + تبويب الطلبات | `/invoices/[id]` | H2-03 |
| صفحة الدفع العامة (ar/en) | `/pay/[token]` | H2-03 |
| سجل المدفوعات الإلكترونية + خط زمني للأحداث | `/payments/online` | H2-03 |
| الاسترداد عبر البوابة | `/customer-refunds` | H3-01 |
| التسويات والمطابقة + أعمار المقاصة + التنبيهات | `/payments/settlements`، `/reports` | H3-03 |
| دفع المتجر | `storefront/.../awj/PaymentStage.tsx` | H4-05 |
| النزاعات | `/payments/disputes` | H5-01 |
| POS: بطاقة عبر الجهاز، مرجع يدوي احتياطي، استرداد للبطاقة، مطابقة الدفعة | `/pos` | H6 |
| تفعيل المدفوعات المدمجة (تجربة سلة) | `/finance-settings/payments/activate` | H7-02 |

مراجعة بصرية إلزامية (بحث بصري للمراجع حسب بروتوكول الأفق) لكل شاشة: 390/768/1280/1440، عربي/إنجليزي، فاتح/داكن — نهائياً في H8-02.

---

## 8. الأدلة الخارجية (2026-10-22)

| | Moyasar | Tap | HyperPay | Geidea | NearPay |
|---|---|---|---|---|---|
| تفويض/التقاط/إلغاء/استرداد | VERIFIED | charge/authorize/refund VERIFIED | TO VERIFY | TO VERIFY | purchase/refund/reverse VERIFIED |
| Idempotency | VERIFIED | TO VERIFY | TO VERIFY | TO VERIFY | TO VERIFY |
| توقيع webhook | سر مشترك عند التسجيل؛ آلية التحقق TO VERIFY | `hashstring` HMAC-SHA256 VERIFIED | جسم مشفّر VERIFIED | TO VERIFY | — |
| Apple Pay / STC Pay / mada | وثائق VERIFIED | TO VERIFY | TO VERIFY | TO VERIFY | TO VERIFY |
| بيانات التسوية | Transfers VERIFIED | TO VERIFY | TO VERIFY | TO VERIFY | reconcile VERIFIED |
| Marketplace | غير موثق | Destinations + Business API، غير ذاتي الخدمة VERIFIED | TO VERIFY | TO VERIFY | — |
| أجهزة | — | TO VERIFY | — | ECR (طرف ثالث فقط) TO VERIFY | Android 10+ NFC، Web SDK، HTTP proxy VERIFIED |
| شروط/أهلية/رسوم/مدة الصرف | TO VERIFY | TO VERIFY | TO VERIFY | TO VERIFY | TO VERIFY |

المصادر في §15. SAMA: اللائحة التنفيذية لنظام المدفوعات وخدماته سارية منذ 2023 وتشمل «خدمات الدفع المجمّعة» كنشاط مرخّص (مصدر ثانوي)؛ التطبيق على نموذج أَوْج **سؤال لمستشار مؤهل** (EXT-04).

---

## 9. العقود (PROPOSAL، بلا كسر لمستهلك قائم)

**داخلي:** `payment-gateways` (CRUD + verify/activate/suspend/revoke/rotate) · `invoices/{id}/payment-requests` · `payment-attempts` (+`/{id}/sync`) · `customer-refunds` (method=`gateway`) · `payment-gateway-settlements` · `payment-disputes` · `payments/rollout` (منصة) · `pos/terminals` · `pos/terminal-requests`.
**عام:** `GET /pay/v1/{token}` · `POST /pay/v1/{token}/attempts` (`Idempotency-Key`) · `GET /pay/v1/{token}/status` · `POST /store/v1/checkout/payment-intent` (+ تكافؤ `/commerce/v1`) · `POST /api/payment-webhooks/{provider}/{webhookKey}`.
**أحداث:** `payment.attempt.created` · `payment.captured` · `payment.failed` · `payment.refunded` · `payment.dispute.opened|closed` · `gateway.settlement.posted` — الإضافة للكتالوج الصادر بقرار D-31.
**الأخطاء:** `gateway.not_configured|inactive|credentials_invalid|capability_unsupported` (422) · `payable.not_payable` (409) · `payment.amount_mismatch|currency_mismatch|attempt_in_progress` (409) · `idempotency.conflict` (409) · `webhook.signature_invalid` (401) · `webhook.unknown_connection` (404) · `webhook.payload_conflict` (409) · `refund.exceeds_captured` (422) · `refund.provider_rejected` (502) · `settlement.unreconciled|fee_tax_policy_missing` (422) · `provider.unavailable|timeout` (503) · `tenant.mismatch` (403). رموز ثابتة مع نص عربي، والواجهة تترجم بالرمز.

---

## 10. المراحل H0–H8

| المرحلة | الهدف | مخرجات الإغلاق | البوابة |
|---|---|---|---|
| **H0** القرارات | اعتماد الأفق والقرارات وتسجيلها في ADR | PR الوثائق مدموج؛ G0 مغلق؛ ADR-PAY-01/02 مدموجة؛ طلبات EXT مرسلة | G0 |
| **H1** الأساس | اتصال تاجر آمن، ضوابط تفعيل، محاولات، صندوق أحداث، مستقبِل webhook، مُطابِق، واجهة الإعدادات | لا سر يتسرب؛ لا حذف مدمر؛ dedupe/ترتيب/تزامن مثبتة بـFakeAdapter؛ صفر قيود | G0 |
| **H2** BYOG وروابط الفواتير | محوّلان حقيقيان، روابط دفع، دفعات جزئية، صفحة دفع عامة، سجل المدفوعات | التقاط Sandbox حقيقي ⇒ مجموعة ترحيل واحدة A1؛ تحقق Sandbox لمزوّدين | G1 |
| **H3** الاسترداد والتسوية والمطابقة | استرداد البوابة، تسوية v2 (ضريبة رسوم، استردادات، استقطاعات، فروقات)، استيراد الصرف، تقارير وتنبيهات | A2/A5/A6 مثبتة؛ معادلة التسوية؛ لا قيد وهمي | G2 |
| **H4** المتجر | ربط الهوية بالطرف، حجز الدفع، جسر الطلب→الفاتورة، نية إلكترونية، تعويض الالتقاط المتأخر، واجهة المتجر | طلب مدفوع ⇒ فاتورة + سند مخصّص؛ لا بيع زائد؛ لا طرف مكرر | G3 |
| **H5** النزاعات | دورة النزاع وقيوده وتنبيهات المواعيد | A7–A9 مثبتة | G4 |
| **H6** أجهزة POS | مرجع العملية، مقاصة اختيارية، أساس الأجهزة، محوّل مزوّد، تعويض، استرداد للبطاقة، مطابقة الدفعة | جهاز Sandbox/معتمد؛ لا بيع بلا موافقة ولا موافقة يتيمة | G5 |
| **H7** المدفوعات المدمجة | نمط platform، Onboarding/KYC، تفعيل شبيه بسلة، العمولة | تاجر Sandbox مُنشأ عبر الشريك ويستقبل دفعة؛ A10 | G6 |
| **H8** التحصين والإغلاق | أمن، خصوصية، تدوير المفاتيح، E2E بصري، runbooks، تدريبات تراجع، تحقق Live، تقرير نهائي | DoD الميثاق §5 | G-LIVE / G-DEPLOY |

تفاصيل كل مهمة (النطاق، DB/API، الاعتماديات، الأولوية، معيار الإغلاق) في `AWJ_PAYMENTS_HORIZON_TASK_QUEUE.md`.

---

## 11. حلول التعارضات (C-01…C-16)

| # | التعارض | مسار الحل | الاختبار | معيار القبول | المهمة |
|---|---|---|---|---|---|
| C-01 | ADR-04 «Settlement → Payment Core» مقابل الترحيل عند الالتقاط | ADR-PAY-01 يعدّل الصياغة: السند عند الالتقاط؛ الصرف حدث تسوية | اختبار: لا سند قبل `captured`؛ التسوية لا تغيّر `paid_amount` | ADR مدموج + اختبارات خضراء | H0-03، H2-02 |
| C-02 | `CommercePaymentIntent` فريد لكل طلب بلا محاولات | إبقاؤه + `payment_attempts` متعدد الأشكال | محاولات متعددة لنية واحدة؛ قيد الفرادة باقٍ | لا ترحيل بيانات؛ ADR-09 سليم | H1-03، H4-04 |
| C-03 | `Payment` يتطلب `Partner` | سياسة D-05 في `CustomerPartnerResolver` | لا طرف مكرر لنفس الهوية المتحقق منها؛ لا خلط بطرف آخر | ربط idempotent ومدقّق | H4-01 |
| C-04 | تساوي التخصيصات + فاتورة مرحّلة شرطاً | سندان للدفعة الزائدة (D-26) في معاملة واحدة ضمن `payment_attempt_postings`؛ الفوترة قبل التخصيص (D-13) | دفعة زائدة ⇒ سندان بمجموع = الملتقط؛ انهيار محقون بين السندين ثم إعادة الحدث ⇒ لا تكرار ولا نقص | بلا تعديل لـ`PaymentService` | H2-02 |
| C-05 | حذف البوابة مدمّر | حارس خدمة + نموذج: `revoked` عند وجود مرجع؛ حذف فعلي فقط لغير المرجعية | حذف بوابة لها سند/تسوية/محاولة ⇒ 422 والربط باقٍ | لا `payment_gateway_id` يصبح NULL | H1-01 |
| C-06 | قائمة المزوّدين | توسيع إضافي مع كل محوّل | قيم قديمة صالحة | — | H1-01، H2-01، H2-04 |
| C-07 | ضريبة الرسوم مرفوضة | D-04 + لقطة الدليل والحساب | مع/بدون سياسة؛ لا نسبة مرمّزة | A2 متوازن | H3-02 |
| C-08 | الاسترداد نقد/بنك فقط | `method=gateway` + محاولة استرداد | استرداد قبل/بعد التسوية؛ جزئي متزامن | A5 بعد التأكيد فقط | H3-01 |
| C-09 | بنود التسوية موجبة فقط | `item_type` + معادلة موسّعة | A6 | — | H3-02 |
| C-10 | بطاقة POS للبنك مباشرةً | مقاصة اختيارية لكل طريقة (D-09) | الافتراضي بلا تغيير؛ المفعّل ⇒ A12 | لا انحدار POS | H6-01 |
| C-11 | لا عامل طوابير | معالجة متزامنة idempotent + أوامر مجدولة بـlease (D-25) + تحقق المجدول (EXT-08) | المُطابِق يلتقط العالق | لا اعتماد على Queue | H1-04 |
| C-12 | تدوير سر بلا سماح | سر سابق بصلاحية | webhook بالسر القديم داخل/خارج النافذة | — | H1-01 |
| C-13 | لا حجز عند الإتمام | حجز دفع عبر `InventoryReservationService` (D-14) + تحرير مجدول | فشل/انتهاء ⇒ تحرير؛ نجاح ⇒ استهلاك | لا بيع زائد في سباق | H4-02 |
| C-14 | بوابة↔طريقة 1→1 | طريقة «دفع إلكتروني» واحدة لكل اتصال، العلامة بيان على المحاولة (D-23) | — | لا تضخم طرق الدفع | H1-01، H2-02 |
| C-15 | glassmorphism مقابل نظام التصميم | يُتبع `DESIGN_SYSTEM.md` | مراجعة بصرية | — | كل UI |
| C-16 | تقارير PAY-V2 قديمة الحالة؛ PAY-V2-6A غير مدموج | الكود مصدر الحقيقة؛ قراءة #778 كمدخل لـH3-01 فقط | — | — | H3-01 |

## 12. بنود العناية الخاصة

| البند | الحل | المهمة |
|---|---|---|
| حماية روابط البوابات بالسندات | C-05 + `restrictOnDelete` منطقي + اختبار | H1-01 |
| الفترات المقفلة والدفعات المؤكدة غير المرحّلة | D-12: حالة `captured_unposted`، تنبيه، إعادة ترحيل بعد فتح الفترة رسمياً أو قرار تاريخ؛ لا تغيير تلقائي | H2-02، H3-03 |
| السداد المتزامن والتكرار والأحداث المتأخرة/الخارجة عن الترتيب | §4 + اختبارات PostgreSQL باتصالين (تفشل ولا تتخطّى) | H1-03، H1-04، H2-02 |
| الاسترداد قبل التسوية وبعدها | A5/A6 | H3-01، H3-02 |
| فروقات التسوية دون قيود وهمية | D-21: التسوية تبقى `unreconciled`؛ لا ترحيل حتى تُفسَّر ببنود موثقة أو مستند تسوية معتمد بدور معتمد | H3-02 |
| ربط CustomerIdentity بـPartner | C-03/D-05 | H4-01 |
| حجوزات المخزون | C-13/D-14 | H4-02 |
| تعويض POS عند فشل إتمام البيع | طلب جهاز ⇒ موافقة ⇒ `PosService::checkout` بمرجع الطلب؛ فشل ⇒ `void/reverse` آلي عبر المحوّل + حالة `compensation_required` تمنع الإقفال حتى تُحل | H6-02 |
| VAT/ZATCA | §5 + اختبار «لا تغيير لضريبة الفاتورة/XML» في كل شريحة مالية | H2-02، H3، H4-03 |
| الأمن والأسرار والخصوصية | §6 + H8-01 | H1-01، H8-01 |

---

## 13. سجل القرارات

> **2026-10-22:** قرارات G0 (D-03، D-07، D-08، D-11، D-12، D-19، D-20، D-23، D-25، D-27، D-29، D-30، D-31) **معتمدة** وموثقة في `docs/decisions/ADR-0004-payments-orchestration-g0.md` (الضوابط على D-12/D-20/D-25 هناك). ما عداها OPEN حتى بواباته. القرار المعتمد لا يُعاد كتابته بصمت.

| ID | القرار | البدائل وأثرها | الأدلة | التوصية | البوابة |
|---|---|---|---|---|---|
| D-01 | مزوّد BYOG الأول | Moyasar: idempotency وTransfers موثقة، آلية توقيع غير مثبتة · Tap: توقيع موثق ومسار marketplace · HyperPay: جسم مشفّر | §8 | Moyasar أو Tap بعد تأكيد التوقيع وsandbox | G1 |
| D-02 | المزوّد الثاني (إثبات تعدد المزوّدين) | الآخر من الاثنين · HyperPay | §8 | الآخر من Moyasar/Tap | G1 |
| D-03 | توقيت قيد الاسترداد | عند الطلب (خطر قيد لاسترداد فاشل) · عند تأكيد المزوّد | PAY-V2-4 §7 | عند التأكيد | G0 |
| D-04 | ضريبة عمولة المزوّد | `tax_input` بفاتورة ضريبية صالحة + إعداد قابلية الاسترداد لكل اتصال · كلها مصروف · رفض (الحالي) | `PaymentGatewaySettlementService` يرفضها | الأول بعد رأي ضريبي (EXT-05) | G2 |
| D-05 | ربط مشتري المتجر بطرف | إنشاء/ربط آلي بهوية متحقق منها (لا دمج ذمم) · طرف «عميل نقدي» عام (يفقد الكشف) · ربط يدوي (يعطّل الترحيل) | `CustomerPartnerLinkService` | آلي كسياسة قابلة للضبط، افتراض «ربط عند التحقق وإلا إنشاء» | G3 |
| D-06 | محاسبة النزاع | إعادة إثبات ذمة العميل + دور رسوم نزاع · مصروف خسائر مباشر | PAY-V2-4 §6 | الأول | G4 |
| D-07 | تصنيف `payment_attempts` | CompanyWide + `branch_id` لقطة · BelongsToBranch | `CommercePaymentIntent` CompanyWide | الأول | G0 |
| D-08 | صلاحية الأسرار | `payment_gateways.manage` جديدة لـowner/admin · `payments.manage` (يمنح المحاسب الأسرار) | `Rbac` | الأول | G0 |
| D-09 | مقاصة بطاقات POS | اختيارية لكل طريقة مطفأة افتراضياً · إلزامية · لا | القاعدة 6 | الأول | قبل H6-01 |
| D-10 | التشفير المغلّف / تدوير مفتاح التطبيق | `APP_PREVIOUS_KEYS` + مفتاح لكل مستأجر/KMS · الإبقاء على encrypted cast | لا KMS اليوم | الإبقاء في H1، وإضافة التدوير المغلّف في H8-01 | قبل H8-01 |
| D-11 | المدفوعات في كتالوج التطبيقات | ضابط تفعيل فقط · قدرة قابلة للإيقاف (`finance.payments`) | `ApplicationCatalog` | ضابط تفعيل لكل مستأجر + إيقاف منصة | G0 |
| D-12 | التقاط في فترة مقفلة | تاريخ الالتقاط ورفض مع تنبيه · ترحيل بتاريخ أول فترة مفتوحة تلقائياً (يخالف روح FC-3) | `AccountingDateGuard` | الأول | G0 |
| D-13 | توقيت فاتورة الطلب المدفوع مسبقاً | `ON_PAYMENT_CONFIRMED` (يتجنب الدفعة المقدمة) · `ON_FULFILLMENT` (دفعة مقدمة + أثر ضريبي) | ADR-01 | الأول كافتراض قابل للضبط، بعد رأي ضريبي | G3 |
| D-14 | حجز المخزون عند الدفع | حجز عند بدء الدفع بمدة (مثلاً 15 دقيقة) · بلا حجز | ADR-02/04 | حجز بمدة قابلة للضبط | G3 |
| D-15 | التقاط متأخر بعد إلغاء/انتهاء/سداد بطريق آخر | استرداد آلي · إبقاء رصيد دائن + مراجعة يدوية | §4 | قابل للضبط؛ افتراض «مراجعة يدوية» | G3 |
| D-16 | الدفع الجزئي في الروابط | مسموح افتراضياً · ممنوع افتراضياً | — | ممنوع افتراضياً، مسموح لكل رابط | G1 |
| D-17 | نموذج المدفوعات المدمجة | AWJ مزوّد تقني تحت شريك مرخّص · AWJ مجمّع مرخّص · بلا عمولة | SAMA (EXT-04) | الأول، بعد الرأي القانوني | G6 |
| D-18 | مزوّد أجهزة POS | NearPay (وثائق عامة) · Geidea · مستحوذ العميل | §8 | يُحسم بأجهزة العملاء الفعلية (OQ-6) | G5 |
| D-19 | سياسة الدمج | موافقة صريحة لكل PR (رسالة المالك) · دمج تلقائي للمنخفض المخاطر | رسالة 2026-10-22 | موافقة لكل PR | G0 |
| D-20 | احتفاظ أجسام أحداث المزوّد | 180 يوماً ثم هاش فقط · دائم | PDPL (EXT-07) | 180 يوماً | G0 |
| D-21 | فروقات التسوية | تبقى مفتوحة حتى بنود موثقة أو مستند تسوية معتمد · ترحيل الفرق لحساب عام (مرفوض) | PAY-V2-4 §9 | الأول | G2 |
| D-22 | الاستقطاعات/الاعتمادات غير العمولة | أدوار جديدة صريحة (احتياطي، تعديل مزوّد) · رفض (الحالي) | PAY-V2-5 | أدوار صريحة بدليل | G2 |
| D-23 | تمثيل علامات البطاقات | علامة على المحاولة + طريقة واحدة · طريقة لكل علامة | C-14 | الأول | G0 |
| D-24 | نمط الالتقاط | فوري · تفويض ثم التقاط | ADR-04 | فوري للروابط والمتجر؛ التفويض فقط حيث تطلبه حالة أعمال | G1 |
| D-25 | المعالجة الخلفية | متزامن + مجدول · عامل طوابير | `Dockerfile:58` | متزامن + مجدول، وعامل لاحقاً بقرار بنية | G0 |
| D-26 | الدفعة الزائدة | سند غير مخصّص (رصيد دائن) + مراجعة · استرداد آلي للفرق | `PaymentService` | الأول | G1 |
| D-27 | اتصال Sandbox لمستأجر حقيقي | مسموح بلا ترحيل (محاولات فقط) · ممنوع | — | مسموح بلا أي سند | G0 |
| D-28 | موافقة الاسترداد | عتبة مبلغ تتطلب موافقة ثانية (maker/checker) قابلة للضبط · صلاحية واحدة | `customer_refunds.manage` | العتبة، افتراضها معطّل | قبل H3-01 |
| D-29 | البطاقات المحفوظة/الاشتراكات المتكررة | داخل الأفق · خارج الأفق (ليست من المتطلبات الـ12) | ADR-09 | خارج HZ-01 ما لم يضفها المالك | G0 |
| D-30 | رسوم إضافية على العميل (Surcharge) | لا تُقدّم · سياسة قابلة للضبط (أثر ضريبي/ZATCA) | PAY-V2-4 §3.1 | لا تُقدّم في HZ-01 | G0 |
| D-31 | أحداث الدفع في Webhooks الصادرة | إضافة للكتالوج · لا | `WebhookEventCatalog` | إضافة `payment.captured/refunded` في H3-03 | G0 |

## 14. الأسئلة المفتوحة (للمالك)

| # | السؤال | يحسم |
|---|---|---|
| OQ-1 | مستأجر تجريبي فعلي وحسابه لدى أي مزوّد؟ | D-01، EXT-01 |
| OQ-2 | هل مجدول الإنتاج (Railway cron) يعمل فعلاً؟ | D-25، EXT-08 |
| OQ-3 | أيام الصرف ونموذج كشف التسوية لدى المزوّد المختار | H3-02 |
| OQ-4 | الدفع الجزئي في الروابط افتراضياً؟ | D-16 |
| OQ-5 | هدف «نموذج سلة»: عمولة لأَوْج أم تبسيط تجربة فقط؟ | D-17 |
| OQ-6 | أجهزة POS المستخدمة فعلاً لدى العملاء | D-18 |

## 15. المصادر الخارجية

- Moyasar: [فهرس الوثائق](https://docs.moyasar.com/llms.txt) · [Create Webhook](https://docs.moyasar.com/docs/api/other/webhooks/create-webhook.md)
- Tap: [Webhook](https://developers.tap.company/docs/webhook) · [Marketplace Overview](https://developers.tap.company/docs/marketplace-overview) · [Marketplace Getting Started](https://developers.tap.company/docs/marketplace-getting-started) · [Onboarding](https://developers.tap.company/docs/onboarding)
- HyperPay: [Webhook decryption](https://hyperpay.docs.oppwa.com/tutorials/webhooks/decryption-example)
- NearPay: [Web SDK](https://docs.nearpay.io/sa/en/remote-integration/web-sdk) · [HTTP proxy](https://docs.nearpay.io/en/remote-integration/proxy-with-http) · [FAQ](https://docs.nearpay.io/sa/en/guides/faq)
- Geidea (طرف ثالث فقط): [Webkul guide](https://webkul.com/blog/user-guide-for-odoo-pos-geidea-payment-terminal-integration/)
- SAMA: [Rulebook](https://rulebook.sama.gov.sa/en/node/1430) · [Article 6](https://rulebook.sama.gov.sa/en/node/1438) · ملخص ثانوي: [Pinsent Masons](https://www.pinsentmasons.com/en-gb/out-law/news/new-saudi-payment-services-rules-will-bolster-international-investment-universities)

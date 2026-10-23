# ADR-0005 — AWJ Payments: Moyasar مزوّد BYOG الأول (Sandbox فقط)

DATE: 2026-10-23
STATUS: **accepted — اختيار المزوّد والاختبارات فقط** · **G1 مفتوحة جزئياً** (انظر «شروط G1 المتبقية»)
DECIDED_BY: صفوان (المالك)، رسالة الاعتماد 2026-10-23 («Moyasar كمزوّد الدفع الأول في أَوْج، لبيئة Sandbox فقط»)
SUPERSEDES: — (يحسم D-01 في `AWJ_PAYMENTS_HORIZON_MASTER_PLAN.md` §13 دون تعديل غيره)
RELATED_TASKS: PAY-H2-01 · EXT-01 · الأفق: `docs/plans/payments/horizon/`

## نطاق الاعتماد (صريح)

**يشمل:** اختيار Moyasar مزوّداً أول، وبناء المحوّل والاختبارات في بيئة **Sandbox** فقط.
**لا يشمل:** تفعيلاً إنتاجياً (Live) · تعاقداً أو اتفاقية تجارية مع Moyasar · تفعيل أي بوابة حقيقية لمستأجر · Deploy/Production Migration · استعمال مفاتيح `live`. أيٌّ من ذلك يحتاج قراراً مستقلاً (G-LIVE / G-DEPLOY).

## Context

D-01 (§13) أبقت المزوّد الأول مفتوحاً «بعد تأكيد آلية التوقيع وsandbox»، وسجّلت أن آلية توقيع Moyasar **غير مثبتة**. بنية الأفق جاهزة (H1): `PaymentGateway` + `GatewayAdapter` + `PaymentGatewayAdapterRegistry` + `PaymentOrchestrator` + `PaymentWebhookInbox` + `PaymentAttemptReconciler`؛ المحوّلات الحقيقية تُضاف إلى `ADAPTERS` فقط.

## Decision

1. **Moyasar هو المزوّد الأول (D-01)** للبيئة Sandbox. المحوّل الجديد `MoyasarAdapter` يُضاف عبر السجل القائم **دون بنية موازية** ولا تعديل لعقد المنسّق.
2. **التدفق المعتمد = الفاتورة المستضافة (Invoices API → صفحة `checkout.moyasar.com`)**: عميل المتصفح يدفع على صفحة Moyasar؛ **بيانات البطاقة لا تمرّ بخادم أَوْج أبداً** (لا حقل بطاقة في أي طلب/نموذج/سجل لدينا). يطابق عقد `GatewayAdapter::createCheckout` (Hosted/redirect فقط) ونطاق PCI الأضيق. *Moyasar Form* (نموذج JS بمفتاح `pk`) خيار لاحق للمتجر عند الحاجة وبقرار مستقل؛ لا يُبنى هنا.
3. **الدفع لا يُؤكَّد بالـCallback ولا بالـwebhook وحدهما.** الحقيقة = استعلام API (`GET /v1/invoices/{id}`) بالمفتاح السري، يطبّقه `PaymentOrchestrator::sync/applySnapshot` رتيباً. `success_url`/`callback_url`/الأحداث تُطلق الاستعلام فقط.
4. **أمان الـwebhook:** وثائق Moyasar الرسمية لا تصف توقيع HMAC على الجسم؛ الآلية الموثّقة هي حقل `secret_token` (سرّ يحدده التاجر) داخل الجسم. القرار: يُقارَن بثبات زمني مع أسرار الاتصال (الحالي ثم السابق في نافذة السماح)، ويُرفض الحدث إن اختلف نمط `live` عن بيئة الاتصال، وتُعامَل الأحداث **إشارات** لا مصدر حقيقة (بند 3)؛ فلا يمنح تزوير جسم أي أثر مالي. **السرّ لا يُخزَّن**: يُنقَّح من جسم الحدث المحفوظ في `payment_provider_events`.
5. **سياسة المفاتيح:** اتصال Moyasar في `sandbox` يرفض أي مفتاح غير `sk_test_`/`pk_test_` (يرفض `sk_live_`/`pk_live_` برمز ثابت)، و**`environment=live` لمزوّد moyasar ممنوع حتى قرار G-LIVE** (علم إعداد مطفأ افتراضياً). المحوّل الوهمي (`fake`) يبقى `local/testing` فقط.
6. **المال:** المبلغ بالهللات (Moyasar يستعمل أصغر وحدة، الحد الأدنى 100 هللة = 1.00 ريال). أي أثر محاسبي (سند/قيد) **خارج هذه الشريحة** ويمرّ لاحقاً عبر `PaymentService` (H2-02)؛ المحوّل والمنسّق لا يكتبان قيوداً.
7. **المفاتيح الحقيقية:** لا تُطلب في المحادثة ولا تُوضع في PR/سجلات/أصول؛ تُدخل عبر واجهة الإعدادات المحروسة (`payment_gateways.manage`). اختبارات المحوّل Mock/Fixture بـ`Http::fake`.

## شروط G1 المتبقية (G1 **ليست مغلقة بالكامل**)

| الشرط | الحالة |
|---|---|
| اختيار المزوّد الأول (D-01) | ✅ معتمد (Moyasar، Sandbox فقط) |
| EXT-01: حساب Sandbox + مفاتيح (`sk_test_`/`pk_test_` + سرّ webhook) | ⏳ **PENDING** — المالك يُدخلها عبر الواجهة؛ لم تُستلم ولم يُتحقق منها |
| تحقق تكامل Sandbox فعلي: دفعة مسجّلة (معرّف الفاتورة/الدفعة، حدث webhook، استعلام fetch، بطاقة نجاح/رفض/3DS) | ⏳ **PENDING** |
| D-16 الدفع الجزئي في الروابط · D-24 نمط الالتقاط · D-26 الدفعة الزائدة (مرتبطة بـG1 في §13) | ⏳ **OPEN** — توصياتها (ممنوع افتراضياً/فوري/سند غير مخصّص+مراجعة) تنتظر اعتماداً صريحاً قبل **PAY-H2-02**؛ لا تؤثر على H2-01 |

الأجزاء التي لا تحتاج مفاتيح (المحوّل، الأخطاء، الأحداث، السياسات، الاختبارات) تتقدّم الآن؛ **لا يُغلق H2-01 (DONE) قبل دفعة Sandbox حقيقية مسجّلة**.

## الأدلة (External Evidence — وثائق Moyasar الرسمية، 2026-10-23)

- Authentication: Basic Auth، المفتاح السري اسم مستخدم وكلمة المرور فارغة؛ `sk_test_`/`sk_live_` سرّي (خادم فقط)، `pk_test_`/`pk_live_` للنشر ويُنشئ الدفعات فقط؛ الوضع (test/live) يُحدَّد بالمفتاح؛ HTTPS إلزامي؛ القاعدة `https://api.moyasar.com/v1` — <https://docs.moyasar.com/api/authentication>
- Create Invoice (`POST /invoices`): `amount` (≥100) و`currency` و`description` إلزامية؛ `callback_url` إشعار خادم فقط، `success_url`/`back_url` إعادة توجيه؛ `expired_at`؛ الاستجابة تحوي `url` (صفحة الدفع) و`payments[]` و`metadata`؛ حالات الفاتورة `initiated|paid|failed|refunded|canceled|on_hold|expired|voided` — <https://docs.moyasar.com/api/invoices/01-create-invoice>
- Creating invoices (guide): `metadata` مقبولة عند الإنشاء؛ فاتورة منتهية لا تقبل محاولات — <https://docs.moyasar.com/guides/invoices/creating-invoices>
- List Invoices: `GET /invoices` بمرشحات `id` و`status` و`created[gt|lt]` و`metadata[key]` — <https://docs.moyasar.com/api/invoices/03-list-invoice> · Metadata: حتى 30 مفتاحاً/500 حرف — <https://docs.moyasar.com/api/metadata>
- Create Payment: حالات الدفعة `initiated|paid|authorized|failed|refunded|captured|voided|verified|expired`؛ `initiated` تتطلب إجراءً (3DS) عبر `source.transaction_url`؛ `given_id` للـidempotency في إنشاء الدفعات (لا مكافئ موثّق للفواتير) — <https://docs.moyasar.com/api/payments/01-create-payment>
- Webhook Reference: حقول `id` و`type` و`created_at` و`secret_token` و`account_name` و`live` و`data`؛ **لا ترويسة توقيع موثّقة**؛ يجب إرجاع 2xx بسرعة؛ إعادة إرسال 5 مرات (فورياً، 1د، 10د، 30د، 1س، 2س) ثم الإسقاط — <https://docs.moyasar.com/api/other/webhooks/webhook-reference> · الأحداث: `payment_paid|payment_failed|payment_voided|payment_authorized|payment_captured|payment_refunded|payment_abandoned|payment_verified|card_auth_authenticated|card_auth_failed` — <https://docs.moyasar.com/api/other/webhooks/available-webhooks> · `secret_token` «كلمة سر تتحقق منها على خادمك» — <https://docs.moyasar.com/guides/dashboard/setting-up-webhooks>

## غير موثّق / يُتحقق منه في Sandbox (لا يُفترض)

1. هل تقبل فاتورة `failed` محاولة دفع جديدة على الصفحة نفسها؟ (الافتراض الحالي: لا يُنهى المحاولة محلياً بـ`failed` فاتورياً؛ تنتهي بالإلغاء/الانتهاء — انظر تقرير H2-01a.)
2. صيغة قيمة مرشح `metadata[key]` (يُصفَّى الناتج محلياً بمطابقة `metadata` على أي حال).
3. جسم `payment_paid` الفعلي ووجود `invoice_id` في `data` لمطابقة المحاولة.
4. لا مفتاح idempotency موثّق لإنشاء الفاتورة ⇒ المحوّل يبحث بالـmetadata قبل الإنشاء؛ نافذة سباق ضيقة بين بحث وإنشاء طلبين متزامنين لمحاولة واحدة يُقيّدها المنسّق (محاولة واحدة نشطة/Payable) وتُغلقها المطابقة.

## Rejected / Not Adopted

- Moyasar Form / استقبال بيانات البطاقة في خادم أَوْج (يوسّع نطاق PCI).
- الاعتماد على `callback_url`/`success_url` أو جسم الـwebhook لتأكيد الدفع.
- تفعيل Live أو التعاقد ضمن هذا القرار.
- تخزين `secret_token` أو أي سرّ في سجلات الأحداث أو الـPRs أو الأصول.

## Consequences

- H2-01 يتقدّم بشرائح صغيرة بلا مفاتيح؛ الجزء الذي يحتاج مفاتيح حقيقية يُسجَّل عائقاً ويُستأنف عند استلام EXT-01.
- فتح `moyasar` في `PaymentGateway::PROVIDERS` أثره: توسيع قائمة مقبولة فقط (قيم قديمة صالحة).

## Security / tenant / accounting impact

لا أثر محاسبي. أمنياً: أسرار مشفّرة كما هي، تنقيح سرّ الـwebhook من المخزَّن، رفض مفاتيح Live في Sandbox، عزل المستأجر يمرّ عبر الاتصال (`webhook_key`) كما في H1-04.

## Follow-up

EXT-01 (مفاتيح Sandbox عبر الواجهة) · تحقق تكامل Sandbox · اعتماد D-16/D-24/D-26 قبل H2-02 · G-LIVE قرار مستقل لأي تفعيل حي.

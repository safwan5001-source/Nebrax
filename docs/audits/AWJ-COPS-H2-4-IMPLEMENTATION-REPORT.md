# COPS-H2-4 — Implementation Report (كتلة تنفيذ الطلب العامة للمشتري)

| البند | القيمة |
|---|---|
| Slice | COPS-H2-4 — كتلة `fulfillment` الإضافية في قراءة الطلب العامة + `AccountOrderStatus` في `storefront/` |
| Branch | `claude/cops-h2-4-public-fulfillment-block` (مكدَّس على H2-3) |
| PR / Merge SHA | تُسجَّل مجمَّعةً في `AWJ_COPS_H2_HORIZON_CLOSURE_REPORT.md` |
| الحالة | Implemented · Tested · عند الدمج Merged · **Not deployed · Not activated** |
| العقد | خطة H2-0 §3.2: D-H2-13 (الحقول) · D-H2-14 (التوافق وحالات الغياب) · D-H2-09 (خصوصية الساعي) |

## 0. الخلاصة

- `CommerceOrderPublicFulfillment::block()` (إسقاط نقيّ للقراءة) يضيف المفتاح `fulfillment` **إضافياً** إلى `CommerceOrderSerializer::serialize` (كل قراءات التفاصيل: ضيف بالمرجع الموقَّع، عميل، مشتري جملة، إتمام `/commerce/v1`) وإلى `StorefrontCheckoutController::serializeOrder` (تأكيد `/store/v1`).
- الشكل: `{type, stage, stages:[{key,at}], tracking:{carrier,number,url}|null, pickup:{ready_at}|null}` — قائمة بيضاء حرفية.
- **يغيب المفتاح تماماً** لطلب بلا صف تنفيذ ولطلب **ملغى** (الإلغاء يطغى)، فالاستجابات القديمة **بايتاً ببايت**. لا كتلة في صفوف القوائم (V1).
- `delivery_failed` و`returned_to_store` ⇒ المرحلة العامة `delivery_attempt_failed` **بلا سبب ولا عدد محاولات**؛ إعادة الإرسال تعيدها إلى `out_for_delivery` بلا أثر للفشل.
- `tracking` للناقل وبعد الإرسال فقط؛ `pickup.ready_at` للاستلام وبعد الجاهزية فقط؛ لا ساعي/موظف/مخزن/ملاحظة/نسخة.
- AR-3: الإسقاط لا يقرأ بوابة التنفيذ — إغلاقها لا يُخفي حقيقة مخزَّنة.
- الواجهة: `ACCOUNT_ORDER_STATUS_CAPABILITY` من `design_only` إلى **`gated`**: الخطوات بعد «تم الطلب» تُضاء **من الكتلة وحدها**؛ بدونها (أو غير مقروءة) التصميم القديم حرفياً.

## 1. الملفات

| الملف | التغيير |
|---|---|
| `app/Support/CommerceOrderPublicFulfillment.php` | **جديد** — الإسقاط |
| `app/Support/CommerceOrderSerializer.php` · `StorefrontCheckoutController.php` | سطر إضافي واحد لكل منهما |
| `docs/openapi/commerce-api-v1.yaml` | `Order.fulfillment` (غير إلزامي) + مخطط `OrderFulfillment` |
| `tests/Feature/CommerceOrderPublicFulfillmentTest.php` | **جديد** — 12 اختباراً |
| `storefront/src/lib/commerce/checkout-types.ts` | `AwjOrderFulfillment`، `StorefrontFulfillment`، `mapOrderFulfillment` (دفاعي: نوع/مرحلة مجهولة ⇒ `null`، https فقط للرابط، لا نسخ لحقول مجهولة) |
| `storefront/src/lib/commerce/wholesale-buyer.ts` | قراءة الكتلة لطلب المشتري |
| `storefront/src/components/account/AccountOrderStatus.tsx` · `AccountOrderDetail.tsx` · `AccountOrdersView.tsx` | الرحلة من الكتلة: توصيل (تم الطلب · قيد التجهيز · في الطريق · تم التسليم) / استلام (… جاهز للاستلام · تم الاستلام)، توقيتات المراحل، إشعار محايد لمحاولة فاشلة، بطاقة التتبع (رابط `noopener noreferrer`) |
| `storefront/src/lib/commerce/capabilities.ts` + `messages/{ar,en,de,es,fr,pl}.json` | القدرة `gated` + تسعة مفاتيح بكل لغة |

## 2. الاختبارات والنتائج

| الفحص | النتيجة |
|---|---|
| `CommerceOrderPublicFulfillmentTest` (SQLite) | ✅ 12/12 (قائمة بيضاء، غياب المفتاح، ناقل/استلام/فشل/تسليم/قبول يدوي، ملغى بلا كتلة، بوابة مغلقة لا تخفي، مفاتيح الاستجابة القديمة + `fulfillment` فقط، تطابق OpenAPI، فحص ساكن للإسقاط) |
| انحدار العقد العام | ✅ 115 اختباراً: `CommerceApiOpenApiContractTest`، `CommerceOrderStatusApiTest`، `CommerceOrderPublicCancelledContractTest`، `CommerceCustomerOrderTest`، `FlowersEndToEndJourneyTest`، `StorefrontCheckout*`، `CommerceOrderOwnershipTest`، `StorefrontBuyer*` — **بلا تعديل أي اختبار قديم** |
| storefront Vitest | ✅ كامل: 252 ملفاً / 3660 اختباراً؛ الجديد: مُحوِّل الكتلة، المكوّن بملفات الرسائل الحقيقية للغات الست (لا مفتاح خام ولا `{date}`)، قراءة طلب المشتري |
| `tsc --noEmit` · `next build` (storefront) | ✅ |

## 3. لا أثر محاسبي أو مخزني

قراءة فقط: لا كتابة ولا حدث ولا قيد ولا مخزون ولا حجز. جدول القيود: **لا قيود جديدة**.

## 4. المخاطر والقرارات

| البند | المعالجة |
|---|---|
| مرحلة `accepted` لا عمود لها في الرحلة المرئية | تُعاد في `stages` (للتوافق مع D-H2-13) لكن الرحلة المرئية تطوي القبول داخل «قيد التجهيز»؛ لا ادّعاء إضافي |
| `AccountOrderStatus` لا يعرف أن متجراً يستعمل التنفيذ حين لا صف | يبقى التسمية القديمة «لا ينشر تتبّعاً بعد» (لا مصدر لتمييز «لم يبدأ» من «لا يستعمل») |
| ترجمات de/es/fr/pl | سوق AWJ يعرض ar/en فقط؛ اللغات الأخرى متحقَّق منها بالاختبار الوحدوي بملفات الرسائل الحقيقية |
| صفحة تتبّع الضيف | H2-5 (مستقلة، لا تمسّ هذه الكتلة) |

## 5. الخطوة التالية

H2-5 (تتبّع الضيف الموقَّع) — تلقائياً بعد دمج H2-4. لا نشر ولا تفعيل.

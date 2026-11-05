# COPS-H4-6 — إتاحة وسيلة الدفع لكل قناة (تقرير التنفيذ)

| البند | القيمة |
|---|---|
| الشريحة | **H4-6** — D-H4-06 (خيار ج + 1، معتمد 2026-11-04) |
| Base | `main` @ `eabfba6` |
| الفرع | `claude/cops-h4-6-channel-payment-availability` |
| PR / Head / Merge SHA | تُسجَّل في Handoff |
| الهجرة | **لا** (الجدول `payment_method_channel_availabilities` قائم منذ 2026-09) |

## 1. الفحص (قراءة فقط)

`PaymentMethodChannelAvailabilityService` كان **قراءة فقط** من أي مسار (لا مسار كتابة في أي ملف مسارات) رغم أن `isAvailable`/`availableFor` يحكمان Checkout المتجر (`GET store/v1/checkout/payment-methods`) وجاهزية وسائل الدفع الإلكتروني. `setAvailability` موجودة في الخدمة بلا مستهلك HTTP.

## 2. ما بُني

- **`PaymentMethodChannelAvailabilityController`** (يغلّف الخدمة، بلا منطق موازٍ):
  - `GET payment-methods/{id}/channel-availability` — كل قنوات غير POS مع `override` (`true|false|null`) و`effective` (يحسبه الخادم بـ`isAvailable`).
  - `PUT payment-methods/{id}/channel-availability/{channelId}` بجسم `{is_enabled: true|false|null}` (`null` يزيل التجاوز ⇒ الافتراضي `available_online`)؛ يرفض `tenant_id` وغياب الحقل والقيم غير المنطقية؛ POS ⇒ 422 `channel_not_supported`.
- **الصلاحيتان معاً (D-H4-06):** قراءة `payments.view` + `commerce.channel_settings.manage`، كتابة `payments.manage` + `commerce.channel_settings.manage` + قدرة `commerce.storefront` (+ `throttle:60,1`). `accountant` (يملك `payments.manage` فقط) و`staff` ⇒ 403.
- **القفل والتدقيق:** قفل صف القناة `FOR UPDATE` أولاً (ADR-19 §2.3) ثم الكتابة؛ حدث `sales_channel_setting_events` بمفتاح `payment_methods.<id>.channel_availability` (من/إلى؛ null = الافتراضي) **لتغيير فعلي فقط** (التكرار صامت). 404 موحَّد لطريقة/قناة مستأجر آخر.
- **`PaymentMethodChannelAvailabilityService::clearOverride()`** (جديدة): إزالة التجاوز idempotent.
- **الواجهة (دمج في شاشة الوسيلة القائمة):** قسم «الإتاحة حسب القناة» داخل حوار تعديل الوسيلة في `/payment-methods`: صف لكل قناة (الاسم/النوع/شارة «تظهر للمشتري|لا تظهر» من الخادم) وقائمة (الافتراضي/مفعّلة/معطّلة) تحفظ فوراً لقناتها وتُحدَّث بما يعيده الخادم؛ قفل لكل قناة؛ فشل ⇒ إعادة تحميل الحقيقة. **يظهر لمن يملك الصلاحيتين فقط وإلا لا شيء ولا طلب.** ar/en.

## 3. ما لم يُفعل

لا هجرة · لا صلاحية جديدة · لا مصدر حقيقة ثانٍ للإتاحة (Checkout يقرأ الخدمة نفسها) · لا مساس بـ`available_online` ولا بإعدادات وسائل الدفع الإلكتروني (`use_in_store`) ولا بالمدفوعات القائمة ولا بـPOS · لا قيد محاسبي ولا مخزون · لا تعديل لقواعد الدفع/Checkout.

## 4. الاختبارات

| النوع | النتيجة |
|---|---|
| `PaymentMethodChannelAvailabilityApiTest` (7) | خضراء: القائمة (POS مستبعد، تجاوز/فعلي)، التعطيل يُخفي الوسيلة من `GET store/v1/checkout/payment-methods` والإزالة تعيدها، الافتراضي لغير المتاحة إلكترونياً + تجاوز صريح، التدقيق لتغيير فعلي، الصلاحيتان معاً وقدرة المتجر، صرامة الجسم وPOS، العزل |
| مجموعة `PaymentMethod|Rbac|…` | 83 خضراء |
| vitest `ChannelAvailabilitySection` (10) | خضراء: لا شيء بلا الصلاحيتين، العرض، PUT واحد، الإزالة، لا إرسال لنفس الاختيار، الفشل، الحالات، تحويل متسامح |

## 5. المخاطر

- الأثر فوري على Checkout المتجر (مقصود وموضَّح في النص)؛ لا يمسّ الطلبات/الدفعات القائمة.
- سجل التدقيق مشترك مع إعدادات التسعير: يظهر الحدث في `recent_changes` العام لتلك الشاشات بمفتاح بادئته `payment_methods.` (كما هو حال `operations.*` من قبل).

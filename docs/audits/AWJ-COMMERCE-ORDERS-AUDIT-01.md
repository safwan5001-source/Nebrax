# AWJ-COMMERCE-ORDERS-AUDIT-01 — تدقيق إدارة طلبات المتجر الإلكتروني

**النوع:** تدقيق فقط (لا كود تطبيق، لا migrations، لا refactoring، لا تنفيذ ميزات)
**التاريخ:** 2026-10-26
**الحالة:** للمراجعة — بانتظار اعتماد المالك قبل أي PR تنفيذي

## 0. ملخص تنفيذي

| السؤال | الجواب المثبت |
|---|---|
| هل توجد صفحة `/commerce/orders` أو أي شاشة موظف لإدارة طلبات المتجر؟ | **لا.** لا مسار واجهة، لا عنصر تنقل، لا endpoint موظف لقراءة قائمة الطلبات أو تفاصيلها. |
| ماذا يرى التاجر عن الطلب اليوم؟ | لا شيء عن الطلب نفسه. الوحيد المتاح: `GET commerce/payment-intents` (قائمة التزامات الدفع مع `order_number`) و`collect`/`cancel` لها — **بلا أي واجهة web تستهلكها**. |
| هل للطلب دورة حياة؟ | **لا.** `status` ∈ {`draft`,`confirmed`} فقط، والطلب يُنشأ `confirmed` مباشرة. لا إلغاء، لا تجهيز، لا شحن، لا تسليم، لا مرتجع. |
| هل أبعاد الطلب/الدفع/التنفيذ مفصولة؟ | **جزئياً:** بُعد الدفع منفصل فعلاً (`CommercePaymentIntent`)، بُعد الطلب شبه معدوم، بُعد التنفيذ **غير موجود**. |
| ما المنفَّذ بجودة عالية؟ | الإنشاء من Checkout، اللقطات الثابتة، الحجز المؤقت للدفع الإلكتروني، المكنسة، ترحيل الطلب الإلكتروني المدفوع إلى فاتورة وسند (مغلق خلف بوابات)، عزل المستأجر والملكية. |
| أخطر فجوة | طلب **COD/الاستلام** لا ينتج حجزاً ولا فاتورة ولا قيداً ولا خصماً من المخزون **إطلاقاً** (`collect` مجرد تبديل حالة)، ولا يملك الموظف طريقة لرؤيته أو إلغائه أو تجهيزه. |
| الخطوة الأولى الموصى بها | **O1a:** قراءة فقط للموظف (API + صلاحية `commerce.orders.view`)، بلا تغيير حالات ولا أثر مالي/مخزني. |

## 1. الحالة الحالية المثبتة

### 1.1 معلومات المرجع (Git / CI)

| البند | القيمة |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Branch | `claude/commerce-orders-audit-tzdtiw` |
| Base SHA (`origin/main`) | `2f4de9c01ba5f1a7e5280c741aa7c4628114da2b` (#1763 X4-FIX) |
| Head SHA عند التدقيق | `2f4de9c01ba5f1a7e5280c741aa7c4628114da2b` (الفرع = `main` قبل إضافة هذا التقرير) |
| CI على `main@2f4de9c` (GitHub Actions) | Storefront CI ✅ success · Storefront Docker context ✅ success · **CI الرئيسي (run 10640) كان `in_progress` وقت الفحص — غير مؤكد**. آخر CI رئيسي مكتمل: run 10638 على `34c3ece` ✅ success، وCI فرع PR #1763 (run 10639) ✅ success. |
| تحقق محلي | `php artisan test` مركَّز (SQLite) على `CommerceOrderStatusApiTest\|CommerceOrderServiceTest\|CommercePaymentIntentTest\|CommerceOrderReservationServiceTest\|OnlineOrderStockHoldTest\|CommerceInvoiceOnPaymentTest\|CommerceOrderOwnershipTest` → **142 passed (742 assertions)**. لم أشغّل الاختبار الكامل ولا PostgreSQL ولا اختبارات الواجهة (التدقيق لا يغيّر كوداً). ملاحظة بيئية: امتداد `bcmath` ناقص محلياً (يُحمَّل في CI). |

### 1.2 النموذج الحالي (Backend)

| العنصر | الدليل | الوضع |
|---|---|---|
| `CommerceOrder` (`CompanyWide`) | `app/Models/CommerceOrder.php` | `status` ∈ draft/confirmed — `database/migrations/2026_09_16_010000_create_commerce_orders_table.php:47` (enum). أعمدة: `sales_channel_id`, `storefront_id`, `commerce_checkout_id`, `partner_id`, `customer_identity_id`, `number` (`CORD`), `total`, `delivery_method`, `delivery_amount_minor`, `confirmed_at`. |
| منع حذف المؤكَّد | `CommerceOrder::booted()` يرمي `LogicException` | ✅ مقصود (سجل تاريخي) |
| السطور واللقطات | `CommerceOrderLine`, `CommerceOrderSnapshot`, `CommerceOrderGift`, `CommerceOrderSchedule`, `...LinePersonalization` | ✅ لقطات ثابتة (اسم، سعر، متغيّر، عنوان، إهداء، موعد) |
| الإنشاء | `CommerceOrderService::createFromCheckout()` — معاملة واحدة، يُنشأ `confirmed` مباشرة | ✅ لا مسار تعديل بعد التأكيد (`updateSnapshot` للمسودة فقط) |
| نية الدفع | `CommercePaymentIntent` — حالات: `awaiting_collection`/`collected` (COD، استلام)، `pending`/`paid` (إلكتروني)، `cancelled` | ✅ منفصلة عن الطلب |
| لا إلغاء للطلب | لا `cancel` في `CommerceOrderService` (grep: لا نتيجة) | ❌ |
| لا شحنة/تتبع/ناقل | لا جدول/نموذج (grep migrations: `shipment`/`tracking_number`/`carrier` = صفر) | ❌ |
| لا مرتجع/استرداد للطلب | `ReturnService`/`CreditNoteService` لا يشيران إلى `commerce_order` (grep) ؛ `PaymentRefundService.php:650` يردّ `not_refundable` لمدفوعات المتجر | ❌ |
| لا سجل أحداث | لا جدول `commerce_order_events` | ❌ |
| ربط بفاتورة | `CommerceOrderPosting` (`app/Models/CommerceOrderPosting.php`) + `CommerceOrderPostingService` — **للدفع الإلكتروني الملتقَط فقط**، خلف `CommerceInvoiceOnPayment::active()` | ◐ مغلق افتراضياً (PAY-H4-03، EXT-05) |

### 1.3 واجهات API الحالية

| المسار | الجمهور | الغرض | الدليل |
|---|---|---|---|
| `GET commerce/v1/orders/{id}` | تطبيق الجوال (ضيف بـ`X-Order-Reference` موقّع) | حالة طلب واحد | `routes/api_commerce.php:127`, `CommerceOrderController` |
| `GET commerce/v1/me/orders[/{id}]` | عميل موثَّق | سجل طلباته | `routes/api_commerce.php:258-259`, `CommerceCustomerOrderController` |
| `POST store/v1/checkout/complete`, `GET store/v1/orders/{order}/payment-status` | المتجر | إتمام/حالة الدفع | `routes/api_storefront.php:101` |
| `GET commerce/payment-intents` (+`collect`,`cancel`) | **موظف** (`payments.view`/`payments.manage`) | إدارة التزامات الدفع | `routes/api.php:1164-1168`, `CommercePaymentIntentController` |
| `GET/PUT commerce/workspace/storefronts/{id}/fulfillment` | موظف (`commerce.manage`) | **مخزن** تنفيذ القناة فقط — ليس شحنة | `CommerceFulfillmentController` (تسمية مضلِّلة: سياسة لا تنفيذ) |
| **`GET commerce/orders`** | — | — | **غير موجود** (grep `routes/` لا يجد `CommerceOrder` في `api.php`) |

### 1.4 الواجهة (web/)

- شريط تنقل مساحة التجارة: `web/src/modules/commerce-workspace/nav.ts` — المجموعات: نظرة عامة، (stores, published-products, merchandising, themes, appearance, app-builder)، (domains, delivery, gifting, integrations). **لا عنصر «الطلبات».**
- `web/src/app/(commerce)/commerce/`: لا مجلد `orders`. لا استهلاك لـ`commerce/payment-intents` في `web/`, `mobile/`, `storefront/` (grep).
- لوحة `/commerce` الرئيسية لا تعرض أي مؤشر طلبات (grep `order` في `page.tsx` = صفر).
- ✅ ما يمكن البناء عليه: غلاف المساحة، سياق المتجر النشط (`active-store.ts`: متجر وحيد تلقائي؛ تعدد ⇒ اختيار صريح، `?store=`، `sessionStorage`)، `DataTable` (مع `serverSort`/`selection`)، مكتبة رسائل `messages.ts`.

### 1.5 الطلب ↔ المخزون ↔ المحاسبة ↔ الدفع ↔ العميل

| العلاقة | الواقع الحالي (دليل) |
|---|---|
| **المخزون — إلكتروني** | حجز عند الإتمام داخل المعاملة (`CommerceCheckoutService.php:638`، `holdStockForPayment`) بمدة قابلة للضبط؛ استهلاك عند الترحيل (`CommerceOrderPostingService`)؛ تحرير عبر المكنسة (`CommerceUnpaidOrderSweeper`, `commerce:expire-unpaid-orders` كل 5 د — `routes/console.php:145`) أو إلغاء النية (`CommercePaymentIntentService::cancel`). |
| **المخزون — COD/الاستلام** | **لا حجز** (`if ($intent->isOnline())` فقط). يؤكد `OnlineOrderStockHoldTest › cod orders never hold stock`. ⇒ مخاطر بيع زائد. القرار D-10 مفتوح. |
| **المحاسبة — إلكتروني** | بعد الالتقاط: فاتورة آجلة + إخراج مخزون/COGS + سند قبض بوابة (مدين 1170/دائن 1130) عبر `InvoiceService`/`PaymentService`؛ مغلق خلف بوابة نشر + `tax_opinion_ref` + سياسة مستأجر. |
| **المحاسبة — COD/الاستلام** | `markCollected()` = تبديل حالة فقط (`CommercePaymentIntentService.php:110-126`): لا `Payment`، لا فاتورة، لا قيد، لا خروج مخزون. القرار D-8 (الأثر المالي + توقيت ZATCA) مفتوح. |
| **العميل** | `partner_id` يُحسم للدفع الإلكتروني فقط (`CustomerPartnerResolver`، D-05). طلبات COD/الاستلام بلا `partner_id` غالباً؛ `customer_identity_id` للملكية الرقمية. |
| **الدفع عند الاستلام** | تُنشأ النية `awaiting_collection`؛ التحصيل/الإلغاء يدويان عبر API دون واجهة. إلغاء نية COD **لا يلغي الطلب** ويبقى `confirmed`. |
| **الطلب الإلكتروني الفاشل/المنتهي** | تُلغى النية والحجز لكن **الطلب يبقى `confirmed`** (مقصود بالتصميم: «الطلب يبقى سجلاً بلا حالة جديدة») ⇒ حالة مضلِّلة لموظف يقرأ `status` وحده. |

### 1.6 الصلاحيات والعزل

- **العزل:** `CommerceOrder` يرث `BaseModel` (TenantScope) ومصنَّف `CompanyWide`؛ مسارات الجمهور تعيد 404 موحَّداً لأي فشل ملكية (`CommerceOrderController`، `CommerceOrderOwnershipTest`).
- **RBAC:** لا نطاق `commerce.orders.*` في `Rbac` (grep). الموجود: `commerce.manage` (`Rbac.php:215`، owner/admin عبر `*` فقط) و`payments.view/manage` (accountant وغيره عبر `MATRIX`). **أثر جانبي:** من يملك `payments.manage` يستطيع تحصيل/إلغاء التزام دفع طلب متجر **دون** أي صلاحية على الطلب نفسه.
- **الفروع/المخازن:** الطلب `CompanyWide` (SalesChannel ≠ Branch، ADR-03). لا عمود مخزن/فرع على الطلب؛ مخزن التنفيذ يعيش في `FulfillmentPolicy` للقناة وفي `InventoryReservation` (إلكتروني فقط). `User::allowedWarehouseIds()` موجود لمستخدمين مقيَّدين لكن لا قارئ طلبات يطبّقه بعد.
- **تعدد المتاجر:** كل طلب يحمل `sales_channel_id` و`storefront_id`؛ الواجهة تدعم المتجر النشط. لا عرض طلبات موحّد/مفلتر بالمتجر لأن لا قائمة أصلاً.
- **كتالوج التطبيقات:** المفتاح `commerce.storefront` موجود (`ApplicationCatalog.php:350`)؛ مسارات الدفع الحالية لا تستعمل `EnsureApplicationActive` عليه.

## 2. جدول الوظائف

| # | الوظيفة | الحالة | الدليل / الملاحظة |
|---|---|---|---|
| 1 | إنشاء الطلب من Checkout (ذرّي، idempotent) | **مكتمل** | `CommerceOrderService::createFromCheckout`, `CommerceCheckoutApiTest` |
| 2 | لقطات ثابتة (عميل/عنوان/إهداء/موعد/تخصيص) | **مكتمل** | `CommerceOrderSnapshotTest`, نماذج `CommerceOrder*` |
| 3 | قراءة الطلب للمشتري (ضيف/مسجّل) — جوال | **مكتمل** | `CommerceOrderStatusApiTest`, `CommerceOrderOwnershipTest` |
| 4 | قراءة الطلب للضيف في المتجر (`store/v1/orders/{id}`) | **غير موجود** | الخطة O2؛ يوجد `payment-status` فقط |
| 5 | **قائمة الطلبات للموظف + بحث + فلاتر** | **غير موجود** | لا endpoint ولا صفحة ولا تنقل |
| 6 | **تفاصيل الطلب للموظف** (منتجات/عميل/دفع) | **غير موجود** | — (المسلسل العام `CommerceOrderSerializer` لا يصلح للموظف: لا معرّف عميل/ملاحظات داخلية/دفع تفصيلي) |
| 7 | بُعد حالة الدفع | **جزئي** | `CommercePaymentIntent.status` (+ `PaymentAttempt`) — لا اشتقاق موحّد على الطلب ولا مراجعة بشرية ظاهرة |
| 8 | بُعد حالة التنفيذ (قبول/تجهيز/جاهز/شحن/تسليم) | **غير موجود** | لا نموذج ولا جدول |
| 9 | بُعد حالة الطلب التجاري | **جزئي** | `draft/confirmed` فقط؛ لا `cancelled`/`completed` |
| 10 | تأكيد/قبول الطلب من التاجر | **غير موجود** | التأكيد آلي عند الإتمام؛ لا خطوة قبول/رفض |
| 11 | إلغاء الطلب (موظف/مشترٍ) | **غير موجود** | لا `cancel` على الطلب؛ إلغاء النية فقط (`payments.manage`) وبلا أثر على الطلب |
| 12 | تحصيل COD/الاستلام | **جزئي** | `collect` يبدّل الحالة فقط؛ لا سند/قيد (D-8) |
| 13 | حجز المخزون — إلكتروني | **مكتمل** | `OnlineOrderStockHoldTest`, `CommerceOrderReservationPostgresConcurrencyTest` |
| 14 | حجز المخزون — COD/الاستلام | **غير موجود** | D-10 مفتوح |
| 15 | فاتورة/قيد لطلب إلكتروني مدفوع | **مكتمل (مغلق)** | `CommerceInvoiceOnPaymentTest` (13) — خلف بوابات EXT-05/G3 |
| 16 | فاتورة/قيد لطلب COD/الاستلام | **غير موجود** | INV1، D-8 |
| 17 | شحنة/ناقل/رقم تتبع/«تم الشحن»/«تم التسليم» | **غير موجود** | F1 |
| 18 | اختيار مخزن التنفيذ للقناة | **مكتمل** | `CommerceFulfillmentController`, `FulfillmentPolicyService` |
| 19 | استلام من فرع (`PickupLocation`) | **غير موجود** | F2 (ADR-19 §5 مؤجَّل) |
| 20 | مرتجع/RMA لطلب المتجر | **غير موجود** | RT2 (يحتاج ADR RT1) |
| 21 | استرداد مبلغ لطلب المتجر | **غير موجود** | `not_refundable` صريح؛ RT3 |
| 22 | إشعار دائن/إعادة مخزون مرتبط بالطلب | **غير موجود** | RT4 |
| 23 | سجل زمني لأحداث الطلب | **غير موجود** | O4؛ لا جدول أحداث |
| 24 | تنبيه التاجر بطلب جديد | **غير موجود** | N4 (ينتظر O1 وD-12) |
| 25 | تأكيد/إشعارات المشتري | **غير موجود** | N1/N2 (مزوّد اتصالات خارجي) |
| 26 | عزل المستأجر في مسارات الجمهور | **مكتمل** | اختبارات الملكية/IDOR |
| 27 | صلاحيات الموظف على الطلبات (`commerce.orders.*`) | **غير موجود** | الخطة تقترحها؛ غير مُضافة |
| 28 | دعم تعدد المتاجر/القنوات في إدارة الطلبات | **جزئي** | البيانات موجودة (`storefront_id`, `sales_channel_id`)؛ لا واجهة/فلتر |
| 29 | واجهة RTL عربية متجاوبة لمركز الطلبات | **غير موجود** | الغلاف والمكوّنات المشتركة جاهزة |
| 30 | مؤشرات طلبات في لوحة المتجر | **غير موجود** | GAP_MAP: «مبيعات المتجر، الطلبات، التنبيهات» |

> **ملاحظة على الأدلة:** الحالات أعلاه مبنية على الكود والاختبارات المقروءة أو المشغَّلة (142 اختباراً مركَّزاً). لم أشغّل مجموعة PostgreSQL ولا اختبارات الواجهة.

## 3. الفجوات مقارنة بوظائف Spree

> **تنبيه مصدر:** لم أُعد جلب توثيق Spree في هذه الجلسة. القائمة التالية تجمع (أ) ما سُجّل في وثائق المستودع (`AWJ_SPREE_ADMIN_SANDBOX_GAP_MAP.md`, `AWJ_SPREE_DASHBOARD_ADOPTION_MAP.md`, `AWJ_SPREE_TECHNICAL_FIT_AUDIT.md`) و(ب) معرفتي العامة بنموذج Spree، وهي **مرجع وظيفي لا قرار** (القرار: أَوْج مصدر الحقيقة؛ Spree للتصميم فقط).

| وظيفة Spree Admin | ما يقابلها في أَوْج اليوم | القرار المقترح |
|---|---|---|
| قائمة الطلبات + فلاتر (حالة، دفع، شحن، تاريخ، عميل، رقم) | لا شيء | **ADAPT** — O1 |
| تفاصيل الطلب (سطور، عنوان، دفعات، شحنات، سجل) | لا شيء | **ADAPT** — O1 ثم تدرّجياً O3/F1/O4 |
| `state` للطلب (complete/canceled/returned…) | `draft/confirmed` | **ADAPT** بتبسيط: confirmed/cancelled + اشتقاق completed |
| `payment_state` (balance_due/paid/failed/void/credit_owed) | حالة النية فقط | **ADAPT** كقراءة مشتقة، لا عمود جديد في البداية |
| `shipment_state` (pending/ready/shipped) + تتبع | لا شيء | **BUILD** — F1 (شحنة واحدة V1؛ **الشحنات المتعددة مُسقَطة** CK6/D-7) |
| إلغاء الطلب / استئناف (resume) | لا شيء | **BUILD** إلغاء فقط — O3؛ `resume` خارج النطاق |
| Order log / state changes | لا شيء | **ADAPT** — O4 (append-only) |
| Capture/Void/Refund للدفعة | `collect`/`cancel` للنية؛ لا Refund | **ADAPT** عبر `PaymentService`/`PaymentRefundService` — INV1/RT3 |
| Return Authorization / Customer Return / Reimbursement | لا شيء | **LATER** — بعد ADR RT1 (Return ≠ Refund ≠ CreditNote ≠ Exchange) |
| تعديل الطلب بعد الإنشاء (إضافة/حذف سطور، adjustments) | لا شيء ومحظور فعلياً | **REJECT** — الطلب لقطة تجارية ثابتة؛ التصحيح بإلغاء/إعادة إنشاء |
| إنشاء طلب نيابةً عن عميل (draft orders) | لا شيء | **LATER** (GAP_MAP: ليس شرطاً للإطلاق) |
| Stock locations لكل شحنة | `FulfillmentPolicy` لكل قناة | **REUSE** — لا نموذج موازٍ |
| Multi-store / channel | `SalesChannel` + `Storefront` | **REUSE** |
| Promotions/Adjustments على الطلب | مؤجَّل (ADR-11) | **LATER** |
| إيميلات المعاملات | لا مزوّد (N1) | **EXTERNAL** |

## 4. التوصية المعمارية (تستفيد من البنية الحالية)

### 4.1 المبدأ: ثلاثة أبعاد مستقلة + أثر مالي منفصل، دون enum واحد

```
CommerceOrder (التزام تجاري، CompanyWide، يبقى كما هو)
 ├─ بُعد الطلب      : status = draft | confirmed | cancelled      ← إضافة cancelled فقط (+ cancelled_at/by/reason)
 ├─ بُعد الدفع      : CommercePaymentIntent (+PaymentAttempt)      ← موجود؛ يُضاف مُشتقّ قراءة payment_state
 ├─ بُعد التنفيذ    : commerce_fulfillments (جديد، 1:1 في V1)      ← pending → ready → shipped → delivered | failed | cancelled
 ├─ سجل الأحداث     : commerce_order_events (جديد، append-only)
 └─ الأثر المالي    : CommerceOrderPosting (موجود) — COD لاحقاً (INV1) — عبر الخدمات المحاسبية حصراً
```

- **`completed` يُشتق ولا يُخزَّن:** `delivered` ∧ دفع مُسوّى.
- **لا تعديل لمعنى `confirmed` ولا لعقد OpenAPI العام** (`CommerceOrderController`/`CommerceOrderSerializer`): الحقول الجديدة **كتل إضافية** (`fulfillment`, `cancellation`)؛ قيمة `cancelled` الجديدة في `status` العام تغيير عقد ⇒ تُعرض للجمهور بقرار صريح (`status` العام يبقى `confirmed` مع كتلة `cancellation` حتى يُعتمد غير ذلك).
- **كل الانتقالات عبر خدمة واحدة** `CommerceOrderLifecycleService` (معاملة + `lockForUpdate` على الطلب والنية والحجز بترتيب ثابت) تنسّق الخدمات الموجودة ولا تكرّرها.

### 4.2 إعادة الاستخدام (لا مكوّنات موازية)

| الحاجة | المُعاد استخدامه |
|---|---|
| حجز/تحرير/استهلاك | `CommerceOrderReservationService` (`releaseActive`, `consumeActive`) |
| إلغاء/تحصيل النية | `CommercePaymentIntentService::cancel/markCollected` |
| الفاتورة والقيود | `CommerceOrderPostingService` / `InvoiceService` / `PaymentService` / `LedgerService` فقط |
| مخزن التنفيذ | `FulfillmentPolicyService` (المصدر: القناة، لا الفرع) |
| الترقيم | `GeneratesDocumentNumbers` (إن لزم رقم شحنة) |
| الصلاحيات | `Rbac` + جدول `roles` (زرع طبق الأصل، لا منح ضمني) + `EnsureApplicationActive:commerce.storefront` |
| التنبيه | `NotificationService` (N4) |
| الواجهة | غلاف `(commerce)` + `nav.ts` + `active-store` + `DataTable` + `messages.ts` |
| الاختبار | نمط `OnlineOrderStockHoldTest` (مكنسة/تزامن) و`BranchIsolationGuardTest` للتصنيف |

### 4.3 قرارات تصميم

1. **مسلسل الموظف منفصل عن العام:** `CommerceOrderStaffSerializer` (يضيف معرّف نية الدفع، مراجعة المحاولات، حالات التنفيذ، ملاحظات داخلية) — **لا** توسيع `CommerceOrderSerializer` (يخدم ثلاثة مستهلكين عامين).
2. **صلاحيات جديدة** (owner/admin عبر `*`؛ لا تُمنح تلقائياً لأي دور آخر): `commerce.orders.view` (قراءة + PII)، `commerce.orders.manage` (تجهيز/شحن/تسليم)، `commerce.orders.cancel`. وتصبح الإجراءات على نية دفع طلب متجر مشروطة بها **إضافةً** إلى `payments.manage` (سدّ الأثر الجانبي في §1.6).
3. **المستخدمون المقيَّدون بمخازن (`allowedWarehouseIds()`):** في O1 يُرفضون (fail-closed 403) لأن الطلب لا يحمل مخزناً؛ وفي F1 يُصفَّى بمخزن الشحنة. (قرار سياسة قابل للضبط — قاعدة CLAUDE رقم 6 — يُعرض على المالك).
4. **COD:** حجز المخزون سياسة قابلة للضبط (`none` الافتراضي | `reserve_on_confirm`) = D-10 (CK4)؛ والفاتورة عند التحصيل/التسليم = D-8 (INV1/INV2) مغلقة افتراضياً. **لا افتراض ضريبي/توقيت ZATCA بالتخمين** (عقد #9).
5. **التصنيف الفرعي للجداول الجديدة:** `commerce_fulfillments`, `commerce_order_events` ⇒ `CompanyWide` (تتبع الطلب)، مع تسجيلها في `BranchIsolationGuardTest`.
6. **الأحداث immutable** على نمط مُشغّلات القاعدة المستعملة في ZATCA (منع UPDATE/DELETE/TRUNCATE).

## 5. خطة التنفيذ — PRs صغيرة مرتبة بالاعتماديات

| PR | الهدف | يعتمد على | يحتاج قراراً | الحجم | تغييرات DB |
|---|---|---|---|---|---|
| **O1a** | **API موظف للقراءة فقط**: `GET commerce/orders` (ترقيم، بحث بالرقم/الاسم/الهاتف، فلاتر: متجر، تاريخ، حالة الدفع، طريقة التسليم، طريقة الدفع)، `GET commerce/orders/{id}`، `CommerceOrderStaffSerializer`، صلاحية `commerce.orders.view` + زرع | — | قرار المستخدم المقيَّد بمخزن (§4.3-3) | M | لا (فهارس اختيارية فقط) |
| **O1b** | واجهة `/commerce/orders` (قائمة + فلاتر + تفاصيل في صفحة/لوح)، عنصر تنقل، مؤشرات اللوحة، RTL/جوال، حالات فراغ/خطأ | O1a | — | M | لا |
| **D-9 ADR** | وثيقة: أبعاد الحالة، الإلغاء، عقد `status` العام (مع الإبقاء على عدم كسر الجوال) | — | **المالك** | S (docs) | — |
| **O3a** | `cancelled` + `CommerceOrderLifecycleService::cancel` (موظف): يحرّر الحجز ويلغي النية ذرّياً؛ يرفض بعد وجود `CommerceOrderPosting`/دفعة ملتقَطة؛ `commerce.orders.cancel` | O1a، D-9 | D-9 | L | نعم (أعمدة cancel) |
| **O4** | `commerce_order_events` append-only + تسجيل أحداث الإنشاء/الدفع/الحجز/الإلغاء + عرضها في التفاصيل | O3a | — | M | نعم (جدول) |
| **F1a** | `commerce_fulfillments` (حالات ready/shipped/delivered، ناقل، تتبع) + إجراءات `commerce.orders.manage` + كتلة `fulfillment` إضافية | O3a، O4 | D-9 | L | نعم |
| **CK4** | سياسة حجز COD (`none` الافتراضي) | O3a، D-10 | D-10 | M | إعداد فقط |
| **N4** | تنبيه التاجر بطلب جديد | O1a، D-12 | D-12 | S–M | لا |
| **INV1** | فاتورة+سند لـCOD عند التحصيل/التسليم، مغلقة افتراضياً | O1a، O3a، D-8 | D-8 + رأي ضريبي | L | نعم (مِرساة) |
| **RT1→RT4** | ADR المرتجعات ثم RMA/استرداد/إشعار دائن | O3a، F1a، D-11 | D-11 | L× | لاحقاً |

> **أرقام PR (O1…RT4) مأخوذة من `AWJ_SPREE_EXIT_MIGRATION_PLAN.md` و`AWJ_STORE_COMMERCE_HORIZON_TRACKER.md`**؛ التقسيم الفرعي (O1a/O1b, O3a, F1a) اقتراح هذا التدقيق.

## 6. المخاطر

| المجال | الخطر | التخفيف |
|---|---|---|
| **المخزون** | بيع زائد لطلبات COD (لا حجز) | CK4 كسياسة؛ إلى أن تُفعَّل: تنبيه تشغيلي ونص واضح للتاجر |
| | إلغاء يحرّر الحجز بينما التقاط متأخر قادم (D-15) | الإلغاء يمرّ عبر قفل النية؛ التقاط متأخر ⇒ `late_capture` للمراجعة (قائم) |
| | تحرير يدوي مزدوج مع المكنسة | `releaseActive` idempotent؛ اختبار تزامن PG |
| **المحاسبة** | فتح فاتورة COD بلا قرار D-8 | INV1 مغلقة افتراضياً؛ لا ترحيل رجعي |
| | إلغاء طلب بعد ترحيل فاتورة | رفض صريح؛ المسار الوحيد إشعار دائن/مرتجع (RT) |
| | خلط Refund/Return/CreditNote | ADR RT1 قبل أي كود |
| | كتابة مباشرة في الأستاذ من Commerce | ممنوع (عقد #6)؛ حارس ساكن في الاختبارات |
| **الدفع** | طلب `confirmed` بنية ملغاة/منتهية يظهر كنشط للموظف | عرض حالة مشتقة موحّدة في O1، وO3a يحسم الحالة |
| | `collect` بلا سند ⇒ تحصيل نقدي غير مسجَّل محاسبياً | يُعرض صراحةً «غير مرحَّل» في التفاصيل حتى INV1 |
| **الصلاحيات** | `payments.manage` يُدير نية طلب متجر دون صلاحية طلب | ربط الإجراءات بـ`commerce.orders.*` (§4.3-2) |
| | تسريب PII عبر مسلسل الموظف | مسلسل منفصل + قناع للهاتف/البريد لمن لا يملك `.view` + 404 موحّد |
| | مستخدم مقيَّد بمخزن يرى كل الطلبات | O1: رفض fail-closed حتى F1 |
| **العزل** | استعلامات يدوية تتجاوز `TenantScope` | الاستعلام عبر `CommerceOrder::query()` فقط + اختبار عبر مستأجرين |
| **التوافق** | تغيير `status` العام يكسر الجوال/المتجر | كتل إضافية فقط؛ اختبارات `CommerceOrderStatusApiTest`/`FlowersEndToEndJourneyTest` تُبقى بلا تعديل |

## 7. الاختبارات المطلوبة ومعايير القبول لكل مرحلة

**قاعدة عامة لكل PR:** `php artisan test` كاملاً أخضر؛ `BranchIsolationGuardTest` يمرّ؛ لا تعديل لاختبارات جمهور قائمة؛ لأي أثر محاسبي جدول القيود في وصف الـPR قبل طلب المراجعة (CLAUDE.md).

| المرحلة | الاختبارات | معيار القبول |
|---|---|---|
| **O1a** | Feature: مصفوفة RBAC لكل دور (يسمح/يمنع) · عزل مستأجر (طلب مستأجر آخر ⇒ 404) · ترقيم/فرز/فلاتر/بحث · عدم وجود N+1 · عدم تسريب حقول داخلية · مستخدم مقيَّد بمخزن ⇒ 403 · قراءة فقط (لا `StockMovement`/قيد/تغيير صف) · SQLite + PostgreSQL | قراءة فقط؛ لا أثر جانبي؛ الاستجابات الجماهيرية القائمة بلا تغيير |
| **O1b** | اختبارات مكوّنات (حالات: تحميل/فراغ/خطأ/مصفوفة صلاحيات) · RTL · عرض جوال · `npm run build` · فحص `nav.test.ts` | عنصر التنقل يظهر بالصلاحية فقط؛ لا نص ثابت خارج `messages.ts` |
| **O3a** | تزامن PG (إلغاء مقابل التقاط/مكنسة) · انتقالات الحالة المسموحة/المحظورة · تحرير الحجز · رفض بعد الترحيل · idempotency (إلغاء مكرر) | ذرّي؛ لا طلب `confirmed` بنية ملغاة؛ لا قيود غير متوازنة |
| **O4** | منع UPDATE/DELETE على الأحداث · لا PII زائد · ترتيب زمني | كل انتقال حدث ثابت |
| **F1a** | انتقالات `ready→shipped→delivered` · RBAC · عزل · idempotency · كتلة `fulfillment` إضافية لا تغيّر العقد القديم | واجهات الجمهور بلا تغيير |
| **CK4 / INV1 / RT** | كما في الخطة الأصلية (PG، قيود متوازنة، T5/T6 للاسترداد النقدي) | بعد قرارات D-8/D-10/D-11 |

## 8. أول PR مقترح — **AWJ-COMMERCE-ORDERS-O1a**

**العنوان:** `feat(commerce): O1a — staff read-only orders API + commerce.orders.view`

**داخل النطاق (دقيق):**
1. `GET commerce/orders` و`GET commerce/orders/{id}` في `routes/api.php` ضمن مجموعة المستأجر المصادَق، بـ`$perm('commerce.orders.view')` + `EnsureApplicationActive:commerce.storefront` (قراءة).
2. `CommerceStaffOrderController` + `CommerceOrderStaffSerializer` (قائمة موجزة؛ تفاصيل بالسطور واللقطات ونية الدفع وحالات المحاولات `review_reasons` ونتيجة `CommerceOrderPosting` إن وُجدت).
3. فلاتر: `storefront_id`/`sales_channel_id`، `status`، `payment_status`، `payment_method`، `delivery_method`، `from`/`to`، `q` (رقم الطلب/اسم/هاتف). فرز بالحقول المسموحة فقط.
4. صلاحية `commerce.orders.view` في `Rbac` مع زرع طبق الأصل لجدول `roles` (owner/admin عبر `*` فقط؛ لا منح ضمني).
5. رفض fail-closed (403) للمستخدم المقيَّد بمخازن.
6. الاختبارات في §7 + تحديث CLAUDE.md بفقرة قصيرة + تقرير تنفيذ.

**خارج النطاق صراحةً:** أي تغيير حالة، إلغاء، شحن، تحصيل، فاتورة، `StockMovement`، migrations جدولية، تعديل `CommerceOrderSerializer`، الواجهة (O1b)، الإشعارات.

**لماذا هذا أولاً:** لا يحتاج أي قرار مفتوح (D-8…D-12)، آمن (قراءة فقط)، يفتح الرؤية التشغيلية فوراً، وهو شرط مسبق لكل ما بعده (O3/F1/N4/INV1).

## 9. قرارات مطلوبة من المالك قبل التنفيذ

1. **D-9:** اعتماد نموذج الأبعاد (§4.1) وأن `cancelled` يظهر للجمهور ككتلة `cancellation` لا قيمة `status` جديدة.
2. **سياسة المستخدم المقيَّد بمخازن** على قائمة الطلبات (رفض في O1 ثم تصفية بالشحنة في F1) — أم نموذج آخر؟
3. **الأدوار التي تُمنح `commerce.orders.view/manage/cancel`** إلى جانب owner/admin.
4. **D-10** (حجز COD) و**D-8** (فاتورة COD وتوقيت ZATCA): تبقى مغلقة حتى حسمها؛ لا تمنع O1.
5. موافقة على أن O1a هو أول PR، وO1b الواجهة PR مستقل بعده.

## 10. حدود هذا التدقيق

- لم أشغّل CI كاملاً ولا PostgreSQL ولا الواجهة؛ الحالات «مكتمل» تستند إلى قراءة الكود وإلى 142 اختباراً مركَّزاً ناجحاً على SQLite وإلى سجل CI الأخضر على الـPRs السابقة.
- مقارنة Spree مرجع وظيفي من وثائق المستودع ومعرفتي العامة، لم أُعد التحقق منها من مصدرها في هذه الجلسة.
- CI الرئيسي لـ`2f4de9c` (run 10640) كان قيد التشغيل وقت الفحص.
- لم أراجع مسارات POS/ERP الأخرى ولا `DeliveryHubOrder` (نطاق منفصل لمنصات التوصيل؛ لم أجد ربطاً بـ`CommerceOrder` في grep) إلا بالقدر اللازم للربط.

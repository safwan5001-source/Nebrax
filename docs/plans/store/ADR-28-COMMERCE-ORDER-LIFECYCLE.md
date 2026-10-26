# ADR-28 — دورة حياة طلب التجارة الإلكترونية (قرار D-9)

**الحالة:** مقترَح — بانتظار موافقة المالك (لا يُنفَّذ O3a قبلها)
**التاريخ:** 2026-10-26
**يحسم:** D-9 في `AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` (يفتح O3a ثم O4 وF1a وRT2)
**Base:** `main@18fc006` (بعد دمج O1b #1768)
**المراجع:** `docs/audits/AWJ-COMMERCE-ORDERS-AUDIT-01.md` · `AWJ-COMMERCE-ORDERS-O1a/O1b-IMPLEMENTATION-REPORT.md` · `AWJ_SPREE_EXIT_MIGRATION_PLAN.md` (O3، O4، CK4، INV1، RT) · ADR-01 (Order ≠ Invoice) · ADR-02 (الحجز) · ADR-04/09 (نية الدفع) · CLAUDE.md (عقود Commerce #1–#10، PAY-H4-02/03)

> توثيق فقط: لا كود ولا migration ولا تعديل لقاعدة البيانات في هذه المهمة.

---

## 1. الحالة الحالية المثبتة (دليل من الكود)

### 1.1 الانتقالات الموجودة اليوم

| الكيان | الحالات | من يغيّرها | الدليل |
|---|---|---|---|
| `CommerceOrder.status` | `draft` ← `confirmed` فقط (enum في القاعدة) | `CommerceOrderService::createFromCheckout` داخل معاملة الإتمام (يُنشأ `draft` ثم `confirmed` في المعاملة نفسها)، و`confirm()` للمسار القديم | `database/migrations/2026_09_16_010000…:47`، `CommerceOrderService.php:292,373` |
| `CommercePaymentIntent.status` | `awaiting_collection` → `collected` \| `cancelled` (COD/استلام)؛ `pending` → `paid` \| `cancelled` (إلكتروني) | `markCollected` (قفل صف النية)، `cancel` (قفل صف النية)، `completeCaptured` (قفل صف النية)، المكنسة | `CommercePaymentIntentService.php:110,135`، `CommerceOnlinePaymentService.php:200-257` |
| `PaymentAttempt.capture_status` | `created → pending_customer → authorized → captured` / `cancelled`/`expired`/`failed`/`voided` | المنسِّق/المزوّد | `PaymentAttempt.php:24-46,89` |
| `InventoryReservation.status` | `active → consumed` \| `released` \| `expired` | `CommerceOrderReservationService` (`releaseActive`/`consumeActive`/`makePermanent`) | `CommerceOrderReservationService.php:193-240` |
| الترحيل المحاسبي | مِرساة `commerce_order_postings` (append-only) | `CommerceOrderPostingService` تحت قفل المحاولة ثم النية ثم الطلب | `PaymentAttemptPostingService.php:110,192-194`، `CommerceOrderPostingService.php:70,81` |

### 1.2 ما **لا** يوجد
- لا إلغاء للطلب (لا دالة ولا عمود ولا مسار). الطلب لا يتغيّر بعد `confirmed` أبداً.
- إلغاء النية وحدها (`POST commerce/payment-intents/{id}/cancel`، `payments.manage`، بلا واجهة) **لا يمسّ الطلب**: يبقى `confirmed` بنية ملغاة. المكنسة تفعل الشيء نفسه لانتهاء الدفع الإلكتروني (مقصود في H4-02: «الطلب يبقى سجلاً بلا حالة جديدة»).
- تحرير الحجز بعد إلغاء النية الإلكترونية يجري **خارج** معاملة الإلغاء بأفضل جهد (`CommercePaymentIntentService::cancel`، فشله «تعالجه المكنسة»)، وإغلاق المحاولات النشطة كذلك.

### 1.3 نقاط التزامن الموجودة (ترتيب الأقفال الفعلي)

```
المحاولة (PaymentAttempt)  →  النية (CommercePaymentIntent)  →  الطلب (CommerceOrder)  →  صفوف الحجز
```
- `PaymentAttemptPostingService`: يقفل المحاولة ثم النية (`:192-194`)؛ `CommerceOrderPostingService`: النية (`:70`) ثم الطلب (`:81`).
- `completeCaptured`: النية فقط، ثم `makePermanent` على الحجوزات (بلا قفل الطلب).
- `CommercePaymentIntentService::cancel`: النية فقط؛ يرفض إن `collected`/`paid`/ملغاة أو `hasCapture` (محاولة `captured`) **تحت قفل النية** — هذا هو الحاجز الذي يمنع تعارض الإلغاء مع التقاط مؤكَّد.
- `CommerceOrderReservationService::reserve`: يقفل الطلب (داخل معاملة الإتمام، قبل وجود منافس).
- التقاط يؤكده المزوّد بعد إلغاء النية ⇒ `late_capture` للمراجعة البشرية (D-15، لا استرداد آلي، لا إحياء للحجز).

**الخلاصة:** قفل النية هو **المحور** الذي يُسلسل التقاط/إلغاء/ترحيل. أي إلغاء للطلب يجب أن يأخذه أولاً ثم الطلب ثم الحجز — دون عكس ترتيب أي مسار قائم.

### 1.4 من يقرأ `status` اليوم (أثر أي تغيير)
- حرّاس جمود اللقطات `CommerceOrderSnapshot`/`Gift`/`Schedule`/`LinePersonalization` تعتمد `isConfirmed()` (`:84/:45/:45/:38`) لتجميد الطلب المؤكَّد؛ وحارس الحذف في `CommerceOrder::booted()` يمنع حذف `confirmed`.
- `CommercePayable.php:59-60`: بدء دفع إلكتروني يشترط `status === confirmed`.
- `CommerceOrderReservationService::reserve:112`: يشترط `isConfirmed()`.
- المسلسلات العامة تخرج `status` حرفياً: `CommerceOrderSerializer` (ضيف/عميل/إتمام)، `CommerceCustomerOrderController:60`، `StorefrontCheckoutController:347`.
- المتجر (`storefront/`): `AccountOrderList/Detail.statusLabel` يترجم `confirmed`/`draft` ويعيد **القيمة الخام** لغيرهما؛ و`AccountOrderStatus` يُضيء «تم استلام الطلب» **فقط** حين `status === 'confirmed'`. عقد OpenAPI (`docs/openapi/commerce-api-v1.yaml`) **لا يحصر** قيم حالة الطلب (يحصر `payment.status`، وفيها `cancelled` أصلاً). لا قارئ لـ`confirmed` في `mobile/` (grep).
- واجهة الموظف O1b: تعرض `status` بتسمية من `messages.ts` وتعيد القيمة الخام لما لا تعرفه — فتتحمّل `cancelled` بلا كسر.

---

## 2. القرار المقترح

### 2.1 ثلاثة أبعاد مستقلة (لا enum واحد)

| البعد | المصدر | التعديل |
|---|---|---|
| **حالة الطلب (lifecycle)** `draft` / `confirmed` / `cancelled` | عمود `status` + **حقائق إلغاء** (`cancelled_at`…) | يُشتقّ `lifecycle_status`: `cancelled` إن `cancelled_at` غير فارغ وإلا `status` |
| **حالة الدفع** | `CommercePaymentIntent.status` (+ `PaymentAttempt`) | **لا مصدر ثانٍ**: تُعرض مشتقّة؛ لا عمود `payment_status` على الطلب |
| **حالة التنفيذ** | `commerce_fulfillments` (F1a لاحقاً) | خارج هذا القرار؛ الإلغاء يرفض الطلب المشحون حين تُبنى |

> **قرار تخزين (D-9-S1، يحتاج موافقة):** لا تُضاف قيمة `cancelled` إلى enum العمود `status`؛ تُضاف **أعمدة حقائق** (`cancelled_at`, `cancelled_by_user_id`, `cancellation_reason`, `cancellation_note`). الأسباب:
> 1. `status` يبقى `confirmed` للطلب الملغى فتظل **كل حراس الجمود** (لقطة، إهداء، موعد، تخصيص، منع الحذف) ساريةً بلا تعديل؛ إضافة `cancelled` إلى enum كانت ستجعل `isConfirmed()` خاطئة للملغى فيُفكّ تجميد لقطات طلب تاريخي (خطر مباشر).
> 2. لا تعديل لقيد enum في PostgreSQL/SQLite (DROP/ADD CHECK) على جدول طلبات حيّ.
> 3. نقاط التصحيح الوحيدة هي القراء الذين يعنيهم «هل يقبل عملاً جديداً» (`CommercePayable`، المسلسلات)، وعددهم صغير ومحدَّد في §1.4.
>
> البديل (توسيع enum + استبدال `isConfirmed()` بـ`isCommitted()`) صالح لكنه أوسع أثراً — موثَّق في §9.

### 2.2 الإلغاء: من يملكه ومتى
- **موظف فقط** في O3a (`commerce.orders.cancel`). إلغاء المشتري الذاتي سياسة مستقلة لاحقاً (قابلة للضبط، قاعدة CLAUDE رقم 6).
- يُنفَّذ عبر خدمة واحدة `CommerceOrderLifecycleService::cancel(order, actor, reason, note)` **تنسّق** الخدمات القائمة ولا تكرّرها: `CommercePaymentIntentService` (النية)، `CommerceOrderReservationService` (الحجز). لا كتابة في الأستاذ أو المخزون من هذه الخدمة (عقد Commerce #6).

---

## 3. مصفوفة الإلغاء (ما يُسمح وما يُمنع)

`الإجراء` = ما يفعله `cancel()` داخل المعاملة. كل رفض = 409 برمز `reason` ثابت. الفحوص تُجرى **بعد** أخذ الأقفال (§4).

| # | حالة النية | المحاولات | الترحيل (`commerce_order_postings`) | الحجز | القرار | الإجراء / الرمز |
|---|---|---|---|---|---|---|
| 1 | COD/استلام `awaiting_collection` | — | لا | لا (COD بلا حجز اليوم) | **يُسمح** | النية → `cancelled`، الطلب → ملغى، `releaseActive` (لا شيء اليوم؛ يشمل D-10 لاحقاً) |
| 2 | COD/استلام `collected` | — | لا (INV1 غير مبنيّ) | — | **يُمنع** `payment_collected` | نقد استُلم: يلزم مسار استرداد/مرتجع (RT) لا إلغاء مباشر |
| 3 | إلكتروني `pending` | لا محاولات | لا | `active` | **يُسمح** | النية → `cancelled`، الطلب → ملغى، الحجز → `released` (كله داخل المعاملة) |
| 4 | إلكتروني `pending` | `created`/`pending_customer` فقط | لا | `active` | **يُسمح** | كالسابق + `closeActiveAttempts` **بعد الالتزام** (best-effort كما اليوم)؛ التقاط لاحق على صفحة بقيت حيّة ⇒ `late_capture` (D-15)، الطلب يبقى ملغى |
| 5 | إلكتروني `pending` | محاولة `authorized` | لا | `active` | **يُمنع** `payment_authorized` | مبلغ محجوز لدى المزوّد قد يتحوّل التقاطاً؛ يُعاد بعد انتهاء/إغلاق المحاولة |
| 6 | إلكتروني `pending` | محاولة `captured` (حتى المحجوزة للمراجعة `under_review`/لم تُثبَّت) | أي | — | **يُمنع** `payment_captured` | يُكتشف تحت قفل النية عبر `hasCapture` — الحاجز نفسه المستعمل في إلغاء النية |
| 7 | إلكتروني `paid` | captured | لا أو نعم | `active`/`consumed` | **يُمنع** `payment_paid` | استرداد عبر RT3/`PaymentRefundService` |
| 8 | أي | أي | **موجودة** (فاتورة/سند) | `consumed` | **يُمنع** `already_posted` | مرتجع/إشعار دائن (RT4)؛ لا إلغاء مباشر لما رُحِّل |
| 9 | `cancelled` (أُلغيت النية سابقاً بالمسار القديم أو المكنسة) والطلب `confirmed` | لا `captured` | لا | `released`/لا | **يُسمح** (إقفال إداري) | الطلب → ملغى؛ لا أثر آخر (النية والحجز محرَّران مسبقاً؛ `releaseActive` idempotent) |
| 10 | أي | — | — | — | الطلب **ملغى أصلاً** | **idempotent**: 200 بالحالة الحالية، لا أثر ولا تغيير للسبب/الفاعل/الوقت الأصليين |
| 11 | — | — | — | — | الطلب `draft` | 422 `not_confirmed` (لا يُرى خارج المعاملة أصلاً) |
| 12 | — | — | — | — | طلب مستأجر آخر / معرّف غير موجود | **404 موحَّد** (TenantScope) |
| 13 | — | — | — | — | مستخدم مقيَّد بمخازن | 403 (كما O1a) |
| 14 | — | — | — | — | شحنة موجودة (F1a لاحقاً) `shipped`/`delivered` | يُمنع `fulfillment_started` (يُضاف عند بناء F1a؛ لا أثر اليوم) |

**التقاط يصل بعد الإلغاء** (صف 4): الطلب لا يعود (لا un-cancel)؛ المحاولة تُوسم `late_capture` والاسترداد بشري (D-15 المحافظ). هذا الخطر مقبول بنفس منطق الإلغاء الإداري للنية اليوم.

### 3.1 أثر الإلغاء
| المكوّن | الأثر |
|---|---|
| نية الدفع | `cancelled` + `cancelled_at` (عبر `CommercePaymentIntentService`، لا كتابة مباشرة) |
| الحجز | `releaseActive` ⇒ `active → released`؛ ATS يعود فوراً؛ **لا `StockMovement`** (الحجز وعد لا حركة، عقد #2) |
| الفاتورة/القيد | **لا شيء**: لا إنشاء ولا عكس. الطلب المرحَّل لا يُلغى (صف 8). لا استدعاء لـ`InvoiceService`/`LedgerService`/`PaymentService` |
| الدفعة الملتقَطة | لا تُمسّ (صفوف 5–7 تمنع) |
| الإشعارات | خارج النطاق (N3) |

---

## 4. التزامن والمعاملة

**ترتيب الأقفال للإلغاء (يطابق الاتجاه القائم ولا يعكس أي مسار):**
`النية (FOR UPDATE)` → `الطلب (FOR UPDATE)` → `صفوف الحجز` ؛ المحاولات **لا تُقفل** (تُقرأ تحت قفل النية للفحص، وتُغلق بعد الالتزام).

داخل `DB::transaction` واحدة:
1. قفل النية، ثم الطلب (مع التحقق أنه للمستأجر الحالي عبر النطاق).
2. إن `cancelled_at` غير فارغ ⇒ إعادة الحالة (idempotent).
3. فحوص المصفوفة §3 بالترتيب: `already_posted` (مِرساة) → `payment_paid` → `payment_collected` → `payment_captured` (`hasCapture`) → `payment_authorized`.
4. إلغاء النية عبر الخدمة (إن لم تكن ملغاة) + `releaseActive` + كتابة حقائق الإلغاء على الطلب (`cancelled_at = now(UTC)`، الفاعل، السبب، الملاحظة).
5. خارج المعاملة بعد الالتزام: `closeActiveAttempts` (best-effort).

**سباقات يجب أن تُحسم دون حالة هجينة:**
| السباق | النتيجة المطلوبة |
|---|---|
| إلغاء ↔ `completeCaptured` | أحدهما يفوز: إما نية `paid` والإلغاء `payment_paid`/`payment_captured`، أو طلب ملغى والتقاط لاحق `late_capture`. **ممنوع** طلب ملغى بنية `paid` |
| إلغاء ↔ مكنسة | المكنسة تُلغي النية ثم تحرّر الحجز؛ الإلغاء الإداري يجد النية ملغاة (صف 9) |
| إلغاء ↔ إلغاء (نقرة مزدوجة) | الثاني ينتظر قفل النية فيرى `cancelled_at` ⇒ 200 idempotent، أثر واحد |
| إلغاء ↔ ترحيل (`CommerceOrderPostingService`) | الترحيل يقفل النية ثم الطلب؛ الإلغاء ينتظر ثم يرى المِرساة فيرفض `already_posted`، أو يسبق فيرفض الترحيل لأن النية ملغاة |
| إلغاء ↔ تحصيل COD | `markCollected` يقفل النية: إما `collected` (الإلغاء يرفض `payment_collected`) أو `cancelled` (التحصيل يرفض) |

**Idempotency:** حالة-مبنيّة (لا مفتاح إلزامي): إعادة الطلب نفسه آمنة بالتصميم. لا استعمال لـ`Idempotency-Key` (يخص `checkout/complete`).

---

## 5. العقود

### 5.1 عقد الموظف (داخلي — إضافي فوق O1a)

| المسار | الوصف |
|---|---|
| `POST commerce/orders/{id}/cancel` | جسم: `reason_code` ∈ {`customer_request`, `out_of_stock`, `payment_issue`, `duplicate_order`, `fraud_suspected`, `other`} (**إلزامي**)، `note` (≤ 500، **إلزامي عند `other`**). الصلاحية `commerce.orders.cancel` (owner/admin عبر `*` فقط؛ لا تُضاف إلى `MATRIX` ولا لأي دور مخزَّن) + `EnsureApplicationActive:commerce.storefront` + رفض المقيَّد بمخازن. 200 ← تفاصيل الطلب (مسلسل O1a) |
| الأخطاء | 404 موحَّد · 403 · 409 `{message, reason}` برموز §3 · 422 (تحقق الجسم) |
| `GET commerce/orders[/{id}]` | يضيف `lifecycle_status` وكتلة `cancellation: {cancelled, at, by:{id,name}, reason, note}`؛ `status` الخام يبقى كما هو؛ فلتر جديد `lifecycle_status` |
| `POST commerce/payment-intents/{id}/cancel` | **قرار D-9-R1:** لنية تتبع طلب متجر يُفوَّض إلى خدمة الإلغاء (يُطلب `payments.manage` **و** `commerce.orders.cancel`)، فلا تبقى طريقة تترك «طلباً مؤكَّداً بنية ملغاة». لا مستهلك واجهة اليوم |

الكتابة الوحيدة الجديدة هي مسار الإلغاء؛ لا تغيير لمسارات التحصيل/الاسترداد.

### 5.2 عقد الجمهور (متجر/جوال/ضيف) والتوافق

حقائق: لا مستهلك حالي يعرف `cancelled` للطلب؛ العقد لا يحصر قيم `status`؛ المتجر يضيء «تم الاستلام» عند `confirmed` فقط ويعيد القيمة الخام لغيره.

| الخيار | الوصف | التوافق |
|---|---|---|
| **A (الأفضلية المبدئية في التكليف)** | `status` يبقى `confirmed` + كتلة `cancellation` إضافية | العقد لا يتغيّر حرفياً، **لكن** كل عميل قائم (المتجر `AccountOrderStatus`، أي تطبيق جوال قديم) سيعرض الطلب الملغى **كنشط/مستلَم** حتى يُحدَّث ليقرأ الكتلة — يخالف شرط «لا يُعرض الملغى نشطاً» ما لم تُحدَّث العملاء أولاً |
| **B (موصى به — D-9-P1)** | `status: "cancelled"` للطلب الملغى **وكتلة `cancellation: {cancelled_at}`** الإضافية (بلا السبب الداخلي) | قيمة جديدة في حقل نصّي غير محصور؛ لا طلب قائم يتغيّر معناه (لا طلب مُلغى قبل O3a)؛ العملاء القائمة تتدهور بأمان (تعرض النص الخام، **ولا تضيء «تم الاستلام»**) |

التوصية **B** لأن A لا يحقق الشرط الأمني-التجاري (عدم إظهار الملغى نشطاً) لأي عميل لم يُحدَّث. إن فضّل المالك A فالشرط: تحديث `storefront/` وتأكيد عدم وجود جوال منشور يقرأ الحالة، **قبل** تمكين الإلغاء في الإنتاج (بوابة نشر).

في الحالتين: `payment.status` العام يعكس النية (`cancelled`) كما هو مسموح في العقد؛ `GET store/v1/orders/{order}/payment-status` يعيد حالة ملغاة؛ بدء دفع لطلب ملغى يُرفض (`CommercePayable` يفحص `cancelled_at`)؛ مرجع الضيف الموقَّع يبقى صالحاً للقراءة (الطلب يُقرأ ملغى).

**اختبارات التوافق المطلوبة:** `CommerceOrderStatusApiTest`/`FlowersEndToEndJourneyTest`/`CommerceCustomerOrderTest` لطلب غير ملغى **بلا أي تعديل**؛ مسلسل الملغى؛ vitest للمتجر (`AccountOrderList/Status`) لحالة `cancelled`.

---

## 6. هل يحتاج O3a إلى migration؟ **نعم، إضافية بحتة**

نطاق الهجرة (جدول `commerce_orders` فقط، بلا backfill ولا تعديل لصف قائم):
| العمود | النوع |
|---|---|
| `cancelled_at` | `timestamp` null |
| `cancelled_by_user_id` | uuid null، FK `users` `nullOnDelete` |
| `cancellation_reason` | string(32) null |
| `cancellation_note` | string(500) null |
| فهرس | `(tenant_id, cancelled_at)` |

حراس قاعدة البيانات (مُشغّلات PostgreSQL وSQLite على نمط الحراس القائمة، ليست قيوداً تطبيقية فقط):
1. `cancelled_at` يُكتب مرة واحدة فقط، من `NULL`، وعلى طلب `status = 'confirmed'`.
2. بعد ضبطه تتجمّد الأعمدة الأربعة (لا مسح ولا تعديل — لا un-cancel).
3. `cancellation_reason` إلزامي ومن القائمة حين `cancelled_at` غير فارغ.

`down()` يرفض متى وُجد أي طلب ملغى (نمط الهجرات القائمة). لا نموذج جديد (فلا تصنيف `BranchIsolationGuardTest` إضافي). لا تغيير في enum `status`. لا migration للأحداث — `commerce_order_events` هي **O4** (مستقلة).

---

## 7. الاختبارات المطلوبة لـO3a

**PostgreSQL / التزامن** (نمط `CommerceOnlinePaymentPostgresConcurrencyTest`، تفشل ولا تتخطّى إن غاب pcntl):
- إلغاء ↔ `completeCaptured`: لا حالة هجينة (ملغى + `paid`) في أيٍّ من الترتيبين.
- إلغاء ↔ المكنسة؛ إلغاء ↔ إلغاء (أثر واحد وردّ idempotent)؛ إلغاء ↔ ترحيل الطلب؛ إلغاء ↔ `markCollected`.
- اختبار **عدم الجمود**: ترتيب الأقفال النية→الطلب→الحجز مع المسارات القائمة بالتوازي.
- مُشغّلات الحراسة على PG وSQLite (كتابة مرتين، مسح، طلب `draft`، سبب خارج القائمة).

**Feature (SQLite + PG):** كل صف في §3 (1–14) · RBAC (owner/admin ✔؛ accountant بـ`payments.manage` ✘؛ دور مخصص بالصلاحية ✔ وبدونها ✘؛ صلاحية العرض وحدها ✘) · عزل المستأجر/IDOR 404 · مقيَّد المخازن 403 · القدرة المعطّلة 403 · السبب إلزامي و`other` يتطلب ملاحظة · حفظ الفاعل/الوقت/السبب ثباتاً · الحجز `released` وعودة ATS · **لا** `JournalEntry` ولا `StockMovement` ولا تغيير على `Invoice`/`Payment` (لقطة قبل/بعد) · فحص ساكن أن الخدمة لا تذكر `LedgerService`/`InvoiceService`/`InventoryService`.

**التوافق:** مسلسلات الجمهور (§5.2) وواجهة الموظف O1b (تعرض `cancelled` بلا كسر) وقارئ `status` في المتجر.

**معايير القبول:** الاختبارات أعلاه خضراء على SQLite وPostgreSQL؛ `php artisan test` كاملاً؛ لا حالة (طلب ملغى ∧ نية `paid`/`collected`) قابلة للتحقق؛ بوابة النشر مغلقة افتراضياً (§8)؛ تقرير تنفيذ وجدول بلا قيود (لا أثر محاسبي) في وصف الـPR.

---

## 8. خطة التنفيذ المقسَّمة (بعد الموافقة)

| PR | النطاق | يعتمد |
|---|---|---|
| **O3a-1** | الهجرة + الحراس + `lifecycle_status` + كتلة `cancellation` في مسلسل الموظف (قراءة، بلا إلغاء بعد) | موافقة ADR |
| **O3a-2** | `CommerceOrderLifecycleService::cancel` + `POST commerce/orders/{id}/cancel` + `commerce.orders.cancel` + تفويض مسار إلغاء النية + اختبارات PG | O3a-1 |
| **O3b** | واجهة O1b: زر «إلغاء الطلب» + حوار السبب + حالة `cancelled` | O3a-2 |
| **O3c** | تعريض الإلغاء في عقد الجمهور (§5.2) + تحديث المتجر | O3a-2 + قرار P1 |
| **O3d** (سياسة) | إلغاء تلقائي عند انتهاء الدفع الإلكتروني: `sales.commerce_unpaid_order_expiry_action` = `keep` (الافتراضي، السلوك الحالي) \| `cancel` | O3a-2 |

يُفعَّل الإلغاء في الإنتاج خلف بوابة نشر مغلقة افتراضياً (`config('commerce.order_cancellation_enabled')`) حتى يُعتمد §5.2.

---

## 9. المخاطر والبدائل المرفوضة

| الخطر | التخفيف |
|---|---|
| التقاط متأخر بعد الإلغاء (الصف 4) | `late_capture` + مراجعة بشرية (D-15)؛ الإلغاء لا يُلغى |
| عميل قديم يعرض الملغى نشطاً | الخيار B؛ أو تحديث العملاء قبل التمكين (A) |
| الإلغاء يحرّر مخزوناً ثم يصل التقاط | الحجز المحرَّر لا يُحيا (D-15)؛ المراجعة البشرية تحسم |
| COD المحصَّل لا يُلغى | مقصود: يتطلب مسار استرداد (RT) — قد يُرهق التاجر قبل RT؛ يُقيَّم مع المالك |
| تعطيل مسار إلغاء النية المستقل | لا مستهلك؛ يوثَّق في ملاحظات الإصدار |
| سباقات المكنسة | إلغاء المكنسة وإلغاء الموظف يمرّان بقفل النية نفسه |

**مرفوض:** توسيع enum `status` (يُفكّ تجميد اللقطات ويحتاج تعديل قيد PG)؛ مفتاح idempotency مستقل (الحالة تكفي)؛ عمود `payment_status` على الطلب (مصدر حقيقة مكرر)؛ إلغاء يكتب قيداً عكسياً أو حركة مخزون (يُخالف عقد #6)؛ إلغاء مشترٍ ذاتي في O3a.

---

## 10. قرارات تحتاج موافقة المالك

| # | القرار | التوصية |
|---|---|---|
| D-9-S1 | تخزين الإلغاء بأعمدة حقائق (لا توسيع enum) | موافقة |
| D-9-P1 | شكل عقد الجمهور: B (`status: cancelled` + كتلة) أم A (`confirmed` + كتلة) | **B**؛ A مقبول بشرط تحديث العملاء قبل التمكين |
| D-9-C1 | منع إلغاء COD **المحصَّل** (مسار استرداد لاحق) | موافقة |
| D-9-C2 | منع الإلغاء عند محاولة `authorized` | موافقة |
| D-9-R1 | تفويض `payment-intents/{id}/cancel` إلى خدمة الإلغاء بصلاحيتين | موافقة |
| D-9-R2 | قائمة أسباب الإلغاء الستة و`other`+ملاحظة | موافقة/تعديل |
| D-9-A1 | سياسة الإلغاء التلقائي عند انتهاء الدفع (O3d): الافتراضي `keep` | موافقة |
| D-9-G1 | بوابة نشر مغلقة افتراضياً للإلغاء | موافقة |
| تذكير | حسم D-10 (حجز COD) مستقل؛ الإلغاء جاهز لتحرير حجز COD حين يُفعَّل | — |

بعد الموافقة تتحوّل حالة D-9 إلى «Approved» ويُفتح O3a-1.

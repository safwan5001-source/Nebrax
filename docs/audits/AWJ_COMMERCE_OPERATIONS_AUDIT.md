> **مصدر الوثيقة:** أُنتجت في جلسة COPS-H0 (2026-11-01) خارج المستودع، وأُدرجت هنا **حرفياً** في COPS-H1-0 كمرجع قرار. الاعتمادات اللاحقة للمالك مسجّلة في `docs/plans/store/ADR-29-COMMERCE-ORDER-OPERATIONS.md` §0 — لا تُعدَّل هذه الوثيقة لتعكسها.

# AWJ Commerce Operations — H0 Audit & Horizon Master Plan

**البرنامج:** AWJ Commerce Operations Horizon (**COPS**) — امتداد لـ `AWJ_STORE_COMMERCE_MASTER_HORIZON_V1` (H2 Orders / H3 Payments-COD / H4 Fulfillment-Returns) وليس برنامجاً مستقلاً.
**هذه الوثيقة:** COPS-H0 — تدقيق قراءة فقط + خطة أفق. **لا تنفيذ لـ H1 قبل اعتماد المالك.**
**التاريخ:** 2026-11-01

| البند | القيمة |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Branch | لا فرع (HEAD منفصل على `main`) — لم يُنشأ فرع ولا commit ولا PR |
| Base SHA (المدقَّق) | `a05d7974c3f3780943b75c2bb5223fa2557e7506` (#1887) |
| Head SHA | = Base (لا تعديل) |
| `origin/main` وقت الإغلاق | `213debaa31cfdb4b6cc59a60aea7e119aa7b3a9d` (#1888 — ملفات fuel-web ورسائل فقط؛ لا أثر على النطاق) |
| تعديلات على المستودع | **صفر** (التقرير مكتوب في scratchpad الجلسة، خارج المستودع) |
| اختبارات مشغَّلة | **لا** — التدقيق قراءة كود/وثائق. حالات «Verified» تستند إلى وجود اختبارات مدموجة وتقارير تنفيذ سابقة بنتائج CI، لا إلى تشغيل جديد |
| بحث خارجي/بصري | **لم يُنفَّذ في H0** (انظر §0.3). كل سلوك منصّات خارجية مذكور هنا = «قيد معروف يجب التحقق منه» لا «دليل خارجي» |

---

## 0. الملخص التنفيذي

### 0.1 الجواب المختصر

| السؤال | الواقع المثبت من الكود |
|---|---|
| هل يرى التاجر الطلبات؟ | **نعم** — `/commerce/orders` قائمة + تفاصيل (O1a/O1b) بصلاحية `commerce.orders.view`. **بلا تحديث تلقائي** (تحميل واحد). |
| هل يقبل/يرفض الطلب؟ | **لا.** كل طلب يُنشأ `confirmed` آلياً داخل معاملة الإتمام (`CommerceOrderService.php:295`). لا مفهوم قبول. |
| هل يجهّز/يشحن/يسلّم؟ | **لا.** لا كيان تنفيذ/شحنة/تتبع إطلاقاً (لا جدول/نموذج/مسار/واجهة). `commerce_fulfillments` موجود في ADR-28 كوثيقة فقط. |
| هل يتتبّع العميل طلبه؟ | **تصميم فقط.** `AccountOrderStatus` يعرض خطاً زمنياً ثابتاً (placed/preparing/onTheWay/delivered) يضيء «placed» وحدها؛ `ACCOUNT_ORDER_STATUS_CAPABILITY = "design_only"`. |
| هل يُنبَّه التاجر بطلب جديد؟ | **لا.** لا حدث عند إنشاء الطلب، لا إشعار، لا صوت، لا Push. الجرس (`NotificationBell`) غير مركَّب في غلاف التجارة أصلاً. |
| هل يمكن الإلغاء؟ | **نعم للموظف، خلف بوابة مغلقة** (`COMMERCE_ORDER_CANCELLATION_ENABLED=false`) — O3a/O3b/O3c مدموجة ومختبَرة SQLite+PG، غير مفعّلة وغير مُتحقَّق منها بيئياً. |
| COD؟ | نية `awaiting_collection` → `collected` بتبديل حالة فقط عبر API **بلا واجهة، بلا قيد، بلا فاتورة، بلا حجز مخزون، بلا خروج مخزون**. |
| إعدادات المتجر؟ | موزّعة على 7 مواضع (هوية، توصيل، جدولة، إهداء، حسابات عملاء، مخزن تنفيذ، نطاقات). **مفقود:** قبول تلقائي/يدوي، إيقاف استقبال الطلبات، ساعات العمل، حدّ أدنى للطلب، مستلمو التنبيهات، محرّر مناطق الشحن (API موجود بلا شاشة). |

### 0.2 أهم خمس نتائج

1. **الأساس سليم ومعماري:** فصل الأبعاد (الطلب ≠ الدفع ≠ المحاسبة) مطبَّق فعلاً؛ ترتيب الأقفال `Attempt → Intent → Order → Reservations` مثبت ومحروس باختبارات PG؛ الإلغاء نموذج يُحتذى (حقائق ثابتة + حراس قاعدة + تنظيف بعد الالتزام).
2. **البُعد الثالث (التنفيذ) غائب كلياً** وهو المانع الأول لكل من: التجهيز، التتبع، تصفية المستخدم المقيَّد بمخزن، صف المصفوفة 14 في ADR-28، الفوترة عند التسليم (INV2).
3. **لا بنية زمن حقيقي** (لا Broadcasting/SSE/WebSocket؛ `QUEUE_CONNECTION=sync`؛ Apache prefork mod_php) ⇒ أي تنبيه V1 يجب أن يقوم على **استطلاع خفيف بمؤشّر** لا على اتصال دائم. Web Push غير موجود ويصطدم بقرار ADR-COMMS D9 المفتوح.
4. **ثلاث آلات حالة تشغيلية قائمة يجب عدم تكرارها:** `DeliveryHubOrder` (received→accepted→preparing→ready→handed_off) لطلبات منصات التوصيل، `DeliveryNote` لسندات التسليم B2B، و`CommerceOrder` + ADR-28. التصميم المقترح **يستعير نمط** DeliveryHub (انتقالات مسمّاة + idempotent replay + `visibleTo`) **دون** دمج الكيانات (حدود مختلفة: DeliveryHub `BelongsToBranch` بلا فاتورة؛ CommerceOrder `CompanyWide`).
5. **فجوات توثيقية:** متتبّع الأفق (`AWJ_STORE_COMMERCE_HORIZON_TRACKER.md`, 10-26) متأخر (O1/O3 تظهر Planned/Blocked وهي مدموجة)، وترويسة ADR-28 ما زالت «مقترَح» رغم دمج O3a–O3c المبنية عليه. شاشتا `/sales-settings/orders` و`/sales-settings/shipping` تكتبان إعدادات **لا يقرؤها أي كود** (خطر ازدواج/التباس).

### 0.3 حدود H0 (صراحةً)

- **لا بحث خارجي ولا بصري في H0.** بروتوكول الأفق §4 يفرضه **قبل تثبيت قرار كل Slice** ذات سلوك/UI؛ أُدرج كبوابة R في كل Slice معنية (§E). ما يرد عن iOS/Web Push/Autoplay أدناه **قيود معروفة للتحقق** لا «External Evidence».
- لم تُشغَّل اختبارات ولا CI ولا بيئة. لم يُتحقق من الحالة المنشورة (Railway/Render/Vercel).
- لم تُفحص App Builder runtime إلا بقدر استهلاك الطلبات (لا شاشات طلبات في `mobile/`).

---

## A — Current State (الحالة الحالية بالأدلة)

### A.1 مفتاح التصنيف

`IMPL-V` منفَّذ ومُتحقَّق (اختبارات مدموجة + تقرير CI) · `IMPL-U` منفَّذ غير مُتحقَّق بالكامل (مغلق/غير مفعَّل/بلا E2E بيئي) · `PARTIAL` · `DESIGN` تصميم/واجهة بلا بيانات حية · `MISSING` · `BLOCKED(D-x)` محجوب بقرار مالك.

### A.2 الطلب ودورة حياته

| القدرة | الحالة | الدليل |
|---|---|---|
| `CommerceOrder` (`CompanyWide`، `CORD`)، status enum `draft\|confirmed` | IMPL-V | `app/Models/CommerceOrder.php:64-66`; migration `2026_09_16_010000…:47` |
| إنشاء ذرّي idempotent من Checkout، يُنشأ `confirmed` مباشرة | IMPL-V | `CommerceCheckoutService::complete` L502-626; `CommerceOrderService.php:295`; `StorefrontCheckoutCompletion*Test` |
| لقطات ثابتة (عنوان/عميل/إهداء/موعد/تخصيص/إضافات) | IMPL-V | `CommerceOrderSnapshot/Gift/Schedule/LinePersonalization`; `CommerceOrderSnapshotTest` |
| `lifecycle_status` مشتق (`cancelled` من `cancelled_at`) | IMPL-V | `CommerceOrder::lifecycleStatus()`; ADR-28 D-9-S1 |
| إلغاء الموظف (مصفوفة 14 صفاً، حراس DB، تنظيف afterCommit، مطابِق مجدول) | **IMPL-U** (بوابة مغلقة؛ مُختبَر SQLite+PG؛ غير منشور/غير مُفعَّل) | `CommerceOrderLifecycleService.php:40-174`; migration `2026_12_13_010000` (trigger L91-141); `CommerceOrderCancellation*Test`; `AWJ-COMMERCE-ORDER-CANCELLATION-BETA-READINESS.md` |
| عقد الجمهور للملغى (`status:"cancelled"` + `cancellation.cancelled_at`) | IMPL-V (كود) / IMPL-U (بيئة) | `CommerceOrderSerializer.php:49,60-67`; O3c |
| قبول/رفض التاجر | MISSING | لا كود |
| إلغاء تلقائي عند انتهاء الدفع (O3d `commerce_unpaid_order_expiry_action`) | MISSING (مقترح في ADR-28 §8) | grep فارغ؛ المكنسة تلغي النية فقط ويبقى الطلب `confirmed` (`CommerceUnpaidOrderSweeper`) |
| سجل أحداث الطلب (O4 `commerce_order_events`) | DESIGN (ADR-28 فقط) | grep في `app/`/`database/` فارغ |
| أحداث نطاق عند الإنشاء/الإلغاء | MISSING | `app/Events` = `CommercePaymentAttemptCaptured`, `PaymentAttemptCaptured`, `PaymentRefundConfirmed` فقط |
| Webhooks خارجية للطلب | MISSING | `WebhookEventCatalog.php:18-20` = partner/product/invoice.created |
| إلغاء المشتري الذاتي | MISSING (مرفوض في O3a صراحةً) | ADR-28 §2.2 |

### A.3 الدفع (بُعد مستقل — مصدر حقيقته `CommercePaymentIntent`)

| القدرة | الحالة | الدليل |
|---|---|---|
| نية COD/استلام `awaiting_collection→collected\|cancelled` | IMPL-V | `CommercePaymentIntentService.php:55-127` |
| تحصيل COD | **PARTIAL** — API فقط (`payments.manage`)، **لا واجهة**، **لا أثر محاسبي** (docblock L24-28) | `routes/api.php:1182`; `orders-readonly.test.ts:33` يمنع الاستدعاء من الواجهة |
| دفع إلكتروني (نية/محاولات/التقاط/late_capture/مطابقة) | IMPL-U (بوابة `PAYMENTS_COMMERCE_ONLINE_CHECKOUT_ENABLED` مغلقة؛ G3/EXT-05) | PAY-H4-04a/05 |
| فاتورة + سند بوابة عند الالتقاط | IMPL-U (3 بوابات) | `CommerceOrderPostingService.php:49-196`; `CommerceInvoiceOnPaymentTest` |
| استرداد لطلب متجر | MISSING (`not_refundable` صريح) | `PaymentRefundService.php:649-650,674-681` |

### A.4 المخزون

| القدرة | الحالة | الدليل |
|---|---|---|
| حجز الطلب الإلكتروني + مكنسة + استهلاك عند الترحيل | IMPL-U (يتبع بوابة الدفع الإلكتروني) | `CommerceCheckoutService.php:610-612`; `CommerceOrderReservationService`; `OnlineOrderStockHoldTest` |
| حجز COD/الاستلام | **MISSING** — `BLOCKED(D-10)` | `if ($intent->isOnline())` فقط؛ اختبار `cod orders never hold stock` |
| خروج مخزون لطلب COD | **MISSING** — `BLOCKED(D-8)` | لا مسار |
| مخزن التنفيذ للقناة (ثابت واحد) | IMPL-V | `FulfillmentPolicyService::setFixedWarehouse/resolveWarehouseFor` L40/L67 |

### A.5 التنفيذ والتوصيل والاستلام

| القدرة | الحالة | الدليل |
|---|---|---|
| طرق التوصيل `standard\|pickup` (ثابتة في الكود) | IMPL-V / PARTIAL (لا جدول طرق) | `CommerceCheckoutService::DELIVERY_METHODS` L72 |
| مناطق الشحن + سعر ثابت لكل منطقة (ADR-10) | IMPL-V (API) / **لا شاشة تحرير** | `ShippingRateService`; `routes/api.php:1452-1459`; شاشة الجملة للقراءة فقط |
| جدولة التسليم: نوافذ/سعة/تواريخ محجوبة/مهلة/cut-off (ADR-19) | IMPL-V | `CommerceDeliveryScheduleService`; `/commerce/delivery` |
| وعد التسليم ووقت التحضير (ADR-20) | IMPL-V (كتالوج فقط، لا يُربط بالطلب) | `CommerceDeliveryPromiseService`; `ProductPreparationService` |
| كيان تنفيذ/شحنة، حالات التجهيز/الجاهزية/خرج للتوصيل/سُلِّم | **MISSING** | grep `shipment\|tracking_number\|fulfillment` في migrations = لا شيء للتجارة |
| نقاط الاستلام `PickupLocation` | MISSING (ADR-03 §9 يمنع مساواتها بالمخزن) | `CommerceBoundary.php:62` نص فقط |
| ناقلات خارجية (SMSA/Aramex/SPL) | MISSING — `BLOCKED` (قرار ADR-10 المفتوح) | `logistics.shipping` = `coming_soon` في `ApplicationCatalog.php:253-264` |
| شحنات متعددة/تنفيذ جزئي | MISSING — `BLOCKED(D-7)` (التوصية: إسقاط في V1) | ADR-03 §8 «لا تقسيم متعدد المخازن في V1» |
| طلبات مجدولة كطابور تشغيلي | PARTIAL — الموعد يُلتقط في `commerce_order_schedules` ويُعرض في التفاصيل؛ لا عرض «مستحق اليوم»/«ابدأ التحضير» | `CommerceOrderStaffSerializer` |

### A.6 تتبع العميل

| السطح | الحالة | الدليل |
|---|---|---|
| تأكيد الطلب داخل الجلسة | IMPL-V (يعالج الملغى) | `storefront/src/components/checkout/awj/Confirmation.tsx` |
| سجل الطلبات للحساب + تفاصيل + المطالبة بطلب ضيف | IMPL-U (بوابة `COMMERCE_RETAIL_ACCOUNTS_ENABLED`) | `AccountOrdersView/Detail`; `lib/data/customer.ts:466-506` |
| خط زمني لحالة الطلب | **DESIGN** | `AccountOrderStatus.tsx:7-12,78-81`; `capabilities.ts:246` |
| بحث الضيف عن طلب (`store/v1/orders/{id}` = O2) | MISSING | لا مسار؛ الجوال يملك `commerce/v1/orders/{id}` بمرجع موقَّع |
| شاشات الطلبات في تطبيق الجوال | MISSING | `mobile/lib/commerce/commerce_client.dart:26-32` |
| رسائل بريد/SMS للمشتري | MISSING — `BLOCKED(D-12, N1)` | بقايا Spree خاملة في `storefront/src/lib/emails/*`؛ لا مزوّد اتصالات |

### A.7 الإشعارات والزمن الحقيقي

| القدرة | الحالة | الدليل |
|---|---|---|
| صندوق إشعارات داخلي (جدول/خدمة/API/منتِجون) | IMPL-V | `NotificationService::deliver()`; `notifications` table (`2026_09_06_020000`) dedupe `(tenant, recipient, dedupe_key)` |
| إجراء إشعار للطلب `view_commerce_order` | MISSING | `NotificationActions::ALLOWED` L21-37؛ `web/src/lib/notifications.ts` `ACTION_PATHS` |
| الجرس | IMPL-V في غلاف `(app)` فقط؛ **غائب عن `(commerce)` و`(pos)`** | `topbar.tsx:97`; `commerce-workspace-shell.tsx` |
| زمن حقيقي (Broadcast/Reverb/Pusher/SSE/WS) | MISSING | لا `broadcasting.php`؛ `Dockerfile:58 QUEUE_CONNECTION=sync`؛ Apache prefork |
| استطلاع | جرس كل 60ث بلا `visibilitychange`؛ قائمة الطلبات **بلا استطلاع** | `notification-bell.tsx:25,66-70`; `orders-list.tsx:154` |
| Web Push / Service Worker / Manifest / VAPID / اشتراكات | MISSING | لا ملفات؛ لا حزمة `minishlink/web-push` (المستودع بلا `composer.json`؛ `deploy/assemble.sh:14-20`) |
| صوت | IMPL-V لـPOS (`PosSoundManager`: preload/unlock/gain/vibrate)؛ **لا تكرار حتى الإقرار، لا معالجة `document.hidden`، أحداث مغلقة على POS** | `web/src/lib/pos-sound.ts:134-281`; `web/public/sounds/pos/*.wav` |
| تنسيق تعدد التبويبات (BroadcastChannel/Web Locks) | MISSING (مستمعو `storage` فقط) | `use-can.ts:14`, `branch.ts:103` |
| منصة الاتصالات (outbox/عقود/جداول) | PARTIAL — لا dispatcher ولا مزوّد ولا مستهلك؛ ADR-COMMS-01 «Proposed» وD1–D9 مفتوحة (D9 = FCM/APNs) | `app/Services/Communications/CommunicationOutbox.php`; `CommunicationChannel::Push` |
| مجدول | IMPL-V — Railway `awj-scheduler` كل 5 دقائق ⇒ **دقة فعلية ~5 دقائق** | `routes/console.php:98,114-176` |
| Push للجوال | PARTIAL خامل (قناة `awj/push` بلا FCM) | `mobile/lib/push/*` |

### A.8 الإعدادات والصلاحيات

| القدرة | الحالة | الدليل |
|---|---|---|
| مخزن إعدادات المؤسسة `tenants.settings` عبر `Settings` | IMPL-V — **عيب:** `put()` يُسقط القيم `null` فلا يمكن مسح `commerce_price_tax_mode` | `Settings.php:483-500` |
| مفاتيح `sales.commerce_*` (partner policy، hold minutes، invoice trigger، price tax mode، popularity) | IMPL-V (API) / **لا واجهة** | `UpdateSalesSettingsRequest.php:17-41`؛ grep `web/src` فارغ |
| `sales_config.orders` / `sales_config.shipping` | **شاشات بلا أثر** (لا قارئ) | `SalesConfigController.php:27-46` |
| إعدادات القناة (حسابات العملاء/الجملة/قائمة الأسعار) + سجل تدقيق | IMPL-V | `SalesChannelSettingsService`; `sales_channel_setting_events` |
| توفر طرق الدفع لكل قناة | PARTIAL — خدمة `setAvailability()` بلا مسار ولا واجهة | `PaymentMethodChannelAvailabilityService.php:69` |
| فتح/إغلاق المتجر | PARTIAL — `storefronts.is_active` (تفعيل/تعطيل كامل)؛ **لا «إيقاف استقبال الطلبات» مؤقت** | `api.php:1253-1254` |
| ساعات العمل / حد أدنى / قبول تلقائي / مستلمو التنبيهات | MISSING | نص عرض `contact.hours` فقط |
| نمط وراثة ثلاثي المستوى + تدقيق | IMPL-V (في الوقود) — **سابقة قابلة لإعادة الاستعمال** | `FuelStationSettingsService` + `fuel_station_setting_overrides` |
| تفضيلات المستخدم | PARTIAL — `users.preferences` JSON؛ `PUT /account/preferences` **يستبدل العمود كاملاً** ويقبل locale/theme/appTheme فقط | `AccountSettingsController.php:47-58` |
| صلاحيات `commerce.orders.view/cancel` | IMPL-V (owner/admin عبر `*` فقط) | `Rbac.php:219-222` |
| `commerce.orders.manage` (تجهيز/قبول) | MISSING | — |
| المستخدم المقيَّد بمخازن على الطلبات | 403 fail-closed (مؤقت حتى وجود مخزن على التنفيذ) | `CommerceStaffOrderController.php:174-179` |
| أغلب مسارات `commerce/workspace/*` بلا `EnsureApplicationActive` | ملاحظة اتساق (ليست ضمن نطاق COPS) | `api.php:1190-1224` |

### A.9 مكوّنات مجاورة قائمة يجب إعادة استعمالها لا تكرارها

| المكوّن | ما يُستعار | ما لا يُفعل |
|---|---|---|
| `DeliveryHubOrderService` (انتقالات مسمّاة، replay idempotent، `lockForUpdate`، `visibleTo(User)`، شاشة `/delivery-hub` بتبويبات حالات) | النمط والمصطلحات وتصميم الشاشة | لا دمج `CommerceOrder` فيه (حدود مختلفة: فرعي بلا فاتورة، مصدر خارجي) |
| `NotificationService::deliver()` + الجرس | قناة التنبيه الداخلية الوحيدة | لا جدول إشعارات ثانٍ |
| `PosSoundManager` | آلية preload/unlock/gain | لا إضافة أحداث طلبات لإعدادات POS |
| `FuelStationSettingsService` | نمط المؤسسة ← النطاق ← الجهاز + تدقيق | لا نسخ الجداول؛ تصميم نظير للتجارة |
| `sales_channel_setting_events` | نمط تدقيق إعدادات القناة | — |
| `CommunicationOutbox` | القناة المستقبلية لـ Email/SMS/WhatsApp/Push | لا إرسال مباشر من خدمات التجارة |
| `CommerceDeliveryScheduleService` / `ShippingRateService` / `FulfillmentPolicyService` | مصدر الحقيقة للموعد/السعر/المخزن | لا نموذج شحن/منطقة ثانٍ |
| `DeliveryNote` | — | ليس كيان شحنة للتجارة (فرعي B2B، عميل طرف). يُنظر فيه فقط كجسر محتمل لـ INV2 بقرار |

---

## B — Gap Analysis (Gap Matrix)

`Existing` · `Partial` · `Design Only` · `Missing` · `Blocked` (القرار المانع بين قوسين).

| # | المتطلب | الحالة | ملاحظة / المانع |
|---|---|---|---|
| G01 | قائمة/تفاصيل الطلبات للموظف | Existing | بلا تحديث حي |
| G02 | تحديث حي لقائمة الطلبات (feed) | Missing | — |
| G03 | قبول الطلب يدوياً | Missing | D-OPS-1 |
| G04 | رفض الطلب | Missing | D-OPS-2 (رفض = إلغاء بسبب جديد يتطلب تعديل حارس DB) |
| G05 | سياسة قبول تلقائي/يدوي لكل متجر | Missing | D-OPS-1 |
| G06 | مهلة القبول وإجراء انتهائها | Missing | D-OPS-3 |
| G07 | التجهيز (preparing/ready) | Missing | D-OPS-4 |
| G08 | توصيل محلي (سائق/خرج للتوصيل/سُلِّم) | Missing | D-OPS-4 |
| G09 | ناقل خارجي + رقم تتبع (يدوي) | Missing | D-OPS-4 |
| G10 | تكامل API ناقل | Blocked | ADR-10 قرار الناقل |
| G11 | استلام العميل (ready_for_pickup/picked_up) | Missing | D-OPS-4 |
| G12 | نقاط استلام متعددة | Blocked | D-OPS-10 (ADR-03 §9) |
| G13 | طلبات مجدولة كطابور («مستحق اليوم»، وقت بدء التحضير) | Partial | البيانات موجودة؛ العرض مفقود |
| G14 | COD: تحصيل من الواجهة | Partial | API بلا UI؛ عرضه قبل INV1 قرار (D-OPS-12) |
| G15 | COD: فاتورة/قيد/خروج مخزون | Blocked | D-8 + رأي ضريبي |
| G16 | COD: حجز مخزون | Blocked | D-10 |
| G17 | تنفيذ جزئي/شحنات متعددة | Blocked | D-7 (التوصية: إسقاط V1، مخطط يسمح لاحقاً) |
| G18 | إلغاء الموظف | Existing (مغلق) | تفعيل Beta بقرار |
| G19 | إلغاء تلقائي لطلب إلكتروني منتهي (O3d) | Missing | D-9-A1 (الافتراضي `keep`) |
| G20 | إلغاء المشتري الذاتي | Missing | سياسة قابلة للضبط — قرار |
| G21 | فشل التوصيل (محاولة/إعادة/إرجاع للمتجر) | Missing | D-OPS-4 |
| G22 | مرتجع/RMA | Blocked | D-11 (RT1) |
| G23 | استرداد مالي لطلب متجر | Blocked | D-11 + PAY-V2-6A |
| G24 | إشعار دائن/إعادة مخزون مرتبط بالطلب | Blocked | D-11 + T5/T6 |
| G25 | سجل أحداث الطلب (audit timeline) | Design Only | ADR-28 (O4) |
| G26 | حدث نطاق `order.placed` (afterCommit) | Missing | — |
| G27 | إشعار داخلي للتاجر بطلب جديد | Missing | D-12 (جزء التاجر قابل للفصل) |
| G28 | تنبيه صوتي في المتصفح | Missing | — |
| G29 | منع تكرار الصوت عبر التبويبات/الأجهزة | Missing | — |
| G30 | Web Push + PWA (+iPhone) | Missing | D-OPS-6 + ADR-COMMS D9 |
| G31 | تذكير/تصعيد لطلب غير مقبول | Missing | D-OPS-3 |
| G32 | مساحة استقبال الطلبات (لوحي/محمول) | Missing | يعتمد G03/G07 |
| G33 | خط زمني حقيقي للعميل | Design Only | يعتمد G07–G11 + D-OPS-5 |
| G34 | بحث الضيف عن طلبه (O2) | Missing | — |
| G35 | إشعارات المشتري (بريد/SMS) | Blocked | N1 (D1–D9) + D-12 |
| G36 | مركز إعدادات المتجر الموحَّد | Partial | الإعدادات موزّعة |
| G37 | محرر مناطق الشحن | Partial | API موجود |
| G38 | إيقاف استقبال الطلبات مؤقتاً | Missing | D-OPS-7 |
| G39 | ساعات العمل وسلوك خارجها | Missing | D-OPS-7 |
| G40 | حد أدنى للطلب | Missing | D-OPS-8 |
| G41 | مستلمو التنبيهات لكل متجر | Missing | D-OPS-9 |
| G42 | تفضيلات المستخدم/الجهاز للتنبيه | Missing | — |
| G43 | واجهة إعدادات `sales.commerce_*` | Partial | API فقط |
| G44 | توفر طرق الدفع لكل قناة (واجهة/مسار) | Partial | خدمة بلا مسار |
| G45 | صلاحية `commerce.orders.manage` | Missing | D-OPS-9 |
| G46 | تصفية الطلبات للمستخدم المقيَّد بمخزن | Partial (403) | تُرفع بوجود مخزن على التنفيذ |
| G47 | بوابات تفعيل لكل مستأجر (بدل العالمية) | Missing | قبل أول مستأجر حقيقي |
| G48 | تحديث المتتبّع وحالة ADR-28 | Partial | توثيق |

---

## C — Proposed Architecture

### C.1 المبادئ

1. **أربعة أبعاد مستقلة، كلٌّ بمصدر حقيقة واحد** (ADR-01 §4، ADR-28):

| البعد | مصدر الحقيقة | التخزين | ملاحظات |
|---|---|---|---|
| **Order lifecycle** | `commerce_orders` (`status` + حقائق الإلغاء) | قائم | لا قيم enum جديدة (D-9-S1) |
| **Merchant acceptance** (جديد) | حقائق على `commerce_orders`: `accepted_at`, `accepted_by_user_id`, `acceptance_mode`(`auto\|manual`) — والرفض = **إلغاء** بسبب `merchant_rejected` | إضافة أعمدة | يُشتق `operational_status` للعرض فقط |
| **Payment** | `CommercePaymentIntent` (+`PaymentAttempt`) | قائم | **لا** عمود `payment_status` على الطلب |
| **Fulfillment** (جديد) | `commerce_fulfillments` | جدول جديد | 1 لكل طلب في V1 (فهرس فريد قابل للإسقاط لاحقاً لـ D-7) |
| **Accounting** | `commerce_order_postings` + المستندات المحاسبية عبر الخدمات | قائم | لا كتابة من Commerce في الأستاذ |
| **Inventory** | `inventory_reservations` (وعد) + `stock_movements` (عبر `InventoryService`/`InvoiceService` فقط) | قائم | الحجز ≠ الحركة |
| **Audit** (جديد، O4) | `commerce_order_events` append-only | جدول جديد | حراس DB تمنع UPDATE/DELETE/TRUNCATE |

2. **لا enum مركّب.** واجهة الموظف وتتبع العميل تقرأ **إسقاطاً مشتقاً** (`operational_status`) محسوباً في خدمة واحدة `CommerceOrderStatusProjector` (قراءة نقية) من الأبعاد أعلاه.
3. **خدمة واحدة لكل انتقال:** `CommerceOrderLifecycleService` (قبول/رفض/إلغاء) و`CommerceFulfillmentService` (انتقالات التنفيذ). لا انتقال من متحكّم أو مستمع مباشرة.
4. **الإعدادات تُضبط ولا تُفرض** (قاعدة 6): كل سلوك جديد مع افتراض يطابق السلوك الحالي حرفياً.

### C.2 آلة حالة القبول (مقترحة — D-OPS-1/2/3)

```
confirmed ──(acceptance_mode=auto at creation)──▶ accepted (accepted_at=confirmed_at, by=null, mode=auto)
confirmed ──(manual)──▶ awaiting_acceptance ──accept──▶ accepted
                                         └──reject──▶ cancelled (reason=merchant_rejected) [عبر cancel()]
awaiting_acceptance ──timeout──▶ (remind_only: تذكير/تصعيد) | (auto_reject: فقط إن لا دفع ملتقَط/محصَّل — قرار)
```
- **الافتراضي `auto`** ⇒ لا تغيّر سلوكي لأي مستأجر قائم؛ الطلبات القديمة (قبل الهجرة) تُعامَل `accepted` ضمنياً بالاشتقاق (لا backfill).
- القبول **ممنوع** لطلب ملغى؛ الرفض يمرّ بمصفوفة الإلغاء نفسها (مدفوع/محصَّل ⇒ 409، المسار RT).
- **طلب إلكتروني غير مدفوع:** لا يظهر في طابور القبول حتى `paid` (أو يظهر «بانتظار الدفع») — قرار عرض D-OPS-1b؛ التوصية: لا ينبّه التاجر قبل الدفع.

### C.3 آلة حالة التنفيذ (مقترحة — D-OPS-4)

```
pending ─prepare─▶ preparing ─ready─▶ ready ─┬─dispatch─▶ out_for_delivery ─deliver─▶ delivered
                                              │                  └─fail─▶ delivery_failed ─retry─▶ out_for_delivery
                                              │                                         └─return─▶ returned_to_store
                                              └─(pickup) mark_ready_for_pickup ─▶ ready_for_pickup ─pickup─▶ picked_up
any non-terminal ─cancel (يتبع إلغاء الطلب فقط)─▶ cancelled
```
- `type` ∈ `local_delivery | carrier | pickup` (يُشتق من `delivery_method` ويُثبَّت عند الإنشاء).
- حقول: `warehouse_id` (لقطة من `FulfillmentPolicy` عند الإنشاء) ⇒ **يحلّ تصفية المستخدم المقيَّد بمخزن** (G46)، `carrier_name`, `tracking_number`, `tracking_url` (نص حر V1)، `courier_name/phone` (محلي، PII يُقنَّع)، طوابع كل مرحلة، `failure_reason`، `version` للقفل التفاؤلي في الواجهة.
- يُنشأ الصف عند القبول (أو عند الإنشاء لـ`auto`) — idempotent بفهرس فريد `commerce_order_id`.
- **التنفيذ لا يكتب مخزوناً ولا قيداً في V1.** أي ربط (خروج مخزون COD/فاتورة عند التسليم) = INV1/INV2 خلف D-8.
- **الإلغاء:** صف المصفوفة 14 يُفعَّل: `out_for_delivery`/`delivered`/`picked_up` ⇒ 409 `fulfillment_started`؛ `preparing`/`ready` ⇒ مسموح (قابل للضبط؟ D-OPS-4b).
- **ترتيب الأقفال:** `Attempt → Intent → Order → Fulfillment → Reservations`. انتقالات التنفيذ تقفل `Order` ثم `Fulfillment` (لاحقة، لا عكس). الإلغاء يضيف `Fulfillment` بعد `Order`.

### C.4 سجل الأحداث (O4) والأحداث النطاقية

- `commerce_order_events` (`CompanyWide`): `order_id`, `type` (قائمة مغلقة: `order.placed`, `order.accepted`, `order.rejected`, `order.cancelled`, `payment.collected`, `payment.paid`, `fulfillment.*`, `notification.acknowledged`…), `actor_type/actor_id`, `occurred_at`, `data` (بلا PII/مبالغ حساسة)، `sequence` لكل طلب.
- يُكتب **داخل** معاملة الانتقال نفسها (لا afterCommit) — مصدر تدقيق.
- حدث Laravel `CommerceOrderPlaced`/`CommerceOrderTransitioned` يُطلق **afterCommit** للمستهلكين (إشعارات، outbox لاحقاً، webhooks لاحقاً). مع `QUEUE_CONNECTION=sync` المستمعون متزامنون ⇒ **يجب أن تكون خفيفة ولا ترمي** (فشل الإشعار لا يُفشل الطلب).
- **Feed cursor:** المؤشّر = (`occurred_at`, `id`) من جدول الأحداث ⇒ مصدر واحد للاستطلاع والتنبيه والخط الزمني.

### C.5 التنبيهات (V1 بلا بنية زمن حقيقي)

```
CheckoutComplete (tx) ─▶ commerce_order_events(order.placed) ─commit─▶ CommerceOrderPlaced (afterCommit)
   └▶ NotificationService::deliver(type=commerce.order_placed, action=view_commerce_order, dedupe=order:{id})  [لكل مستلم مؤهل]
Web (commerce shell) ─ poll GET commerce/orders/feed?since=<cursor> (10–15ث، ETag/304، backoff عند الإخفاء)
   └▶ OrderAlertCenter (قائد تبويب واحد عبر Web Locks + BroadcastChannel)
        ├ صوت متكرر حتى الإقرار (AlertSoundEngine المستخرج من PosSoundManager)
        ├ Notification API المحلي (إن أُذن) أثناء فتح التبويب
        └ شارة/عنوان التبويب
Scheduler (5 د) ─ commerce:remind-unaccepted-orders ─▶ إشعار تذكير/تصعيد (dedupe لكل مرحلة)
[V2، مغلق] Web Push: push_subscriptions + VAPID + Service Worker ← عبر CommunicationOutbox(Push) بعد D9
```
- **منع التكرار:** (1) خادمياً `dedupe_key` لكل (مستلم، طلب، مرحلة)؛ (2) عبر التبويبات قائد واحد بـ`navigator.locks` مع سقوط إلى BroadcastChannel؛ (3) مجموعة «مُعلَن عنها» في `localStorage` لكل جهاز؛ (4) **الإقرار** (`POST commerce/orders/{id}/acknowledge` أو قراءة الإشعار) يُسكت الصوت على كل الأجهزة عند الاستطلاع التالي.
- **قيود يجب التحقق منها في بحث H3-0 (ليست دليلاً بعد):** سياسة Autoplay تتطلب تفاعلاً لفتح الصوت؛ تقنين المؤقتات في التبويبات الخلفية؛ Web Push على iPhone متاح فقط لتطبيق ويب مُضاف للشاشة الرئيسية (iOS 16.4+ وفق ما هو معروف)؛ Screen Wake Lock للوضع اللوحي.
- **الاستطلاع مقبول تشغيلياً:** طلب خفيف مفهرس (`tenant_id, occurred_at`) مع 304؛ لا اتصال دائم يحجز عامل PHP.

### C.6 مساحة استقبال الطلبات

`/commerce/orders/live` — لوحي أولاً، RTL، أعمدة: جديد (بانتظار القبول) · مقبول/قيد التجهيز · جاهز · خرج للتوصيل/جاهز للاستلام · منتهٍ اليوم. أزرار كبيرة (قبول/رفض/التالي)، مؤقت منذ الوصول، شارة «مجدول لـ…»، شريط «تفعيل الصوت»، Wake Lock، وضع ملء الشاشة. يستهلك feed C.5 والانتقالات C.2/C.3 فقط — **لا منطق حالة في الواجهة**.

### C.7 تتبع العميل

- كتلة `fulfillment` **إضافية** في `CommerceOrderSerializer` (لا تغيير لـ`status`): `{stage, stages[{key, at}], tracking:{carrier, number, url}|null, pickup:{ready_at}|null}` — مراحل علنية محدودة (`placed, accepted, preparing, ready, out_for_delivery|ready_for_pickup, delivered|picked_up`) بلا أسماء موظفين/سائقين.
- `AccountOrderStatus` يتحول من `design_only` إلى `live` بقراءة الكتلة؛ غيابها ⇒ السلوك الحالي حرفياً.
- O2: `GET store/v1/orders/{order}` للضيف بمرجع موقَّع (`CommerceOrderReference` القائم) ونفس المسلسل.

### C.8 ما يُرفض صراحةً

- عمود `payment_status`/`fulfillment_status` على `commerce_orders` (مصدر ثانٍ). · قيمة enum جديدة في `status`. · بنية WebSocket/Reverb في V1 (تتطلب عاملاً دائماً غير موجود). · إرسال Email/SMS مباشر من خدمات التجارة (يمر بالـoutbox). · إعادة استعمال `DeliveryHubOrder` لطلبات المتجر. · إعدادات قبول/شحن في `sales_config.orders/shipping` الميتة. · أي خروج مخزون/قيد عند الشحن أو التسليم قبل D-8.

### C.9 مصادر الحقيقة، الانتقالات، التزامن، idempotency، التدقيق

| الكيان | الكاتب الوحيد | الأقفال | Idempotency | التدقيق |
|---|---|---|---|---|
| Order lifecycle/acceptance | `CommerceOrderLifecycleService` | Intent→Order(→Fulfillment) | حالة-مبنية (إعادة القبول = 200 بلا أثر) | `commerce_order_events` + حراس DB على حقائق القبول (مرة واحدة، ثابتة) |
| Fulfillment | `CommerceFulfillmentService` | Order→Fulfillment | حالة-مبنية + `expected_version` اختياري (409 `stale_fulfillment`) | events |
| Payment | الخدمات القائمة فقط | Attempt→Intent | قائم | قائم |
| Reservations | `CommerceOrderReservationService` | بعد Order | `releaseActive` idempotent | قائم |
| Notifications | `NotificationService` | — | `dedupe_key` فريد | جدول الإشعارات |
| Channel ops settings | `CommerceChannelOperationsSettingsService` | قفل صف القناة (نفس بروتوكول ADR-19) | مقارنة `version` | `sales_channel_setting_events` (موسَّع بالمفاتيح) |

---

## D — Store Settings Map

المستويات: **T** مؤسسة (`tenants.settings`) · **S** متجر/قناة (`sales_channel_id`) · **U** مستخدم (`users.preferences`، خادمي) · **Dv** جهاز (localStorage/IndexedDB، لا يغادر الجهاز).

| المجموعة | الإعداد | المستوى | الحالة | المصدر/المقترح | الافتراضي الحافظ |
|---|---|---|---|---|---|
| هوية | الاسم، اللغة، النشاط | S | Existing | `PUT commerce/workspace/storefronts/{id}` | — |
| هوية | فتح/تعطيل المتجر | S | Existing | activate/deactivate | — |
| استقبال | **إيقاف استقبال الطلبات مؤقتاً** (+حتى وقت، رسالة) | S | Missing | `commerce_channel_operation_settings.accepting_orders`, `paused_until`, `pause_message` | `true` (مفتوح) |
| استقبال | **ساعات العمل** (أسبوعي + منطقة زمنية) | S | Missing | جدول ساعات مرتبط بالقناة (لا خلط مع نوافذ التسليم) | غائب = بلا قيد |
| استقبال | سلوك خارج الساعات (`accept` / `scheduled_only` / `reject`) | S | Missing | قرار D-OPS-7 | `accept` |
| استقبال | **وضع القبول** (`auto`/`manual`) | S | Missing | D-OPS-1 | `auto` |
| استقبال | مهلة القبول + إجراء الانتهاء (`remind_only`/`auto_reject_unpaid`) | S | Missing | D-OPS-3 | `remind_only`, 10 د |
| استقبال | حد أدنى للطلب (هللات) | S | Missing | D-OPS-8 | `null` |
| تنفيذ | مخزن التنفيذ | S | Existing | `FulfillmentPolicy` | — |
| تنفيذ | وقت التحضير الافتراضي | S | Missing (للمنتج Existing) | امتداد اختياري | `null` |
| تنفيذ | الناقل الافتراضي/قالب رابط تتبع | S | Missing | V1 نص حر | `null` |
| تنفيذ | السماح بإلغاء أثناء التجهيز | S | Missing | D-OPS-4b | `true` |
| توصيل | طرق التوصيل (`standard`/`pickup`) | S | Partial (ثابتة) | تفعيل/تعطيل لكل قناة لاحقاً | الحالي |
| توصيل | مناطق وأسعار الشحن | T (اليوم) | Existing API / Missing UI | `commerce_shipping_zones` (مؤسسي) | — |
| توصيل | جدولة/نوافذ/محجوب/مهلة/cut-off | S | Existing | ADR-19 | — |
| توصيل | نقاط الاستلام | S | Blocked (D-OPS-10) | `commerce_pickup_locations` لاحقاً | — |
| دفع | طرق الدفع الإلكتروني (مدى/فيزا…) + `use_in_store` | T | Existing | `online_payment_method_settings` | — |
| دفع | توفر طريقة دفع لكل قناة | S | Partial (بلا مسار) | `PaymentMethodChannelAvailabilityService` | الحالي |
| دفع | مدة حجز الدفع الإلكتروني | T | Existing API / Missing UI | `sales.commerce_payment_hold_minutes` | 60 |
| دفع/COD | سياسة حجز COD | T أو S | Blocked (D-10) | `sales.commerce_cod_reservation_policy` | `none` |
| محاسبة | مُشغِّل الفاتورة، نمط ضريبة السعر | T | Existing API (مغلق) | `sales.commerce_invoice_trigger`, `commerce_price_tax_mode` | `none`/`null` |
| محاسبة | سياسة ربط الطرف | T | Existing API / Missing UI | `sales.commerce_partner_policy` | `link_verified_else_create` |
| إلغاء | انتهاء الدفع ⇒ `keep`/`cancel` (O3d) | T | Missing | `sales.commerce_unpaid_order_expiry_action` | `keep` |
| إلغاء | إلغاء المشتري الذاتي (`off`/`before_acceptance`) | S | Missing | قرار | `off` |
| عملاء | حسابات العملاء، الجملة، قائمة الأسعار | S | Existing | `SalesChannelSettingsService` | — |
| إهداء | إعدادات الإهداء | S | Existing | `commerce_gift_settings` | — |
| تنبيه | مستلمو تنبيه الطلب (أدوار/مستخدمون) | S | Missing | D-OPS-9 — الافتراضي: كل من يملك `commerce.orders.view` | — |
| تنبيه | جهات تنبيه خارجية (بريد/جوال المتجر) | S | Missing | يخزَّن الآن، يُستعمل بعد N1 | فارغ |
| تنبيه | تصعيد بعد X دقيقة لدور | S | Missing | D-OPS-3 | معطّل |
| تنبيه | المتاجر التي أتلقى تنبيهاتها | U | Missing | `users.preferences.commerce_alerts.storefront_ids` (يتطلب إصلاح الاستبدال الكامل) | الكل |
| تنبيه | تفعيل الصوت، الصوت المختار، المستوى، التكرار | Dv | Missing | localStorage `awj-order-alerts:v1` | مفعَّل بعد إذن |
| تنبيه | إذن إشعارات المتصفح/اشتراك Push | Dv | Missing | `Notification.permission` + جدول اشتراكات (V2) | — |
| تنبيه | وضع الاستقبال (ملء الشاشة/Wake Lock) | Dv | Missing | localStorage | معطّل |
| واجهة | المتجر النشط، استعلام القائمة | Dv | Existing | `awj-commerce-active-store`, `awj-commerce-orders-list-query` | — |
| سياسات | صفحات السياسات | S | Existing | B8 | — |

**قرار تخزين مقترح:** جدول واحد `commerce_channel_operation_settings` (صف لكل قناة، `CompanyWide`، غيابه = السلوك الحالي) + جدول `commerce_channel_opening_hours` — على نمط `commerce_delivery_schedule_settings` (ADR-19) لا JSON في `tenants.settings`، لأن القراءة ساخنة في Checkout وتحتاج قفل صف القناة نفسه. **مركز الإعدادات** صفحة `/commerce/settings` تجمع الأقسام وتربط الموجود (لا تكرار نماذج).

---

## E — Horizon Master Plan & Implementation Plan

### E.0 الترقيم والعلاقة بالمتتبّع القائم

| COPS Slice | معرّف المتتبّع الأصلي |
|---|---|
| H1-1 | O4 |
| H2-* | F1 (F1a)، O2، F2 |
| H3-* | N4 |
| H4-* | CK2/CK3 (جزئياً)، جديد |
| H5-* | INV1، INV2، CK4 |
| H6-* | O3d، RT1–RT4، N3 |
| H7-* | N1، N2 |

**قاعدة عامة لكل Slice (لا تتكرر في الجداول):** فرع مستقل من أحدث `origin/main` · `php artisan test` كاملاً أخضر (SQLite) + الأجنحة ذات الصلة على PostgreSQL · `BranchIsolationGuardTest` لكل نموذج جديد · `npm run build`/`pnpm build` للواجهات · اختبارات عزل مستأجر (404 موحَّد) ومصفوفة RBAC سلبية · لا تعديل لاختبارات الجمهور القائمة (`CommerceOrderStatusApiTest`, `FlowersEndToEndJourneyTest`, `CommerceCustomerOrderApiTest`) · تقرير تنفيذ بصيغة البروتوكول §9 · جدول القيود في وصف PR (أو «لا أثر محاسبي» صراحةً) · تحديث CLAUDE.md بفقرة موجزة.

### COPS-H0 — Audit & Plan *(هذه الوثيقة)*
**الإغلاق:** اعتماد المالك للخطة + حسم بوابات القرار الأولى (D-OPS-1، D-OPS-4، D-OPS-5) + الإذن ببدء H1.

### COPS-H1 — Order Operations Foundation

| Slice | النطاق | يعتمد | قرار | DB | Acceptance Criteria | الاختبارات |
|---|---|---|---|---|---|---|
| **H1-0** Docs | ADR-29 «Order Operations & Fulfillment» (C.2/C.3/C.4/C.7) + تحديث المتتبّع + رفع ترويسة ADR-28 إلى Accepted (بموافقة) | H0 | D-OPS-1..5 | لا | ADR معتمد؛ المتتبّع يعكس O1/O3 المدموجة | — (توثيق) |
| **H1-1** O4 Events | `commerce_order_events` + حراس DB (PG/SQLite: لا UPDATE/DELETE/TRUNCATE، تسلسل لكل طلب) + كتابة `order.placed` في معاملة الإتمام و`order.cancelled` في `cancel()` + عرض في تفاصيل الموظف | H1-0 | — | نعم (جدول) | كل إنشاء/إلغاء = حدث واحد ثابت؛ فشل الكتابة يُرجع المعاملة؛ لا PII زائد | حراس DB؛ ذرّية مع الإتمام؛ إلغاء idempotent = حدث واحد؛ عزل؛ PG تزامن إتمام متوازي |
| **H1-2** Domain events + Feed | `CommerceOrderPlaced`/`Transitioned` afterCommit؛ `GET commerce/orders/feed?since=&storefront_id=` (مؤشّر، ≤100، ETag/304) بصلاحية `commerce.orders.view` | H1-1 | — | فهرس | المؤشّر مستقر (لا فقد/تكرار عبر حدود الصفحة)؛ 304 عند عدم التغير؛ مقيَّد المخازن 403 | ترتيب المؤشّر بطوابع متساوية؛ تراجع المعاملة ⇒ لا حدث؛ عزل؛ RBAC |
| **H1-3** Acceptance | حقائق القبول + حراس DB؛ `accept`/`reject` في `CommerceOrderLifecycleService`؛ سبب `merchant_rejected` (تعديل قائمة حارس الإلغاء بهجرة مُشغِّلات فقط)؛ `commerce.orders.manage`؛ `acceptance_mode` يُقرأ من إعداد القناة (غائب ⇒ `auto`)؛ `operational_status` مشتق في مسلسل الموظف | H1-1، H4-3 (أو ثابت `auto` مؤقتاً) | D-OPS-1/2 | نعم | `auto` = سلوك اليوم حرفياً؛ قبول مرة واحدة؛ رفض = إلغاء بالمصفوفة نفسها؛ لا قبول لملغى؛ لا أثر مالي/مخزني | مصفوفة كاملة؛ سباقات PG: قبول↔إلغاء، قبول↔قبول، رفض↔التقاط، رفض↔مكنسة؛ RBAC؛ مسلسلات الجمهور بلا تغيير |
| **H1-4** Staff UI | أزرار قبول/رفض + شارة الحالة التشغيلية + الخط الزمني في `/commerce/orders/[id]`؛ فلتر `operational_status` | H1-3 | — | لا | الأزرار تظهر بـ`*_action` من الخادم فقط (نمط O3b)؛ 409 ⇒ تحديث | vitest (تحميل/خطأ/صلاحية/409)؛ RTL؛ جوال 390px؛ build |

**إغلاق H1:** كل طلب جديد له حدث `order.placed`؛ القبول/الرفض يعمل خلف إعداد القناة بافتراضي `auto`؛ تقارير H1-0..4 + CI أخضر على main.

### COPS-H2 — Fulfillment & Tracking

| Slice | النطاق | يعتمد | قرار | DB | Acceptance Criteria | الاختبارات |
|---|---|---|---|---|---|---|
| **H2-1** Fulfillment core | `commerce_fulfillments` (`CompanyWide`، فريد لكل طلب V1) + `CommerceFulfillmentService` (C.3) + لقطة `warehouse_id` + `POST commerce/orders/{id}/fulfillment/{action}` (`commerce.orders.manage`) + أحداث H1-1 + صف المصفوفة 14 في الإلغاء | H1-3 | D-OPS-4 | نعم | انتقالات محظورة ⇒ 409 برمز؛ replay idempotent؛ لا مخزون/قيد؛ ترتيب أقفال محفوظ | كل حافة مسموحة/محظورة؛ PG: انتقال↔إلغاء، انتقال↔انتقال؛ فحص ساكن: الخدمة لا تذكر `LedgerService/InventoryService/InvoiceService` |
| **H2-2** Warehouse visibility | رفع 403 للمستخدم المقيَّد: تصفية القائمة/التفاصيل/الـfeed بـ`fulfillments.warehouse_id ∈ allowed` (طلب بلا تنفيذ ⇒ مخزن القناة الحالي — قرار) | H2-1 | D-OPS-9b | لا | مقيَّد يرى طلبات مخازنه فقط؛ 404 لغيرها | مصفوفة رؤية؛ عزل |
| **H2-3** Staff fulfillment UI | إجراءات التجهيز/الجاهزية/الإرسال/التسليم/الفشل؛ نموذج الناقل/التتبع/السائق؛ | H2-1 | — | لا | لا منطق حالة في الواجهة | vitest؛ RTL؛ جوال؛ build؛ تحقق بصري |
| **H2-4** Public tracking | كتلة `fulfillment` إضافية في `CommerceOrderSerializer` + OpenAPI؛ `AccountOrderStatus` → `live` | H2-1 | D-OPS-5 | لا | الطلب بلا تنفيذ ⇒ استجابة حرفياً كاليوم؛ لا أسماء موظفين/هاتف سائق إلا بقرار | عقود الجمهور القائمة بلا تعديل؛ OpenAPI؛ storefront vitest (6 لغات) |
| **H2-5** O2 Guest lookup | `GET store/v1/orders/{order}` بمرجع موقَّع، 404 موحَّد، rate limit | H2-4 | — | لا | لا تعداد طلبات؛ مرجع غير صالح = 404 | IDOR؛ throttle؛ عزل مضيف |
| **H2-6** Scheduled queue | فلتر/عرض «مستحق اليوم/غداً» و«ابدأ التحضير قبل» (من `commerce_order_schedules` + وقت التحضير) | H2-3 | — | فهرس | التوقيت بمنطقة سياسة القناة (لا وقت المتصفح) | حدود المنطقة الزمنية |
| **H2-7** Pickup locations (F2) | ADR + `commerce_pickup_locations` مرتبطة بمخزن، اختيار في Checkout | H2-1 | D-OPS-10 | نعم | — | — |
| **H2-8** Carrier adapters | — | — | **ADR-10 قرار الناقل** | — | **مؤجَّل** (V1 = ناقل يدوي في H2-1) | — |

**إغلاق H2:** دورة تنفيذ كاملة للتوصيل المحلي/اليدوي/الاستلام، تتبع حي للعميل، ورفع قيد المستخدم المقيَّد.

### COPS-H3 — Merchant Alerts & Order Reception

| Slice | النطاق | يعتمد | قرار | DB | Acceptance Criteria | الاختبارات |
|---|---|---|---|---|---|---|
| **H3-0** Research+ADR | **بحث خارجي وبصري إلزامي**: WebKit/MDN (Web Push على iOS، Autoplay، Notifications API، Web Locks، BroadcastChannel، Wake Lock، Page Visibility)، تطبيقات تاجر مرجعية (Shopify/Salla/Zid/Foodics/منصات التوصيل) للاستقبال اللوحي؛ ADR-30 لنقل V1 (استطلاع) وخارطة Push | H0 | D-OPS-5/6 | لا | فصل External Evidence / AWJ Decision / Rejected | — |
| **H3-1** In-app producer | `commerce.order_placed` عبر `NotificationService` (مستمع H1-2، afterCommit، لا يرمي)؛ إجراء `view_commerce_order` (خادم + `ACTION_PATHS`)؛ مستلمون = حاملو `commerce.orders.view` (owner/admin + أدوار مخصصة) مع احترام H2-2؛ تركيب الجرس في غلاف التجارة | H1-2 | D-OPS-9 | لا | إشعار واحد لكل (مستلم، طلب)؛ فشل الإشعار لا يُفشل الإتمام؛ الطلب الإلكتروني غير المدفوع لا يُنبَّه حتى `paid` (حسب D-OPS-1b) | dedupe؛ لا مستلم خارج المستأجر؛ استثناء داخل المستمع لا يكسر الإتمام؛ RBAC |
| **H3-2** Sound engine | استخراج `AlertSoundEngine` من `PosSoundManager` **بلا تغيير سلوك POS** (اختبارات POS القائمة بلا تعديل) + أصل صوتي جديد + تكرار حتى الإقرار | — (موازٍ) | — | لا | POS حرفياً؛ مُحقَن قابل للاختبار | vitest للمحرّك؛ أجنحة POS |
| **H3-3** Alert center | `OrderAlertCenter` في غلاف التجارة: استطلاع feed (10–15ث، backoff مخفي/خطأ)، قائد تبويب (Web Locks + BroadcastChannel fallback)، مجموعة «مُعلَن» لكل جهاز، شريط «تفعيل الصوت»، Notification API محلي، تفضيلات الجهاز | H1-2، H3-2 | — | لا | صوت واحد فقط مهما تعددت التبويبات؛ يتوقف عند الإقرار على كل التبويبات خلال دورة استطلاع؛ لا يصدر صوت بلا تفاعل مسبق (يعرض شريطاً) | vitest بمحاكاة تبويبين/قفل/BroadcastChannel؛ اختبار يدوي متعدد الأجهزة موثَّق |
| **H3-4** Acknowledge | `POST commerce/orders/{id}/acknowledge` (حدث `notification.acknowledged`، idempotent) أو اعتبار القبول إقراراً | H1-3 | D-OPS-3 | لا | إقرار من جهاز يُسكت الآخرين | — |
| **H3-5** Reception workspace | `/commerce/orders/live` (C.6) + Wake Lock + ملء الشاشة | H1-4، H2-3، H3-3 | — | لا | يعمل على 768px لوحي و390px؛ RTL؛ لا منطق حالة محلي | vitest؛ **تحقق بصري إلزامي** (لوحي/جوال/فاتح/داكن) |
| **H3-6** Reminders/escalation | `commerce:remind-unaccepted-orders` (5 د، `withoutOverlapping`، dedupe لكل مرحلة) + تصعيد لدور | H1-3، H4-3 | D-OPS-3 | لا | لا تذكير مكرر لنفس المرحلة؛ دقة 5 دقائق معلنة | أمر مجدول؛ dedupe؛ عزل |
| **H3-7** User prefs | `PUT account/preferences` **دمج لا استبدال** + مفاتيح `commerce_alerts` (متاجري، تفعيل) | — | — | لا | الإصلاح لا يمحو مفاتيح قائمة | توافق رجعي للحقول الحالية |
| **H3-8** Web Push + PWA *(مغلق)* | manifest + service worker لـ`web/`، VAPID، `web_push_subscriptions` (مستخدم+جهاز+مستأجر، إبطال عند الخروج/410)، مرسل عبر outbox قناة Push | H3-0، ADR-COMMS D9 | D-OPS-6 | نعم + حزمة composer | بوابة نشر مغلقة؛ لا Push لمستخدم فقد الصلاحية؛ iOS موثّق كحدّ | اشتراك/إبطال؛ عزل؛ RBAC؛ لا PII في الحمولة |

**إغلاق H3:** تنبيه صوتي/مرئي موثوق خلال ≤15 ثانية أثناء فتح أي تبويب، بلا تكرار، مع تذكير مجدول؛ Push موثَّق كقرار (مُنفَّذ خلف بوابة أو مؤجَّل صراحةً).

### COPS-H4 — Store Settings Center

| Slice | النطاق | يعتمد | قرار | DB | Acceptance Criteria | الاختبارات |
|---|---|---|---|---|---|---|
| **H4-1** Settings hub | `/commerce/settings` يجمع الأقسام القائمة (هوية، توصيل، إهداء، حسابات، نطاقات، مخزن) بروابط/تبويبات | — (موازٍ) | — | لا | لا نموذج مكرر؛ صلاحيات كل قسم كما هي | vitest؛ nav؛ build |
| **H4-2** Shipping zones UI | محرر مناطق الشحن فوق API القائم | — (موازٍ) | — | لا | السعر بالهللات في الحفظ، ريال في العرض | vitest؛ build |
| **H4-3** Channel operations settings | `commerce_channel_operation_settings` + `commerce_channel_opening_hours` + خدمة + تدقيق في `sales_channel_setting_events` + API `commerce.channel_settings.manage` + واجهة | H1-0 | D-OPS-1/3/7/8/9 | نعم | غياب الصف = سلوك اليوم؛ تعديل يقفل صف القناة (بروتوكول ADR-19) | افتراضات؛ قفل؛ تدقيق؛ عزل؛ RBAC |
| **H4-4** Checkout enforcement | إيقاف/خارج الساعات/حد أدنى ⇒ رموز `review_required` جديدة؛ `capabilities.accepting_orders` في `GET store/v1/storefront`؛ لافتة المتجر | H4-3 | D-OPS-7/8 | لا | فحص داخل معاملة الإتمام بقفل مشترك على القناة؛ القناة بلا إعداد حرفياً كاليوم | سباق إيقاف↔إتمام PG؛ storefront vitest |
| **H4-5** Tenant commerce settings UI + bugfix | واجهة `sales.commerce_*` (مع احترام البوابات) + إصلاح `Settings::put` للسماح بمسح القيم القابلة للإلغاء (قائمة صريحة) | — | — | لا | لا تغيير لقيمة مخزَّنة دون طلب صريح | اختبار وحدة للمسح؛ توافق |
| **H4-6** Payment methods per channel | مسار + واجهة لـ`PaymentMethodChannelAvailabilityService::setAvailability` | — | — | لا | الافتراضي = `available_online` كما اليوم | RBAC؛ عزل |
| **H4-7** Dead settings | تعليم `/sales-settings/orders` و`/shipping` كغير مؤثرين أو إخفاؤهما (قرار) | — | D-OPS-13 | لا | لا تغيير بيانات | — |

### COPS-H5 — COD, Accounting & Inventory *(كلها مغلقة افتراضياً — محجوبة بقرارات مالية)*

| Slice | النطاق | قرار مانع | ملاحظات إلزامية |
|---|---|---|---|
| **H5-0** ADR محاسبي/ضريبي COD | توقيت الفاتورة (عند التحصيل/التسليم/الشحن)، ZATCA، مصدر الخزينة (T4 policy) | **D-8 + رأي ضريبي** | لا تخمين ضريبي (عقد Commerce #9) |
| **H5-1** CK4 COD reservation | سياسة `none`(افتراضي)/`reserve_on_confirm` عبر `CommerceOrderReservationService` | **D-10** | حجز ≠ حركة؛ تحرير عند الإلغاء موجود |
| **H5-2** COD collection UI | زر «تحصيل» في التفاصيل/الاستقبال | D-OPS-12 | قبل H5-3 يعرض «غير مرحَّل محاسبياً» صراحةً |
| **H5-3** INV1 | فاتورة + سند قبض عند التحصيل/التسليم عبر `InvoiceService`/`PaymentService` (نمط H4-03) + مِرساة | D-8 | جدول القيود في PR؛ PG تزامن؛ لا ترحيل رجعي |
| **H5-4** INV2 | مُشغِّل الفاتورة عند التنفيذ/التسليم (`ON_FULFILLMENT`/`ON_DELIVERY` من ADR-01 §5) | D-8 | يحفظ السياسة على الطلب للتفسير التاريخي |

**جدول القيود المتوقع (مرجعي — لا يُعتمد قبل D-8؛ مطابق لنمط PAY-H4-03 القائم):**

| العملية | مدين | دائن |
|---|---|---|
| فاتورة الطلب | 1130 العملاء (الإجمالي) | 4110 الإيراد (صافي) + 2120 ضريبة المخرجات |
| تكلفة البضاعة | 5110 تكلفة البضاعة | 1140 المخزون |
| تحصيل COD | خزينة النقد المحلولة (T3/T4، لا 1110 مرمَّزاً حين تُفتح البوابة) | 1130 العملاء |

> H1–H4 **لا تُنتج أي قيد** (يُذكر صراحةً في كل PR).

### COPS-H6 — Cancellations, Delivery Failures, Returns & Refunds

| Slice | النطاق | قرار | ملاحظات |
|---|---|---|---|
| **H6-1** O3d | `sales.commerce_unpaid_order_expiry_action` = `keep`(افتراضي)/`cancel` في المكنسة عبر `cancel()` | D-9-A1 | بلا أثر مالي |
| **H6-2** Delivery failure policy | ما بعد `returned_to_store`: إعادة جدولة/إلغاء/مرتجع | D-OPS-4c | يعتمد H2-1 |
| **H6-3** Buyer self-cancel | `before_acceptance` فقط، بسياسة القناة | قرار | عبر `cancel()` بفاعل عميل |
| **H6-4** RT1 ADR | Return ≠ Refund ≠ CreditNote ≠ Exchange | **D-11** | — |
| **H6-5..7** RT2/RT3/RT4 | RMA؛ فتح `PaymentRefundService::partnerIdOf` لنوايا التجارة؛ جسر إشعار دائن/إعادة مخزون مع T5/T6 | D-11 | القيود في PR؛ PG |

### COPS-H7 — Customer Notifications *(محجوب)*
N1 (مزوّد + dispatcher للـoutbox، ADR-COMMS D1–D9) ⇒ N2 تأكيد الطلب ⇒ N3 الشحن/الإلغاء/فشل الدفع — مستهلكين لأحداث H1-2. **قرار D-12.**

### COPS-H8 — Activation & Closure
H8-1 بوابات تفعيل **لكل مستأجر** (allowlist) للإلغاء والقبول اليدوي والتنبيهات (G47) · H8-2 E2E متصفح على Beta staging (موظف + متجر + لوحي) · H8-3 ENV verification (SHAs المنشورة، الهجرات) · H8-4 تقرير إغلاق البرنامج. **Deploy/تفعيل = موافقة منفصلة.**

### E.1 تسلسل التنفيذ المراعي للاعتماديات

```
H0 ─▶ H1-0 ─▶ H1-1 ─▶ H1-2 ─┬─▶ H1-3 ─▶ H1-4 ─▶ H2-1 ─▶ H2-2 ─▶ H2-3 ─▶ H2-4 ─▶ H2-5
                            │              └────────▶ H3-4      └▶ H2-6         └▶ (H6-2)
                            └─▶ H3-1 ─▶ H3-3 ─▶ H3-5 (بعد H1-4 وH2-3) ─▶ H3-6
H4-3 (بعد H1-0) ─▶ H4-4 ;  H4-3 يغذي H1-3 (وضع القبول) وH3-6 (المهلة)
موازية بلا تعارض: H3-2, H4-1, H4-2, H4-5, H4-6, H3-7, H3-0, H6-4(ADR)
محجوبة: H5-* (D-8/D-10)، H6-5..7 (D-11)، H7 (N1/D-12)، H3-8 (D9)، H2-7 (D-OPS-10)، H2-8 (ADR-10)
```

**الأولوية (قيمة × خطر):** 1) H1-0→H1-2 (أساس الكل، خطر منخفض) · 2) H3-1/H3-2/H3-3 (أعلى قيمة تاجر، بلا أثر مالي) · 3) H1-3/H4-3 (القبول) · 4) H2-1→H2-4 (التنفيذ والتتبع) · 5) H3-5/H3-6 · 6) H4-4 · 7) H5/H6 بعد القرارات.

### E.2 التوازي الآمن

| يمكن بالتوازي | السبب |
|---|---|
| H3-2 مع H1-* | واجهة فقط، ملفات منفصلة (`lib/pos-sound.ts` + جديد) |
| H4-1، H4-2، H4-6 مع H1-* | واجهات/مسارات لا تلمس الطلب |
| H4-5 مع أي شيء | `Settings`/طلب تحقق معزول |
| H3-0 وH6-4 (وثائق) | لا كود |
| **ممنوع التوازي** | H1-1/H1-3/H2-1 (كلها تلمس `CommerceOrderLifecycleService` والمسلسل والهجرات) · أي شريحتين بهجرة في الوقت نفسه (ترتيب الطوابع/الحراس) · H2-4 مع H4-4 (كلاهما يمس عقود `store/v1`) |

### E.3 شروط إغلاق كل Horizon

1. كل Slice: PR مدموج، CI أخضر على `main` (php sqlite+pgsql، web، storefront)، تقرير تنفيذ بالحقول §9 (Branch/PR/Base/Head SHA، الأدلة، القرارات، المخاطر، التالي).
2. لا P1/P2 مفتوح.
3. تحديث المتتبّع (`AWJ_STORE_COMMERCE_HORIZON_TRACKER.md`) وCLAUDE.md.
4. **التمييز الصريح:** Merged ≠ Deployed ≠ Env-Verified. الإغلاق الهندسي = Merged + CI؛ إغلاق المنتج = Env-Verified + موافقة المالك.
5. تقرير إغلاق الأفق (§10).

---

## F — Risks

| المجال | الخطر | الاحتمال/الأثر | التخفيف |
|---|---|---|---|
| تكرار | آلة حالة ثانية بجانب DeliveryHub/DeliveryNote | م/ع | ADR-29 يوثّق الحدود؛ لا دمج؛ نمط مشترك فقط |
| تكرار | إعدادات قبول/شحن في `sales_config` الميتة | م/م | H4-7 + الإعداد الجديد على القناة فقط |
| تكرار | عمود حالة دفع/تنفيذ على الطلب | م/ع | مرفوض (C.8)؛ مراجعة ساكنة |
| الحالات | طلب إلكتروني منتهٍ يبقى `confirmed` ويظهر في طابور القبول | ع/م | الطابور يستبعد نية `cancelled`/`pending` (D-OPS-1b)؛ O3d |
| الحالات | قبول بعد إلغاء/إلغاء بعد إرسال | م/ع | قفل Intent→Order→Fulfillment + صف المصفوفة 14 |
| التزامن | جمود بإضافة Fulfillment لترتيب الأقفال | م/ع | لاحقة للترتيب القائم فقط؛ اختبارات PG 40P01 |
| التزامن | مستمع متزامن (sync queue) يُبطئ/يُفشل الإتمام | ع/ع | afterCommit + try/catch + `report()`؛ لا شبكة في المستمع |
| التزامن | إيقاف المتجر أثناء إتمام جارٍ | م/م | قفل مشترك على صف القناة (بروتوكول ADR-19) |
| الصلاحيات | تسرب PII للتنبيه/Push | م/ع | حمولة بلا اسم/هاتف؛ «طلب جديد #CORD-…» فقط |
| الصلاحيات | تنبيه مستخدم مقيَّد بمخزن بطلبات غيره | م/م | H3-1 يستثنيه حتى H2-2 |
| الصلاحيات | `payments.manage` يحصّل COD بلا صلاحية طلب | قائم | ربط التحصيل بـ`commerce.orders.manage` في H5-2 (نمط D-9-R1) |
| العزل | feed يتجاوز `TenantScope` | م/ع | `CommerceOrderEvent::query()` فقط؛ اختبار عبر مستأجرين |
| المخزون | بيع زائد لـCOD (لا حجز) | ع/ع | قائم ومعلن؛ H5-1 بقرار D-10؛ تنبيه نصي للتاجر |
| المخزون | التنفيذ يُفهم كخروج مخزون | م/ع | فحص ساكن في H2-1؛ خروج المخزون فقط عبر INV1/INV2 |
| المحاسبة | «تم التسليم» يُفهم كإيراد/تحصيل | م/ع | واجهة توسم «تشغيلي لا محاسبي» (نمط DeliveryHub) |
| المحاسبة | تحصيل COD نقدي غير مسجَّل | قائم/ع | عرض «غير مرحَّل» حتى INV1 |
| الإشعارات | صوت مكرر عبر تبويبات/أجهزة | ع/م | قائد Web Locks + dedupe خادمي + إقرار |
| الإشعارات | صمت بسبب Autoplay/تبويب نائم/iPhone | ع/ع | شريط تفعيل؛ Wake Lock؛ Push V2؛ توثيق الحد في الواجهة |
| الإشعارات | دقة التذكير 5 دقائق (cron) | مؤكد/م | التكرار الثانوي في المتصفح؛ الدقة معلنة |
| الأداء | استطلاع كثيف من أجهزة كثيرة على Apache prefork | م/م | طلب خفيف + 304 + backoff + فهرس؛ قياس في H3-3 |
| التوافق | تغيير عقد الجمهور | م/ع | كتل إضافية فقط؛ اختبارات العقود القائمة دون تعديل |
| التشغيل | بوابات عالمية لا لكل مستأجر | قائم | H8-1 قبل أول مستأجر حقيقي |
| التوثيق | المتتبّع وADR-28 متأخران | قائم | H1-0 |

---

## G — Owner Decision Gates

| # | القرار | التوصية | يحجب |
|---|---|---|---|
| **D-OPS-1** | نموذج القبول: حقائق على الطلب، أوضاع `auto`(افتراضي)/`manual` لكل قناة | موافقة | H1-3 |
| D-OPS-1b | طلب إلكتروني غير مدفوع: خارج طابور القبول وبلا تنبيه حتى `paid` | موافقة | H1-3، H3-1 |
| **D-OPS-2** | الرفض = إلغاء بسبب `merchant_rejected` (يتطلب توسيع قائمة الحارس في DB) | موافقة | H1-3 |
| **D-OPS-3** | مهلة القبول وإجراؤها: `remind_only` افتراضي؛ `auto_reject` لغير المدفوع فقط اختيارياً؛ التصعيد | موافقة | H3-6، H4-3 |
| **D-OPS-4** | آلة التنفيذ (C.3)، 1:1 في V1، ناقل يدوي، لا أثر مالي | موافقة | H2-1 |
| D-OPS-4b | الإلغاء مسموح حتى `ready` ومحظور من `out_for_delivery` | موافقة | H2-1 |
| D-OPS-4c | سياسة ما بعد فشل التوصيل | لاحقاً | H6-2 |
| **D-OPS-5** | عقد التتبع العلني: كتلة `fulfillment` إضافية بمراحل محدودة؛ إظهار رقم التتبع؛ لا بيانات سائق | موافقة | H2-4 |
| **D-OPS-6** | Web Push: V1 بلا Push (استطلاع + صوت)، Push V2 خلف بوابة بعد ADR-COMMS D9 | موافقة | H3-8 |
| D-OPS-7 | ساعات العمل وسلوك خارجها، والإيقاف المؤقت | موافقة على الإعداد بافتراضي مفتوح | H4-3/4 |
| D-OPS-8 | الحد الأدنى للطلب (لكل قناة؛ يشمل الشحن أم لا) | قرار | H4-4 |
| **D-OPS-9** | من يملك `commerce.orders.manage` ومن يُنبَّه (owner/admin + أدوار مخصصة) | owner/admin عبر `*` فقط، لا منح ضمني | H1-3، H3-1 |
| D-OPS-9b | رؤية المقيَّد بمخزن عبر مخزن التنفيذ | موافقة | H2-2 |
| D-OPS-10 | نموذج نقاط الاستلام | لاحقاً | H2-7 |
| D-OPS-11 | اختيار الناقل/المجمِّع (ADR-10 المفتوح) | لاحقاً | H2-8 |
| D-OPS-12 | عرض «تحصيل COD» قبل INV1 (حالة فقط + تنبيه «غير مرحَّل») | قرار | H5-2 |
| D-OPS-13 | مصير `/sales-settings/orders\|shipping` | إخفاء/وسم | H4-7 |
| قائمة | **D-7** (إسقاط الشحنات المتعددة V1) · **D-8** (COD مالي/ZATCA) · **D-10** (حجز COD) · **D-11** (المرتجعات) · **D-12** (قنوات الإشعار) · **D-9-A1** (O3d) · رفع ADR-28 إلى Accepted · قرار تفعيل الإلغاء Beta | — | H5، H6، H7 |

---

## H — Handoff (للاستئناف دون إعادة استكشاف)

**نقطة البداية التالية:** بعد اعتماد المالك ⇒ **H1-0** (ADR-29 + تحديث المتتبّع) من أحدث `origin/main`.

**اقرأ فقط:**
1. هذه الوثيقة (§C، §E، §G).
2. `docs/plans/store/ADR-28-COMMERCE-ORDER-LIFECYCLE.md` §1.3 (ترتيب الأقفال)، §3 (المصفوفة)، §4.1 (P-1..P-6).
3. `docs/audits/AWJ-COMMERCE-ORDER-CANCELLATION-BETA-READINESS.md` (البوابات، الحد الأدنى للمراجعات).
4. `docs/plans/store/ADR-01`, `ADR-03 §8-9`, `ADR-10`, `ADR-19 §2.3` (بروتوكول قفل القناة).

**ملفات الارتكاز في الكود:**
- الطلب: `app/Models/CommerceOrder.php`, `app/Services/Commerce/{CommerceOrderService,CommerceCheckoutService,CommerceOrderLifecycleService,CommercePaymentIntentService,CommerceOrderReservationService,CommerceOrderPostingService,CommerceUnpaidOrderSweeper,OrderCancellationCleanup}.php`, `app/Support/{CommerceOrderSerializer,CommerceOrderStaffSerializer}.php`, migration `2026_12_13_010000_add_cancellation_facts_to_commerce_orders.php` (نمط الحراس).
- المسارات: `routes/api.php:1181-1204` (موظف)، `routes/api_storefront.php`، `routes/api_commerce.php:127,258-259`.
- نمط مرجعي: `app/Services/DeliveryHub/DeliveryHubOrderService.php`, `web/src/components/delivery-hub/delivery-hub-workspace.tsx`.
- الإشعارات: `app/Services/NotificationService.php`, `app/Support/NotificationActions.php`, `web/src/lib/notifications.ts`, `web/src/components/layout/notification-bell.tsx`.
- الصوت: `web/src/lib/pos-sound.ts`, `web/src/app/(pos)/pos/page.tsx:587-593`.
- الإعدادات: `app/Support/Settings.php` (عيب `put` L490)، `app/Services/Commerce/SalesChannelSettingsService.php`, `app/Services/FuelStationSettingsService.php` (نمط ثلاثي)، `app/Http/Controllers/Api/AccountSettingsController.php:47-58`.
- الواجهة: `web/src/modules/commerce-workspace/{nav.ts,orders/*}`, `web/src/app/(commerce)/layout.tsx`, `web/src/components/commerce-workspace/commerce-workspace-shell.tsx`.
- التتبع: `storefront/src/components/account/AccountOrderStatus.tsx`, `storefront/src/lib/commerce/capabilities.ts:214-246`.
- المجدول: `routes/console.php` (Railway `awj-scheduler` كل 5 د).

**ثوابت لا تُكسر في أي Slice:** لا كتابة في الأستاذ/المخزون من Commerce؛ ترتيب الأقفال `Attempt→Intent→Order→Fulfillment→Reservations`؛ لا شبكة تحت أقفال؛ لا enum جديد في `commerce_orders.status`؛ كتل إضافية فقط في عقود الجمهور؛ كل سلوك جديد خلف إعداد بافتراضي يطابق اليوم أو بوابة نشر مغلقة؛ `commerce.orders.*` لـowner/admin عبر `*` فقط دون زرع ضمني.

**ما لم يُنجز في H0 (يُنقل):** البحث الخارجي والبصري (H3-0 وكل Slice واجهة)؛ التحقق البيئي للحالة المنشورة؛ تشغيل الاختبارات.

---

## I — الملفات والمسارات المفحوصة

**وثائق:** `CLAUDE.md` · `docs/engineering/AWJ_HORIZON_EXECUTION_PROTOCOL.md` · `docs/audits/AWJ-COMMERCE-ORDERS-AUDIT-01.md` · `docs/plans/store/ADR-28-COMMERCE-ORDER-LIFECYCLE.md` · `docs/audits/AWJ-COMMERCE-ORDER-CANCELLATION-BETA-READINESS.md` · `docs/audits/AWJ-COMMERCE-ORDERS-O1a/O1b/O3a-1/O3a-2a/O3a-2b/O3b/O3c-IMPLEMENTATION-REPORT.md` · `docs/plans/store/AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` · `docs/audits/AWJ_STORE_COMMERCE_HORIZON_HANDOFF.md` · `docs/plans/store/ADR-01, ADR-03, ADR-10, ADR-19, ADR-20` · `docs/plans/pos/DLV-HUB-UI-1-IMPLEMENTATION-REPORT.md` · `docs/plans/alerts-notifications/*` · `docs/plans/communications/ADR-COMMS-01-COMMUNICATIONS-PLATFORM-FOUNDATION.md` · `docs/pos-sound-feedback.md`.

**Backend:** `app/Models/{CommerceOrder,CommerceOrderLine,CommerceOrderSnapshot,CommerceOrderSchedule,CommerceOrderPosting,CommercePaymentIntent,CommerceShippingZone,CommerceDelivery*,FulfillmentPolicy,DeliveryHubOrder,DeliveryNote,Notification,SalesChannel,Storefront,User}.php` · `app/Services/Commerce/*` (المذكورة أعلاه + `ShippingRateService`, `FulfillmentPolicyService`, `CommerceDeliveryScheduleService`, `CommerceDeliveryPromiseService`, `SalesChannelSettingsService`) · `app/Services/DeliveryHub/DeliveryHubOrderService.php` · `app/Services/{NotificationService,PaymentRefundService,PaymentAttemptPostingService,FuelStationSettingsService}.php` · `app/Services/Communications/*` · `app/Support/{Settings,BranchSettings,Rbac,ApplicationCatalog,NotificationActions,WebhookEventCatalog,CommercePaymentHold,CommerceInvoiceOnPayment,CommercePartnerPolicy,CommerceOrderSerializer,CommerceOrderStaffSerializer}.php` · `app/Http/Controllers/Api/{CommerceStaffOrderController,CommerceStaffOrderCancellationController,CommercePaymentIntentController,NotificationController,AccountSettingsController,SalesSettingsController,SalesConfigController,CommerceStaffChannelSettingsController,CommerceFulfillmentController}.php` · `app/Events/*` · `routes/{api,api_storefront,api_commerce,console}.php` · `config/{commerce,payments,storefront,treasury,communications}.php` · migrations المذكورة في §A · `Dockerfile` · `deploy/assemble.sh` · `render.yaml`.

**Web:** `web/src/app/(commerce)/**` · `web/src/modules/commerce-workspace/**` · `web/src/components/{layout/notification-bell.tsx,layout/topbar.tsx,commerce-workspace/*,delivery-hub/*}` · `web/src/lib/{pos-sound.ts,notifications.ts,use-can.ts,branch.ts}` · `web/src/app/layout.tsx`.

**Storefront/Mobile:** `storefront/src/components/account/*` · `storefront/src/components/checkout/awj/{Confirmation,AwjCheckoutFlow,PaymentReturn}.tsx` · `storefront/src/lib/commerce/capabilities.ts` · `storefront/src/lib/data/customer.ts` · `storefront/src/lib/emails/*`, `storefront/src/app/api/webhooks/spree/route.ts` (بقايا خاملة) · `mobile/lib/commerce/commerce_client.dart` · `mobile/lib/push/*`.

---

**الحالة:** H0 مكتمل كتدقيق وخطة. **لا تنفيذ، لا فرع، لا PR، لا Merge، لا Deploy.** الخطوة التالية بانتظار اعتماد المالك للخطة وحسم D-OPS-1، D-OPS-4، D-OPS-5، D-OPS-6، D-OPS-9 على الأقل لفتح H1.

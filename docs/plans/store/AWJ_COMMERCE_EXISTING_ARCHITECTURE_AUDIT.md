# AWJ Commerce — Existing Architecture Audit

**Status:** Architecture Inspection — read-only، لا اعتماد implementation
**Date:** 2026-09-09
**Method:** فحص كود فعلي (models/services/migrations/routes/tests) — لا افتراضات، كل استنتاج بدليل file path + symbol.
**Parents:** `AWJ_STORE_MASTER_PLAN.md`, `AWJ_COMMERCE_PLATFORM_RESEARCH.md`, `AWJ_COMMERCE_FEATURE_MATRIX.md`,
`AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`, `AWJ_COMMERCE_CAPABILITY_RESEARCH_02.md`, `AWJ_COMMERCE_CAPABILITY_RESEARCH_03_RETURNS.md`

> **هذا المستند Architecture Inspection فقط.** لا migration، لا تعديل Production code، لا تغيير API، لا refactoring،
> لا PR/Merge/Deploy ناتج عن هذه الجولة. الهدف الوحيد: تحديد ما الذي يمكن لـ AWJ Commerce Core إعادة استخدامه فعلياً،
> وما يحتاج امتداداً، وما هو غائب تماماً — مقابل الكود الحقيقي لا التوثيق أو الافتراض.

---

## 1. Executive Summary

الخلاصة الأهم: **أَوْج أنضج مما افترضته وثائق البحث الست في عدة نقاط جوهرية، وأفقر منها في نقطة واحدة حرجة.**

**أنضج من المفترض:**
- يوجد بالفعل **`CreditNote`** model مستقل تماماً عن `ReturnDocument` — بلا أثر مخزني، مستند مالي بحت. البحث السابق (Research 03 §3.4) افترض أن Credit Note قد لا يكون مفصولاً؛ الكود يثبت عكس ذلك.
- توجد بنية **Outbound Webhooks** ناضجة تماماً: outbox model (`WebhookEvent`)، delivery/retry مع exponential backoff، توقيع HMAC، وحماية SSRF فعلية (حظر نطاقات IP خاصة IPv4/IPv6 صريحاً، إعادة تحقق عند التسليم لتضييق نافذة DNS rebinding). هذا أعمق بكثير من "foundation" عام.
- توجد بنية **Idempotency** حقيقية ومطبَّقة فعلاً في مسارين: Public API (`EnforceApiIdempotency` + `PublicApiIdempotencyKey`) وPOS checkout (`PosCheckoutAttempt` + idempotency_key + request checksum + replay عند التصادم، مع اختبار مخصص).
- توجد بالفعل مساحة صلاحيات **`developer.*`** كاملة (API clients، webhooks، مفاتيح) — ليست فجوة كما افترض البحث، بل ميزة مبنية.
- توجد بالفعل سابقة **API عام مُصفَّى** (`PublicProductResource`, `PublicPartnerResource`, `PublicInvoiceResource`) تُسقط الحقول المحاسبية الحساسة (`avg_cost`, `purchase_price`, `profit_margin`, `cash_account_id`...) — نمط جاهز للاقتداء به عند بناء Mobile API، لا حاجة لاختراعه.

**أفقر من المفترض:**
- **لا يوجد أي مفهوم Reservation/Available-to-Sell على الإطلاق.** لا حجز، لا كمية محجوزة، لا "متاح للبيع" منفصل عن `quantity_on_hand`. وهذا أخطر مما بدا في البحث: **مبيعات نقطة البيع والفواتير اليوم تسمح بالبيع السالب (oversell) دون أي تحقق من توفر المخزون.** أي طبقة Commerce عامة (ويب/موبايل) تحتاج Reservation حقيقياً منذ اليوم الأول، ولا يمكنها الاعتماد على السلوك الحالي.
- **لا يوجد مفهوم Sales Channel على الإطلاق.** أقرب إشارة موجودة هي عمود `invoices.pos_session_id` (NULL = فاتورة عادية، غير NULL = من POS) — وهذا وحده، لا أكثر.
- **لا يوجد Payment Intent/Authorization/Capture ولا أي تكامل بوابة دفع فعلي.** كل دفعة اليوم عملية أحادية المرحلة (draft→posted فوراً).
- **B2B hierarchy غير موجود إطلاقاً** — `Partner` نموذج مسطّح تماماً (سجل واحد = عميل واحد، عنوان واحد مضمّن، لا Contacts منفصلة).

**القاعدة الذهبية التي أثبتها الفحص عبر كل الوحدات دون استثناء:** كل أثر مالي أو مخزني في الكود الحالي — من الفاتورة إلى المرتجع إلى الجرد إلى POS — يمرّ حصراً عبر الخدمات المعتمدة (`LedgerService`, `InvoiceService`, `InventoryService`, `PaymentService`, `ReturnService`, `CreditNoteService`). لم يظهر **ولو مثال واحد** لكتابة مباشرة في `journal_lines`/`stock_movements` متجاوزة لهذه الطبقة. هذا يعني أن AWJ Commerce Core، إذا التزم نفس القاعدة، سيكون توسعاً آمناً لا اختراقاً للمعمار المحاسبي.

---

## 2. Current Architecture (من الكود الفعلي)

```text
Product (flat, no variants)                         Partner (customer/supplier/both, flat, single address)
   ├─ ProductCategory (self-referencing)                 ├─ type: individual|commercial
   ├─ ProductMedia (disk/path/sort_order)                 ├─ default_price_list_id (اقتراح فقط، غير ملزم)
   ├─ UnitTemplate/UnitTemplateUnit (UOM, integer factor) └─ branch_id (BranchShareable، افتراضي مشترك)
   └─ PriceListItem ← PriceList (per-partner via
        Partner.default_price_list_id)

        │ (Quote/Invoice/Purchase lines reference Product+Partner)
        ▼
Quote  [غير محاسبي، "لا يولّد قيوداً"]
  draft → sent → accepted/rejected → converted
        │ QuoteService::convert() → Invoice::create() (draft فقط، لا ترحيل تلقائي)
        ▼
Invoice (draft) ◄──────────────── PosService::checkout()  [POS = نفس Invoice model، لا مستند منفصل]
        │                                  ▲
        │                          DeliveryNote (draft/confirmed/cancelled)
        │                          [توثيق تسليم فقط، "لا ينشئ فاتورة أو حركة مخزون أو قيداً بنفسه"]
        │                          يغذّي DeliveryNoteSalesInvoiceDraftBuilder
        ▼ InvoiceService::post()  [isDraft() guard + lockForUpdate، يمنع الترحيل المزدوج]
Invoice (posted, IMMUTABLE — InvoiceService::update() يرفض تعديل غير draft)
   ├─→ LedgerService::post() → JournalEntry/JournalLine (قيد متوازن)
   ├─→ InventoryService::recordSaleCogs() → StockMovement(out) + COGS بمتوسط التكلفة الحالي
   └─→ ZATCA (QR/UUID/ICV/PIH)
        ▼
Payment (draft→posted, direction=received) — PaymentAllocation (polymorphic → Invoice|Purchase)
   PosService: عدة Payment (tender واحد لكل وسيلة دفع، split payments)
        ▼ PaymentService::post()
JournalEntry (بنك/صندوق ↔ عميل)

── مسارات التصحيح بعد الترحيل (لا تلمس Invoice المرحّلة أبداً) ──

Invoice (posted) ──original_type/id──→ ReturnDocument (draft→posted, type=sales|purchase, restock?)
                                          ├─→ StockMovement(in) @ current avg_cost  [إذا restock=true فقط]
                                          ├─→ JournalEntry (عكس إيراد/ضريبة) + cogs_entry_id
                                          └─→ Payment (direction=paid) — سند صرف عادي، لا نوع "refund" مخصص

Invoice (posted) ──────────────────────→ CreditNote  [مالي بحت، "بلا حركة مخزون"، مستند منفصل تماماً]

Invoice (posted) ──LedgerService::reverse()──→ قيد عكسي  [تصحيح كامل، بلا ReturnDocument]

Invoice (posted, POS only) ──PosExchange (return_id + original_invoice_id + replacement_invoice_id)──→
                                          [سجل ربط تشغيلي فقط، لا قيد بنفسه — الإرجاع والبيع البديل عاديّان]
```

**غياب مؤكَّد (لا توجد أي إشارة في الكود):**
`Reservation` — `SalesOrder` — `SalesChannel` — `PaymentIntent`/`Authorization`/`Capture` — `Company/BusinessLocation/Buyer` (B2B) — `Promotion`/`Coupon` — customer-facing auth/identity — inbound webhook receiver.

### Candidate Commerce Integration Points (استكشافي فقط — ليس قراراً معمارياً)

```text
                    [NEW] SalesChannel (web / mobile / pos / external)
                       │  attribution فقط، بلا سلطة مالية أو مخزنية
                       ▼
   [REUSE] Product ──► [NEW] CommerceListing (publish/SEO/channel visibility)
                       ▼
   [NEW] Cart/Checkout ──يستدعي──► [EXTEND] Central PriceResolver
        (مؤقت، بلا أثر محاسبي)        (غلاف فوق InvoiceService::applyItemsAndTotals
                       │                + PriceListService + PosCustomerPriceListResolver،
                       │                 لا إعادة كتابة لمنطق الضريبة/التقريب القائم)
                       ▼
   [NEW] CommerceOrder ──يتحقق عبر──► [NEW] Inventory Reservation
        (state machine خاصة؛              (On-Hand → Reserved → Committed/Released
         Order ≠ Invoice ≠ Quote)          — الفجوة الأكبر، غير موجودة اليوم إطلاقاً)
                       │
        ┌──────────────┼───────────────────┐
        ▼              ▼                   ▼
  [EXTEND]         [NEW]               [EXTEND]
  DeliveryNote-    Payment Intent/     تعميم PosExchange
  based Fulfillment Capture wrapper    خارج نطاق POS وحده
  /Shipment        (بلا تخزين بيانات        │
  entity           بطاقات)                  ▼
        │              │              [REUSE] ReturnDocument
        │              ▼               + [REUSE] CreditNote
        │         [REUSE] Payment /       (الحدّ المحاسبي القائم، بلا تعديل)
        │         PaymentAllocation
        ▼
  يغذّي [REUSE] Invoice (existing، posted، immutable، ledger+COGS كما هو اليوم دون تغيير)
```

---

## 3. Evidence by Domain

### 3.1 Product Core
- `app/Models/Product.php` (fillable ~L29-64): `sku, barcode, name/name_en, type(good|service), unit, default_sales_unit/default_purchase_unit, category/category_id, brand/brand_id, unit_template_id, reorder_level, supplier_id, sales_account_id, cogs_account_id, min_sale_price, discount/discount_type, profit_margin, tags, internal_notes, sale_price, purchase_price, tax_rate(default 15), track_inventory, quantity_on_hand, avg_cost, is_active`. كل الأموال/الكميات bigint هللات. `SoftDeletes` فقط، لا lifecycle timestamps إضافية.
- **لا variants/options إطلاقاً** — grep شامل لـ `variant|option|attribute` في `app/Models` والـmigrations: صفر نتائج. المنتج صف واحد = SKU واحد.
- UOM: `UnitTemplate` + `UnitTemplateUnit` (`factor` صحيح)، `UnitTemplate::factorFor()`، `HasUnitConversion` trait.
- التصنيفات: `ProductCategory` (self-referencing `parent_id`)، "بلا أثر محاسبي" (docblock).
- الصور: `ProductMedia` (disk/path/original_name/mime_type/size/sort_order) — جدول حقيقي لا حقل رابط فقط.
- **لا فصل بين بيانات المنتج المحاسبية وبيانات عرض المتجر** — لا `is_published`/`seo_*`/`storefront_description` في أي مكان. فجوة حقيقية يجب سدّها بـ `CommerceListing` منفصل، لا بإضافة حقول للـProduct نفسه.
- `App\Support\ProductImportFields` يؤكد صراحة أن `quantity_on_hand`/`avg_cost` "حقائق مشتقة من مستندات وترحيلات، لا من ملف كتالوج" — لا تُستورد أبداً.

### 3.2 Pricing
- `PriceList` + `PriceListItem` (product_id + unit_name + price بالهللات) — موجود وحقيقي.
- تسعير خاص بالعميل: `Partner.default_price_list_id` → لكنه **اقتراح فقط** يُطبَّق عند إنشاء فاتورة جديدة، "لا يعيد تسعير مستند محفوظ" (تعليق الكود نفسه).
- **لا تسعير بالكمية (volume pricing)** — `PriceListItem` يفتقر لأي عتبات كمية.
- الخصومات: `Invoice.discount/adjustment` (رأس)، `InvoiceLine.line_discount` + حماية `min_sale_price_snapshot`/`min_sale_price_override_reason`. **لا Promotion/Coupon model.**
- POS يعيد استخدام نفس المحرك: `PosService` يحقن `InvoiceService` ويستدعي `checkout()` عبره — لا حقول تسعير مستقلة لـPOS.
- العملة: `Tenant.currency` (افتراضي SAR) — لا عمود عملة على مستوى الفاتورة، لا FX.
- الضريبة: منطقها في `InvoiceService::calcTax()`/`extractTax()` (صحيح، نصف-لأعلى)، `Product.tax_rate` % صحيح.
- التقريب: هللات bigint في كل مكان؛ `InvoiceLinePrecision` يحفظ `rounding_remainder_numerator/denominator` كسجل تدقيق للكميات الكسرية بدل تقريب صامت.
- **لا PriceResolver مركزي واحد** — منطق موزّع: `PriceListService::resolve()` + `PosCustomerPriceListResolver` + الحساب الفعلي داخل `InvoiceService::applyItemsAndTotals()` (مكرر جزئياً في `PurchaseService`).

### 3.3 Inventory
- المخازن: `Warehouse` (tenant_id, branch_id nullable="مركزي", code auto-numbered, is_default, is_active). الفروع: `Branch` — علاقة واحد-لأكثر مع Warehouse.
- **لا تفصيل أدق من المخزن** (لا bins/zones) — تأكيد صريح بالفحص.
- الكمية المتاحة: **مزدوجة** — `products.quantity_on_hand` (إجمالي عام) + `product_warehouse_stock` (تفصيل لكل مخزن، مع عمود `revision` للتزامن التفاؤلي).
- **"Available to Sell" منفصل عن On-Hand: غير موجود إطلاقاً.** لا `reserved`/`committed`/`available_quantity` في أي مكان.
- حركات المخزون: `StockMovement` (`type`: `in|out|adjustment` فقط — **لا نوع transfer مخصص**)، `source_type/source_id` polymorphic.
- خصم المخزون عند البيع: `InventoryService::recordSaleCogs(Invoice)` — يُستدعى من `InvoiceService::post()`.
- التحويلات بين المخازن: تُنفَّذ عبر `StockPermit` (`type=transfer`)، لا عبر `StockMovement.type` مباشرة.
- إذون التسليم: `DeliveryNote` — توثيقي بحت، "لا ينشئ بنفسه فاتورة أو حركة مخزون أو قيداً"؛ لا `GoodsReceipt` منفصل — استلام الشراء مدمج في `PurchaseService`/`InventoryService::receiveStock()`.
- الجرد: `Stocktake`/`StocktakeLine` (system_quantity + system_revision للتزامن + counted_quantity + difference_value) — قيد فروق واحد لكل جرد مرحَّل.
- التقييم: متوسط متحرك حصراً — `InventoryService::applyReceipt()` يعيد حساب `avg_cost`؛ عمليات الصرف لا تغيّره أبداً.
- تحويل الوحدات: `UnitConversion::resolve()` — كل حركة تُسجَّل بالوحدة الأساسية عبر `baseQuantity()`.

### 3.4 Inventory Valuation & Returns (منطقة محاسبية حساسة — راجع القسم 5 للتفصيل الكامل)
ملخص سريع (التفصيل في §5): مرتجع المبيعات يُقيَّم بـ**متوسط التكلفة الحالي**، لا تكلفة الحركة الأصلية. يوجد `CreditNote` منفصل تماماً عن `ReturnDocument`. الإرجاع لا يُنشئ حركة مخزون دائماً — يعتمد على علم `restock`.

### 3.5 Sales Lifecycle
راجع §6 للتفصيل الكامل. ملخص: `Quote` (غير محاسبي) → `Invoice` (draft→posted، immutable بعد الترحيل) — **لا `SalesOrder` بينهما إطلاقاً**. `DeliveryNote` مستند تسليم مستقل قبل الفاتورة، بلا أثر مباشر. لا إلغاء لفاتورة مرحَّلة — فقط عكس/مرتجع.

### 3.6 Credit Notes / Returns / Refunds / Exchange
راجع §5 و§6. ثلاثة مفاهيم متمايزة فعلياً في الكود: `ReturnDocument` (سلعي + مالي، restock اختياري)، `CreditNote` (مالي بحت)، `Payment` (نقدي). `PosExchange` موجود لكن **محصور بسياق POS فقط**.

### 3.7 Payments
راجع §7. `Payment` (draft→posted فقط، لا نية/تفويض)، `PaymentAllocation` (polymorphic → Invoice|Purchase)، `PaymentMethod` (CompanyWide، snapshot الاسم على السند). **لا Payment Intent/Authorization/Capture، لا تكامل بوابة دفع واحد.**

### 3.8 POS
راجع §8. لا `PosSale` منفصل — البيع = `Invoice` عادية. Idempotency قوي (`PosCheckoutAttempt` + checksum). **لا تحقق من توفر المخزون قبل البيع.**

### 3.9 Customers / Partners / B2B
راجع §9. `Partner` مسطّح: `type`(customer|supplier|both)، `entity_type`(individual|commercial)، عنوان/جهات اتصال كأعمدة مضمّنة، لا Company/Location/Buyer.

### 3.10 Branch / Warehouse / Channel
- `Branch implements CompanyWide` — الفروع نفسها غير محصورة بفرع (منطقياً). `Warehouse implements CompanyWide` + `branch_id` nullable (مركزي).
- `User::branches()` belongsToMany (تعيين متعدد، فارغ=بلا قيد)؛ `User::warehouses()` belongsToMany؛ `User::employee()` رابط اختياري.
- `PosSession` (`BelongsToBranch`): branch_id + pos_device_id + warehouse_id + opened_by/closed_by + pos_shift_id.
- **"Channel" كمفهوم مبيعات: غير موجود إطلاقاً.** أقرب دليل: `invoices.pos_session_id` (NULL/غير NULL = مصدر الفاتورة). `AWJ_STORE_MASTER_PLAN.md` نفسه (بتاريخ اليوم، "Not started") يقترح بناء هذا المفهوم من الصفر — أرض بكر مؤكَّدة.
- `design-system/foundations/multi-branch-architecture.md`: ثلاث تصنيفات إلزامية لكل `BaseModel` — `BranchScoped` (تشغيلي افتراضي)، `BelongsToBranch` (محاسبي موسوم بلا scope عام، مثل PosSession/سطور القيد)، `CompanyWide` (مشترك: حسابات/فروع/مخازن/مستخدمون). يفرضها `BranchIsolationGuardTest` في CI.

### 3.11 Tenant Isolation
راجع §10. `TenantContext`/`TenantScope`/`BelongsToTenant` ناضجة وتعمل، لكن **كل التحقق من الملكية عبر tenant يعتمد على أن الـglobal scope فعّال — لا تحقق مستقل ثانٍ.**

### 3.12 RBAC
راجع §11. مصفوفة صلاحيات غنية (`products.*`, `invoices.*`, `payments.*`, `pos.*` بتفصيل دقيق، `developer.*`). **لا `inventory_*` namespace منفصل — يُعاد استخدام `products.view`/`products.manage` عمداً.**

### 3.13 Idempotency
راجع §12. بنية حقيقية وموجودة في مسارين (Public API وPOS)، غائبة عن `POST /payments` والفاتورة العادية داخلياً.

### 3.14 Webhooks / Integrations
راجع §13. Outbound ناضج جداً (توقيع + SSRF + retry + outbox). **Inbound (لاستقبال أحداث من سلة/زد/شوبيفاي): غير موجود إطلاقاً.**

### 3.15 Mobile Commerce API Readiness
راجع §14. الـAPI الحالي back-office/staff بالكامل. **لا هوية عميل مستهلك، لا endpoint دخول مستهلك.** الموارد الحالية (`ProductResource` إلخ) تكشف حقولاً محاسبية حساسة — لكن يوجد نمط جاهز (`Public*Resource`) للاقتداء به.

---

## 4. REUSE / EXTEND / NEW Matrix

| Capability | Current AWJ evidence | Classification | Commerce gap | Risk |
|---|---|---|---|---|
| Product master data (SKU/name/type/tax/prices) | `app/Models/Product.php:29-64` | **REUSE** | يحتاج طبقة عرض متجر فوقه | Low |
| Product variants/options | لا يوجد (grep صفر نتائج) | **NEW** | أساسي لأي كتالوج ملابس/خيارات | Medium |
| UOM + التحويل | `UnitTemplate`/`UnitTemplateUnit`, `UnitConversion::resolve()` | **REUSE** | — | Low |
| فئات المنتجات | `ProductCategory.php` | **REUSE** | يحتاج طبقة merchandising/channel visibility فوقها | Low |
| صور/وسائط المنتج | `ProductMedia.php` (sort_order موجود) | **REUSE** | — | Low |
| Store/Commerce Listing (نشر/SEO/وصف تسويقي) | لا يوجد (grep صفر) | **NEW** | يجب أن يكون model منفصل عن Product، لا حقول إضافية عليه | Low |
| Price List الأساسي | `PriceList`/`PriceListItem.php` | **REUSE** | — | Low |
| تسعير خاص بالعميل (ملزم) | `Partner.default_price_list_id` — اقتراح فقط | **EXTEND** | يحتاج ربطاً ملزماً/عقدياً إن احتاجه B2B | Medium |
| تسعير بالكمية (Volume pricing) | لا يوجد | **NEW** | — | Low |
| خصومات (رأس/سطر) | `Invoice.discount`, `InvoiceLine.line_discount` + حراسة `min_sale_price` | **REUSE (foundation)** | لا Promotion/Coupon | Low |
| Promotions/Coupons | لا يوجد | **NEW** | يجب احترام `min_sale_price` الموجود، لا كسره | Medium |
| Central PriceResolver موحّد | منطق موزّع: `InvoiceService::applyItemsAndTotals`, `PriceListService`, `PosCustomerPriceListResolver` | **NEW (كخدمة موحِّدة)، REUSE (كمنطق داخلي)** | غلاف يستدعي المنطق القائم، لا يعيد كتابته | Medium |
| العملة/متعدد العملات | `Tenant.currency` واحد، لا FX | **NEW** (مؤجَّل، خارج V1 محلياً) | — | Low |
| حساب الضريبة | `InvoiceService::calcTax/extractTax` | **REUSE** | — | Low |
| التقريب/الهللات | bigint في كل مكان + `InvoiceLinePrecision` | **REUSE** | — | Low |
| المخازن/الفروع | `Warehouse.php`, `Branch.php` | **REUSE** | — | Low |
| الكمية الموجودة (On-Hand) | `products.quantity_on_hand` + `product_warehouse_stock` | **REUSE** | — | Low |
| **Available-to-Sell / Reservation** | **لا يوجد إطلاقاً** | **NEW — أولوية قصوى** | حرج: لا حجز، لا "متاح للبيع" | **High** |
| حركات المخزون + COGS | `StockMovement`, `InventoryService::recordSaleCogs` | **REUSE** | — | Low |
| التحويلات بين المخازن | `StockPermit(type=transfer)` | **REUSE** | — | Low |
| إذون التسليم (Delivery) | `DeliveryNote.php` (توثيقي، pre-invoice) | **EXTEND** | بذرة محتملة لـShipment/Fulfillment، لا تعدد شحنات/تتبع اليوم | Medium |
| استلام المشتريات | مدمج في `PurchaseService`/`InventoryService::receiveStock()` | **REUSE** | — | Low |
| الجرد (Stocktake) | `Stocktake`/`StocktakeLine.php` | **REUSE** | غير مرتبط مباشرة بالتجارة لكنه يثبت نضج التقييم | Low |
| التقييم (متوسط متحرك) | `InventoryService::applyReceipt()` | **REUSE — لا تُعدَّل أبداً** | يجب أن يبقى AWJ Commerce عميلاً له لا بديلاً | Low (بشرط الالتزام) |
| تقييم مرتجع المبيعات | `ReturnService::postSalesReturn()` — متوسط اليوم، لا تكلفة الحركة الأصلية | **REUSE (سياسة أَوْج المتعمَّدة)** | أي Commerce Return مستقبلي يجب أن يمر عبر هذه الخدمة دون إعادة تفسير | **High إذا التُفّت حولها** |
| Credit Note (منفصل عن Return) | `CreditNote.php` — مالي بحت | **REUSE** | تصحيح لافتراض بحثي سابق أنه غير موجود | Low |
| Quote (مستند ما قبل الفاتورة) | `Quote.php` — غير محاسبي | **REUSE (كمدخل محتمل)** | يفتقر لحالة دفع/تنفيذ مستقلة يحتاجها Commerce Order | Medium |
| Sales Order | لا يوجد — Quote→Invoice مباشرة | **NEW** | فجوة معمارية جوهرية لـ Commerce Order | Medium |
| ترحيل/عدم قابلية تعديل الفاتورة | `InvoiceService::post/update` (immutable) | **REUSE — لا تُمس** | — | Low |
| إلغاء فاتورة مرحَّلة | لا يوجد — فقط عكس/مرتجع | **DO NOT REUSE (غير موجود أصلاً)** | Commerce Order يحتاج إلغاءً *قبل* الفاتورة أصلاً، بلا لمس Invoice | Medium |
| المرتجع (سلعي) | `ReturnDocument`/`ReturnLine` + تحقق مرتجع جزئي/سقف الكمية | **REUSE** | أساس قوي | Low |
| الاسترداد المالي (Refund) | `Payment(direction=paid)` عادي، لا نوع "refund" مخصص | **EXTEND** | غير متماثل مع `SupplierRefund` على جانب المورد | Medium |
| الاستبدال (Exchange) | `PosExchange`/`PosExchangeService` — **محصور بـPOS فقط** | **EXTEND (تعميم)** | يجب تعميمه لا تكراره لخارج POS | Medium |
| المدفوعات (فاتورة/POS) | `Payment`, `PaymentAllocation`, `PaymentMethod` | **REUSE** | — | Low |
| Idempotency للدفع/الفاتورة الداخلية | موجود فقط في Public API وPOS، غائب عن `POST /payments` الداخلي | **EXTEND** | يجب تعميم نمط `PosCheckoutAttempt` | Medium |
| Payment Intent/Authorization/Capture | لا يوجد — أحادي المرحلة فقط | **NEW** | لا تخزين بيانات بطاقة أبداً | Medium-High |
| بوابة دفع إلكتروني | لا يوجد أي تكامل | **NEW** | خارجي بالكامل، عبر adapter | Medium |
| نمط checkout/idempotency في POS | `PosService::checkout()` + `PosCheckoutAttempt` | **REUSE (كنمط، لا كنسخ حرفي)** | POS مبني لسياق موظف واحد، لا مستهلك مجهول | Low إذا اتُّبع كنمط |
| **التحقق من توفر المخزون عند البيع** | **لا يوجد — oversell ممكن اليوم** | **DO NOT REUSE** | يجب بناء تحقق حقيقي مع Reservation، لا وراثة السلوك الحالي | **High** |
| Customer/Partner الأساسي | `Partner.php` مسطّح | **REUSE (كافٍ لـB2C)** | — | Low |
| B2B Company/Location/Buyer | لا يوجد | **NEW** | مؤجَّل عمداً (ADVANCED) حسب البحث السابق | Medium |
| العناوين المتعددة | أعمدة مضمّنة واحدة على Partner | **EXTEND** | Checkout يحتاج شحن/فوترة منفصلين، عناوين متعددة | Medium |
| علاقات الفرع/المخزن/المستخدم | `Branch`, `Warehouse`, `User::branches()/warehouses()` | **REUSE** | — | Low |
| مفهوم Sales Channel | لا يوجد — فقط `invoices.pos_session_id` كإشارة وحيدة | **NEW** | يحتاج تصنيف Branch-isolation صريح (غالباً CompanyWide) | Medium |
| عزل المستأجرين (Tenant Isolation) | `TenantContext/TenantScope/BelongsToTenant` + `BranchIsolationGuardTest` | **REUSE** | نقطة فشل واحدة: تعتمد كلياً على تفعيل الـglobal scope | **High إذا تجووز** |
| نمط التحقق من ملكية FK عبر المستأجرين | `ApiController::assertTenantOwned*`, نمط Product Import V2 | **REUSE (يجب اتّباعه حرفياً)** | أي ربط قناة خارجية مستقبلي يجب أن يمر بنفس النمط | Medium إذا لم يُتَّبع |
| مصفوفة RBAC | `Rbac::MATRIX/PERMISSIONS` غنية (`products.*`, `pos.*`, `developer.*`...) | **EXTEND** | يحتاج namespaces جديدة (`commerce.orders.*` مثلاً) بنفس النمط | Low |
| مساحة صلاحيات Developer/Webhooks | `developer.view/manage` + `ApiClient`/`Webhook*` | **REUSE** | تصحيح لافتراض أنها قد تكون غائبة | Low |
| بنية Outbound Webhooks | `WebhookEndpoint/Event/Delivery`, `WebhookSignature`, `WebhookUrlValidator` | **REUSE** | أساس ممتاز لمزامنة Connected Commerce الصادرة | Low |
| استقبال Webhooks واردة (سلة/زد/إلخ) | لا يوجد إطلاقاً | **NEW** | يجب بناؤه بنفس انضباط التوقيع/الـdedupe، مؤجَّل صراحة | Medium (عند البناء) |
| بنية Idempotency العامة (كنمط) | `PublicApiIdempotencyKey`, `EnforceApiIdempotency`, `PosCheckoutAttempt` | **REUSE (يجب تعميمه)** | — | Low إذا اتُّبع |
| هوية/دخول العميل المستهلك (Mobile) | لا يوجد — Sanctum للموظفين فقط | **NEW** | معزول تماماً عن مصادقة الموظفين | Medium |
| طبقة API عامة آمنة (بلا حقول حساسة) | `PublicProductResource` وأخواتها (لـB2B فقط) | **EXTEND (نمط جاهز، مورد جديد)** | لا يُعاد استخدام Public* الحالية حرفياً — تحتاج موارد مستهلك جديدة بنفس الانضباط | Low إذا اتُّبع النمط، High إذا كُشفت الموارد الداخلية مباشرة |
| إصدار/تحديد معدل الـAPI الداخلي | `routes/api.php` بلا نسخ، throttle ضعيف | **DO NOT REUSE كما هو لـMobile** | `routes/api_public.php` (مُصدَّر، rate-limited) نموذج أفضل | Medium |

---

## 5. Inventory & Valuation Findings

هذه المنطقة الأكثر حساسية محاسبياً في الفحص كله، ونتائجها **تصحّح افتراضاً في `AWJ_COMMERCE_CAPABILITY_RESEARCH_03_RETURNS.md` §3.5** كان يصنّفها "CRITICAL RESEARCH".

1. **مرتجع المبيعات يُقيَّم بمتوسط التكلفة الحالي، لا بتكلفة الحركة الأصلية.** `ReturnService::postSalesReturn()` (`app/Services/Accounting/ReturnService.php:~468`): `$unitCost = $product->avg_cost;` مع تعليق صريح في الكود: **"التكلفة بمتوسط اليوم في الحالتين — هو الأساس الذي خرجت به"**. هذا قرار محاسبي متعمَّد من أَوْج، وليس فجوة نمط Odoo (original-cost-basis) المذكور في البحث. **أي Commerce Return مستقبلي يجب أن يستدعي `ReturnService` كما هو، لا أن يعيد تفسير هذه القاعدة أو يحسب قيمة الإرجاع بمعزل عنها.**
2. **مرتجع المشتريات** يستخدم نفس منطق متوسط التكلفة الحالي (carrying value)، مع فصل صريح عن القيمة التجارية (سعر الشراء الأصلي) — أي فرق بينهما يُرحَّل إلى حساب فروق تقييم مخصص (`5116` / `ACC_PURCHASE_RETURN_VALUATION_VARIANCE`)، لا يُبتلع أو يُهمَل.
3. **سلسلة الإثبات (Provenance) موجودة وكاملة:** `ReturnDocument.original_type/original_id` (MorphTo) → `Invoice`/`Purchase`؛ `ReturnLine.source_line_id` → `InvoiceLine`/`PurchaseLine`؛ `ReturnService::resolveSource()`/`assertWithinSource()` يتحققان من صحة الربط وتناسق الكمية التراكمية. الربط بالمستند الأصلي مؤكَّد؛ الربط المباشر بـ`StockMovement` الأصلي غير مباشر (تُعاد الحركة اشتقاقاً من `unit_factor` للسطر المصدر لا جلباً بمعرّف).
4. **`CreditNote` موجود كمستند مستقل تماماً عن `ReturnDocument`** — `app/Models/CreditNote.php`: "إشعار دائن — مستند مالي للعميل (بلا حركة مخزون)"، و`CreditNoteService` لا يستدعي `InventoryService` إطلاقاً. **هذا يعني أن أَوْج يملك بالفعل ثلاثة مفاهيم متمايزة**: `ReturnDocument` (سلعي + مالي، مع/بلا restock)، `CreditNote` (مالي بحت، مثلاً تصحيحات سعرية)، و`Payment` (نقدي). البحث السابق لم يكن يعلم بوجود هذا الفصل الجاهز.
5. **الإرجاع لا يُنشئ حركة مخزون دائماً.** `ReturnDocument.restock` (nullable boolean) يتحكم في ذلك: إذا `false` — "بلا إرجاع: **لا حركة مخزون إطلاقاً**" (تعليق الكود)، والتكلفة تُرحَّل إلى `inventory_damage_loss` بدل `inventory_asset`. القيمة الافتراضية عند الإغفال تُقرأ من `Settings::get('inventory','restock_sales_returns')` — إعداد قابل للضبط لكل مستأجر، منسجم مع مبدأ "السياسة تُضبط ولا تُفرَض".

---

## 6. Sales / Invoice / Credit Note Boundary

- **لا يوجد `SalesOrder`** بين `Quote` و`Invoice` — الدورة اليوم: `Quote(draft→sent→accepted→converted)` → `Invoice(draft)` عبر `QuoteService::convert()` (بلا ترحيل تلقائي) → `Invoice(posted)` عبر `InvoiceService::post()`. هذا يعني أن **"أين يدخل Commerce Order؟"** له إجابتان محتملتان يجب حسمهما في ADR منفصلة: (أ) طبقة جديدة موازية لـ`Quote` وأغنى منه بحالة دفع/تنفيذ مستقلة، أو (ب) امتداد لـ`Quote` نفسه بحقول إضافية. **هذا الفحص لا يقترح أياً منهما** — فقط يثبت أن كلا الخيارين ممكنان تقنياً دون كسر شيء، لأن `Quote` "غير محاسبي" أصلاً.
- **الفاتورة المرحَّلة immutable فعلاً وبقوة**: `InvoiceService::update()` يرفض أي تعديل على غير `draft` صراحة ("لا يمكن تعديل فاتورة مرحّلة")، والترحيل نفسه محمي بـ `isDraft()` قبل وبعد `lockForUpdate()` لمنع الترحيل المزدوج المتزامن.
- **`DeliveryNote` مستند تسليم مستقل حقاً**: له دورة حياة خاصة (`draft/confirmed/cancelled`)، ولا يُنشئ فاتورة أو حركة مخزون أو قيداً بنفسه — فقط يغذّي `DeliveryNoteSalesInvoiceDraftBuilder` لبناء فاتورة draft لاحقاً. هذا أقرب نمط قائم لما قد يصبح لاحقاً Fulfillment/Shipment entity لـCommerce، **لكنه اليوم مستند واحد بلا تعدد شحنات جزئية**.
- **لا إلغاء لفاتورة مرحَّلة على الإطلاق** — لا `cancel()` في `InvoiceService`/`QuoteService`. التصحيح الوحيد: `LedgerService::reverse()` (قيد عكسي) أو `ReturnDocument` (مرتجع/إشعار دائن). Commerce Order، بالمقابل، **يحتاج إلغاءً حقيقياً قبل إنشاء الفاتورة أصلاً** (مثلاً إلغاء طلب لم يُدفع بعد) — وهذا الإلغاء **يجب ألا يمسّ Invoice إطلاقاً** لأنه ببساطة لن يكون قد أُنشئ.
- **الحد المحاسبي بين Return/Refund/CreditNote/Exchange:**
  - `Return != Refund`: مرتجع جزئي مسموح ومُتحقَّق منه صراحة — `ReturnService::assertWithinSource()` يجمع المرتجعات **المرحَّلة فقط** لكل `source_line_id` ("المسوّدات لا تحجز")، يحسب `remaining = sold - returned`، ويرفض أي كمية تتجاوزه. سعر الوحدة أيضاً مسقوف على سعر البيع الأصلي — لا مجال لاسترداد مُضخَّم.
  - **لا نوع "refund" مخصص على `Payment`** — استرداد مبيعات = `Payment(direction=paid)` عادي. بالمقابل، جانب المورد لديه `SupplierRefundService`/`SupplierRefund` model مخصص — **عدم تماثل** يستحق الانتباه عند تصميم Commerce Refund.
  - **الاستبدال (Exchange) موجود لكن محصور بـPOS فقط**: `PosExchange` سجل ربط تشغيلي غير مالي بنفسه ("لا ينشئ قيداً بنفسه") يربط `return_id` + `original_invoice_id` + `replacement_invoice_id` + `applied_credit_amount`/`cash_refund_amount` — الإرجاع والبيع البديل يبقيان `ReturnDocument`/`Invoice` عاديين. **لا Exchange عام خارج سياق POS.**
  - سلسلة الإثبات الكاملة: `ReturnDocument(original_type/id)` → `Invoice` ← `ReturnLine(source_line_id)` → `InvoiceLine` ← `ReturnDocument(journal_entry_id/cogs_entry_id)` → `JournalEntry` — لا فجوة وُجدت في هذه السلسلة تحديداً.

---

## 7. Payments

- `Payment`: `direction`(received|paid، افتراضي received) — `amount` (bigint هللات) — `status`(draft→posted فقط) — `method`(legacy cash|bank) — `payment_method_id`+`payment_method_name` (**snapshot الاسم مؤكَّد بالكود**، `PaymentService::resolvePaymentSetup()`) — `cash_account_id` — `journal_entry_id`.
- `PaymentAllocation`: `allocatable_type/allocatable_id` (MorphTo → `Invoice`|`Purchase`)، مجموع التخصيصات يساوي مبلغ السند.
- `PaymentMethod` (`CompanyWide`): `settlement_type`(cash|bank)، `cash_bank_account_id`، `is_default`، `available_online`. **تعديل الطريقة لاحقاً مؤكَّد أنه لا يغيّر السند السابق** — الاسم snapshot، مطابق تماماً لما ينصّ عليه CLAUDE.md.
- **POS لا يملك مساراً منفصلاً**: `PosService::checkout()` يستدعي نفس `PaymentService::create()/post()`، مع `tenders[]` array (تعدد وسائل دفع لسلة واحدة — split payments موجود فعلاً في POS، غير موجود بنفس الشكل في الفاتورة العادية).
- **لا نوع lifecycle للدفع أبعد من draft→posted** — لا pending/authorized/failed.
- **Idempotency للدفع**: موجودة قوية في مسارين فقط — `EnforceApiIdempotency` middleware (Public API، `Idempotency-Key` header + claim/replay/conflict عبر قيد فريد DB) و`PosCheckoutAttempt` (POS، `idempotency_key`+`request_checksum`+unique constraint+replay). **غائبة تماماً عن `POST /payments` الداخلي وإنشاء الفاتورة غير-POS.**
- **لا يوجد Payment Intent/Authorization/Capture بأي شكل** — تأكيد صريح: كل دفعة عملية أحادية `draft→posted`.
- **لا تكامل بوابة دفع واحد** — grep شامل لـ gateway/stripe/moyasar/paytabs/hyperpay: صفر نتائج حقيقية (فقط نتائج غير ذات صلة من وحدة محطات الوقود).

---

## 8. POS Reuse Assessment

- **لا `PosSale` model** — بيع POS = `Invoice` عادية بالضبط، بنفس مسار `InvoiceService::post()`/`LedgerService`.
- Cart/Checkout: السلة تبقى في الواجهة الأمامية فقط (`web/src/lib/pos-cart-snapshot.ts` كـsnapshot عميل)، ثم POST واحد نهائي إلى `PosService::checkout()` داخل `DB::transaction()` واحدة ذرية. `PosCheckoutAttempt.cart_id` مجرد مرساة idempotency بعد النجاح، لا سلة محفوظة مسبقاً. `PosHeldSale` ميزة "تعليق بيع" اختيارية منفصلة، ليست المسار الافتراضي.
- التسعير: معاد استخدامه بالكامل عبر `InvoiceService` (لا ازدواج منطق).
- **لا تحقق من توفر المخزون قبل البيع** — `assertProductsAllowedForPos()` يتحقق فقط من أهلية الكتالوج/التسعير/الخصم، لا من الرصيد. **البيع السالب (oversell) ممكن اليوم في POS كما في الفاتورة العادية.** هذه أهم نقطة يجب أن يتنبه لها تصميم Commerce Core: لا يمكن الاعتماد على "الرصيد يمنع البيع الزائد" لأنه غير موجود أصلاً.
- اختيار العميل: `partner_id` مطلوب دائماً، لكن "العميل الافتراضي" (walk-in) هو Partner حقيقي مُهيَّأ في إعدادات POS — لا عميل null/مجهول فعلياً.
- الدفع: تعدد وسائل (`tenders[]`) مدعوم فعلاً.
- **Idempotency ممتاز ومختبَر**: `idempotency_key` + `checksum` على محتوى السلة + قيد فريد في `PosCheckoutAttempt` + إعادة تشغيل (replay) عند تصادم متزامن، مغطّى بـ`tests/Feature/PosCheckoutIdempotencyTest.php`. **هذا هو النمط الجاهز الذي يجب أن يتّبعه أي Commerce checkout مستقبلي حرفياً** — لا إعادة اختراع.
- استعادة الجلسة: `PosSession` = وردية/صندوق فقط (بلا بنود سلة)؛ استعادة سلة فعلية = `PosHeldSale` (خادم) + snapshot جانب العميل — تمييز واضح بين المفهومين يجب الحفاظ عليه في أي تصميم Commerce مستقبلي.

---

## 9. Customer/B2B Readiness

- `Partner`: `type`(customer|supplier|both) و`entity_type`(individual|commercial) — **محوران منفصلان**، وليس عموداً واحداً يخلط بينهما.
- **العنوان أعمدة مضمّنة واحدة** (`address, city, building_no, street, district, postal_code, country`) — **لا نموذج Address منفصل، لا عناوين متعددة** (لا فصل شحن/فوترة، لا multi-ship-to).
- **لا نموذج Contact منفصل** — فقط `email`/`phone`/`mobile` كأعمدة مباشرة.
- شروط الائتمان: `credit_limit` + `credit_period` (كلاهما nullable) — موجودان لكن غير مربوطين بأي منطق حجز/سياسة تلقائية وُجد أثناء الفحص.
- التصنيف: عمود نصي حر + `customer_classification_id`/`supplier_classification_id` (FK إلى `Classification`) — بنية تصنيف حقيقية موجودة.
- ربط قائمة الأسعار: `Partner.default_price_list_id` **اقتراح غير ملزم** فقط (مؤكَّد بتعليق الكود نفسه).
- **B2B hierarchy (Company → Location → Buyer) غير موجود إطلاقاً.** `Partner` مسطّح تماماً: سجل واحد = كيان واحد. هذا يتطابق مع تصنيف "ADVANCED foundation" الذي اعتمده `AWJ_COMMERCE_CAPABILITY_RESEARCH_02.md` §4 مسبقاً — أي **يمكن تأجيله بأمان لما بعد الـpilot** دون أن يمنع إطلاق B2C.
- العزل: `Partner` مصنَّف `BranchScoped` + `implements BranchShareable` بمفتاحي تبديل (`share_customers`/`share_suppliers`)، الافتراضي مشترك بالكامل بين الفروع.

---

## 10. Tenant Isolation

- الآلية: `TenantContext` (singleton بحدود الطلب) + `TenantScope::apply()` (يحقن `WHERE tenant_id = ?`) + `BelongsToTenant::bootBelongsToTenant()` (يسجّل الـglobal scope ويملأ `tenant_id` تلقائياً عند الإنشاء) — تُفعَّل عبر `SetTenant` middleware الذي يرفض إن كان المستخدم بلا tenant أو كان المستأجر غير نشط.
- `BaseModel` (abstract، `HasUuids` + `BelongsToTenant`، UUID PK) — كل نموذج أعمال يجب أن يرثه.
- **الحارس الفعلي**: `tests/Feature/BranchIsolationGuardTest.php` يفحص انعكاسياً كل نموذج غير-abstract من `BaseModel` ويتأكد أنه يعلن بالضبط تصنيفاً واحداً من `BranchScoped`/`BelongsToBranch`/`CompanyWide` — نموذج غير مصنَّف أو متناقض التصنيف **يُفشل CI**.
- **⚠️ نقطة الخطر الجوهرية:** التحقق من ملكية FK عبر المستأجرين (`partner_id`/`product_id` في الفواتير/المشتريات) **يعتمد كلياً على تفعيل الـglobal scope**، لا على تحقق مستقل ثانٍ. `ApiController::assertTenantOwned()`/`assertTenantOwnedAll()` يستخدمان `whereKey($id)->exists()` المعتمد على `TenantScope` نفسه — **وليس** `where('tenant_id', $tenant)` صريحاً وخام. النمط نفسه يتكرر في Product Import V2 (`Product::query()->whereKey($nebraxId)->first()` — معرّف من مستأجر آخر يعود `null` وليس خطأ صريحاً، ومختبَر: `ProductImportV2Test::a_nebrax_id_from_another_tenant_never_resolves`).
  **الأثر على Commerce Core:** أي كود مستقبلي (خصوصاً معالجات webhook واردة أو مهام خلفية) يستعلم دون المرور عبر `SetTenant` بشكل طبيعي **معرَّض لتسريب عبر المستأجرين** إن لم يُفعَّل `TenantContext` يدوياً قبل أي استعلام. هذا يجب أن يكون **HIGH severity gate** في أي ADR لاحق لمعالجة webhooks واردة من قنوات خارجية.
- حدود منصة التشغيل (`PlatformAdministrator`, `/api/platform/*`): مؤكَّدة منفصلة تماماً — لا `tenant_id`، لا تُقبل في مسارات ERP العادية.

---

## 11. RBAC

- `Rbac::MATRIX`/`Rbac::PERMISSIONS` (`app/Support/Rbac.php`) غنية ومفصَّلة: `products.view/manage/view_cost` (**لا `inventory_*` — مُعاد استخدام `products.*` عمداً**، مطابق لما وثّقه CLAUDE.md)، `invoices.view/manage` + `delivery_notes.*`، `payments.view/manage`، `partners.view/manage`، `pos.*` بتفصيل دقيق جداً (variance.approve, audit.*, investigations.*, cctv.bookmark.manage...)، `purchases.*`، `returns.*` + `supplier_refunds.*`.
- **`developer.view`/`developer.manage` موجودان بالفعل** ويغطيان إدارة `ApiClient` وWebhooks بالكامل — **تصحيح لافتراض قد يكون موجوداً في البحث السابق أن هذه مساحة فارغة**؛ هي في الواقع ميزة مبنية وناضجة.
- `EnsurePermission::handle()` → `Rbac::allows($role,$permission)` → `resolve()`: يفحص أولاً جدول `Role` مخصص لكل مستأجر (ميزة hr-users-architecture) وإلا يسقط على `MATRIX` الثابتة.
- **التوصية:** أي namespace جديد لـCommerce (مثل `commerce.orders.view/manage`, `commerce.channels.manage`) يجب أن يتّبع نفس نمط `pos.*`/`developer.*` الدقيق حرفياً، ويبقى متوافقاً مع ميزة الأدوار المخصصة لكل مستأجر — لا حاجة لإنشاء آلية RBAC جديدة.

---

## 12. Idempotency

- **موجود فعلياً وناضج في مسارين محددين:**
  1. Public API (`api/v1`): `PublicApiIdempotencyKey` model + `EnforceApiIdempotency` middleware — يفرض `Idempotency-Key` header على كل الطلبات غير-GET/HEAD، مطالبة ذرية عبر قيد فريد `(tenant_id, api_client_id, key_hash)`، حالات `claimed/in_progress/completed/conflict`، إعادة تشغيل الاستجابة 2xx المخزَّنة، محمي بـsavepoint لبقاء آمن تحت PostgreSQL.
  2. POS: `PosCheckoutAttempt`/`PosReturnAttempt`/`PosExchangeAttempt` — `idempotency_key` + `request_checksum` + قيد فريد DB + إعادة تشغيل عند التصادم.
- حماية ترقيم المستندات: `GeneratesDocumentNumbers::lockNumberingAnchor()` يقفل صف الفرع/المستأجر قبل حساب `max()+1` — يمنع تصادم الترقيم تحت التزامن، لكنه **حماية ترقيم لا حماية إرسال مكرر بحد ذاته**.
- حراسة "هل تمّ التنفيذ مسبقاً؟": `InvoiceService::post()` يفحص `isDraft()` قبل وبعد `lockForUpdate()`؛ `LedgerService::reverse()` يفحص `isPosted()` بنفس النمط قبل وبعد القفل — يمنعان الترحيل/العكس المزدوج المتزامن تحديداً.
- **الفجوة المؤكَّدة**: لا آلية idempotency على `POST /payments` الداخلي ولا على إنشاء الفاتورة غير-POS. **التوصية:** أي Commerce checkout/order/payment/refund mutation يجب أن يتبنى نمط `PosCheckoutAttempt` بالضبط (idempotency key + checksum + جدول محاولات + إعادة تشغيل عند التصادم) — البنية جاهزة للتعميم، لا حاجة لاختراعها من جديد.

---

## 13. Webhooks/Integrations

- **Outbound ناضج جداً بالفعل:**
  - `WebhookEndpoint` (وجهة موقَّعة يملكها المستأجر، مع اختيار أنواع الأحداث)، `WebhookEvent` (outbox دائم، فريد على `(source_type, source_id, type)`)، `WebhookDelivery` (محاولة تسليم لكل زوج حدث/وجهة، فريد على `(webhook_event_id, webhook_endpoint_id)`).
  - `WebhookEmitter` يُصدر الأحداث معاملاتياً (معزول بـsavepoint فلا يكسر فشل كتابة الـwebhook المعاملة التجارية الأصلية).
  - `WebhookDeliveryProcessor` يطالب بالتسليمات المستحقة عبر lease/`lockForUpdate`، يعيد المحاولة بـexponential backoff قابل للضبط، يعمل عبر أمر مجدوَل `webhooks:deliver` (آمن مع `QUEUE_CONNECTION=sync`).
  - **التوقيع**: `WebhookSignature` — HMAC-SHA256 على `{timestamp}.{raw_body}`، مقارنة زمن ثابت.
  - **حماية SSRF حقيقية وعميقة**: `WebhookUrlValidator` — HTTPS فقط، رفض بيانات اعتماد مضمّنة، تحليل الاستضافة إلى IPs وحظر كل نطاقات private/loopback/link-local/CGNAT/ULA/multicast/reserved صراحةً (IPv4 وIPv6 معاً، قوائم CIDR صريحة لا مجرد `FILTER_VALIDATE_IP`)، إعادة تحقق عند وقت التسليم لتضييق نافذة DNS rebinding.
  - طبقة مصادقة مطوّرين منفصلة: `ApiClient` (كيان M2M مستقل، `HasApiTokens` بـtokenable مختلف عن `User`/`PlatformAdministrator`) + `AuthenticateApiClient` middleware + صلاحيات محدودة النطاق (`EnsureApiScope`).
- **Inbound (استقبال أحداث من سلة/زد/شوبيفاي/ووكومرس): غير موجود إطلاقاً.** لا controller/route لاستقبال webhook خارجي في أي مكان — النقطة الوحيدة المشابهة (محطات الوقود) موثَّقة صراحة بأنها "لا اتصال بمزوّد خارجي" ومحاكاة داخلية فقط.
- **التوصية:** بنية outbound الحالية أساس ممتاز لمزامنة Connected Commerce الصادرة (لا حاجة لإعادة بنائها). بناء inbound webhooks مستقبلاً يجب أن يقتبس نفس انضباط التوقيع/الـSSRF/الـdedupe من الجانب الصادر — لكنه سطح جديد بالكامل يحمل ثقة أقل (مصدره خارجي)، ويستحق مراجعة أمنية مستقلة عند تصميمه، ومؤجَّل صراحة حسب خطة البحث.

---

## 14. Mobile API Readiness

- بنية المسارات (`routes/api.php`، 1233 سطراً): مجموعات — عام/بلا مصادقة (تسجيل/دخول بـthrottle محدود)، منصة التشغيل (`EnsurePlatformAdministrator`، منفصلة تماماً)، **موظفي المستأجر الأساسيون** (`auth:sanctum`+`SetTenant`+`SetBranch`+`EnsureActiveSubscription`+صلاحيات لكل مسار+`EnsureApplicationActive`/`EnforcePlanLimit`) وتغطي كل الوحدات، ومطوّرو التكامل (`developer` prefix).
- **`routes/api_public.php` (منفصل، بادئة `api/v1`، مُصدَّر بالفعل):** واجهة M2M B2B — `AuthenticateApiClient` (مفتاح API لا Sanctum) → `PublicApiTenantGuard` → `PublicApiRequestAudit` → `EnforcePublicApiRateLimit` → `EnsureActiveSubscription` → `EnsureApiScope`(+`EnforceApiIdempotency` على الكتابة). **هذه لأنظمة المستأجر الخارجية الخاصة، لا للمتسوقين.**
- **لا هوية/مصادقة عميل مستهلك على الإطلاق** — `AuthController::register()`/`login()` ينشئان/يتحققان فقط من `User` موظف مرتبط بـ`role`/`permissions`/`tenant_id`. **لا `CustomerAuthController`، لا جدول عملاء، لا حارس رمز مستقل للمتسوقين.** هذا يجب بناؤه بالكامل من الصفر، ومعزولاً عن مصادقة الموظفين.
- **الموارد الحالية تكشف حقولاً محاسبية حساسة**: `ProductResource` يكشف `purchase_price, avg_cost, profit_margin, cogs_account_id, sales_account_id, internal_notes, min_sale_price, quantity_on_hand` (غير محمي). بالمثل `PartnerResource`/`InvoiceResource`/`PaymentResource` تكشف `credit_limit/credit_period`, `cash_account_id`, `journal_entry_id`, `cost_center_id`, `salesperson_id`, `collector_employee_id` — كلها بيانات داخلية غير صالحة لواجهة مستهلك.
- **لكن يوجد نمط جاهز للاقتداء به**: `PublicProductResource`/`PublicPartnerResource`/`PublicInvoiceResource` (تُستخدم فقط لواجهة B2B الحالية) **تُسقط بالفعل عمداً** كل هذه الحقول الحساسة — دليل أن الفريق يعرف هذا النمط ويطبّقه، لكن **لم يُبنَ بعد لأي قناة مستهلك**. أي Mobile API resource layer جديد يجب أن يتبع هذا النمط، لا أن يكشف الموارد الداخلية مباشرة، ولا يعيد استخدام موارد B2B الحالية حرفياً (لأن ما يحتاجه المستهلك مثل "التوفر" يختلف عمّا يحتاجه شريك B2B مثل "الكمية بالمخزن").
- كشف مخزون غير مقيَّد: `GET warehouses/{id}/stock` يعيد الرصيد الكامل بمستوى الموقع لأي موظف بصلاحية `products.view` — لا مفهوم "توفر عام" منفصل، يتوافق مع الفجوة الحرجة في §4/§8.
- **الإصدار (versioning) والحد من المعدل (rate limiting)**: الـAPI الداخلي **غير مُصدَّر إطلاقاً** وthrottle ضعيف عليه (فقط تسجيل/دخول/تصدير/ZATCA). `api/v1` (B2B) وحده مُصدَّر ومحدود المعدل فعلياً — نموذج أفضل لتقليده عند بناء Mobile API.
- تأكيد الشكل العام: لا `cart`/`checkout` بمعنى مستهلك في أي مكان — `pos/carts`/`pos/checkout` الموجودة هي مسارات POS تشغيلية للموظف الكاشير محمية بصلاحيات الموظفين، وليست endpoints تسوّق للمستهلك.

---

## 15. Risks

| المخاطرة | الشدة | الدليل/السبب |
|---|---|---|
| Tenant Isolation — نقطة فشل واحدة | **High** | التحقق من ملكية FK يعتمد كلياً على تفعيل `TenantScope`، لا تحقق مستقل ثانٍ (`ApiController::assertTenantOwned*`). أي مسار جديد (خصوصاً webhook وارد/مهمة خلفية) لا يمرّ بـ`SetTenant` بشكل طبيعي معرَّض للتسريب |
| ازدواج خصم المخزون (double deduction) | **Medium-High** | لا Reservation اليوم؛ أي طبقة حجز جديدة يجب ألا تتعارض مع `InventoryService::recordSaleCogs()` القائم عند ترحيل الفاتورة؛ ومع غياب تحقق التوفر في POS/الفاتورة، يمكن أن يتسابق حجز المتجر مع بيع POS على نفس الرصيد الفعلي |
| فواتير مكررة | Low-Medium | الترحيل نفسه محمي جيداً (`isDraft()`+`lockForUpdate`)، لكن **لا idempotency key على إنشاء الفاتورة الداخلية** — يجب استعارة نمط `PosCheckoutAttempt` |
| استرداد مكرر (duplicate refunds) | Medium | لا كيان "refund" مخصص على جانب المبيعات (بعكس `SupplierRefund`)؛ أي مسار استرداد لبوابة دفع لاحقاً (غير متزامن بطبيعته) لا نمط جاهز له اليوم — يجب تصميمه بانضباط idempotency من البداية |
| تقييم مرتجع غير صحيح | Medium (بحكم التصميم لا الخطأ) | متوسط التكلفة الحالي سياسة أَوْج المتعمَّدة؛ الخطر الحقيقي هو أن يعيد Commerce تفسيرها بدل استدعاء `ReturnService` كما هو |
| اتساق الضريبة/القيمة المضافة | Low | محسوبة مركزياً في `InvoiceService`؛ الخطر يرتفع فقط لو حسبت واجهة العرض (storefront) الإجمالي بمعزل عن الخادم |
| حدود ZATCA | Low-Medium | `ZatcaIcvScope` منفصل تماماً عن `GeneratesDocumentNumbers`؛ أي ترقيم قناة تجارية جديد يجب ألا يتقاطع مع تسلسل ICV إطلاقاً |
| سباقات التزامن في الحجز | **High** (لأنه غير موجود بعد) | أي Reservation جديد هو أول مكان ستظهر فيه سباقات تزامن حقيقية — يجب أن يتّبع نمط القفل الموجود بالفعل (`lockForUpdate`, `system_revision` في Stocktake) |
| توفر بائت (stale availability) | Medium | بلا حجز، أي "أضف للسلة" يحسب من `quantity_on_hand` مباشرة، ويصبح بائتاً فور أي طلب متزامن |
| إعادة تشغيل (replay) الدفع/الـwebhook | Low (صادر)، Medium (وارد لاحقاً) | البنية الصادرة محمية جيداً (توقيع+timestamp+قيد فريد+SSRF)؛ الواردة غير موجودة بعد، فالخطر كامن لا فعلي اليوم |
| تسوية عبر القنوات (cross-channel reconciliation) | Medium | لا مفهوم Channel إطلاقاً — لا شيء للتجميع عليه في التقارير المستقبلية |
| التوافق العكسي (backward compatibility) | Low (بشرط الانضباط) | كل خدمة موجودة (Invoice/Payment/Inventory/Return/Ledger) هي نقطة الدخول الوحيدة فعلياً في الكود القائم بأكمله — المخاطرة الوحيدة هي أن يكتب Commerce مستقبلاً مباشرة إلى `journal_lines`/`stock_movements` تحت ضغط الجدولة، وهو ما يمنعه CLAUDE.md صراحة |

---

## 16. Blockers / Unknowns

- **سياسة توقيت الحجز/انتهاء الصلاحية** (Reservation timing/TTL) — قرار سياسة بحت يحتاج ADR قبل أي schema.
- **توجيه التنفيذ متعدد المواقع** (Fulfillment routing) — `DeliveryNote` اليوم مستند واحد بلا شحنات جزئية/متعددة؛ توسيعه أو بناء `Shipment` جديد قرار غير محسوم.
- **مزوّد بوابة الدفع السعودي** — لا كود قائم يُبنى عليه إطلاقاً؛ البحث المتخصص (Research 04 في الطابور) لم يكتمل بعد.
- **هل Commerce Order امتداد لـ`Quote` أم مستند جديد كلياً** — كلا الخيارين ممكن تقنياً (Quote غير محاسبي أصلاً)، لكن هذا الفحص لا يحسم أياً منهما.
- **دورة استرداد غير متزامنة** (Research 03: REQUESTED→PROCESSING→SUCCEEDED/FAILED/REQUIRES_ACTION) — **لا سابقة كود لها إطلاقاً**؛ كل استرداد اليوم متزامن (سند صرف عادي). يجب بناؤها من الصفر عند دمج بوابة دفع فعلية.
- **تعميم اصطلاح `branch_id => null` (مركزي)** المستخدم في Inventory Opening — هل يتعمّم بسلاسة على سياسة موقع مخزون القناة المستقبلية، أم يحتاج جدول ربط صريحاً خاصاً به؟ غير مؤكَّد، يحتاج تحققاً وقت التصميم على مستأجرين حقيقيين متعددي الفروع.
- **هل بنية `api/v1` (B2B) الحالية (`AuthenticateApiClient`, `EnsureApiScope`, rate limiting) صالحة كطبقة نقل لمزامنة Connected Commerce الصادرة (سلة/زد)، أم تحتاج طبقة مصادقة مخصصة للتكامل؟** — مرشّح معقول لإعادة الاستخدام لكن غير مؤكَّد بهذا الفحص لغياب أي كود connector للمقارنة معه.

---

## 17. Recommended Architecture Inputs

هذه مدخلات للـADRs القادمة، **لا قرارات معتمَدة**:

1. **PriceResolver** يجب أن يكون غلافاً فوق `InvoiceService::applyItemsAndTotals`/`PriceListService`/`PosCustomerPriceListResolver`، لا إعادة كتابة لمنطق الضريبة/التقريب/الخصم القائم.
2. **Inventory Reservation هي أعلى أولوية NEW** — يجب أن تتكامل مع `StockMovement`/`ProductWarehouseStock` القائمين دون تكرار منطق `avg_cost`، وأن تُصمَّم بنفس انضباط القفل الموجود في `InvoiceService::post`/`StocktakeLine.system_revision`.
3. **CommerceOrder يجب أن يقع بوضوح قبل/موازياً لـQuote**، ولا يلمس `journal_lines`/`stock_movements` مباشرة أبداً — فقط عبر الخدمات القائمة عند النقطة المعتمَدة (قابلة للضبط حسب وثائق Best-of-Breed).
4. **Returns/Refunds/Exchange/CreditNote**: إعادة استخدام أنماط `ReturnDocument`+`CreditNote`+`PosExchange` القائمة — تعميم `PosExchange` خارج نطاق POS بدل بناء نموذج Commerce موازٍ مستقل.
5. **Idempotency**: تبنّي نمط `PosCheckoutAttempt`/`PublicApiIdempotencyKey` حرفياً لكل mutation حساس في Commerce (checkout/order/payment/refund).
6. **Webhooks**: إعادة استخدام بنية `WebhookEndpoint/Event/Delivery`/التوقيع/SSRF القائمة لمزامنة Connected Commerce الصادرة؛ الواردة تُبنى جديدة لكن بنفس الانضباط الأمني.
7. **SalesChannel مفهوم جديد بالكامل** — يجب تصنيفه صراحةً حسب قواعد `multi-branch-architecture.md` (الأرجح `CompanyWide`، لأنه ليس مفهوماً محلياً لفرع) قبل أي migration.
8. **Mobile Commerce API** يحتاج هوية مستهلك جديدة تماماً + طبقة موارد آمنة جديدة على نمط `Public*Resource` — لا كشف موارد الموظفين مباشرة ولا إعادة استخدام موارد B2B حرفياً.
9. **B2B Company/Location/Buyer مؤجَّل بأمان** — `Partner` كافٍ لـ pilot B2C؛ هذا يتوافق مع تصنيف "ADVANCED foundation" المعتمَد مسبقاً في البحث.
10. **RBAC**: إضافة namespaces جديدة (`commerce.orders.*`, `commerce.channels.*` مثلاً) بنفس نمط `pos.*`/`developer.*` القائم، متوافقة مع ميزة الأدوار المخصصة لكل مستأجر.

---

## 18. Explicit Non-Decisions

هذا الفحص **لا يعتمد ولا يقترح** أياً مما يلي — وأي منها يحتاج ADR مستقلة أو موافقة صريحة قبل أي تنفيذ:

- لا Database schema أو migrations أو API contracts.
- لا نقطة زمنية معتمَدة لإنشاء Sales Invoice من Commerce Order (دفع/تنفيذ/تسليم/سياسة قابلة للضبط).
- لا سياسة توقيت/انتهاء صلاحية للحجز (Reservation).
- لا مزوّد بوابة دفع.
- لا حسم لكون Commerce Order امتداداً لـ`Quote` أم مستنداً منفصلاً كلياً.
- لا تصميم نهائي لـException/Store Credit/Repair.
- لا معمارية موصّل خارجي (Salla/Zid/Shopify/WooCommerce) ولا تصميم inbound webhook فعلي.
- لا اختيار إطار تطبيق الجوال («متجرنا» — Flutter/React Native) — خارج نطاق هذا الفحص بالكامل.
- لا حسم لإعادة استخدام بنية `api/v1` (B2B) الحالية كما هي لـConnected Commerce أو بناء طبقة منفصلة.

---

## 19. Next Step

1. مراجعة صفوان لهذا الفحص أولاً — هو المدخل الفعلي (لا البحث الخارجي وحده) لبوابة **Gate B** المذكورة في `AWJ_COMMERCE_FEATURE_MATRIX.md` §11.
2. كتابة الـADRs بالترتيب المقترح التالي، كل منها مبني على أدلة هذا الفحص لا افتراضات خارجية:
   - **ADR 1** — حدود Commerce Order مقابل Sales Invoice (مبنية الآن على دليل Quote/Invoice/DeliveryNote الفعلي أعلاه).
   - **ADR 2** — دلالات Inventory Reservation/Commit/Release (أكبر بند NEW وُجد في هذا الفحص).
   - **ADR 3** — تخصيص Channel↔Warehouse/Location.
   - **ADR 4** — دورة حياة Payment Intent/Attempt/Refund (مبنية على التأكد من غياب أي مفهوم ثنائي المرحلة اليوم).
   - **ADR 5** — حدود مصادقة العميل/الجوال المستهلك.
3. **لا كود إنتاج، لا migration، لا PR تنفيذي** حتى اعتماد هذا الفحص والـADRs الناتجة عنه صراحةً، حسب قاعدة العمل المثبَّتة في `AWJ_STORE_MASTER_PLAN.md`.

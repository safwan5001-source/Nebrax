# AWJ Commerce — Capability Research 02

**Status:** Research / architecture input — no implementation approval
**Date:** 2026-09-09
**Parent:** `AWJ_STORE_MASTER_PLAN.md`
**Companions:** `AWJ_COMMERCE_PLATFORM_RESEARCH.md`, `AWJ_COMMERCE_FEATURE_MATRIX.md`, `AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`

## 1. Purpose

استمرار البحث بمنهج **Best-of-Breed + Policy-Driven Commerce**: لا نختار منصة واحدة لتقليدها، بل نفكك التجارة إلى capabilities ونستخرج أفضل الأنماط والبدائل، ثم نصنف اتجاه أَوْج إلى ADOPT / CONFIGURABLE / ADVANCED / REJECT / RESEARCH.

هذه الجولة تركز على Pricing & Promotions، B2B/B2C identity/catalogs، multi-location fulfillment، abandoned carts، والحدود التي يجب تثبيتها في Commerce Core قبل تصميم API أو DB schema.

## 2. Pricing is a resolver, not one price field

البحث في Odoo وShopify B2B يؤكد أن السعر الفعلي قد يعتمد على أكثر من بُعد: القناة/الموقع، العميل، الشركة/فرع الشركة، العملة، الكمية، الفترة الزمنية، وقائمة الأسعار أو catalog المخصص.

### AWJ direction — ADOPT

نحتاج `PriceResolver` مركزيًا في Commerce Core، يعيد نتيجة قابلة للتدقيق لا مجرد رقم:

```text
PriceContext
  tenant
  channel
  customer / company account
  location / market
  product / variant
  quantity
  currency
  timestamp

        ↓

ResolvedPrice
  base_price
  applied_price_list/catalog
  adjustments
  discount_candidates
  tax_display_context
  final_unit_price
  provenance
```

لا يسمح للـStorefront أو Mobile App بإعادة اختراع حساب السعر.

### Policy candidates

- `ChannelPricingPolicy`: inherit ERP price list / channel-specific price list.
- `CustomerPricingPolicy`: public / customer / company-location pricing.
- `VolumePricingPolicy`: disabled / quantity breaks.
- `TaxDisplayPolicy`: tax-inclusive / tax-exclusive حسب القناة والسوق، مع بقاء حساب الضريبة نفسه ضمن Tax Core المعتمد.

**مهم:** لا يعني هذا اعتماد precedence نهائي الآن. يجب فحص Price Lists/Tax Core الحالي في أَوْج أولًا.

## 3. Promotions need classes and combination rules

Shopify يفصل الخصومات إلى Product / Order / Shipping ويعرّف قواعد الجمع بينها وترتيب التطبيق. Odoo يفرق بين structured pricelists وبين promotions/discount/loyalty programs، ويدعم coupon, Buy X Get Y, next-order coupon, loyalty وغيرها.

### AWJ direction — ADOPT foundation, staged features

لا نبني `discount_percent` وحيدًا على Order كحل Commerce.

نحتاج مفهومًا عامًا محدودًا مثل:

```text
Promotion
  eligibility
  benefit
  scope: line | order | shipping
  activation: automatic | code | reward
  validity window
  usage limits
  audience/channel constraints
  combinability class
```

ثم `PromotionEvaluation` يحفظ ما طُبق ولماذا.

### V1

- Coupon code.
- Automatic order/line discount basic.
- Free shipping promotion basic.
- Explicit combination policy.
- Snapshot applied promotions on order.

### Advanced

- Buy X Get Y.
- Loyalty points/rewards.
- Gift cards/store credit.
- Next-order coupons.
- Complex campaign segmentation.

### REJECT for V1

Generic expression/rules engine مفتوح يسمح ببناء شروط اعتباطية. نبدأ بtyped conditions/rewards ونوسعها فقط مع use cases مثبتة.

## 4. B2C and B2B should share Commerce Core, not be forced into one checkout mode

Odoo يسمح بسياسات checkout مختلفة: guest اختياري/مسموح/ممنوع، ومتجر مقيد للمستخدمين المسجلين، ويذكر استخدام إعدادات مختلفة لـB2C وB2B. Shopify B2B يضيف نموذج Company → Company Location → Buyer/Customer، مع catalog/pricing/payment/shipping/tax settings حسب موقع الشركة.

### AWJ direction — CONFIGURABLE + ADVANCED foundation

`Customer` وحده لا يكفي كتصور طويل المدى لكل B2B commerce.

نحتاج أثناء فحص أَوْج تحديد إمكانية تمثيل:

```text
Business Account / Company
  ├── Business Location / Buying Account
  │     ├── billing/shipping identity
  │     ├── tax identity
  │     ├── payment terms
  │     ├── price/catalog assignment
  │     └── delivery constraints
  └── Buyers / Contacts
```

لا نعتمد أسماء الجداول قبل فحص Partner/Customer model الحالي.

### Checkout identity policy

- `GUEST_ALLOWED`
- `ACCOUNT_OPTIONAL`
- `ACCOUNT_REQUIRED`
- `B2B_INVITED_OR_APPROVED_ONLY` — advanced

### Key requirement

المتجر أو التطبيق يستطيع خدمة B2C وB2B، لكن لا نفرض نفس catalog أو الأسعار أو payment terms أو صلاحيات الشراء على الاثنين.

## 5. Catalog visibility is separate from product existence

Shopify B2B catalogs تتحكم في المنتجات والأسعار التي يمكن لشركة/موقع شركة الوصول إليها. Odoo يدعم pricelists/customer access ومواقع B2B/B2C مختلفة.

### AWJ direction — ADOPT

`CommerceListing` يجب ألا يكون فقط `is_published=true`.

يجب أن يسمح النموذج تدريجيًا بـ:

- channel visibility;
- audience visibility (public/B2B/segment);
- availability window;
- merchandising metadata;
- optional catalog assignment;
- variant-level sellability where required.

لكن Product Core يبقى مصدر هوية المنتج، SKU/UOM/inventory semantics الأساسية.

## 6. Multi-location fulfillment needs a routing policy

Shopify يدير inventory مستقلًا لكل location، ثم يوجه الطلبات بحسب inventory availability وorder-routing configuration. إذا لم يستطع موقع واحد تنفيذ كامل الطلب، يمكن أن ينقسم التنفيذ بين مواقع متعددة أو تُطبق سياسة أخرى. هذا يكمل ما وجدناه في Zid عن channel ↔ warehouse/location.

### AWJ direction — CONFIGURABLE

نحتاج فصل:

```text
Inventory Availability
        ↓
Fulfillment Routing
        ↓
Allocation(s)
        ↓
Shipment/Fulfillment(s)
```

ولا نضع `warehouse_id` وحيدًا على Order ونعتبر المشكلة محلولة.

### Policy candidates

`FulfillmentRoutingPolicy`:

- `SINGLE_CONFIGURED_LOCATION`
- `PRIORITY_LOCATION`
- `BEST_SINGLE_LOCATION`
- `SPLIT_ALLOWED` — advanced
- `MANUAL_ASSIGNMENT`

مع قيود تمنع overselling غير المقصود وتحافظ على Reservation invariants.

### V1 recommendation

يدعم الـdomain تعدد allocations، لكن واجهة Pilot تبدأ بسياسة بسيطة (`SINGLE_CONFIGURED_LOCATION` أو `PRIORITY_LOCATION`) ما لم يثبت مشروع «متجرنا» حاجة فعلية للتقسيم.

## 7. Abandoned cart is useful, but Cart must not become an accounting document

Odoo يحتفظ بعربة/quotation غير مكتملة ويمكن إرسال reminder بعد مدة إذا كانت بيانات العميل متوفرة.

### AWJ direction — ADOPT foundation / ADVANCED engagement

- Cart كيان Commerce مؤقت/قابل للاستعادة.
- Cart لا ينشئ invoice أو accounting impact.
- Cart يمكن أن يصبح identifiable بعد login أو إدخال بيانات الاتصال.
- Cart expiration/cleanup policy مطلوبة.
- Abandoned-cart analytics useful.
- Email/SMS/push recovery campaigns **Later**، وليس شرطًا لإطلاق Commerce Core.

هذا مهم لتطبيق «متجرنا»: يمكن لاحقًا استخدام push notification لاستعادة السلة دون تغيير Order Core.

## 8. Omnichannel promotion and loyalty — architecture implication

Odoo يستخدم discount/loyalty programs عبر Sales/eCommerce/POS. هذا pattern مهم لأَوْج: إذا أضفنا loyalty لاحقًا، لا ينبغي أن يكون خاصًا بالويب بينما POS والتطبيق يملكان أرصدة منفصلة.

### AWJ direction — ADVANCED but shared-core

أي Loyalty/Store Credit/Gift Card مستقبلية يجب أن تكون channel-agnostic في الـcore، مع channel eligibility policy، حتى يمكن للعميل — حسب سياسة المنشأة — الكسب أو الاسترداد عبر Web Store / Mobile / POS.

لا ننفذها في V1، لكن نتجنب schema/API decisions تمنعها.

## 9. Updated capability decision table

| Capability | Decision | V1 stance | Why |
|---|---|---|---|
| Central price resolution | ADOPT | Foundation/V1 | يمنع اختلاف السعر بين Web/Mobile/POS |
| Channel-specific pricing | CONFIGURABLE | Foundation | حالات تجارة متعددة |
| Customer/B2B pricing | CONFIGURABLE | Foundation, UI later as needed | B2B requirement |
| Volume pricing | ADVANCED | Contract-aware | wholesale/B2B |
| Tax display included/excluded | CONFIGURABLE | Research with Tax Core | B2B/B2C/market needs |
| Coupon | ADOPT | V1 | basic commerce |
| Automatic promotion | ADOPT | V1 basic | conversion/marketing |
| Discount classes | ADOPT | Foundation | line/order/shipping separation |
| Discount combinability | CONFIGURABLE | V1 simple | deterministic totals |
| Buy X Get Y | ADVANCED | Later | promotion depth |
| Loyalty | ADVANCED | Later/shared-core | omnichannel |
| Gift card/store credit | ADVANCED | Later | requires financial boundary design |
| Guest checkout | CONFIGURABLE | V1 candidate | B2C conversion |
| Required account | CONFIGURABLE | V1 | B2B/private store |
| B2B company/location/buyer | ADVANCED foundation | inspect current Customer model first | wholesale architecture |
| Audience/catalog visibility | ADOPT | Foundation | public/B2B/channel catalog separation |
| Multi-location routing | CONFIGURABLE | Foundation, simple V1 policy | inventory correctness |
| Split fulfillment | ADVANCED | Domain-ready, UI later | scale/multiwarehouse |
| Abandoned cart | ADOPT foundation | Persist/analytics; campaigns later | mobile/web recovery |
| Cross-channel loyalty | ADVANCED | Later | avoids siloed rewards |

## 10. Invariants strengthened by this research

1. **Pricing determinism:** نفس PriceContext ونفس policy/config version يجب أن يعطي نتيجة قابلة للتفسير والتدقيق.
2. **Order snapshot:** بعد قبول الطلب، تحفظ الأسعار والخصومات والضرائب والرسوم المطبقة كsnapshot؛ تغيّر price list لاحقًا لا يعيد كتابة الطلب التاريخي.
3. **Promotion auditability:** يجب معرفة promotion/code/rule التي خفضت كل مبلغ.
4. **No storefront math authority:** Web/Mobile يعرضان totals المحسوبة من Commerce Core، ولا يصبحان مصدر الحقيقة للحساب.
5. **Allocation integrity:** مجموع الكميات allocated/reserved لا يتجاوز السياسة المسموحة للمخزون.
6. **B2B identity isolation:** buyer لا يستطيع رؤية catalog/price/company location غير المصرح بها.
7. **Tenant isolation:** كل Commerce resource/configuration/event scoped صراحة للـtenant؛ external identifiers لا تستخدم وحدها لاسترجاع كيان.
8. **Accounting boundary:** coupons/promotions/store credit لا تُترجم إلى GL behavior عشوائيًا؛ accounting mapping قرار مستقل ومختبر.

## 11. What this means for «متجرنا» Pilot

المشروع التجريبي يجب أن يستهلك نفس contracts العامة التي سيستهلكها أي AWJ Store أو Mobile client لاحقًا.

لكن لا نحمّل Pilot بكل advanced capability. المسار المبدئي الأنسب:

- B2C public catalog.
- guest/account policy قابلة للضبط.
- centralized prices/taxes/totals.
- coupon + basic promotion.
- inventory availability + reservation.
- configured/priority fulfillment location.
- order/payment/fulfillment separated.
- mobile account/orders/tracking.
- push notification integration لاحقًا فوق events.

إذا احتاج «متجرنا» B2B، multi-location split، loyalty، gift cards أو wholesale pricing، تُفعّل فوق الـfoundation بدل fork خاص بالتطبيق.

## 12. Next research gates

### Research 03 — Returns / Refunds / Exchanges / Store Credit

نحتاج مقارنة lifecycle والمخزون والدفع والمستندات المالية، مع عناية خاصة بعدم الخلط بين operational return وCredit Note/accounting.

### Research 04 — Saudi payments / shipping / VAT / ZATCA boundary

بحث رسمي من المصادر السعودية ومزودي الدفع/الشحن المناسبين، مع فصل compliance عن UX.

### Gate A — AWJ Repository Inspection

بعد إغلاق Research 03/04 بالقدر الكافي، نفحص Product/UOM/Inventory/Price Lists/Tax/Customers/Invoices/Payments/POS/Webhooks/Tenant scoping في أَوْج ونصنف كل capability إلى:

- **REUSE**
- **EXTEND**
- **NEW**

لا DB schema ولا API contract نهائي قبل هذا الفحص.

## 13. Implementation status

- Production code: unchanged.
- Database/API: unchanged.
- PR: none.
- Merge/deploy: none.
- This document records research decisions only.

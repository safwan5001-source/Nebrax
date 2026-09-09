# AWJ Commerce Platform — Research & Architecture Direction

**Status:** Active discovery — no implementation
**Date:** 2026-09-09
**Parent:** `docs/plans/store/AWJ_STORE_MASTER_PLAN.md`
**Pilot client:** مشروع «متجرنا» Mobile App

## 1. قرار الرؤية الجديد

بعد ربط فكرة AWJ Store بمشروع «متجرنا» المستقل، لم يعد الهدف المناسب هو بناء Storefront ويب داخل أَوْج فقط.

الاتجاه الذي ستُبنى عليه الدراسة هو:

> **AWJ Commerce Core** طبقة تجارة متعددة القنوات داخل أَوْج، API-first وchannel-agnostic، تستطيع تشغيل AWJ Web Store وتطبيقات جوال مستقلة وAWJ POS، واستقبال/مزامنة قنوات خارجية لاحقًا.

مشروع «متجرنا» سيكون **Reference/Pilot Client** حقيقيًا لـMobile Commerce API، وليس منطقًا خاصًا مزروعًا داخل Core.

## 2. الحدود المعمارية المقترحة

```text
                         AWJ ERP
                            │
      ┌─────────────────────┼─────────────────────┐
      │                     │                     │
   Products              Inventory             Customers
      │                     │                     │
      └────────────── AWJ Commerce Core ──────────┘
                            │
             ┌──────────────┼──────────────┐
             │              │              │
          Pricing         Orders        Payments
             │              │              │
             └──── Fulfillment / Returns ──┘
                            │
                       Sales Channels
        ┌───────────────────┼────────────────────┐
        │                   │                    │
 AWJ Web Store         Mobile Commerce          AWJ POS
                            API
                             │
                      «متجرنا» Mobile App
                       iOS + Android
                             │
        External channels later: Salla / Zid / Shopify / WooCommerce
```

## 3. قاعدة الفصل

### ما يبقى في AWJ Commerce Core
- Cart/Checkout contracts العامة.
- Order lifecycle.
- Pricing/tax resolution contracts.
- Inventory availability/reservation integration.
- Payment intents/status integration دون تخزين بيانات بطاقات حساسة.
- Fulfillment/shipping contracts.
- Returns/refunds orchestration.
- Channel attribution.
- Idempotency/audit trail.
- Customer/account linkage.
- Events/Webhooks contracts.

### ما يبقى في قناة «متجرنا»
- UI/UX وهوية التطبيق.
- Home feed وترتيب الأقسام الخاص بالمشروع.
- merchandising خاص بالمشروع إذا لم يكن عامًا لكل tenants.
- push-notification presentation.
- deep-link navigation.
- app analytics presentation.
- أي تجربة تسويقية خاصة لا تمثل قاعدة تجارة عامة.

**ممنوع:** تخصيص Commerce Core حول احتياجات «متجرنا» بطريقة تكسر عموميته أو Multi-tenancy.

## 4. نتيجة البحث الأولي — Daftra

المصادر الرسمية التي تمت مراجعتها تؤكد أن دفترة لديه متجر إلكتروني مدمج يستخدم نفس كيانات النظام التشغيلية بدل بناء catalog مستقل تمامًا:

- المنتج يُدار من `المخزون > المنتجات والخدمات`، ويُنشَر للمتجر عبر خيار **متاح أونلاين**، مع خيار **منتج مميز**.
- بيانات المنتج نفسها تشمل التسعير والضريبة وإدارة المخزون.
- المنتج يدعم عدة صور، مع تعيين صورة رئيسية تظهر في المتجر.
- تصنيفات المنتجات نفسها يمكن أن تحمل صورًا وتظهر في POS والمتجر الإلكتروني.
- المتجر يدعم قالبًا قابلًا للعرض التجريبي والتطبيق.
- يمكن تخصيص الصفحات الافتراضية مثل الرئيسية وتسجيل الدخول وعرض الأصناف وتأكيد الطلب.
- توجد إدارة صفحات محتوى وعناصر قائمة ومعرض صور للواجهة.
- وسائل الدفع المفعلة تظهر للعميل في تأكيد الشراء، وتشمل وفق التوثيق الدفع النقدي/الإلكتروني/COD حسب إعداد الحساب.
- خيارات الشحن تأتي من إعدادات المبيعات وتظهر في checkout، وتضاف تكلفة الشحن إلى إجمالي الطلب.

### الدرس لأَوْج
النمط الجيد هنا هو **إعادة استخدام Product/Inventory/Payment/Shipping Core** وعدم إنشاء نسخة ثانية من المنتج داخل المتجر. لكن أَوْج يحتاج طبقة Publication/Merchandising مستقلة للحقول التسويقية حتى لا نحمّل الكيان المحاسبي تفاصيل storefront الخاصة بكل قناة.

### Daftra + Salla
توثيق سلة الحالي لربط دفترة يوضح نقاطًا مهمة للقنوات الخارجية:

- مزامنة المنتجات والتصنيفات والـVariants والمنتجات المجمعة قابلة للتحكم.
- يمكن اختيار اتجاه المزامنة أو تعطيل التحديثات التلقائية.
- توجد إعادة محاولة للفواتير الفاشلة.
- هناك تمييز للموقع/المتجر المرتبط لمنع الالتباس عند تعدد المتاجر.
- الطلبات يمكن ترحيلها تلقائيًا عند حالة معينة أو يدويًا.
- السجل يعرض حالة الترحيل والفشل.
- الطلب المرحّل سابقًا لا ينبغي ترحيله تلقائيًا مرة ثانية بعد إعادة الربط.

المصدر نفسه ينبه إلى أن مزامنة المخزون ليست تلقائية في ذلك الربط تحديدًا. هذا مهم: لا نفترض أن مجرد وجود integration يعني وجود inventory truth موحد.

### الدرس لأَوْج
Connected Commerce يحتاج من البداية:

- external channel/store identity.
- external IDs mapping.
- direction policy لكل resource.
- idempotency keys / deduplication.
- sync attempts + failure reason + retry.
- reconciliation view.
- explicit inventory ownership/source-of-truth policy.

## 5. نتيجة البحث الأولي — Odoo

توثيق Odoo 19 يوضح دورة eCommerce صريحة:

```text
Quotation / Cart
   ↓ checkout
Quotation Sent / unpaid
   ↓ payment confirmation
Sales Order
   ↓
Delivery Order
   ↓
Invoice
```

النقاط المهمة:

- إضافة المنتج للسلة تبدأ كQuotation.
- checkout مع دفع غير مؤكد يبقي الطلب غير مؤكد.
- الدفع المؤكد يحول الدورة إلى Sales Order في التدفق المعتاد.
- Delivery Order ينشأ بعد تأكيد Sales Order للمنتجات التي تحتاج شحنًا.
- يمكن ضبط حجز المخزون عند التأكيد.
- الدفع البنكي مثال على مسار لا يُحجز فيه المخزون حتى استلام الدفع والتأكيد اليدوي وفق الإعداد الموثق.
- الفاتورة يمكن إنشاؤها يدويًا أو تلقائيًا، والتوثيق يوضح اختلاف سياسة الفوترة حسب الدفع/التسليم.
- Odoo يدعم returns/refunds وabandoned carts.

### الدرس لأَوْج
أقوى درس ليس أسماء حالات Odoo بل **فصل المستندات والمراحل**. يجب ألا يكون Store Order مرادفًا لفاتورة مبيعات، ويجب أن تكون نقطة reservation/invoice قابلة للتعريف بوضوح حسب سياسة القناة والدفع.

## 6. نتيجة البحث الأولي — Shopify

توثيق Shopify Admin API الحالي يقدم `Order` كمحور دورة الشراء ويربط داخله/حوله بيانات العميل والمنتجات والدفع والـfulfillment والreturns/refunds، مع فصل واضح للحالات.

نقاط مهمة للدراسة:

- financial status مستقل عن fulfillment status.
- Order يحمل channel/publication attribution.
- يمكن وجود عدة fulfillments لطلب واحد، مثل الشحن الجزئي أو من مواقع مختلفة.
- fulfillment يتتبع line items والكميات وtracking.
- order يدعم returns وrefunds وcancellation information.
- توجد روابط cart/checkout tokens للربط بين مراحل الرحلة.
- Shopify يميز fulfillment/location/inventory concepts بدل اختزالها في status واحد.

### الدرس لأَوْج
نحتاج **state machines منفصلة** على الأقل لـ:

1. Order lifecycle.
2. Payment/financial lifecycle.
3. Fulfillment lifecycle.
4. Return/refund lifecycle.

ولا ينبغي بناء `status` واحد ضخم يحاول تمثيل الأربعة.

## 7. نتيجة البحث الأولي — Zid / Omnichannel

توثيق زد الحالي لكاشير يوضح اتجاهًا عمليًا متعدد القنوات:

- لوحة الكاشير تعرض المبيعات والطلبات حسب الفروع/المواقع.
- المخزون مرتبط بمواقع البيع.
- يمكن تفعيل مخزن محدد لقناة زد كاشير.
- الكاشير يستطيع التحقق من توفر المنتج والكميات في مخزون محدد والبحث في مخزون آخر.
- يوجد مسار لإنشاء «طلب من المتجر» من تطبيق الكاشير مع تحديد المخزون قبل إضافة المنتجات.

### الدرس لأَوْج
`Sales Channel` لا يكفي وحده. نحتاج لاحقًا علاقة صريحة بين:

```text
Channel ↔ Branch/Location ↔ Warehouse/Inventory Policy
```

حتى يستطيع Web Store وMobile App وPOS معرفة مصدر التوفر والتنفيذ دون خلط المخزون بين الفروع.

## 8. Architecture Direction v0.1

هذه ليست ADR نهائية، لكنها فرضية العمل التي سيُختبر عليها البحث التالي.

### A. Commerce Core API-first
كل من AWJ Web Store و«متجرنا» Mobile App يجب أن يستهلك contract تجاريًا مشتركًا. لا يكون منطق الطلب والدفع والمخزون محصورًا في Next.js Storefront.

### B. Headless-capable from day one
ليس المطلوب بناء Headless platform عامة من أول إصدار، لكن الحدود الداخلية يجب ألا تمنع mobile/native clients.

### C. Product Core ≠ Store Presentation
المنتج الأساسي يبقى مصدر SKU/UOM/tax/inventory/accounting semantics. طبقة publication للقناة تحمل مثلًا:

- published/unpublished.
- channel title/description overrides.
- media ordering.
- merchandising/category placement.
- SEO/web metadata عند الحاجة.

### D. Order ≠ Invoice
Order كيان تجاري مستقل. Invoice مستند مالي/ضريبي ينتج في نقطة معتمدة من lifecycle.

### E. Inventory has explicit states
التصميم المستقبلي يجب أن يميز على الأقل مفاهيم مثل:

- on-hand.
- available-to-sell.
- reserved.
- committed/fulfilled.

الأسماء الدقيقة تعتمد بعد فحص Inventory Core الحالي، ولا يُنشأ schema قبل ذلك.

### F. Payment provider boundary
أَوْج يحتفظ بالمراجع والحالات والمبالغ اللازمة للتسوية والتدقيق، ولا يخزن بيانات البطاقة الحساسة. provider adapters تكون خلف contract موحد.

### G. Channel attribution is first-class
كل Order يجب أن يعرف مصدره: AWJ Web Store / Mobile App / POS / Salla / Zid / Shopify / direct ERP، مع store/location identifiers عند الحاجة.

## 9. «متجرنا» كـPilot Mobile Client

هدف الـPilot ليس فقط إطلاق تطبيق؛ بل إثبات أن Commerce Core صالح لقناة Native مستقلة.

### التطبيق يحتاج مبدئيًا
- authentication/customer session.
- home/catalog/categories/search.
- product details/media/availability.
- cart.
- checkout.
- addresses.
- shipping method selection.
- payment initiation/status.
- order history/detail/tracking.
- cancellation/return entry points وفق السياسة.
- favorites لاحقًا أو ضمن product experience، دون ربطها بالمحاسبة.
- push notifications.
- deep links.

### لا نحسم الآن
- Flutter vs React Native.
- مزود الدفع.
- مزود الشحن.
- push provider.
- exact mobile UI design.

هذه قرارات لاحقة بعد تثبيت contracts والمتطلبات.

## 10. Security / Tenant / Accounting gates

أي PR مستقبلي في هذا المسار يجب أن يثبت:

- Tenant Isolation لكل store/channel/cart/order/payment/fulfillment mapping.
- عدم قبول tenant/company identifiers من client دون server-side authorization.
- idempotent checkout/order/payment/webhook processing.
- replay protection للـwebhooks حسب المزود.
- عدم خصم/حجز المخزون مرتين عند retries.
- عدم إصدار/ترحيل فاتورة مرتين لنفس business event.
- audit trail للحالات والانتقالات.
- authorization/RBAC لإدارة المتجر والقنوات.
- عدم كشف cost/internal accounting data للـStorefront/Mobile API.
- backward compatibility مع Invoice/POS/Product/Inventory cores الحالية.

## 11. ما نحتاج بحثه بعد ذلك

### Research 2 — Salla + Zid deep comparison
- product/variant model.
- inventory per location.
- order lifecycle.
- payments/COD.
- shipping/fulfillment.
- returns/refunds.
- customer accounts.
- mobile app behavior.
- POS/omnichannel.
- APIs/webhooks/integration model.

### Research 3 — Daftra deep workflow
- exact store-order artifact.
- when invoice is generated.
- stock effect timing.
- cancellation/returns.
- customer identity requirements.
- shipping/payment status behavior.

### Research 4 — Shopify/Odoo architecture
- state transitions.
- reservation semantics.
- partial fulfillment.
- partial refunds/returns.
- payment authorization/capture.
- webhook/event idempotency patterns.

### Research 5 — Saudi requirements
- ZATCA boundary between ecommerce order and tax invoice.
- VAT presentation.
- supported payment ecosystem requirements.
- shipping/address requirements.
- consumer-commerce obligations that affect product design.

## 12. Deliverables before implementation

لا يبدأ implementation لمجرد وجود هذا الملف. المطلوب إغلاق هذه المخرجات أولًا:

1. `AWJ_COMMERCE_FEATURE_MATRIX.md`
2. `AWJ_COMMERCE_ARCHITECTURE_ADR.md`
3. `AWJ_COMMERCE_DOMAIN_MODEL.md`
4. `AWJ_MOBILE_COMMERCE_API_CONTRACT.md`
5. `AWJ_COMMERCE_PHASED_IMPLEMENTATION_PLAN.md`
6. «متجرنا» Pilot scope منفصل عن generic Core scope.

بعد اعتمادها فقط يتم تقسيم العمل إلى PRs صغيرة ومستقلة.

## 13. حالة العمل

- Research started: نعم.
- Master vision expanded to Commerce Platform: نعم، كاتجاه دراسة.
- Daftra initial pass: مكتمل جزئيًا.
- Odoo initial architecture pass: مكتمل جزئيًا.
- Shopify initial architecture pass: مكتمل جزئيًا.
- Zid initial omnichannel pass: مكتمل جزئيًا.
- Salla deep pass: لم يكتمل.
- Saudi regulatory pass: لم يبدأ.
- Repository implementation inspection: لم يبدأ، لأنه غير مطلوب قبل إغلاق product research.
- Production code/database/API changes: **لا يوجد**.
- Merge/deploy: **لا يوجد**.

---

**قاعدة العمل:** البحث الخارجي يحدد الأنماط والبدائل، لكن أي قرار نهائي يجب أن يُراجع مقابل البنية الحالية الفعلية لأَوْج قبل إنشاء migrations أو APIs أو تغيير accounting/inventory behavior.

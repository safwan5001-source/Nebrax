# AWJ Commerce — Feature Matrix & Research Decisions

**Status:** Research / architecture input — no implementation approval
**Date:** 2026-09-09
**Parent:** `AWJ_STORE_MASTER_PLAN.md`
**Research companion:** `AWJ_COMMERCE_PLATFORM_RESEARCH.md`

## 1. Purpose

هذا المستند يحول البحث المقارن في Daftra وSalla وZid إلى قرارات ومتطلبات قابلة للاستخدام عند تصميم **AWJ Commerce Core** و**AWJ Store** وواجهة Mobile Commerce التي سيستخدمها مشروع **«متجرنا»** كأول Pilot/Reference Client.

المستند لا يعتمد Database schema أو API contract ولا يسمح ببدء implementation بمفرده.

## 2. Product direction confirmed by research

الرؤية الأنسب ليست «متجرًا داخل ERP» فقط، بل:

```text
AWJ ERP
  └── AWJ Commerce Core
       ├── Catalog / Pricing
       ├── Inventory Availability & Reservation
       ├── Customers
       ├── Cart / Checkout
       ├── Orders
       ├── Payments
       ├── Fulfillment / Shipments
       ├── Returns / Refunds
       └── Accounting boundary
              │
              └── Sales Channels
                   ├── AWJ Web Store
                   ├── Mobile Commerce API
                   │    └── «متجرنا» Mobile App — pilot
                   ├── AWJ POS
                   └── Connected Commerce
                        ├── Salla
                        ├── Zid
                        ├── Shopify
                        └── WooCommerce
```

**Key rule:** القناة لا تملك المنطق المالي أو المخزني الأساسي؛ هي مستهلك/منتج لأوامر وأحداث Commerce Core ضمن سياسات واضحة.

## 3. Research findings — Daftra

### 3.1 Catalog reuse

توثيق دفترة يوضح أن المنتج الأساسي داخل نظام المخزون نفسه يحمل خيار **«متاح أونلاين»** لإظهاره في المتجر، وخيار **«منتج مميز»** لواجهة التسوق. السعر والضرائب وبيانات المنتج تأتي من كيان المنتج في النظام، وليس من Catalog مستقل بالكامل.

**AWJ implication:**
- Product Core يبقى مصدر الحقيقة للهوية التجارية/المخزنية الأساسية.
- نحتاج طبقة `CommerceListing` أو equivalent لبيانات العرض التي لا ينبغي تلويث Product Core بها: publish status, merchandising title/description, media ordering, SEO, badges, channel visibility.
- لا ننشئ نسخة ثانية من Product لكل متجر.

### 3.2 Payments

متجر دفترة يعرض طرق الدفع المفعلة في الحساب ضمن checkout، ويشمل النقد/البطاقات/الدفع عند الاستلام حسب الإعدادات.

**AWJ implication:**
- Payment methods يجب أن تكون capabilities/configuration مرتبطة بالقناة والـtenant.
- `PaymentMethod` لا يساوي `PaymentTransaction`.
- COD يجب أن يكون payment flow مستقلًا، لا حالة مبهمة داخل Order.

### 3.3 Shipping

دفترة يعيد استخدام إعدادات خيارات الشحن والتوصيل، ويضيف تكلفة الشحن إلى إجمالي الطلب. في الفواتير توجد أيضًا علاقة صريحة بين الشحن والمستودع والضرائب ومصاريف الشحن.

**AWJ implication:**
- Shipping quote/selection جزء من checkout.
- Shipping charge يجب أن يكون component واضحًا في totals/tax calculation.
- fulfillment source/location يجب ألا يُستنتج من القناة وحدها.

### 3.4 Content/storefront

دفترة يسمح بصفحات محتوى قابلة للتخصيص وعناصر واجهة متجر، ما يؤكد أن storefront merchandising/CMS concern مختلف عن ERP product management.

**AWJ implication:**
- V1 يحتاج CMS خفيف فقط، لا page builder ضخم.
- Commerce Core يجب ألا يعتمد على renderer أو theme بعينه.

### 3.5 Accounting caution

توثيق دفترة العام يوضح في سياقات أخرى أن المسودة يمكن أن تبقى بلا أثر محاسبي أو مخزني حتى التحويل إلى مستند فعلي. هذه ليست إثباتًا لدورة Store Order تحديدًا، لكنها تؤكد قيمة فصل الحالة التشغيلية عن الأثر المالي.

**AWJ decision:**
- Store Order لن يكون Sales Invoice.
- توقيت invoice posting يبقى ADR مستقلًا يجب حسمه بعد فحص accounting flows في AWJ.

## 4. Research findings — Salla

### 4.1 Inventory reservation is first-class

توثيق Salla Point الحالي يذكر صراحة أن المخزون يُحجز عند إنشاء الطلب حتى قبل اكتمال الدفع، وأن الكمية تعود تلقائيًا عند عدم إكمال الطلب/الدفع.

**AWJ decision candidate:**

```text
On checkout/order acceptance:
Available -> Reserved

On successful completion according to fulfillment policy:
Reserved -> Committed/Issued

On expiry/cancel/payment failure:
Reserved -> Available
```

لا نعتمد التوقيت النهائي قبل ADR، لكن **Reservation يجب أن يكون concept مستقلًا** وليس مجرد decrement مؤقت مخفي.

### 4.2 Manual/external order creation

سلة تدعم إنشاء طلب يدويًا مع منتجات + عميل + دفع + شحن + كوبون، وMerchant API يتضمن Create Order / Drafted Order / External Orders.

**AWJ implication:**
- Order Core يجب ألا يفترض أن المصدر storefront browser فقط.
- `source/channel` mandatory metadata.
- Mobile App وPOS وAdmin وexternal connector يجب أن تستخدم نفس invariants مع اختلاف actor/context.

### 4.3 Shipments are separate resources

Salla API يفصل shipment lifecycle عن order، وله أحداث وإنشاء/تحديث/إلغاء/إرجاع للشحنات.

**AWJ decision:**
- لا نضع tracking/status للشحن كحقول مسطحة فقط على Order.
- نحتاج Fulfillment/Shipment aggregate مستقلًا بما يسمح مستقبلًا بـpartial fulfillment وmultiple shipments.

### 4.4 Event-driven integrations

Salla يعتمد webhooks للأحداث مثل order/product/customer/shipment/invoice/cart، ويوصي بالتعامل مع webhook عبر verify → acknowledge → queue → process → idempotent processing.

**AWJ decision:**
- Connected Commerce يجب أن يكون event-driven قدر الإمكان، لا polling دائم.
- inbound events: signature verification + durable receipt + dedupe/idempotency + async processing + retry/dead-letter visibility.
- outbound integration events يجب أن تكون durable أيضًا، والاستفادة من Outbound Webhooks foundation الموجودة في AWJ بدل بناء مسار موازٍ بلا داعٍ.

### 4.5 Inventory mutations

Salla API يميز increment/decrement/overwrite ويوصي بالأولَين لحماية سلامة المخزون.

**AWJ implication:**
- connectors لا تكتب absolute stock عشوائيًا إلى Inventory Core.
- يجب تعريف stock synchronization semantics: authoritative source, delta vs snapshot, reconciliation.

### 4.6 Shipping configuration depth

سلة يدعم COD، اختيار المستودع حسب مدينة العميل، مزامنة المخزون مع شركات الشحن، وإصدار بوليصات الشحن.

**AWJ scope decision:**
- هذه capabilities مهمة، لكن ليست كلها V1.
- V1 يجب أن يثبت Shipping Method + Address + Fulfillment Location + Shipping Charge + basic status/tracking contract.

## 5. Research findings — Zid

### 5.1 Channel ↔ Inventory/Location relationship

زد يسمح بتخصيص المخزن للمتجر الإلكتروني أو زد كاشير أو كليهما، ويمكن فصل مخزون POS عن مخزون المتجر. كما أن المنتجات ذات الخيارات تحمل كميات بحسب المخزن.

**AWJ decision:**
- `SalesChannel` و`InventoryLocation/Warehouse` علاقة many-to-many/policy-driven، وليست `channel.warehouse_id` ثابتة بالضرورة.
- availability resolver يجب أن يعرف القناة والموقع وسياسة التخصيص.

### 5.2 Cross-channel order handling

زد كاشير يستطيع إنشاء «طلب من المتجر» مع اختيار المخزون والمنتجات والعميل والعنوان والشحن والدفع؛ وتنعكس المعاملة على التقارير والقناة والمخزون.

**AWJ implication:**
- order attribution يجب أن يفصل بين:
  - channel/source
  - actor/user/device
  - fulfillment location
  - selling location/branch عند الحاجة
- هذا مهم لتقارير omnichannel وللتدقيق.

### 5.3 API surface

Zid Merchant API يعرض Orders وProducts وInventories وWebhooks، بما فيها variants والمخزون عبر locations.

**AWJ implication:**
- Mobile Commerce API لا ينبغي أن يكون نسخة من internal ERP API.
- نحتاج public/channel-oriented contract ثابتًا حول catalog/availability/cart/order/account، بينما Back Office يحتفظ بعقوده الإدارية.

### 5.4 Webhook granularity

زد لديه أحداث مستقلة مثل `order.create`, `order.status.update`, `order.payment_status.update`, إضافة إلى product events.

**AWJ decision:**
- Order status وPayment status منفصلان domain-wise.
- لا نستخدم enum واحدًا يحاول تمثيل order + payment + fulfillment معًا.

### 5.5 Reporting by channel

تقارير زد الحالية تسمح بتحليل المبيعات حسب قنوات البيع والمخازن والمنتجات والتصنيفات والمدن وطرق الدفع والشحن والكاشير والمستخدم.

**AWJ requirement:**
من البداية نحفظ dimensions اللازمة للتقارير، حتى لو لم نبن كل التقارير في V1.

## 6. Feature matrix — direction for AWJ

Legend:
- **V1** = مطلوب للـpilot الصحيح.
- **V1-foundation** = contract/model مطلوب الآن حتى لو كانت الواجهة محدودة.
- **Later** = لا نحمّل V1 به.
- **Research** = يحتاج قرارًا إضافيًا.

| Capability | Daftra signal | Salla signal | Zid signal | AWJ direction |
|---|---|---|---|---|
| Product publish to store | نعم | نعم | نعم | **V1** — listing فوق Product Core |
| Featured/merchandising | نعم | نعم | نعم | **V1** basic |
| Variants | موجود في ecosystem | قوي | نعم | **V1-foundation**, scope after Product audit |
| Multi-location inventory | ERP warehouse | branch quantities | قوي جدًا | **V1-foundation** |
| Inventory reservation | غير مثبت من store docs | صريح | availability/location | **V1** concept |
| Guest checkout | يحتاج بحث إضافي | ecosystem supports checkout | ecosystem supports checkout | **Research** |
| Customer account | نعم/يتطلب login في توثيق الدفع | نعم | نعم | **V1**, guest policy ADR |
| Payment methods | نعم | نعم | نعم | **V1** abstraction |
| COD | نعم | نعم | نعم | **V1 candidate** |
| Online gateway | نعم | نعم | نعم | **V1/Later حسب مزود pilot** |
| Shipping methods | نعم | نعم | نعم | **V1** |
| Shipment entity | محدود في store docs | قوي ومستقل | shipping/order ecosystem | **V1-foundation** |
| Partial fulfillment | غير مثبت | architecture supports shipments | يحتاج بحث | **V1-foundation / Later UI** |
| Returns/refunds | ERP capabilities need mapping | explicit events | order/payment events | **V1-foundation**, flow ADR |
| Order/payment status separation | غير واضح كفاية | واضح | واضح | **V1** |
| Channel attribution | متجر مدمج + integrations | external/manual | قوي | **V1** |
| Channel-location mapping | warehouse in invoice | branch quantities | صريح | **V1** |
| Webhooks | integrations | قوي | قوي | **V1-foundation** |
| Idempotency/deduplication | integration necessity | recommended | integration necessity | **V1 mandatory** |
| CMS/pages | نعم | themes/content ecosystem | themes/content ecosystem | **V1 basic / Later advanced** |
| Custom domains | ecosystem | نعم | نعم | **Later**, architecture-ready |
| Mobile app API | ليس المرجع الأساسي | APIs | APIs | **V1 mandatory for متجرنا** |
| POS omnichannel | ERP/POS separate | Salla Point | Zid POS strong | **Foundation now, convergence later** |
| External Salla/Zid connectors | marketplace/integration model | native source | native source | **Later after native pilot** |

## 7. Proposed AWJ Commerce bounded contexts

هذه أسماء مفاهيمية وليست أسماء جداول نهائية:

### 7.1 Channel
- SalesChannel
- ChannelType: web_store / mobile_app / pos / admin / external
- channel configuration
- allowed inventory locations
- pricing/tax/payment/shipping policies references

### 7.2 Catalog Presentation
- CommerceListing
- channel visibility
- merchandising title/description
- media ordering
- category/collection membership
- SEO metadata
- publish state

### 7.3 Cart / Checkout
- Cart
- CartLine
- pricing snapshot
- checkout session
- shipping selection
- payment selection
- reservation attempt

### 7.4 Order
- CommerceOrder
- OrderLine
- source/channel
- customer snapshot
- address snapshot
- pricing/tax/discount/shipping snapshots
- operational order status

### 7.5 Inventory Reservation
- Reservation
- location
- quantity in base/UOM-safe representation
- expires_at
- released/committed state
- idempotency/source reference

### 7.6 Payment
- PaymentIntent / PaymentAttempt concept
- provider/method
- status independent from order
- provider reference
- idempotency key
- authorization/capture/refund history as required

### 7.7 Fulfillment
- Fulfillment / Shipment
- source location
- lines/quantities
- carrier/method
- tracking
- fulfillment status
- partial/multiple fulfillment ready

### 7.8 Returns / Refunds
- Return request/authorization concept
- received quantities
- restock disposition
- refund linkage
- Credit Note/accounting linkage

## 8. Mobile Commerce API — requirements discovered

مشروع «متجرنا» يجعل هذه الطبقة **V1 وليست إضافة مستقبلية**.

يجب أن يكون الـAPI:

- tenant/store scoped دون كشف internal tenant identifiers غير اللازمة.
- consumer-safe authentication مستقل عن staff/admin auth.
- rate-limited.
- versioned.
- idempotent في checkout/order/payment mutation endpoints.
- pagination/search/filter consistent.
- media/CDN friendly.
- locale/currency aware.
- قادرًا على إعادة pricing/availability server-authoritatively؛ التطبيق لا يقرر السعر أو الضريبة أو المخزون.

الـsurface المبدئي:

```text
Storefront config
Catalog / categories / search
Product detail + variants
Availability
Cart
Checkout quote
Addresses / shipping methods
Payment methods
Place order
Order history/detail
Order status
Fulfillment/tracking
Cancel/return eligibility
Customer profile/auth
Push-device registration
```

**لا نعتمد endpoint paths أو payloads قبل Domain/Repo audit.**

## 9. «متجرنا» Pilot boundary

مشروع «متجرنا» هو أول client حقيقي، وليس مصدرًا لتخصيص Core.

### داخل AWJ Commerce Core
- product/catalog contract
- inventory availability/reservation
- pricing/tax authority
- cart/order lifecycle
- payments abstraction
- fulfillment contract
- returns/refunds foundations
- customer commerce identity
- channel attribution
- audit/idempotency/security

### داخل تطبيق «متجرنا» فقط
- visual identity
- navigation and consumer UX
- home merchandising layout
- app-specific campaigns/content
- mobile presentation state
- push UX
- deep-link routing
- app analytics presentation

أي طلب خاص بالتطبيق يجب أن يمر باختبار: **هل هو commerce invariant عام أم presentation/business customization خاص بمتجرنا؟**

## 10. Decisions not yet allowed

لا يجوز من هذا البحث وحده اعتماد:

- Flutter vs React Native.
- database tables/migrations.
- exact invoice creation moment.
- exact stock reservation/commit moment.
- payment gateway vendor.
- shipping provider.
- guest checkout policy.
- custom-domain implementation.
- external connector sync ownership.
- whether existing AWJ Product/Price List/UOM models already satisfy all Commerce needs.

## 11. Next research/architecture gate

قبل التنفيذ نحتاج مرحلتين:

### Gate A — AWJ repository/domain audit
فحص محدود للـexisting implementation فقط حول:
- Product / variants / UOM
- warehouses/inventory movements
- price lists/discounts/taxes
- customers
- invoices/credit notes
- payments
- POS checkout/idempotency
- outbound webhooks
- auth/RBAC/tenant scoping

الهدف: **reuse before create** ومنع duplicate domain models.

### Gate B — Architecture Decision Records
بعد الفحص نكتب ADRs على الأقل لـ:
1. Commerce Order vs Sales Invoice boundary.
2. Inventory reservation/commit/release semantics.
3. Channel ↔ warehouse/location allocation.
4. Payment intent/attempt/refund lifecycle.
5. Customer/guest/mobile authentication.
6. Mobile Commerce API boundary and versioning.
7. Fulfillment/Shipment and partial fulfillment.
8. Returns → stock → refund → credit note/accounting.
9. Connected Commerce synchronization ownership/idempotency.

بعد اعتماد هذه القرارات فقط تُقسم الخطة إلى PRs صغيرة.

## 12. Current recommendation

1. نبني **native AWJ Commerce Core + Mobile API** أولًا.
2. يكون **«متجرنا»** أول pilot لتشغيل المسار end-to-end.
3. نبني AWJ Web Store فوق نفس الـCore، لا بمنطق مستقل.
4. نحافظ على POS الحالي ونجهز convergence تدريجيًا بدل إعادة كتابته الآن.
5. نؤجل Salla/Zid/Shopify connectors حتى يثبت native order/inventory/payment/fulfillment model.
6. لا نسمح لأي channel بإنشاء قيود محاسبية مباشرة؛ accounting effects تمر عبر boundaries المعتمدة في AWJ.

## 13. Sources reviewed

Official documentation reviewed during this pass:

- Daftra: product online availability/featured product; store payment methods; store shipping options; content pages; invoice warehouse/shipping behavior.
- Salla Help: Point inventory reservation behavior; manual order creation; shipping configuration.
- Salla Developer Docs: Orders/Shipments APIs and webhooks; webhook processing guidance; inventory quantity mutation semantics.
- Zid Help: POS/store inventory separation; channel assignment to inventory; store-order creation from POS; channel/location reporting.
- Zid Developer Docs: Merchant APIs for orders/products/inventories and order/payment/product webhooks.

The findings above distinguish documented behavior from AWJ recommendations; recommendations are architectural conclusions, not claims that competitors implement AWJ's proposed model exactly.

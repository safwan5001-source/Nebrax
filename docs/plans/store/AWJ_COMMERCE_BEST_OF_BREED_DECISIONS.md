# AWJ Commerce — Best-of-Breed Capability & Policy Decisions

**Status:** Research / product architecture — no implementation approval
**Date:** 2026-09-09
**Parent:** `AWJ_STORE_MASTER_PLAN.md`
**Related:** `AWJ_COMMERCE_PLATFORM_RESEARCH.md`, `AWJ_COMMERCE_FEATURE_MATRIX.md`

## 1. لماذا هذا المستند؟

قرار المنتج ليس نسخ Daftra أو Salla أو Zid أو Shopify أو Odoo. الهدف هو دراسة **الميزة وطريقة التشغيل** أينما كانت، ثم تصميم AWJ Commerce بحيث يجمع أفضل الأنماط المتوافقة مع أَوْج ويستوعب أكثر من Business Policy عندما تكون هناك طرق صحيحة مختلفة حسب نشاط المنشأة.

المبدأ:

> Best-of-Breed, Policy-Driven Commerce — لا نجمع الميزات عشوائيًا، بل نختار أفضل capability ونحدد هل هي Default ثابت، Policy قابلة للضبط، Advanced capability، أم مرفوضة.

مشروع **«متجرنا»** يبقى أول Pilot / Reference Mobile Client، لكنه لا يملك حق تخصيص Commerce Core بما يجعله خاصًا بمتجر واحد.

## 2. تصنيف كل فكرة نجدها

كل capability أو pattern أثناء البحث يجب أن يحمل قرارًا واحدًا:

- **ADOPT** — النمط الصحيح العام ويصبح baseline/default في أَوْج.
- **CONFIGURABLE** — توجد عدة طرق تشغيل صحيحة؛ يبني أَوْج policy صريحة مع default آمن.
- **ADVANCED** — مفيد لكنه ليس مطلوبًا لسلامة V1؛ نحافظ على قابلية التوسع له دون تحميل V1 كامل التعقيد.
- **REJECT** — لا يناسب مبادئ أَوْج، أو يهدد المحاسبة/المخزون/العزل، أو يزيد التعقيد دون قيمة كافية.
- **RESEARCH** — الدليل الحالي غير كافٍ للحسم.

قاعدة مهمة: **Configurable لا تعني configurable بلا حدود.** الخيارات يجب أن تكون finite, validated, auditable، وتملك defaults واضحة.

## 3. فصل Capability عن Policy

مثال: `Inventory Reservation` هو Capability يجب أن يوجد. أما **متى يبدأ الحجز** فهي Policy.

مثال آخر: `Sales Invoice` مستند محاسبي موجود. أما **متى يُنشأ من Commerce Order** فهي Policy محكومة بقيود محاسبية.

هذا الفصل يمنع تحويل الاختلافات التشغيلية إلى forks في الكود.

## 4. القرارات الأولية Best-of-Breed

| المجال | الإشارة المرجعية | قرار أَوْج | Default مبدئي | البدائل التي يجب أن يستوعبها التصميم |
|---|---|---|---|---|
| Product source of truth | Daftra / ERP pattern | ADOPT | Product Core هو الأصل | CommerceListing يحمل العرض التسويقي |
| Commerce listing | متاجر حديثة متعددة | ADOPT | Listing مستقل عن الهوية المخزنية | per-channel visibility/content لاحقًا |
| Order ≠ Invoice | Odoo + ERP safety | ADOPT | فصل كامل | لا يوجد وضع يساوي الكيانين |
| Order / Payment / Fulfillment states | Shopify/Zid/Salla patterns | ADOPT | state machines منفصلة | transitions تختلف حسب channel/provider |
| Inventory reservation | Salla + Odoo | ADOPT + CONFIGURABLE timing | reserve عند قبول/تأكيد الطلب القابل للتنفيذ | after payment لبعض التدفقات؛ manual/exception flow مضبوط |
| Reservation release | Salla pattern | ADOPT | release عند cancel/expiry/payment failure وفق policy | TTL/provider timeout configurable |
| Fulfillment source | Zid + Odoo warehouses | CONFIGURABLE | location محدد/محسوب بالقواعد | fixed warehouse، branch/location، routing لاحقًا |
| Multi-location | Zid/Odoo | ADOPT foundation | availability location-aware | allocation/routing advanced |
| Invoice trigger | Odoo invoicing patterns | CONFIGURABLE بقيود محاسبية | غير معتمد حتى Accounting ADR | payment / fulfillment / delivered quantity / approved operational trigger |
| Invoice quantity basis | Odoo delivery-based invoicing | CONFIGURABLE where valid | ordered quantity للسلع البسيطة فقط بعد ADR | delivered quantity للpartial/backorder/use cases |
| Payment capture | Odoo/Shopify-style provider capabilities | CONFIGURABLE by provider/policy | immediate capture إذا كان المزود/flow مناسبًا | authorize→capture، COD، pay-on-site |
| Partial capture/refund | payment-provider capability pattern | ADVANCED foundation | لا يفترض V1 دعمه في كل مزود | provider capability matrix |
| COD | Daftra/Salla/Odoo | ADOPT | payment flow مستقل | eligibility by delivery method/amount/location |
| Click & Collect | Odoo + omnichannel patterns | ADVANCED قريب | خارج أول vertical slice | warehouse/store pickup with stock visibility |
| Shipping method | Daftra/Salla/Odoo | ADOPT | selected during checkout | carrier, flat rate, free, pickup |
| Shipment entity | Salla + fulfillment patterns | ADOPT foundation | مستقل عن Order | multiple/partial shipments لاحقًا |
| Returns | Odoo + commerce patterns | ADOPT foundation | Return مستقل | partial returns, return reasons, approval policies |
| Refund | Odoo/payment providers | ADOPT foundation | Refund مستقل عن Return | full/partial/provider-specific |
| Credit Note | Accounting safety | ADOPT | المستند القانوني/المحاسبي بعد الفاتورة | لا نعدل posted invoice مباشرة |
| Guest checkout | Odoo supports unsigned customer flow; other platforms vary | CONFIGURABLE | يسمح إذا لم توجد متطلبات B2B/tenant تمنعه | account-required / B2B-only |
| B2B/B2C access | Odoo | CONFIGURABLE | B2C public storefront | B2B restricted catalog/account/pricing later |
| Checkout steps | Odoo + storefront patterns | CONFIGURABLE UX | streamlined standard checkout | express checkout, extra info, B2B fields |
| Channel ↔ warehouse | Zid | CONFIGURABLE | explicit channel inventory policy | many-to-many locations + priorities |
| External sync | Salla/Zid integrations | ADOPT | event-driven + idempotent | reconciliation polling فقط كـrepair mechanism |
| Stock sync semantics | Salla API signal | ADOPT | delta/domain movements داخليًا | snapshots فقط reconciliation/import boundaries |
| Reporting dimensions | Zid | ADOPT | channel/location/payment/shipping/source preserved | advanced BI later |
| Mobile client | «متجرنا» pilot | ADOPT | Mobile Commerce API first-class | web/mobile use same commerce invariants |

هذه Defaults **مبدئية** وليست اعتماد implementation. كل قرار مالي/مخزني حساس يحتاج فحص أَوْج وADR قبل التنفيذ.

## 5. Policy Engine — الاتجاه المقترح

لا نبني generic rules engine في V1. هذا سيكون over-engineering وخطرًا على قابلية التتبع.

بدلًا منه نستخدم **Typed Commerce Policies** مع enums/configurations محددة، مثل:

```text
InventoryReservationPolicy
  - ON_ORDER_CONFIRMATION
  - ON_PAYMENT_CONFIRMED

InvoiceTriggerPolicy
  - ON_PAYMENT_CONFIRMED
  - ON_FULFILLMENT
  - ON_DELIVERY

InvoiceQuantityPolicy
  - ORDERED
  - FULFILLED

PaymentCapturePolicy
  - IMMEDIATE
  - AUTHORIZE_THEN_CAPTURE
  - COD
  - PAY_ON_PICKUP

FulfillmentRoutingPolicy
  - FIXED_LOCATION
  - PRIORITY_LOCATIONS       [later]
  - ROUTING_ENGINE           [advanced]

CheckoutIdentityPolicy
  - GUEST_OR_ACCOUNT
  - ACCOUNT_REQUIRED
  - B2B_APPROVED_ACCOUNT     [later]
```

ليست هذه أسماء schema معتمدة؛ هي توثيق للـdomain decisions فقط.

## 6. قواعد تمنع Feature Soup

1. لا تدخل capability إلى Core فقط لأن منافسًا يملكها.
2. يجب أن تخدم use case معروفًا أو توسعًا معقولًا ومثبتًا.
3. إذا كانت طريقتان متعارضتان صحيحتين لنشاطين مختلفين، نفضّل Policy واضحة على fork أو boolean مبهم.
4. لا نجعل كل شيء setting؛ الخيار النادر أو الخطر يبقى advanced/unsupported حتى توجد حاجة حقيقية.
5. لا يسمح Storefront أو Mobile App بتجاوز invariants المخزون أو المحاسبة.
6. provider-specific fields تبقى في adapter/configuration layer ولا تلوث Commerce Core.
7. كل policy حساسة يجب أن تكون tenant-scoped، permission-controlled، auditable، ولها default آمن.
8. تغيير policy لا يعيد تفسير الطلبات التاريخية؛ الطلب يحفظ policy/version/context اللازمة للتدقيق عند الحاجة.

## 7. مبدأ المحاسبة

المرونة التشغيلية تتوقف عند Accounting Boundary.

يمكن أن يختلف التاجر في توقيت الحجز أو طريقة fulfillment أو payment capture أو invoice trigger ضمن الخيارات المعتمدة، لكن عند إنشاء مستند محاسبي:

- قواعد القيود والضرائب والأرقام والتسلسل تبقى قواعد أَوْج.
- posted invoice لا تُعدل لتسهيل return/refund؛ نستخدم Credit Note/المستند الصحيح.
- refund المالي وstock return وcredit note أحداث مترابطة لكنها ليست كيانًا واحدًا.
- أي policy تغير لحظة الأثر المالي يجب أن تخضع Accounting ADR واختبارات regression قوية.

## 8. نتيجة بحث Odoo الإضافية — لماذا Policy-Driven مناسب

توثيق Odoo الحالي يقدم أكثر من نمط صحيح داخل المنصة نفسها:

- checkout يمكن أن يكون guest أو signed-in، ويمكن تقييده لنموذج B2B.
- COD وPay on Site وonline payment كلها flows مختلفة.
- بعض مزودي الدفع يدعمون authorize ثم manual capture، وبعضهم full/partial capture/refund.
- inventory reservation يمكن أن يتم عند confirmation، بينما wire-transfer flow قد ينتظر وصول الدفع قبل confirmation/reservation.
- invoicing يمكن أن يرتبط بالدفع أو التسليم، وdelivery-based invoicing مهم عندما تختلف الكمية المسلمة عن المطلوبة أو يوجد partial delivery/backorder.
- shipping يمكن أن يكون carrier أو flat/free أو Click & Collect، والـpickup locations مرتبطة بالمخازن وتوفر المخزون.

**استنتاج أَوْج:** الاختلاف ليس edge case؛ التجارة نفسها policy-rich domain. لذلك نحتاج Core ثابت + سياسات محددة، لا flow واحد hard-coded ولا rules engine مفتوح.

## 9. نموذج Capability Registry المقترح للبحث

لكل capability نضيف سجلًا بالشكل:

```text
Capability:
Sources:
Observed patterns:
AWJ classification: ADOPT | CONFIGURABLE | ADVANCED | REJECT | RESEARCH
Default:
Supported alternatives:
Accounting impact:
Inventory impact:
Tenant/security impact:
Mobile impact:
External-channel impact:
Open questions:
ADR required: yes/no
```

هذا يصبح القالب الإلزامي لبقية البحث.

## 10. ما لا نعتمده بعد

هذا المستند لا يعتمد:

- Database schema.
- API routes/payloads.
- event names.
- exact enums.
- invoice trigger النهائي.
- reservation timing النهائي لكل payment flow.
- gateway أو shipping provider سعودي بعينه.
- Flutter/React Native لتطبيق «متجرنا».
- implementation PRs.

## 11. Research Queue التالية

نستمر الآن feature-by-feature بدل platform-by-platform فقط:

1. **Catalog & Merchandising:** variants, bundles, digital/service, media, SEO, channel-specific listing.
2. **Pricing & Promotions:** price lists, coupons, automatic discounts, B2B, channel prices, tax-inclusive/exclusive display.
3. **Inventory & Allocation:** reservation, overselling, safety stock, multi-location, split fulfillment, pickup.
4. **Checkout & Identity:** guest/account/B2B, address, express checkout, custom fields, abandoned carts.
5. **Payments:** authorize/capture, partial capture, COD, wallets, refunds, payment retries, reconciliation.
6. **Fulfillment & Shipping:** carrier quotes, labels, tracking, partial shipments, pickup, delivery zones.
7. **Returns & After-Sales:** RMA, exchanges, partial returns, refund vs store credit, credit note boundary.
8. **Omnichannel:** POS, mobile app, web store, external marketplaces/stores, attribution and shared customer.
9. **Mobile Commerce:** push notifications, deep links, saved cart, account/order tracking, mobile payment constraints.
10. **Saudi requirements:** ZATCA boundary, VAT display, Saudi payment/shipping ecosystem, Arabic/RTL, privacy/commerce requirements — separate compliance research before implementation.

## 12. Gate before architecture freeze

بعد إكمال research queue بدرجة كافية:

1. نفحص AWJ الحالي capability-by-capability.
2. نصنف كل بند: **Reuse / Extend / New**.
3. ننشئ ADRs للقرارات الحساسة.
4. نحدد V1 vertical slice لمشروع «متجرنا» بدون تخصيص Core له.
5. فقط بعد موافقة صفوان ننتقل إلى implementation planning/PRs.

**لا Merge/Deploy/Production change ناتج عن هذا البحث.**
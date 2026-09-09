# AWJ Commerce — Capability Research 03: Returns, Refunds, Exchanges & Store Credit

**Status:** Research / architecture input — no implementation approval
**Date:** 2026-09-09
**Method:** Best-of-Breed + Policy-Driven Commerce
**Parent:** `AWJ_STORE_MASTER_PLAN.md`
**Related:** `AWJ_COMMERCE_FEATURE_MATRIX.md`, `AWJ_COMMERCE_BEST_OF_BREED_DECISIONS.md`, `AWJ_COMMERCE_CAPABILITY_RESEARCH_02.md`

## 1. الهدف

هذه الجولة تفصل أربعة مفاهيم يجب ألا تختلط داخل AWJ Commerce:

1. **Return** — حركة/طلب إرجاع سلعة أو كمية.
2. **Refund** — إعادة قيمة مالية للعميل.
3. **Exchange** — استبدال السلعة بسلعة أخرى مع احتمال فرق مالي.
4. **Credit Note** — مستند محاسبي يعكس/يصحح فاتورة معتمدة وفق قواعد أَوْج المحاسبية والتنظيمية.

القاعدة الأساسية:

> Return != Refund != Credit Note != Exchange.

قد تجتمع في رحلة واحدة، لكن لكل منها lifecycle وأثر مختلف، ويجب ألا يؤدي تنفيذ أحدها تلقائيًا إلى افتراض تنفيذ البقية إلا عبر سياسة صريحة وآمنة.

## 2. مصادر البحث

تمت مراجعة وثائق حديثة من:

- Shopify: Returns, Exchanges, Refunds, Store Credit.
- Odoo 19: Credit Notes & Refunds, POS Returns, Customer Returns/Inventory Valuation, Repairs.
- Zid: Reverse Orders, Return Shipping, Refunds, Payment-provider refund contract.

هذه المصادر تستخدم لاستخراج patterns وليست مرجعًا محاسبيًا ملزمًا لأَوْج.

## 3. Best-of-Breed findings

### 3.1 Shopify — فصل Return عن Refund

Shopify يسمح بإنشاء Return واستقبال/فحص العناصر ثم إصدار Refund لاحقًا. كما يسمح في حالات أخرى بإصدار Refund بدون Return. ويمكن تحديد إعادة المنتج إلى المخزون أو عدم إعادته.

**AWJ decision: ADOPT**

- `Return` كيان تشغيلي مستقل.
- `Refund` معاملة مالية مستقلة.
- لا نفترض أن كل Refund يعني استلام بضاعة.
- لا نفترض أن كل Return يستحق Refund كاملًا.
- قرار restock مستقل عن قرار refund.

### 3.2 Shopify — Exchanges كرحلة مالية ومخزنية حقيقية

الاستبدال قد ينتج:

- قيمة البديل = قيمة المرتجع → even exchange.
- البديل أرخص → مبلغ مستحق للعميل.
- البديل أغلى → مبلغ إضافي مستحق من العميل.

كما أن العناصر البديلة تدخل fulfillment مستقلًا، ويمكن تعليق تنفيذها عند انتظار المبلغ.

**AWJ decision: V1-foundation / ADVANCED UI**

لا نمثل Exchange بمجرد reason على Return. يجب أن يكون domain flow قادرًا على تمثيل returned lines + replacement lines + settlement difference.

لكن واجهة Exchange المتقدمة يمكن تأجيلها بعد pilot إذا لم يحتجها «متجرنا» فورًا.

### 3.3 Shopify — Store Credit كوسيلة Refund مستقلة

Shopify يدعم refund إلى original payment، أو store credit، أو مزيج بينهما، ويربط store credit بملف العميل.

**AWJ decision: ADVANCED, foundation-aware**

Store Credit ميزة قوية مستقبلًا للـWeb/Mobile/POS omnichannel، لكن لا ننشئ wallet/ledger سريعًا داخل Commerce Core قبل فحص Customer/Accounting/Payments في أَوْج.

إذا اعتمد لاحقًا، يجب أن يكون balance ledger قابلًا للتدقيق وليس رقمًا mutable على customer.

### 3.4 Odoo — Credit Note هو الحد المحاسبي

Odoo يفصل إرجاع السلعة والدفع عن Credit Note، ويؤكد أن تعديل/عكس invoice validated يتم عبر credit/debit note، وأن حركة المال أو عودة المخزون إجراءات مرتبطة لكنها مستقلة.

**AWJ decision: ADOPT conceptually, AWJ accounting remains authoritative**

Commerce Core لا يعدل Sales Invoice المعتمدة ولا يكتب قيودًا مباشرة. عند الحاجة إلى أثر محاسبي، يطلب من Accounting/Sales Document boundary إنشاء المستند الصحيح وفق قواعد أَوْج الحالية، ZATCA والمتطلبات التنظيمية المعتمدة.

### 3.5 Odoo — Return valuation يجب أن يعكس الحركة الأصلية

في customer return الناتج من delivery الأصلي، Odoo يعيد السلعة بقيمة الوحدة التي خرجت بها، لا بسعر تكلفة اليوم.

**AWJ decision: CRITICAL RESEARCH / accounting audit required**

هذا pattern مهم جدًا، لكن لا نعتمده مباشرة قبل فحص valuation/costing/returns الحالي في أَوْج. المطلوب أن تكون Commerce Return قادرة على حمل provenance للحركة الأصلية كي يستطيع Inventory Core تطبيق سياسة valuation الصحيحة دون تخمين.

### 3.6 Odoo — Return قد ينتهي Repair أو Replacement وليس Refund

Odoo يدعم رحلة returned damaged item → repair → redelivery.

**AWJ decision: ADVANCED**

لا نحصر `ReturnResolution` في refund فقط. التصميم المستقبلي يجب أن يسمح مثلًا:

- REFUND
- EXCHANGE
- REPLACEMENT
- REPAIR
- STORE_CREDIT
- REJECTED / NO_ACTION

V1 لا يحتاج تنفيذ كل resolution، لكن schema/domain contract لا ينبغي أن يغلق الباب عليها.

### 3.7 Zid — Reverse Order مستقل ثم Refund مستقل

Zid يعرض reverse order كعملية مستقلة، ثم يحسب refundable amount وطرق refund المتاحة، وبعد ذلك يتم إنشاء refund. كما يدعم partial reverse، inventory location، أسباب الإرجاع، وشحن الإرجاع.

**AWJ decision: ADOPT**

- Return/reverse request مستقل عن payment refund.
- refundable amount يجب أن يُحسب server-side من source documents/transactions، لا يثق بقيمة يرسلها client.
- refund method يجب أن يكون من methods المتاحة فعليًا للمعاملة الأصلية والسياسة.
- partial returns first-class.

### 3.8 Zid — Refund provider lifecycle غير متزامن

عقد مزود الدفع في Zid يتوقع refund request ثم refund ID/reference، وبعدها webhook بنتيجة success/failure.

**AWJ decision: ADOPT**

`RefundTransaction` يحتاج lifecycle مثل:

```text
REQUESTED
  -> PROCESSING
      -> SUCCEEDED
      -> FAILED
      -> REQUIRES_ACTION
```

ولا يجوز اعتبار استدعاء بوابة الدفع = refund ناجح.

كل refund حساس يحتاج idempotency key + provider reference + retry safety + webhook verification + audit trail.

## 4. النموذج المفاهيمي المقترح

```text
Order
 ├── Fulfillment / Shipment
 │     └── Delivered Items
 │
 ├── Return Request
 │     ├── Return Lines
 │     ├── Reason
 │     ├── Return Logistics
 │     └── Inspection / Disposition
 │            ├── Restock
 │            ├── Damaged / Quarantine
 │            ├── Repair
 │            └── Do not restock
 │
 ├── Return Resolution
 │     ├── Refund
 │     ├── Exchange / Replacement
 │     ├── Store Credit [later]
 │     └── Repair [later]
 │
 └── Accounting Boundary
       └── Credit Note / required accounting document
```

هذا conceptual model فقط؛ ليس DB schema معتمدًا.

## 5. Return lifecycle candidate

```text
REQUESTED
  -> APPROVED
  -> IN_TRANSIT        [إذا كان هناك شحن إرجاع]
  -> RECEIVED
  -> INSPECTED
  -> RESOLVED
  -> CLOSED

Alternative exits:
REQUESTED -> REJECTED
APPROVED  -> CANCELED
```

**Policy question:** بعض المتاجر قد تسمح refund-before-receipt لعملاء موثوقين أو حالات محددة. لذلك لا نجعل `RECEIVED` prerequisite ثابتًا داخل الكود؛ نعرّف `RefundReleasePolicy` typed policy مع default محافظ.

## 6. Typed policies الجديدة

### ReturnEligibilityPolicy
يحدد:
- window بالأيام.
- حالات order/fulfillment المؤهلة.
- المنتجات غير القابلة للإرجاع.
- max returnable quantity.
- channel-specific restrictions.

### RefundReleasePolicy
خيارات مبدئية:
- AFTER_RECEIPT_AND_INSPECTION — default candidate.
- AFTER_RECEIPT.
- ON_APPROVAL — advanced/risk-based.
- MANUAL_APPROVAL.

### ReturnDispositionPolicy
يحدد ما يحدث للمخزون بعد inspection:
- RESTOCK_SELLABLE.
- RESTOCK_QUARANTINE.
- DAMAGED_WRITE_OFF workflow.
- REPAIR.
- DO_NOT_RESTOCK.

لا تنفذ Commerce Core valuation بنفسها؛ ترسل intent/provenance إلى Inventory Core.

### RefundDestinationPolicy
- ORIGINAL_PAYMENT_METHOD.
- STORE_CREDIT [later].
- MANUAL/BANK_TRANSFER where supported.
- SPLIT according to original tender composition [advanced].

### ReturnFeePolicy
يدعم مستقبلًا:
- no fee.
- return shipping fee.
- restocking fee.

يجب أن تكون الرسوم ظاهرة وقابلة للتفسير ولا تغير invoice/accounting documents بصورة عشوائية.

## 7. Partial returns are mandatory foundation

يجب حفظ `returned_quantity` و`remaining_returnable_quantity` على مستوى line logic، وليس فقط `order.returned=true`.

مثال:

```text
Order line: Qty 5
Delivered: 5
Previously returned: 2
Still returnable: 3
```

أي API لإنشاء Return يجب أن يتحقق server-side من maximum returnable quantity لمنع duplicate/over-return.

**Decision: V1-foundation.**

## 8. Inventory disposition — لا Restock أعمى

إرجاع المنتج لا يعني تلقائيًا أنه صالح للبيع.

بعد الاستلام قد يكون:

- unopened/sellable → stock available.
- opened but sellable → policy dependent.
- damaged → quarantine/damaged location.
- repairable → repair workflow.
- destroyed/lost → no restock / write-off flow.

لذلك `restock=true/false` وحدها ليست كافية للنمو طويل المدى، حتى لو كانت واجهة V1 أبسط.

## 9. Refund amount calculation

الـrefund calculation يجب أن يأخذ في الحسبان:

- line price actually paid.
- allocated discounts/promotions.
- taxes.
- refunded quantities previously.
- shipping refund policy.
- return/restocking fees إن وجدت.
- previous refunds.
- exchange difference.
- currency/rounding rules.

**Security/integrity rule:** client لا يرسل authoritative refund total. السيرفر يحسب maximum refundable amount، وأي manual override يحتاج permission + reason + audit.

## 10. Accounting boundary — قاعدة غير قابلة للمساومة

Commerce Return/Refund لا يقومان مباشرة بـ:

- تعديل invoice posted.
- حذف invoice.
- تعديل journal entry.
- إنشاء journal lines.
- إعادة تقييم inventory بمعزل عن Inventory Core.

بدلًا من ذلك:

```text
Commerce operational event
       ↓
Validated Return / Refund intent
       ↓
Sales/Accounting boundary
       ↓
Credit Note / reversal / settlement
according to AWJ accounting rules
```

يجب فحص implementation الحالي لأَوْج قبل اعتماد mapping نهائي.

## 11. Mobile «متجرنا» implications

الـMobile Commerce Contract يجب أن يستطيع لاحقًا:

- عرض العناصر القابلة للإرجاع والكميات المتبقية.
- إنشاء return request.
- اختيار reason.
- رفع صور عند الحاجة [Later/V1 candidate حسب pilot].
- اختيار طريقة return/shipping.
- تتبع حالة return.
- عرض refund status مستقلًا.
- طلب exchange مستقبلًا.

لا يجب كشف provider secrets أو internal accounting IDs للتطبيق.

## 12. RBAC / Audit requirements

صلاحيات منفصلة مرشحة:

- returns.view
- returns.create
- returns.approve
- returns.inspect
- returns.resolve
- refunds.view
- refunds.create
- refunds.approve
- refunds.override_amount [high risk]
- store_credit.issue [later/high risk]

Audit log يجب أن يحفظ actor, channel, device/source عند توفره, reason, previous/new state, quantities, monetary amounts, payment/provider references, inventory disposition، والمستند المحاسبي الناتج.

## 13. Idempotency & concurrency

حالات يجب حمايتها:

- duplicate return submission من mobile/web.
- ضغط زر refund مرتين.
- webhook refund success مكرر.
- return lines متزامنة لنفس الكمية.
- refund متزامن من Back Office وpayment webhook.

كل mutation مالية/مخزنية تحتاج transaction boundaries وlocking/atomic validation مناسبًا بعد فحص stack الحالي.

## 14. Classification

| Capability | Decision | Phase |
|---|---|---|
| Return مستقل عن Refund | ADOPT | V1 |
| Partial returns | ADOPT | V1-foundation |
| Return reasons | ADOPT | V1 |
| Return shipping/tracking | CONFIGURABLE | V1-foundation |
| Inspection | ADOPT | V1 foundation/basic UI |
| Inventory disposition | ADOPT | V1-foundation |
| Refund to original payment | ADOPT | V1 |
| Async refund lifecycle | ADOPT | V1 |
| Exchange | ADVANCED | foundation now, UI later |
| Replacement | ADVANCED | Later |
| Store Credit | ADVANCED | Later after accounting/customer audit |
| Repair resolution | ADVANCED | Later |
| Restocking fee | CONFIGURABLE | Later |
| Return shipping fee | CONFIGURABLE | Later/V1 if pilot needs |
| Self-service returns | ADOPT | Mobile/Web phased |
| Refund before receipt | CONFIGURABLE high-risk | Later/default off |
| Credit Note accounting boundary | ADOPT | mandatory |

## 15. Gate before implementation

قبل schema/API/implementation يجب فحص أَوْج الحالي في:

1. Sales returns / credit notes.
2. Purchase returns إن كان هناك shared patterns.
3. Inventory movements and valuation provenance.
4. Invoice posting/reversal rules.
5. ZATCA credit/debit note flows.
6. Payment transactions/refunds إن وجدت.
7. POS refunds/returns إن وجدت.
8. RBAC permissions.
9. Tenant scoping.
10. Existing idempotency foundations.

النتيجة المطلوبة من الفحص لكل capability:

- **REUSE**
- **EXTEND**
- **NEW**
- مع file/code evidence.

## 16. القرار الحالي

تم اعتماد اتجاه البحث التالي فقط، وليس التنفيذ:

> AWJ Commerce يبني Returns كـoperational domain مستقل، وRefunds كـfinancial transaction domain مستقل، ويترك Credit Notes والقيود إلى Accounting boundary الحالية. Exchanges وStore Credit وRepair تبقى extensions مخططة دون تلويث V1.

**لا DB migration، لا API، لا production code، لا PR، لا deploy ضمن هذه الجولة.**
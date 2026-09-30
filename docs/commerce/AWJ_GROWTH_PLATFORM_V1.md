# AWJ Growth Platform V1 — Ads, Publishing, Messaging & AI

**Status:** Product / Architecture Baseline  
**Scope:** Documentation only — no implementation, merge, deploy, or production changes  
**Base SHA:** `b3a71ad19e5dcde74e0682524391dcf0691ac8fe`  
**Date:** 2026-09-30

---

## 1. الهدف

بناء طبقة نمو وتسويق موحدة داخل **أَوْج AWJ** تربط التجارة والمخزون والعملاء والمبيعات بالمحتوى والإعلانات والرسائل.

المنصات المستهدفة في V1:

- Instagram
- Facebook
- TikTok
- Snapchat
- Google Ads
- YouTube Ads
- WhatsApp Business Platform

المنتج المقترح داخل أَوْج:

> **AWJ Growth**

وتحته ست مساحات رئيسية:

1. **Ads**
2. **Publishing**
3. **Messaging**
4. **Analytics**
5. **Automation**
6. **AWJ Growth AI**

الذكاء الاصطناعي **جزء أساسي من Product Scope منذ البداية**، وليس إضافة تجميلية لاحقة. لكنه يُفعّل بصلاحيات تدريجية ومضبوطة حتى لا ينفذ إنفاقًا أو تغييرات حساسة بلا Guardrails وموافقة مناسبة.

---

## 2. المبدأ الأساسي

أَوْج لا يجب أن يكون مجرد واجهة لإعادة فتح أدوات Meta أو TikTok أو Snapchat أو Google Ads.

القيمة الحقيقية هي **Closed-loop Growth System**:

```text
Product / Inventory / Price
        ↓
Campaign / Content / Message
        ↓
Channel Delivery
        ↓
Clicks / Leads / Conversations
        ↓
Store / Checkout / POS
        ↓
Order / Invoice / Payment / Return
        ↓
Revenue / Cost / Gross Profit
        ↓
Optimization
```

هذا يجعل أَوْج قادرًا على قياس **الربح الفعلي** وليس فقط مؤشرات المنصات الإعلانية.

---

## 3. القنوات

### 3.1 Meta

يُعامل Facebook وInstagram كـ Provider إعلاني واحد على مستوى البنية:

```text
Meta Provider
├── Facebook Ads
├── Instagram Ads
├── Instagram Publishing
├── Instagram Messaging
└── Meta Conversions / Catalog
```

ويظل WhatsApp قناة مستقلة وظيفيًا حتى لو كان ضمن منظومة Meta:

```text
WhatsApp Provider
├── Business Platform
├── Templates
├── Service conversations
├── Campaign messaging
├── Order notifications
└── Customer support
```

### 3.2 TikTok

```text
TikTok Provider
├── Ads
├── Content Posting
├── Creative assets
├── Campaign reporting
└── Conversion tracking
```

**Evidence:** TikTok Content Posting API يدعم النشر المباشر ورفع المحتوى كمسودة، ويدعم الصور والفيديو.  
Official docs:
- https://developers.tiktok.com/products/content-posting-api
- https://developers.tiktok.com/docs/en/content-posting-api-get-started

### 3.3 Snapchat

```text
Snapchat Provider
├── Ads
├── Creatives
├── Audiences
├── Conversion tracking
└── Reporting
```

النشر العضوي والرسائل يجب ألا يُفترضا مكافئين لقدرات Instagram أو TikTok بدون تحقق API مستقل قبل التنفيذ.

Official developer docs:
- https://developers.snap.com/
- https://developers.snap.com/api/marketing-api/

### 3.4 Google Ads + YouTube

Google Ads يُعامل كـ Provider مستقل، وYouTube أحد أهم Surfaces داخله مع قدرات خاصة للفيديو وShorts وCreator/Video discovery.

```text
GoogleAdsProvider
├── Search
├── Performance Max
├── Demand Gen
│   ├── YouTube
│   ├── YouTube Shorts
│   ├── Discover
│   ├── Gmail
│   ├── Maps
│   └── Google Display Network
├── Shopping / Merchant-linked campaigns
├── YouTube video campaigns
├── Conversion tracking
├── Enhanced Conversions
└── Reporting / Measurement
```

**Evidence — 2026:** Google يوضح أن Performance Max يصل إلى Inventory عبر YouTube وDisplay وSearch وDiscover وGmail وMaps من حملة واحدة، بينما Demand Gen يغطي YouTube بما فيه Shorts إضافة إلى Discover وGmail وMaps وGDN.

Official docs:
- https://support.google.com/google-ads/answer/10724817
- https://support.google.com/google-ads/answer/13695777
- https://support.google.com/google-ads/answer/16040528
- https://support.google.com/google-ads/answer/16042442

---

## 4. AWJ Ads

### 4.1 إنشاء حملة موحدة

يمكن للمستخدم أن يبدأ من منتج أو مجموعة منتجات:

```text
Product → Promote
```

ثم يحدد:

- الهدف
- الميزانية
- المدة
- القنوات
- الجمهور
- المدن / المناطق
- Creative
- Landing page
- حدود الإنفاق

أَوْج ينشئ تمثيلًا داخليًا موحدًا للحملة، ثم يحوله إلى الصيغة المناسبة لكل Provider.

### 4.2 نموذج الحملة الداخلي

```text
GrowthCampaign
├── tenant_id
├── objective
├── budget
├── start_at
├── end_at
├── products[]
├── audiences[]
├── creatives[]
├── destinations[]
├── provider_campaigns[]
└── guardrails
```

لا يتم ربط منطق AWJ مباشرة بـ IDs أو enums الخاصة بمنصة واحدة.

### 4.3 الميزانيات والضوابط

أي Automation تؤثر على إنفاق حقيقي يجب أن تعمل ضمن Guardrails واضحة:

- Daily spend cap
- Campaign total cap
- Max automated increase %
- Max automated decrease %
- Stop-loss threshold
- Minimum data window
- Human approval option
- Audit trail

---

## 5. AWJ Publishing

النشر العضوي جزء مستقل عن Ads.

### 5.1 الوظائف

- إنشاء منشور من منتج
- إنشاء Caption
- Hashtags
- صور
- فيديو قصير
- Reel / short video حيث تسمح المنصة
- جدولة النشر
- Draft
- Review
- Publish
- Status
- Failure / retry
- Content Calendar

### 5.2 التدفق

```text
Product
  ↓
Create Content
  ↓
Channel Variants
  ↓
Review
  ↓
Schedule / Publish
  ↓
Provider status
```

### 5.3 Content Calendar

يعرض:

- اليوم والساعة
- المنصة
- المنشور
- المنتج
- الحالة
- الموظف
- نتائج أساسية

الحالات:

```text
DRAFT
READY
SCHEDULED
PUBLISHING
PUBLISHED
FAILED
CANCELLED
```

---

## 6. AWJ Messaging

### 6.1 WhatsApp أولًا

WhatsApp Business Platform هو القناة الأساسية للرسائل التجارية في V1.

الوظائف:

- ربط حساب WhatsApp Business الخاص بالمنشأة
- إدارة Templates
- إرسال فاتورة
- تأكيد طلب
- إشعار دفع
- تحديث شحن
- Abandoned cart
- Customer service
- Campaigns المسموح بها
- Delivery/read status
- Opt-out
- Consent records

### 6.2 Unified Inbox

يكون الهدف طويل المدى:

```text
AWJ Inbox
├── WhatsApp
├── Instagram
└── future supported channels
```

لكن لا يتم افتراض دعم الرسائل لأي Provider قبل إثباته رسميًا.

---

## 7. Analytics

AWJ Growth يجب أن يربط بيانات المنصة ببيانات ERP/Commerce.

### 7.1 مؤشرات المنصة

- Spend
- Impressions
- Reach
- Clicks
- CTR
- CPC
- CPM
- Leads
- Platform conversions
- ROAS

### 7.2 مؤشرات أَوْج

- Orders
- Paid orders
- Revenue
- Discounts
- Returns
- Refunds
- COGS
- Shipping cost
- Gross profit
- Contribution margin
- New customers
- Repeat customers

### 7.3 المؤشرات الأهم

```text
True ROAS
Profit per Campaign
Profit per Product
CAC
Net CAC
Gross Profit after Ads
Contribution Margin after Ads
Return-adjusted Revenue
Stock-aware campaign performance
```

الهدف: منع القرار الخاطئ الناتج عن الاعتماد على ROAS وحده.

---

## 8. Automation

الأتمتة تأتي بعد استقرار Tracking وAttribution.

أمثلة:

```text
IF inventory < 5
THEN pause product ads
```

```text
IF CPA > configured_limit
AND sample_size >= threshold
THEN reduce budget
```

```text
IF campaign profit < 0
FOR configured duration
THEN notify + optionally pause
```

```text
IF product margin high
AND stock healthy
AND conversion strong
THEN suggest budget increase
```

في المراحل الأولى، الأفضل أن تكون الإجراءات المالية **Suggest → Approve → Apply** قبل الانتقال لأتمتة كاملة.

---

## 9. AWJ Growth AI

### 9.1 الدور

**AWJ Growth AI** هو طبقة ذكاء فوق Ads / Publishing / Messaging / Analytics / Automation، ولا يستبدل Provider APIs أو قواعد الأمان أو القيود الرسمية للمنصات.

وظائفه المستهدفة:

- إنشاء نصوص الإعلانات والعناوين والـCTA والـHashtags.
- إنشاء Variants متعددة لكل منصة بدل نسخ إعلان واحد حرفيًا.
- اقتراح أفكار الصور والفيديو والـHooks والسيناريوهات القصيرة.
- تحليل أداء Campaign / Ad Set / Ad / Creative.
- اكتشاف الإنفاق غير الفعال والانحرافات والـCreative fatigue.
- اقتراح توزيع الميزانيات بين Meta / TikTok / Snapchat / Google Ads / YouTube.
- مراعاة المخزون والسعر والهامش والمرتجعات قبل التوصية.
- اقتراح شرائح العملاء وحملات WhatsApp المناسبة ضمن قواعد الموافقة والـconsent.
- تلخيص أسباب التوصيات بلغة قابلة للفهم والتدقيق.

### 9.2 مستويات التشغيل

يجب أن يدعم أَوْج ثلاث درجات واضحة للصلاحية:

```text
LEVEL 1 — SUGGEST
AI analyzes → recommends → no external change

LEVEL 2 — APPROVE
AI prepares action → human approves → AWJ applies

LEVEL 3 — GUARDED AUTO
AI may act automatically only inside explicit tenant guardrails
```

الافتراضي في المراحل الأولى هو **Suggest** ثم **Approve**. لا يتم الانتقال إلى التنفيذ التلقائي إلا بعد وجود Tracking وAttribution موثوقين وسجل تدقيق كامل.

### 9.3 Guardrails إلزامية

أي قرار قد يسبب إنفاقًا أو إيقاف حملة يجب أن يخضع إلى حدود يحددها Tenant، مثل:

- Maximum daily budget.
- Maximum campaign spend.
- Maximum budget increase/decrease percentage per period.
- Stop-loss threshold.
- Minimum observation window.
- Minimum conversion/sample threshold.
- Minimum stock threshold.
- Human approval requirement.
- Allowed channels/actions.
- Audit log لكل اقتراح وقرار وتنفيذ.

### 9.4 Profit-aware AI

لا يجوز تقييم الحملات على ROAS وحده.

مثال:

```text
Ad Spend                1,000 SAR
Attributed Revenue      5,000 SAR
COGS                    2,600 SAR
Shipping                  400 SAR
Discounts                 300 SAR
Returns                   500 SAR
--------------------------------
Contribution after ads    200 SAR
```

في هذه الحالة، لا يصف AWJ Growth AI الحملة بأنها ناجحة فقط لأن Platform ROAS مرتفع؛ بل يوضح أثر التكلفة والمرتجعات والهامش.

### 9.5 أمثلة توصيات

```text
TikTok CPA أقل، لكن Meta يحقق هامش مساهمة أعلى.
اقتراح: تحويل 20% من ميزانية Snapchat إلى Meta.
سبب الاقتراح: profit-adjusted performance وليس clicks فقط.
```

```text
Inventory for Product X = 4
اقتراح: إيقاف زيادة الميزانية وعدم إطلاق Creative جديد حتى إعادة التوريد.
```

```text
Creative Y frequency مرتفعة وCTR يتراجع.
اقتراح: إنشاء 3 Variants جديدة مع Hooks مختلفة، مع بقاء الحملة الحالية دون تعديل حتى الموافقة.
```

### 9.6 Explainability & Audit

كل Recommendation يجب أن تحتوي على:

- ما الذي لاحظه النظام؟
- ما البيانات المستخدمة؟
- ما التغيير المقترح؟
- ما الأثر المتوقع بصيغة احتمالية/تقديرية لا كضمان؟
- ما حدود المخاطرة؟
- هل يحتاج موافقة بشرية؟
- من وافق ومتى؟
- ما نتيجة التنفيذ الفعلية؟

### 9.7 AI Safety Boundary

الـAI لا:

- يتجاوز سياسات Meta/TikTok/Snapchat/WhatsApp.
- يرسل حملات رسائل دون consent والسياسات المطلوبة.
- ينشئ ميزانية غير محدودة.
- يغير حدود Tenant الأمنية أو RBAC.
- يخلط بيانات Tenants في prompt/context/retrieval.
- يعتبر توصياته حقائق محاسبية أو مالية نهائية دون بيانات ERP الموثقة.

---

## 10. Product UX

### 9.1 Navigation

```text
Growth
├── Overview
├── Ads
├── Publishing
├── Messages
├── Calendar
├── Audiences
├── Creatives
├── Analytics
├── Growth AI
├── Automations
└── Connections
```

### 9.2 Overview

بطاقات قليلة وواضحة:

- Ad Spend
- Revenue attributed
- Gross Profit
- Orders
- New Customers
- Active Campaigns

ثم مقارنة حسب القناة:

- Instagram
- Facebook
- TikTok
- Snapchat
- Google Ads
- YouTube
- WhatsApp

### 9.3 Product action

داخل صفحة المنتج:

```text
Growth
├── Create Ad
├── Create Post
├── Create Video
└── Send WhatsApp Campaign
```

---

## 11. Provider Architecture

```text
AWJ Growth Domain
        |
        v
Growth Provider Interface
        |
        +--> MetaProvider
        |
        +--> TikTokProvider
        |
        +--> SnapchatProvider
        |
        +--> GoogleAdsProvider
        |
        +--> WhatsAppProvider
```

كل Provider يعلن Capabilities بدل افتراض تطابق المنصات:

```text
capabilities:
- ads.create
- ads.read
- ads.update
- ads.pause
- publishing.image
- publishing.video
- publishing.schedule
- messaging.send
- messaging.receive
- insights.read
- audiences.manage
- catalog.sync
- conversions.send
```

الـUI يستخدم Capability Matrix لإظهار ما هو متاح فعلًا لكل قناة.

---

## 12. Multi-tenant

كل Tenant يربط حساباته بنفسه.

لا تستخدم AWJ حسابًا مركزيًا واحدًا لجميع العملاء.

المطلوب:

- Tenant-scoped credentials
- Encrypted token storage
- Token rotation
- OAuth state validation
- Webhook tenant resolution
- RBAC
- Full audit trail
- Least privilege
- Cross-tenant negative tests

---

## 13. Event Model

AWJ Growth يعتمد على Domain Events بدل الربط المباشر بالشاشات:

```text
ProductPublished
PriceChanged
InventoryLow
OrderCreated
OrderPaid
OrderCancelled
OrderRefunded
CustomerCreated
CartAbandoned
InvoicePosted
```

وتستهلكها:

- Conversion tracking
- Messaging
- Automation
- Campaign safety rules
- Analytics attribution

---

## 14. Attribution

لا يجب تثبيت نموذج Attribution واحد على كل القنوات.

نحتاج:

- Provider attribution
- AWJ first-party attribution
- UTM support
- click IDs where available
- server-side conversion events
- order linkage
- campaign/ad/creative linkage
- configurable attribution window

ويجب إظهار الفرق بين:

**Platform-reported conversions**  
و  
**AWJ-attributed orders**

بدون دمجهما في رقم واحد غير قابل للتدقيق.

---

## 15. مقارنة مرجعية مع Salla

سلة تُستخدم كـ **Benchmark UX/Product** وليس كمرجع معماري يُنسخ.

الأنماط المهمة التي نستفيد منها:

- ربط قنوات الإعلان من منصة التجارة
- تقليل انتقال التاجر بين أدوات متعددة
- ربط Catalog/Tracking بالإعلانات
- Social sharing / communication integrations
- جعل التسويق جزءًا من Commerce Workspace

قرار AWJ:

> نذهب أبعد من مجرد Ads Manager، ونربط الإنفاق مباشرة بالمخزون والطلبات والفواتير والتكلفة والربح.

مرجع:
- https://help.salla.sa/
- https://docs.salla.dev/

---

## 16. Modern Growth & Rapid Distribution Playbook — 2026 Evidence

هذه ليست قائمة Tricks أو وعود Viral. هي اتجاهات حديثة مثبتة في منتجات الإعلان الرسمية خلال 2026، وتُستخدم كـ **AWJ product requirements** لا كضمان نتائج.

### 16.1 AI-native campaign buying

المنصات تتحرك من إعدادات يدوية كثيرة إلى حملات مدعومة بالذكاء الاصطناعي مع بقاء Guardrails للمعلن:

- **Google Performance Max**: هدف واحد عبر Search / YouTube / Display / Discover / Gmail / Maps.
- **TikTok Smart+**: يدعم Full / Partial / Manual automation مع تحكم بالاستهداف والميزانية والـCreative.
- **Meta Advantage / Reels automation**: توزيع وتحسين Creative/placements بالذكاء الاصطناعي.

**AWJ Decision:** لا نبني Automation تنافس خوارزمية كل منصة في المزاد نفسه؛ نبني طبقة أعلى تقوم باختيار الهدف والميزانية والـassets والقيود، ثم تترك Delivery Optimization للمنصة وتراقب الربح الحقيقي.

### 16.2 Short-form vertical video as default creative surface

النمط الأهم للاكتشاف السريع حاليًا هو **9:16 short-form video** عبر:

- Instagram/Facebook Reels
- TikTok
- YouTube Shorts
- Snapchat vertical placements

Google يدعم Shorts ضمن Demand Gen وأنواع حملات فيديو متعددة، وMeta يوصي بـReels-native 9:16 creative، بينما TikTok يبني Smart+ وSpark Ads حول Creative أصلي للمنصة.

**AWJ Requirement:** كل Creative رئيسي يجب أن يستطيع إنتاج Variants:
- 9:16
- 1:1
- 4:5
- landscape عند الحاجة

مع Safe Zones ونصوص وCTA مختلفة حسب Placement.

### 16.3 Creator / UGC amplification

الطريقة الحديثة ليست أن تصنع العلامة التجارية كل شيء بنفسها؛ بل اكتشاف محتوى Creators/UGC ثم تحويل الأفضل إلى إعلان:

- TikTok Spark Ads يحول Organic TikTok إلى إعلان مع الحفاظ على الطابع الأصلي.
- TikTok One Content Suite يستخدم AI لاكتشاف UGC مناسب للعلامة وتسريع تفعيله.
- Meta Partnership/Reels ads تسمح بترويج محتوى Creator.
- Google/YouTube Creator Partnerships تسمح باستخدام Creator assets داخل Demand Gen.

**AWJ Requirement:** مستقبلًا يكون لدينا **Creator/UGC Asset Library** مع:
- source creator
- usage rights / authorization
- platform
- product linkage
- organic performance
- paid performance
- expiry / permission status

### 16.4 Creative velocity + AI variation

الاتجاه الحديث هو كثرة التجارب الإبداعية السريعة بدل Creative واحد لفترة طويلة:

- TikTok Symphony يولد/يعدل الفيديو والصور والترجمة والدبلجة والـavatars.
- Google Demand Gen يستخدم Gemini/Veo لاقتراح وتحويل/توسيع Creative.
- Meta Advantage+ Creative يعيد تهيئة assets للمقاسات والplacements.

**AWJ Decision:** Growth AI يجب أن يقيس **Creative Velocity** و**Creative Fatigue** ويقترح Variants جديدة قبل هبوط الأداء.

### 16.5 First-party data + server-side conversion signals

دقة الإعلان الحديثة تعتمد أكثر على بيانات الطرف الأول بدل الاعتماد على cookies فقط.

Google Enhanced Conversions في 2026 يقبل first-party user-provided data من tags وData Manager وAPI، مع hashing قبل الاستخدام.

**AWJ Requirement:** نبني Conversion/Event Gateway موحدًا يدعم:
- browser events
- server-side events
- order-paid events
- refund/cancellation events
- hashed first-party identifiers عندما تسمح السياسات
- consent state
- provider-specific event IDs
- deduplication

### 16.6 Profit-aware optimization, not platform ROAS only

منصة الإعلان ترى conversion/revenue بحسب Attribution الخاص بها. أَوْج يرى أيضًا:

- COGS
- discounts
- refunds
- shipping
- tax treatment
- payment costs where applicable
- inventory
- actual invoice/payment state

**AWJ Decision:** أهم ميزة تنافسية هي **Profit-aware media optimization**.

### 16.7 Incrementality + MMM + experiments

Attribution وحده لا يثبت أن الإعلان تسبب في المبيعات.

Google في 2026 يدفع باتجاه:
- first-party data foundation
- causal/incrementality experiments
- Meridian MMM
- GeoX experiments
- Scenario Planner / budget planning

**AWJ Requirement:** Analytics roadmap يجب أن يضيف لاحقًا:
- incrementality tests
- geo experiments
- holdout groups
- MMM-compatible exports
- marginal ROI / budget scenario planning

### 16.8 Conversational commerce

الرحلة الإعلانية الحديثة يمكن أن تنتهي في محادثة بدل Landing Page فقط:

```text
Ad
→ WhatsApp / Instagram conversation
→ qualification
→ product recommendation
→ checkout/order
→ invoice/payment
```

**AWJ Requirement:** Click-to-message / conversation-origin metadata يجب أن يحتفظ به أَوْج حتى يمكن ربط المحادثة بالطلب والربح.

### 16.9 AI agents connected directly to ad platforms

في 2026 بدأت المنصات نفسها تفتح طبقات رسمية لوكلاء AI:

- Snapchat أطلق **Snap Ads MCP Server** الرسمي لربط AI agents ببيانات Snap Ads.
- TikTok يوسع Smart+ وSymphony Agent كطبقة AI للحملات والCreative.
- Google يضيف قدرات Agentic داخل measurement/commerce workflows.

**AWJ Decision:** بنية AWJ Growth Agent يجب أن تكون Provider-aware، لكن كل Action يمر عبر:
RBAC → Tenant guardrails → policy validation → audit → execution.

### 16.10 Rapid-distribution loop

الانتشار السريع لا يُبنى على "زر Viral". النموذج الصحيح:

```text
Organic test
→ detect winner
→ creator/UGC permission
→ paid amplification
→ short-form variants
→ cross-channel distribution
→ first-party conversion signals
→ profit measurement
→ AI recommendation
→ refresh winning creative
```

هذه الحلقة تجمع Organic + Paid + Creator + Commerce + AI بدل فصلها.

### 16.11 AWJ Viral / Momentum Signals — Proposal

لا ندّعي توقع Viral بشكل يقيني، لكن يمكن بناء Signals تساعد على التقاط الزخم مبكرًا:

- View velocity
- watch-time / completion
- share rate
- save rate
- comment velocity
- profile/product click rate
- organic-to-paid conversion
- creator reuse potential
- CPA trend after paid boost
- stock readiness
- margin readiness

إذا تحققت Thresholds موثقة، يقترح Growth AI:
- Boost / Spark / Partnership promotion
- Cross-post variant
- New hook
- Budget increase داخل Guardrail
- Inventory warning قبل التوسع

---

## 17. Phased Roadmap

### Phase 0 — Evidence & Contracts

- Official API evidence matrix
- Auth/OAuth requirements
- App review requirements
- Rate limits
- Webhooks
- Supported ad actions
- Supported publishing actions
- Messaging restrictions
- Catalog/conversion APIs
- Saudi/regional availability
- Cost model

**No implementation before this phase closes.**

### Phase 1 — Connections Foundation

- Provider abstraction
- OAuth connections
- Token vault
- Webhook ingestion
- Capability registry
- Tenant isolation
- RBAC
- Audit log

### Phase 2 — Tracking & Analytics Foundation

- UTM model
- conversion events
- order attribution
- campaign/ad/creative IDs
- channel dashboard
- profit-aware metrics

### Phase 3 — Ads Read

- Import accounts
- campaigns
- ad sets / groups
- ads
- spend
- results
- dashboard

**Read-first before write.**

### Phase 4 — Ads Write

- Create campaign
- budget
- audience
- creative
- pause/resume
- review flow
- provider status/errors

### Phase 5 — Publishing

- Content composer
- channel variants
- Content Calendar
- scheduling
- publish status
- retries

### Phase 6 — WhatsApp

- Official Business Platform connection
- Templates
- transactional notifications
- Inbox
- campaigns
- consent/opt-out

### Phase 7 — AI Assist + Automation

- AI campaign draft generation
- creative variants
- copy generation
- anomaly detection
- explainable recommendations
- rules
- alerts
- approval workflow
- stock-aware recommendations
- profit-aware recommendations
- controlled auto-actions

في هذه المرحلة يكون المسار الافتراضي **Suggest → Approve → Apply**.

### Phase 8 — Advanced AI Growth Agent

- cross-channel budget recommendations
- campaign/creative fatigue detection
- guarded budget reallocation
- stock-aware pause/resume suggestions
- profit-aware optimization
- customer-segment recommendations
- WhatsApp campaign assistance within consent/policy constraints
- autonomous actions only inside tenant-defined guardrails

الـAgent لا يملك إنفاقًا غير محدود، وكل إجراء مالي أو خارجي حساس يخضع للـGuardrails وRBAC وAudit، مع إمكانية فرض Human Approval على مستوى Tenant.

---

## 18. Definition of Done لكل Provider

لا يعتبر Provider جاهزًا بمجرد نجاح OAuth.

يجب إثبات:

1. Connection
2. Token refresh / renewal behavior
3. Tenant isolation
4. Webhook verification
5. Read operations
6. Write operations المطلوبة
7. Error mapping
8. Rate limit handling
9. Retry/idempotency
10. Audit
11. Production-like verification
12. Official platform review/approval where required
13. Revocation/disconnect behavior

---

## 19. قرارات V1 المثبتة

- الاسم المبدئي: **AWJ Growth**
- القنوات الأساسية: Instagram, Facebook, TikTok, Snapchat, Google Ads, YouTube, WhatsApp.
- Facebook + Instagram Ads تحت Meta Provider.
- WhatsApp Provider مستقل وظيفيًا.
- Ads وPublishing وMessaging Modules منفصلة.
- Unified Analytics فوق الجميع.
- Provider Capability Matrix إلزامية.
- Multi-tenant credentials لكل منشأة.
- Read-before-write في الإعلانات.
- **AWJ Growth AI جزء أساسي من Product Scope منذ V1، وليس Feature جانبية.**
- AI يعمل تدريجيًا عبر: **Suggest → Approve → Guarded Auto**.
- Automation المالية تبدأ بموافقة بشرية، ولا تصبح تلقائية إلا ضمن Tenant Guardrails صريحة.
- كل AI Recommendation يجب أن تكون Explainable وقابلة للتدقيق.
- الربح الحقيقي والمخزون والتكلفة والمرتجعات جزء من منطق AI والتحسين.
- Salla benchmark، لا copy.
- لا تنفيذ API بناءً على افتراض؛ Evidence-first من الوثائق الرسمية.

---

## 20. Evidence Register — البداية

| Platform | Capability | Official source | Status |
|---|---|---|---|
| TikTok | Direct post / upload | https://developers.tiktok.com/products/content-posting-api | Verified |
| TikTok | Direct Post guide | https://developers.tiktok.com/docs/en/content-posting-api-get-started | Verified |
| TikTok | App review | https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines | Verified |
| Snapchat | Developer platform | https://developers.snap.com/ | To detail in Phase 0 |
| Snapchat | Marketing API | https://developers.snap.com/api/marketing-api/ | To detail in Phase 0 |
| Meta | Ads / Instagram / WhatsApp | Official Meta developer documentation | To detail in Phase 0 |
| Google | Performance Max | https://support.google.com/google-ads/answer/10724817 | Verified baseline |
| Google | Demand Gen / YouTube / Shorts | https://support.google.com/google-ads/answer/13695777 | Verified baseline |
| Google | Enhanced Conversions | https://support.google.com/google-ads/answer/15712870 | Verified baseline |
| Google | Measurement / Meridian | https://blog.google/products/ads-commerce/data-strength-updates/ | Verified 2026 direction |
| Salla | Benchmark only | https://help.salla.sa/ + https://docs.salla.dev/ | Benchmark |

---

## 21. ما ليس ضمن هذه الوثيقة

هذه الوثيقة لا:

- تعتمد API contract نهائيًا لأي Provider.
- تثبت أن كل ميزة متاحة في السعودية قبل Evidence Pass.
- تسمح بالدمج أو النشر.
- تسمح بتنفيذ إنفاق أو إرسال رسائل بدون موافقات وسياسات المزود.
- تستبدل توثيق Provider-specific implementation contracts.
- تمنح AI صلاحية إنفاق أو إرسال أو تعديل غير محدودة؛ التنفيذ الذكي يبقى محكومًا بالـRBAC والـGuardrails والـAudit.

الخطوة التالية الصحيحة بعد اعتماد هذه الوثيقة:

> **AWJ-GROWTH-EVIDENCE-1 — Official Platform Capability & Integration Matrix**

ويجب أن يغطي Meta / Instagram / Facebook / TikTok / Snapchat / Google Ads / YouTube / WhatsApp بالتوثيق الرسمي، ثم يقفل النطاق الواقعي للـV1 قبل كتابة الكود.

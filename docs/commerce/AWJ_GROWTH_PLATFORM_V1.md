# AWJ Growth Platform V1 — Ads, Publishing & Messaging

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
- WhatsApp Business Platform

المنتج المقترح داخل أَوْج:

> **AWJ Growth**

وتحته خمس مساحات رئيسية:

1. **Ads**
2. **Publishing**
3. **Messaging**
4. **Analytics**
5. **Automation**

---

## 2. المبدأ الأساسي

أَوْج لا يجب أن يكون مجرد واجهة لإعادة فتح أدوات Meta أو TikTok أو Snapchat.

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

## 9. Product UX

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

## 10. Provider Architecture

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

## 11. Multi-tenant

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

## 12. Event Model

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

## 13. Attribution

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

## 14. مقارنة مرجعية مع Salla

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

## 15. Phased Roadmap

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

### Phase 7 — Automation

- rules
- alerts
- recommendations
- approval workflow
- controlled auto-actions

### Phase 8 — AI Growth Agent

- campaign draft generation
- creative variants
- copy generation
- anomaly detection
- budget recommendations
- stock-aware actions
- profit-aware recommendations

الـAgent لا يملك إنفاقًا غير محدود، وكل إجراء مالي يخضع للـGuardrails.

---

## 16. Definition of Done لكل Provider

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

## 17. قرارات V1 المثبتة

- الاسم المبدئي: **AWJ Growth**
- القنوات الأساسية: Instagram, Facebook, TikTok, Snapchat, WhatsApp.
- Facebook + Instagram Ads تحت Meta Provider.
- WhatsApp Provider مستقل وظيفيًا.
- Ads وPublishing وMessaging Modules منفصلة.
- Unified Analytics فوق الجميع.
- Provider Capability Matrix إلزامية.
- Multi-tenant credentials لكل منشأة.
- Read-before-write في الإعلانات.
- Automation المالية تبدأ بموافقة بشرية.
- الربح الحقيقي والمخزون جزء من منطق التحسين.
- Salla benchmark، لا copy.
- لا تنفيذ API بناءً على افتراض؛ Evidence-first من الوثائق الرسمية.

---

## 18. Evidence Register — البداية

| Platform | Capability | Official source | Status |
|---|---|---|---|
| TikTok | Direct post / upload | https://developers.tiktok.com/products/content-posting-api | Verified |
| TikTok | Direct Post guide | https://developers.tiktok.com/docs/en/content-posting-api-get-started | Verified |
| TikTok | App review | https://developers.tiktok.com/docs/en/our-guidelines-developer-guidelines | Verified |
| Snapchat | Developer platform | https://developers.snap.com/ | To detail in Phase 0 |
| Snapchat | Marketing API | https://developers.snap.com/api/marketing-api/ | To detail in Phase 0 |
| Meta | Ads / Instagram / WhatsApp | Official Meta developer documentation | To detail in Phase 0 |
| Salla | Benchmark only | https://help.salla.sa/ + https://docs.salla.dev/ | Benchmark |

---

## 19. ما ليس ضمن هذه الوثيقة

هذه الوثيقة لا:

- تعتمد API contract نهائيًا لأي Provider.
- تثبت أن كل ميزة متاحة في السعودية قبل Evidence Pass.
- تسمح بالدمج أو النشر.
- تسمح بتنفيذ إنفاق أو إرسال رسائل بدون موافقات وسياسات المزود.
- تستبدل توثيق Provider-specific implementation contracts.

الخطوة التالية الصحيحة بعد اعتماد هذه الوثيقة:

> **AWJ-GROWTH-EVIDENCE-1 — Official Platform Capability & Integration Matrix**

ويجب أن يغطي Meta / Instagram / Facebook / TikTok / Snapchat / WhatsApp بالتوثيق الرسمي، ثم يقفل النطاق الواقعي للـV1 قبل كتابة الكود.

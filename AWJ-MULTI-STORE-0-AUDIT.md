# AWJ-MULTI-STORE-0 — تدقيق العمارة الحالية للمتاجر والفروع

**المستودع:** `safwan5001-source/Nebrax`  
**نطاق التدقيق:** `origin/main` فقط  
**Base SHA المفحوص:** `a53bcd0ab3a5b6e9e9bffcc7e6be588ddbf64c7a`  
**تاريخ التدقيق:** 2026-10-06

> هذا التقرير يصف التنفيذ الحالي ويقترح حدوداً وخطوات مستقبلية فقط. لم تُنشأ هجرات، ولم يُعدّل سلوك الإنتاج، ولم يُفتح PR، ولم يحدث دمج أو نشر.

## Executive Summary

النتيجة المركزية هي أن Nebrax لا يطبّق حالياً نموذج **Tenant → Store واحد** على مستوى قاعدة البيانات؛ بل يملك نموذجاً منفصلاً وقابلاً للتعدد نظرياً: `Tenant` يملك `SalesChannel`، و`Storefront` يربط نفسه بقناة بيع من نوع `web`، والنطاقات تربط hostname بمتجر. توجد قيود تفرّد على مستوى المستأجر للسلاج، وقيد عالمي للـ hostname، ولا يوجد قيد DB يقول إن للمستأجر متجراً واحداً فقط.

لكن التنفيذ التشغيلي الحالي ما يزال **single-store افتراضياً**:

- التزويد الرسمي يخلق/يقارب قناة `web` واحدة بسلاج `web` ومتجراً واحداً بسلاج `main` ونطاق AWJ مُدار واحداً؛ وهو مقصود أن يكون تزويد «أول متجر» لا منشئ متجر عام.
- لا يوجد API إداري عام لإنشاء Store ثانٍ؛ مسار `POST /commerce/workspace/storefronts` يستدعي هذا التزويد الأول idempotently.
- الحسم العام بالنطاق يدعم تعدد المتاجر من حيث البنية، بشرط أن يكون لكل متجر hostname فريد وموثّق.
- Commerce يفصل القناة عن الفرع والمخزن كما ينبغي، لكن `FulfillmentPolicy` الحالية تدعم قناة ← **مخزن تنفيذ واحد ثابت** فقط. هذا ليس بعد نموذج Store ← Branches.
- `CommerceOrder` يحمل `sales_channel_id` و`storefront_id` اختيارياً للطلبات القديمة/الجوالية، لكنه لا يحمل `branch_id` أو `warehouse_id`؛ التنفيذ يُحسم لاحقاً من سياسة القناة.
- لا توجد علاقة Store ↔ Branch حالياً. الفرع كيان CompanyWide، والمخزن قد يرتبط بفرع، أما المتجر/القناة فلا يرتبطان بأي فرع.

**الخلاصة:** الأساس الحالي مناسب للتوسع إلى تعدد المتاجر دون إعادة تعريف Storefront، لكن يلزم فصل واضح بين «إضافة متجر» و«تقارب المتجر الأول»، ثم بناء علاقة تنفيذ/تغطية مستقلة لا تخلط `SalesChannel` مع `Branch` أو `Warehouse`.

## Current Architecture

### الكيانات الأساسية

| المفهوم | النموذج/الجدول | الملكية والحقول المهمة | ملاحظات التعدد |
|---|---|---|---|
| المؤسسة | `Tenant` / `tenants` | الجذر الأمني؛ `TenantScope` و`BelongsToTenant` | مستأجر واحد قد يملك عدة سجلات تجارية من حيث التصميم |
| قناة البيع | `SalesChannel` / `sales_channels` | `tenant_id`, `slug`, `name`, `type`, `is_active`, soft delete | `slug` فريد داخل المستأجر؛ لا `branch_id` ولا `warehouse_id` |
| المتجر المستضاف | `Storefront` / `storefronts` | `tenant_id`, `sales_channel_id`, `slug`, `name`, `is_active`, `default_locale`, soft delete | `slug` فريد داخل المستأجر؛ كل متجر يرتبط بقناة واحدة |
| نطاق المتجر | `StorefrontDomain` / `storefront_domains` | `tenant_id`, `storefront_id`, `hostname`, `type`, `is_primary`, `is_active`, `verification_status` | hostname فريد عالمياً؛ يمكن لمتجر امتلاك عدة نطاقات، مع primary نشط واحد |
| الفرع | `Branch` / `branches` | مؤسسة/بنية داخلية، `is_main`، وعزل تشغيلي بحسب السياق | لا FK من Storefront أو SalesChannel إلى Branch |
| المخزن | `Warehouse` / `warehouses` | `tenant_id`, `branch_id` nullable، `is_active`, code | موقع مخزون يمكن أن يكون تابعاً لفرع أو مشتركاً للمؤسسة |
| سياسة التنفيذ | `FulfillmentPolicy` / `fulfillment_policies` | `tenant_id`, `sales_channel_id`, `warehouse_id` | قيد `unique(sales_channel_id)`؛ صفر أو سياسة واحدة لكل قناة |
| الطلب التجاري | `CommerceOrder` / `commerce_orders` | `tenant_id`, `sales_channel_id`, `storefront_id` nullable، checkout/customer refs، status/number | لا `branch_id` ولا `warehouse_id`؛ الطلب سجل تجاري لا فاتورة |
| السلة/الدفع | `CommerceCart`, `CommerceCheckout` | `tenant_id`, `sales_channel_id`, `storefront_id` بحسب مسار web/mobile | سياق الطلب/السلة يحدد المتجر والقناة، لا الفرع |
| نشر الكتالوج | `CommerceListing`, `CommerceCategoryListing` | `product_id/category_id` + `sales_channel_id` | النشر لكل قناة، وليس لكل فرع؛ قابل لتعدد القنوات |

### إجابات صريحة

**A. هل العمارة الحالية فعلياً Tenant → one SalesChannel → one Storefront؟**  
على مستوى المخطط: لا. `sales_channels` و`storefronts` قابلان لعدة سجلات داخل المستأجر. على مستوى التزويد والإدارة الافتراضية: نعم، المسار الحي يركز على قناة `web` واحدة ومتجر `main` واحد، ولذلك السلوك الفعلي للمستأجر الجديد single-store إلى أن تُضاف قناة/متجر آخر بطريقة أخرى.

**B. هل توجد قيود DB تفرض واحداً لكل Tenant؟**  
لا توجد قيود `unique(tenant_id)` على `sales_channels` أو `storefronts`. الموجود هو:

- `unique(tenant_id, slug)` في القنوات.
- `unique(tenant_id, slug)` في المتاجر.
- `unique(hostname)` عالمياً في النطاقات.
- فهرس فريد جزئي لمتجر واحد primary نشط.
- `unique(sales_channel_id)` لسياسة التنفيذ.

القيد التشغيلي على «أول متجر» يأتي من السلاجين الثابتين `web` و`main` ومن حراسة التطبيق، لا من منع تعدد القنوات/المتاجر كفئة.

**C. هل Storefront يتبع Tenant أم SalesChannel؟**  
يتضمن `tenant_id` مباشرة، ويرتبط بـ`SalesChannel` عبر `sales_channel_id`. عملياً هو كيان Tenant-owned مستقل يمثل واجهة مستضافة، مع تحقق خادمي بأن القناة من نفس المستأجر ومن نوع `web`. لذلك العلاقة الحالية: `Tenant 1—N Storefronts` و`SalesChannel 1—0/1 Storefront` بحسب invariant التطبيق، لا FK مركب يثبت تطابق المستأجرين وحده.

**D. ما هو Branch الحالي؟**  
الفرع تقسيم تشغيلي داخلي للمؤسسة، وليس حاجز tenant. النموذج/المعمارية تصنف الفروع والمخازن كـ`CompanyWide`، بينما البيانات التشغيلية مثل المنتجات وحركات/مستندات التشغيل تستخدم `BranchScoped` أو `BelongsToBranch` حسب الحالة. المخازن تحمل `branch_id` اختيارياً، وPOS وسياقات المستندات التشغيلية لها ربط فرعي. لا توجد حالياً علاقة مباشرة من Store أو SalesChannel إلى Branch.

## Database Relationships

### العلاقات الحالية

```text
Tenant
├── SalesChannel (1:N; slug فريد داخل Tenant)
│   ├── Storefront (حالياً القناة web فقط؛ التطبيق يتوقع واجهة web)
│   │   ├── StorefrontDomain (1:N; hostname فريد عالمياً)
│   │   ├── StorefrontPresentation / versions
│   │   ├── CommerceCart / Checkout / Order references
│   │   └── BusinessProfile / offers / delivery settings
│   ├── CommerceListing / CategoryListing
│   └── FulfillmentPolicy (0..1 → Warehouse)
├── Branch (1:N)
│   └── Warehouse (0..N؛ warehouse.branch_id nullable)
└── CommerceOrder / Commerce data (Tenant-scoped)
```

### القيود التي يجب الحفاظ عليها

- **Tenant isolation:** كل كيان Commerce يمر عبر `TenantScope`/`TenantContext`، مع حراسات ملكية إضافية في الخدمات الحساسة.
- **Channel identity:** `SalesChannel` لا يمثل Branch أو Warehouse؛ هذا الفصل موثق في النموذج والهجرات.
- **Storefront validity:** `Storefront::booted()` يمنع ربط متجر بقناة من مستأجر آخر أو غير `web`.
- **Domain authority:** `StorefrontDomain` هو مدخل الحسم العام، وhostname عالمي التفرّد لأن الاسم نفسه يحسم المستأجر قبل إنشاء `TenantContext`.
- **History preservation:** `CommerceOrder.sales_channel_id` مقيد بـ`restrictOnDelete`; `storefront_id` nullable ومقيد بـ`restrictOnDelete` لحفظ الطلبات القديمة والطلبات التي لا مصدر storefront لها.
- **Fulfillment:** `FulfillmentPolicy` لا يسمح حالياً إلا بسياسة مخزن واحدة للقناة، وهو قرار V1 وليس علاقة Store↔Branch.

## Provisioning Flow

### المسار الحالي

المسار الحي الصريح هو:

```text
POST /api/commerce/workspace/storefronts
  → صلاحية commerce.manage
  → StorefrontProvisioningService::provisionFirstStorefrontForCurrentTenant()
  → TenantContext::id() فقط كمصدر tenant
  → قفل صف Tenant داخل transaction
  → ensureWebSalesChannel()
  → ensureStorefront()
  → ensureManagedDomain()
  → response: store id/name/channel id/preview URL/locale/profile
```

### ما الذي ينشأ؟

1. قناة بيع `type=web`, `slug=web`, نشطة، باسم المتجر الإلكتروني إن لم توجد قناة web نشطة.
2. `Storefront` بسلاج `main`, نشط، locale افتراضي `ar`، واسم display name أو اسم المستأجر إن لم يوجد.
3. `StorefrontDomain` باسم يُولّد خادمياً من `tenants.slug` + `AWJ_STOREFRONT_BASE_DOMAIN`، نوعه `awj_subdomain`، نشط وموثّق فوراً، ويصبح primary إذا لم يوجد primary آخر.
4. ملف النشاط قد يُسند عند إنشاء المتجر فقط؛ إعادة التزويد لا تغيّر ملف متجر قائم.

### سلوك tenant الجديد

لا يوجد في الأدلة التي فُحصت إنشاء تلقائي عند كل تسجيل دخول أو GET أو تحميل لوحة التحكم. التزويد **صريح فقط** عبر POST محروس. لذلك إنشاء Tenant لا يعني بالضرورة إنشاء Storefront تلقائياً؛ المتجر ينشأ عندما يُستدعى مسار التزويد.

### Idempotency والتزامن

التزويد تقاربي لا استنساخي:

- يقفل صف المستأجر لتسلسل طلبين متزامنين للمستأجر نفسه.
- يفشل مغلقاً عند تعدد قنوات web النشطة أو تعدد المتاجر المرتبطة بالقناة.
- يتعامل مع احتلال السلاجين بحذف ناعم أو كيان متعارض كمشكلة تشغيلية، لا يعيد التصنيف تلقائياً.
- يعيد تفعيل Storefront/Domain المتوافقين عند الحاجة.
- يفحص hostname العالمي ويمنع تعارض المستأجر أو المتجر أو النوع.

### افتراضات one-store في هذا المسار

- `CHANNEL_SLUG = web` و`STOREFRONT_SLUG = main` ثابتان.
- `ensureWebSalesChannel()` يبحث عن قناة web نشطة واحدة ويستثني عند التعدد.
- `ensureStorefront()` يبحث عن متجر واحد مرتبط بالقناة ويستثني عند التعدد.
- هذا ممتاز كـ`provision first storefront`، لكنه ليس عقد `create arbitrary store`.

## API Findings

### الموجود

- `GET /api/commerce/workspace/storefronts`: قائمة متاجر الويب للمستأجر الحالي.
- `POST /api/commerce/workspace/storefronts`: تزويد **أول** متجر؛ ليس create-store عاماً.
- `PUT /api/commerce/workspace/storefronts/{id}`: تحديث الاسم واللغة وملف النشاط فقط.
- `POST .../{id}/activate|deactivate`: lifecycle للمتجر.
- مسارات نطاقات المتجر: قراءة/إضافة custom/تحقق/primary/edge.
- مسارات المظهر والنسخ والعروض والمنتجات/التصنيفات والإهداء والجدولة والتنفيذ، كلها nested تحت `{storefront_id}` وتعيد التحقق من الملكية.
- مسارات عامة Storefront تعتمد على Host و`ResolveStorefrontDomain`، بلا storefront id في الرابط.

### هل يمكن إنشاء متجر ثانٍ؟

**لا، ليس عبر API مدعوم حالياً.** مسار POST يستدعي `provisionFirstStorefrontForCurrentTenant` ويستعمل السلاجين الثابتين. لا توجد حمولة create تعطي `name/slug/channel` لإنشاء قناة/متجر إضافي، ولا workflow يختار سياسة uniqueness لمتجر ثانٍ.

قد يستطيع كود داخلي أو اختبار إنشاء سجلات مباشرة، لكن ذلك ليس عقداً عاماً ولا ينبغي اعتباره قدرة منتجية.

### هل الـ endpoints store-scoped أم ضمني؟

- Workspace بعد القائمة store-scoped في معظم عمليات الكتابة/الإعداد: `{storefront_id}` ثم حراسة `ownedStorefront`/TenantScope.
- قائمة المتاجر هي tenant-scoped.
- النطاق العام Host-scoped: لا يقبل معرّف متجر من العميل؛ Host هو السلطة.
- عمليات Commerce العامة للقناة الجوالة منفصلة عن Storefront ولا تفترض وجود متجر.
- بعض خدمات الكتالوج/النشر تتعامل مع جميع متاجر web النشطة للمستأجر، مع دعم اختيار `storefront_id` داخل المجموعة المصرح بها.

### نقطة يجب تدقيقها قبل التوسع

`CommerceOrderService::create()` و`CommercePriceResolver` يتحققان من وجود `sales_channel_id` تحت TenantScope، لكن العقد متعدد المتاجر يجب أن يفرض صراحةً اتساق `(storefront_id, sales_channel_id)` عندما يُرسل الاثنان، وأن يحدد ما إذا كان كل طلب العام يحمل Storefront أم قناة فقط. هذا ليس دليلاً على ثغرة حالية في المسارات المحروسة، بل شرط تصميم لا يجوز تركه ضمنياً عند إضافة create-store.

## Frontend Findings

### الصفحة الحالية

- الصفحة: `web/src/app/(commerce)/commerce/stores/page.tsx`
- الاختبار: `web/src/app/(commerce)/commerce/stores/page.test.tsx`
- سياق اختيار المتجر القابل لإعادة الاستخدام: `web/src/modules/commerce-workspace/store-context`، وتظهر إشاراته في صفحات appearance/domains/published-products وغيرها.
- عميل API العام في `web/src/lib/api.ts`، مع mock/dev harness في `web/src/lib/mock-data.ts`.

### السلوك الحالي

الصفحة تقرأ قائمة المتاجر عبر `GET /commerce/workspace/storefronts` وتعرض قائمة/حالة متجر، مع حالات no-store/error/loading حسب الاختبارات. السياق المشترك يدعم `stores` و`selectedStoreId`، وتستهلكه صفحات المتجر الأخرى؛ هذا مؤشر أن الواجهة الخلفية بدأت تستوعب أكثر من Storefront في طبقة القراءة/الاختيار.

لكن لا يظهر في الصفحة الحالية تدفق create-store مستقل أو نموذج لإنشاء قناة/متجر ثانٍ. التزويد هو تفعيل مسار «إنشاء أول متجر»، لا إنشاء متجر باسم/سلاج جديد. لذلك UI الحالية تصلح كأساس لقائمة متعددة، لكنها لا تثبت أن دورة إنشاء Store متعددة مكتملة.

### ما لا ينبغي استنتاجه

وجود `storefront_id` في صفحات المظهر والنطاقات والكتالوج لا يعني وجود Store↔Branch أو تعدد تنفيذ؛ تلك حراسة نطاق متجر، بينما التنفيذ الحالي يمر عبر قناة وسياسة مخزن.

## Domain / Host Resolution

### السلسلة الحالية

```text
Host أو X-Storefront-Forwarded-Host + سر بوابة صحيح
  → HostnameNormalizer
  → StorefrontDomain.hostname
  → is_active + verified
  → Storefront نشط
  → SalesChannel نشطة + type=web
  → TenantContext + StorefrontContext
```

البحث الأول عن `StorefrontDomain` يحدث قبل ضبط TenantContext لأن hostname هو الذي يحسم المستأجر. بعد ذلك تُصفّى قراءات Storefront وSalesChannel بالسياق المستخرج وتتحقق من الحالة والنوع. الفشل موحّد 404 وغير كاشف.

### هل يمكن لمتجرين في مستأجر واحد نطاقان منفصلان؟

**نعم، من حيث البنية الحالية:** يمكن لكل Storefront نطاق أو نطاقات، والـhostname فريد عالمياً. يمكن أن تكون النطاقات subdomains مختلفة أو custom مختلفة، ما دام كل Domain نشطاً وموثّقاً ومربوطاً بمتجره.

التقييد الحالي ليس «واحد لكل مستأجر»، بل:

- hostname لا يتكرر عالمياً.
- السلاج فريد داخل المستأجر لكل من القناة والمتجر.
- primary النشط واحد لكل متجر.
- النطاق AWJ المولّد حالياً يُبنى من `tenant.slug`، ولذلك لا يولّد slugاً مستقلاً للمتجر الثاني؛ يجب أن يتغير ذلك في شريحة create-store المستقبلية، مع الحفاظ على التفرّد العالمي.

### ما يجب أن يبقى فريداً

- `StorefrontDomain.hostname`: **عالمياً** لأنه مفتاح الحسم الأول.
- `SalesChannel.slug`: داخل المستأجر، مع قرار واضح إن كان slug قناة الويب جزءاً من هوية المتجر أم مجرد key تقني.
- `Storefront.slug`: داخل المستأجر، وليس عالمياً.
- primary domain: واحد نشط لكل Storefront.
- لا ينبغي إضافة `unique(tenant_id)` على القناة أو المتجر، لأنه سيمنع الهدف المنتجى نفسه.

## Branch & Inventory Relationship

### ما هو موجود

لا يوجد FK أو pivot من `storefronts` أو `sales_channels` إلى `branches`. توجد علاقة مختلفة ومشروعة:

```text
Branch ← Warehouse ← FulfillmentPolicy ← SalesChannel
```

لكن V1 الحالية تقيد FulfillmentPolicy إلى مخزن واحد ثابت للقناة. الطلب لا يستنتج فرعه من قناة البيع، ولا يحمل branch/warehouse كحقيقة مصدر مباشرة.

### أصغر علاقة آمنة مقترحة مستقبلاً

لا نوصي بإضافة `branch_id` إلى `storefronts` أو `sales_channels`، لأن ذلك يفشل الحالة المطلوبة Store C → Branches 1+2+3 ويخلط قناة البيع بالتغطية التشغيلية.

الأصغر الذي يحافظ على الحدود هو جدول ربط مستقل، مثلاً مفهومياً:

```text
storefront_branch_coverage
- id
- tenant_id
- storefront_id
- branch_id
- is_active / policy fields only if contract requires
unique(storefront_id, branch_id)
indexes(tenant_id, storefront_id), (tenant_id, branch_id)
```

ويثبت التطبيق/القاعدة أن المتجر والفرع من نفس Tenant. يمكن لاحقاً تعميمه إلى `sales_channel_branch_coverage` إذا تقرر أن القنوات غير الويب (mobile/external) تحتاج التغطية نفسها؛ لا ينبغي افتراض ذلك في شريحة Storefront الأولى.

للحالات المطلوبة يصبح النموذج:

- Store A → Branch 1
- Store B → Branch 2
- Store C → Branch 1, Branch 2, Branch 3

مع بقاء Storefront وSalesChannel CompanyWide، وبقاء Warehouse موقع المخزون الفعلي.

### آثار العلاقة على المجالات الأخرى

- **Inventory:** coverage لا تنقل المخزون ولا تنشئ StockMovement. يجب أن يظل ATS/الحجز يحسم مخازن/مواقع التنفيذ وفق سياسة مستقلة، مع استخدام الفروع لتقييد الخيارات أو تحديد fallback فقط بعد قرار منتجي.
- **Order fulfillment:** يجب إضافة قرار routing صريح: هل يختار النظام فرعاً واحداً، أول فرع متاح، تقسيم الطلب، أم يرفض الغموض؟ لا يمكن استنتاجه من مجرد وجود pivot.
- **POS:** يبقى POS مربوطاً بسياق الفرع/الجلسة، ولا يصبح Storefront تلقائياً قناة POS. لا يُجبر POS القديم على المرور عبر CommerceOrder.
- **Accounting:** لا يُضاف branch إلى SalesChannel أو يُنسخ إلى القيد تلقائياً. عند إنشاء فاتورة/حركة محاسبية لاحقة يجب أن يمر الإسناد عبر خدمات ERP الحالية، مع الحفاظ على مبدأ أن `CommerceOrder` ليس Invoice وأن `InventoryReservation` ليست StockMovement.

## Single-Store Assumptions

| التصنيف | الدليل الحالي | الأثر |
|---|---|---|
| P1 | `StorefrontProvisioningService::CHANNEL_SLUG = web` و`STOREFRONT_SLUG = main` | لا يمكن إنشاء متجر ثانٍ عبر المسار الرسمي؛ السلاجين يمثلان «الأول» لا identity عامة |
| P1 | `ensureWebSalesChannel()` يفشل عند أكثر من قناة web نشطة | التزويد لا يتحمل تعدد web المقصود؛ مناسب للتقارب الأول فقط |
| P1 | `ensureStorefront()` يفشل عند أكثر من Storefront للقناة | لا يمكن استخدامه كخدمة create عامة؛ يجب عدم إعادة استعماله بلا عقد جديد |
| P1 | `FulfillmentPolicyService` و`fulfillment_policies.unique(sales_channel_id)` | قناة واحدة ← مخزن واحد فقط؛ لا يدعم تغطية متعددة أو اختيار فرع |
| P1 | Hostname المولّد من `tenant.slug` فقط | توليد نطاق AWJ ثانٍ يحتاج identity/slug متجر مستقل وإلا حدث تعارض عالمي |
| P2 | `MobileSalesChannelResolver::canonicalForTenant()` يختار أقدم mobile نشطة | قرار canonical مناسب لمسار mobile الحالي، لكنه لا يجب أن يُخلط مع اختيار متجر web |
| P2 | بعض خدمات النشر تعرض جميع web storefronts للمستأجر أو تختار واحداً عبر `storefront_id` | يلزم عقد واضح عند تعدد المتاجر: هل الإعداد per-store أم per-channel أم tenant-wide |
| P2 | الواجهة تعرض قائمة وسياق اختيار لكنها لا تحتوي create-store workflow | تعدد القراءة/التعديل موجود جزئياً؛ دورة الإنشاء والإعداد غير مكتملة |
| P2 | اختبارات كثيرة تنشئ قناة `web` عبر `where('slug','web')->first() ?? create(...)` | نمط اختبار تقاربي لا يثبت uniqueness business rule، وقد يخفي تعدد القنوات إن توسع النطاق |
| P2 | `first()` في قراءات `current`/canonical وبعض الخدمات | ليس كل `first()` خطراً؛ الخطر فقط حين تمثل النتيجة invariant غير موثق أو مع تعدد مقصود |

لم تظهر أثناء التدقيق مؤشرات موثقة على `sole()` أو cache عام يحسم Storefront واحداً في مسار Host الإنتاجي؛ الحسم العام يعتمد على hostname الفريد. يجب إعادة فحص أي cache جديد عند تنفيذ الشرائح، لا افتراض عدم وجوده مستقبلاً.

## Tenant Isolation Risks

### نقاط قوة مثبتة

1. `TenantContext` مصدر الهوية في التزويد؛ لا يقبل tenant/channel/store/domain id من العميل لتحديد المستأجر.
2. `TenantScope` مطبق على نماذج Commerce، مع حراسات ملكية صريحة في خدمات Workspace.
3. Host resolution يبدأ من hostname عالمي قبل TenantContext ثم يعيد التحقق من tenant على Storefront وSalesChannel.
4. النطاق المخصص لا يثبت verified تلقائياً؛ AWJ-managed فقط يملك مسار التوثيق الفوري لأنه مولّد خادمياً.
5. الروابط المتداخلة للأعمال الحساسة تعيد foreign/missing إلى 404 غير كاشف في عدة خدمات.
6. سياسات التنفيذ تتحقق من القناة والمخزن داخل tenant السياق، ولا تعتمد على FK وحده.

### مخاطر يجب منعها في التوسع

- قبول `tenant_id` أو `sales_channel_id` أو `storefront_id` من طلب create ثم الوثوق به دون حل تحت TenantContext.
- إضافة pivot Store↔Branch بقيد FK منفصل فقط؛ FK يثبت الوجود ولا يثبت تطابق tenant.
- جعل hostname tenant-unique بدلاً من عالمي، ما يسمح بأن يحسم الاسم نفسه إلى مؤسستين.
- إعادة استعمال `provisionFirstStorefrontForCurrentTenant()` لإنشاء متجر ثانٍ مع تغيير الاسم فقط؛ سيؤدي إلى تقارب المتجر الأول أو تعارض السلاج.
- حسم `storefront_id` و`sales_channel_id` كل واحد منفرداً دون assert أنهما زوج متسق من نفس المستأجر.
- اختيار «أول قناة web» أو «أول متجر» في public/workspace paths بعد السماح بتعدد مقصود.
- ربط المتجر بفرع واحد على العمود مباشرة ثم فقدان حالة متجر متعدد الفروع.
- اشتقاق branch أو warehouse من Storefront داخل الحجز دون عقد routing صريح؛ قد ينتج تسريباً تشغيلياً أو بيعاً من موقع خاطئ.

## Backward Compatibility Risks

**P0 — tenant/security/data corruption risk**

- تغيير الحسم العام من hostname إلى معرّف متجر وارد أو slug غير عالمي.
- إزالة/إضعاف `TenantScope` أو جعل pivot يسمح بربط Store بفرع مستأجر آخر.
- تحديث `CommerceOrder` التاريخي بإجبار `storefront_id` أو `branch_id` بقيمة مستنتجة؛ الطلبات القديمة قد تكون عمداً بلا storefront.
- تحويل Storefront إلى Branch أو جعل branch scope يخفي مراجع تاريخية مطلوبة للمحاسبة/التقارير.

**P1 — blocking multi-store implementation**

- إبقاء `POST /workspace/storefronts` بعقد التزويد الأول مع تقديمه ظاهرياً كـcreate-store.
- عدم تعريف هوية متجر مستقلة للنطاق AWJ المولّد؛ `tenant.slug` وحده لا يكفي لمتجرين.
- إبقاء سياسة التنفيذ one-channel/one-warehouse عند تقديم Store↔Branch coverage كميزة كاملة.
- عدم تحديد ownership بين `storefront_id` و`sales_channel_id` في الطلبات والسلال وCheckout.
- توسيع خدمات النشر/العروض/الإعدادات دون تحديد هل setting per-store أم per-channel.

**P2 — UX/maintainability**

- اختيار متجر في السياق دون عرض حالة المتجر/النطاق/التغطية بوضوح.
- اختبارات تعتمد على `first()` ولا تختبر مستأجراً بعدة متاجر وقنوات.
- أسماء `canonical`, `main`, `web` تُستخدم في مواضع يلزم أن تفرق بين «الافتراضي القديم» و«المتجر المحدد».
- عدم وجود contract tests تثبت أن المستأجر القديم أحادي المتجر لا يتغير سلوكه بعد إضافة التعدد.

## Recommended Target Model

```text
Tenant
├── Branches
│   └── Warehouses / operational context
└── Stores / SalesChannels
    ├── Store identity, domains, catalog presentation
    ├── channel-specific publication and customer entry point
    └── optional coverage → one or more Branches
```

المبادئ:

1. Store هو واجهة/قناة تجارية؛ Branch موقع تشغيلي؛ Warehouse موقع مخزون؛ لا دمج بينها.
2. Storefront يظل Tenant-owned ويرتبط بقناة web واحدة، مع توسيع القناة/المتجر عبر workflow صريح لا عبر التزويد الأول.
3. domain resolution يبقى Host-first، وhostname عالمياً فريداً، وstore slug tenant-unique.
4. coverage تكون many-to-many منفصلة، وتطابق Tenant في طبقة DB/الخدمة.
5. التوجيه من Store إلى Branch/Warehouse سياسة قابلة للضبط، لا fallback خفي إلى أول فرع/مخزن.
6. Orders تحفظ source channel/store كما وردا في المسار، بينما قرار fulfillment والتأثير المخزني/المحاسبي يظل عبر الخدمات الرسمية.
7. كل feature متعددة المتاجر تضيف اختبارات عزل مستأجر، تعدد داخل المستأجر، تضارب hostname، وتوافق مستأجر أحادي قديم.

## Minimum Safe Implementation Slices

### MULTI-STORE-1 — Domain/database foundation

- تعريف عقد هوية المتجر الثاني: `slug` وdisplay name وchannel relation.
- إضافة migration/قيود فقط بعد قرار نهائي؛ لا تُزال قيود الحالية.
- فصل helper «provision first» عن خدمة «create new store».
- تثبيت contract أن `hostname` عالمي، وأن AWJ hostname الجديد يستعمل هوية متجر مستقلة.
- اختبارات PostgreSQL للتزامن، وtenant isolation، ووجود مستأجرين بعدة متاجر.

### MULTI-STORE-2 — API/create-store workflow

- endpoint create صريح، محروس بـ`commerce.manage`، يأخذ فقط الحقول التي يقرها العقد؛ لا tenant id.
- إنشاء قناة web/Storefront/managed domain ضمن transaction ذرية، مع idempotency أو مفتاح طلب إذا كان workflow قابلاً لإعادة المحاولة.
- التحقق من أن store/channel/domain الثلاثة من نفس Tenant.
- إبقاء POST القديم متوافقاً: إما يظل first-store endpoint صريحاً أو يُحوّل بعقد موثق دون تغيير نتيجة المستأجرين القائمين.
- تحديد سلوك الحذف الناعم وإعادة استخدام السلاج قبل التنفيذ.

### MULTI-STORE-3 — Stores UI

- تحويل `/commerce/stores` من قائمة/حالة إلى إدارة قائمة متعددة دون افتراض index صفر.
- إضافة create flow يستعمل API الجديد فقط.
- إبقاء المتجر المحدد في StoreContext، وإعادة ضبطه بأمان إذا عُطّل/حُذف.
- إظهار domain/status/preview واسم المتجر، مع حالات فارغة ومتعددة واختبارات RTL.
- تحديث صفحات appearance/domains/catalog لتصرح بأي نطاق store أو channel.

### MULTI-STORE-4 — Store ↔ Branch assignment

- إضافة pivot coverage مستقل بعد اعتماد سياسة المنتج.
- CRUD إداري محروس، يتحقق من نفس Tenant ومن فروع مسموحة للمستخدم.
- اختبارات Store A/B/C المطلوبة، وعزل المستأجر، وإزالة/تعطيل فرع أو متجر.
- لا تُغيّر هذه الشريحة المخزون أو الحجز تلقائياً قبل اعتماد routing contract.

### لاحقاً — Fulfillment/routing

هذه ليست جزءاً تلقائياً من إنشاء متجر. يلزم قرار مستقل يحدد:

- هل القناة/المتجر يملك سياسة واحدة أم قائمة مواقع؟
- كيف يختار الفرع والمخزن عند تعدد المتاح؟
- هل يسمح تقسيم الطلب؟
- متى ينشأ الحجز، وما المصدر المحاسبي اللاحق؟

بعد القرار فقط تُحدّث `FulfillmentPolicy`/خدمة الحجز/اختبارات ATS والتزامن. لا يُنصح بتغيير `CommerceOrder` إلى سجل فرعي أو باستنتاج الفرع من pivot وحده.

## Evidence Matrix

| المجال | أدلة رئيسية مفحوصة |
|---|---|
| التزويد | `app/Services/Commerce/StorefrontProvisioningService.php`; `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php`; اختبارات `StorefrontProvisioningServiceTest.php`, `StorefrontProvisioningApiSecurityTest.php`, `StorefrontProvisioningPostgresConcurrencyTest.php` |
| النماذج | `app/Models/Tenant.php`, `Branch.php`, `SalesChannel.php`, `Storefront.php`, `StorefrontDomain.php`, `CommerceOrder.php`, `Warehouse.php`, `FulfillmentPolicy.php` |
| المخطط | `2026_09_13_010000_create_sales_channels_table.php`; `2026_09_20_010000_create_storefronts_table.php`; `2026_09_20_020000_create_storefront_domains_table.php`; `2026_09_14_010000_create_fulfillment_policies_table.php`; `2026_09_16_010000_create_commerce_orders_table.php`; `2025_01_01_000033_create_warehouses.php`; migrations cart/checkout/order linkage |
| الحسم العام | `app/Http/Middleware/ResolveStorefrontDomain.php`; `app/Tenancy/StorefrontContext.php`; `tests/Feature/StorefrontDomainResolutionApiTest.php`, `ManagedStorefrontHostnameTest.php` |
| خدمات Commerce | `CommerceWorkspaceStorefrontsService.php`; `CommerceProductPublicationService.php`; `CommerceOrderService.php`; `CommerceCheckoutService.php`; `CommerceOrderReservationService.php`; `FulfillmentPolicyService.php`; `MobileSalesChannelResolver.php` |
| المسارات | `routes/api.php`; `routes/api_storefront.php`; `routes/api_commerce.php` |
| الواجهة | `web/src/app/(commerce)/commerce/stores/page.tsx`; `page.test.tsx`; `web/src/modules/commerce-workspace/store-context`; domains/appearance/published-products pages and tests |
| العزل والفروع | `CLAUDE.md`; `design-system/foundations/multi-branch-architecture.md`; Branch isolation tests |

## Relevant Tests Found

### Storefront / domain / workspace

- `StorefrontProvisioningServiceTest.php`
- `StorefrontProvisioningApiSecurityTest.php`
- `StorefrontProvisioningPostgresConcurrencyTest.php`
- `StorefrontRoutesRegisteredTest.php`
- `StorefrontDomainResolutionApiTest.php`
- `StorefrontDomainVerificationServiceTest.php`
- `StorefrontDomainEdgeStateMigrationTest.php`
- `CommerceWorkspaceStorefrontsApiTest.php`
- `CommerceWorkspaceStorefrontIdentityApiTest.php`
- `CommerceWorkspaceStorefrontLifecycleApiTest.php`
- `CommerceWorkspaceStorefrontDomainsApiTest.php`
- `CommerceWorkspaceAddCustomDomainApiTest.php`
- `CommerceWorkspaceCustomDomainPostgresConcurrencyTest.php`
- `CommerceWorkspaceMakePrimaryDomainApiTest.php`
- `CommerceWorkspaceStorefrontProductApiTest.php`
- `CommerceWorkspaceStorefrontCategoryApiTest.php`
- `CommerceWorkspaceStorefrontOfferApiTest.php`

### Commerce / fulfillment / orders

- `CommerceProductPublicationApiTest.php`
- `CommerceOrderServiceTest.php`
- `CommerceOrderOwnershipTest.php`
- `CommerceOrderReservationServiceTest.php`
- `CommerceOrderReservationPostgresConcurrencyTest.php`
- `CommerceCheckoutApiTest.php`
- `StorefrontCheckoutApiTest.php`
- `StorefrontCheckoutCompletionApiTest.php`
- `FulfillmentPolicyServiceTest.php`
- `WarehouseAwareDocumentsTest.php`
- `LegacyInventoryWarehouseScopeTest.php`

### Branch / isolation

- `BranchTest.php`
- `BranchIsolationGuardTest.php`
- `BranchOperationalIsolationTest.php`
- `BranchProductIsolationTest.php`
- `BranchPartnerIsolationTest.php`
- `BranchSharingTest.php`
- `BranchSharingProbe.php`
- `BranchDimensionTest.php`
- `DocumentBranchScopeTest.php`
- `PosInvoiceBranchAccessTest.php`

### Frontend

- `web/src/app/(commerce)/commerce/stores/page.test.tsx`
- `web/src/app/(commerce)/commerce/domains/page.test.tsx`
- `web/src/app/(commerce)/commerce/domains/page.manage.test.tsx`
- `web/src/app/(commerce)/commerce/domains/page.lifecycle.test.tsx`
- `web/src/app/(commerce)/commerce/domains/page.edge.test.tsx`
- `web/src/app/(commerce)/commerce/appearance/page.test.tsx`
- `web/src/app/(commerce)/commerce/published-products/page.test.tsx`

## Final Audit Status

- **Base SHA inspected:** `a53bcd0ab3a5b6e9e9bffcc7e6be588ddbf64c7a`
- **Working tree:** clean; `HEAD` يساوي Base SHA.
- **Files modified:** لا ملفات إنتاجية أو اختبارات عُدّلت. أُنشئ هذا التقرير فقط استجابةً لمتطلب التدقيق.
- **Migrations created:** لا.
- **Production behavior changed:** لا.
- **PR created:** لا.
- **Merge performed:** لا.
- **Deploy performed:** لا.

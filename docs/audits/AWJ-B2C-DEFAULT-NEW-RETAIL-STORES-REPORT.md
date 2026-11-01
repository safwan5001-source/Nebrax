# AWJ ERP — تفعيل حسابات B2C افتراضياً للمتاجر التجزئة الجديدة (B2C-DEFAULT)

**الحالة:** جاهز لمراجعة ChatGPT. **لا دمج، لا نشر، لا تغيير لمتغيرات Railway، لا تفعيل لأي متجر قائم.**

## 1. ملخص التغيير

القناة web **التي تُنشأ حديثاً** تبدأ بـ`customer_accounts_enabled = true` ما لم يُرسَل `false` صراحةً. لا هجرة، ولا تغيير لافتراض العمود (`false` يبقى لكل مسار إدخال آخر).

**مسارا الإنشاء المعتمدان (وحدهما يُنشئان قناة web لمتجر تجزئة):**

| المسار | الخدمة | السلوك الجديد |
|---|---|---|
| `POST /api/commerce/workspace/storefronts` (التزويد الأول) | `StorefrontProvisioningService::ensureWebSalesChannel` | يُدرج القناة بـ`true` افتراضياً **فقط في فرع الإدراج**؛ التقارب لقناة قائمة يعيدها دون أي تعديل |
| `POST /api/commerce/workspace/storefronts/create` (متجر إضافي) | `CreateStorefrontForCurrentTenant::create` | يُدرج القناة بـ`true` افتراضياً |

- حقل جديد **اختياري** `customer_accounts_enabled` (boolean، `nullable`) في `ProvisionStorefrontRequest` و`CreateStorefrontRequest`: غائب/`null` ⇒ مفعّل؛ `false` ⇒ يُحترم؛ `true` ⇒ مفعّل؛ غير منطقي ⇒ 422 بلا أي كتابة.
- المصدر الوحيد للقرار: `App\Services\Commerce\NewRetailChannelDefaults` (`initialCustomerAccountsEnabled` + `createWebChannel`). العمود غير قابل للتعبئة الجماعية عمداً، فيُضبط صراحةً في هذا الملف وحده. اختبار ساكن يضمن أن مستخدميه هما الخدمتان أعلاه فقط.

**قرارات صريحة**
1. **المفتاح العام يبقى الحَكَم (البند 9):** لا تُلمس `RetailAccountGate` ولا `commerce.retail_accounts_enabled`. القناة المخزَّنة `true` مع المفتاح مغلقاً **بلا وصول فعلي** (`capabilities.customer_accounts=false` وكل مسارات `auth/*`/`account/*` تردّ 404) — مُثبَت باختبار. وحين يُفتح المفتاح لاحقاً تصير المتاجر المنشأة أثناء إغلاقه فعّالة تلقائياً (هذا هو معنى «افتراضي»؛ مذكور في المخاطر).
2. **الجملة:** لا مسار ينشئ قناة جملة؛ القناة الجديدة دائماً `wholesale_membership_enabled=false`. القنوات الموسومة جملة القائمة لا تُمسّ (مُثبَت)، والقناة غير web تبقى بافتراض العمود وحارس النموذج يرفض `true` عليها (مُثبَت).
3. **التدقيق:** لا يُكتب `SalesChannelSettingEvent` عند الإنشاء — الحالة الابتدائية ليست تغيير إعداد. أي تغيير لاحق عبر شاشة الإعدادات يُدقَّق كما كان (مُثبَت: حدث واحد بعد PUT).
4. **أمر `sales-channel:ensure-web` (CLI تشغيلي)** و`DeliveryPlatformConfigService` وفئات الاختبار: بلا تغيير (افتراض العمود `false`).
5. **الواجهة:** لا تعديل. حوار «إنشاء متجر» لا يرسل الحقل ⇒ الافتراضي مفعّل؛ شاشة «حسابات العملاء» (#1883) تقرأ القيمة المحفوظة وتحفظها كما كانت (مُثبَت بنقطة `pricing-settings` في الاختبار الجديد وباختبارات الواجهة القائمة). إضافة خيار «إلغاء التفعيل عند الإنشاء» في الحوار تحسين لاحق اختياري.

## 2. الملفات

| ملف | تغيير |
|---|---|
| `app/Services/Commerce/NewRetailChannelDefaults.php` | جديد — مصدر الافتراضي وإنشاء القناة |
| `app/Services/Commerce/StorefrontProvisioningService.php` | معامل اختياري + استدعاء المصدر في فرع الإدراج فقط |
| `app/Services/Commerce/CreateStorefrontForCurrentTenant.php` | معامل اختياري + استدعاء المصدر |
| `app/Http/Requests/ProvisionStorefrontRequest.php`, `CreateStorefrontRequest.php` | حقل اختياري + مُستخرِج `customerAccountsEnabled()` |
| `app/Http/Controllers/Api/CommerceWorkspaceStorefrontsController.php` | تمرير القيمة للخدمتين |
| `tests/Feature/NewRetailStoreAccountsDefaultTest.php` | جديد — 14 اختباراً |
| `CLAUDE.md` | بند توثيق B2C-DEFAULT |

## 3. الاختبارات

**جديد (14):** المتجر الأول افتراضيه مفعّل وفعّال فعلياً (التسجيل 202 والقدرة `true`) · `false` الصريح يُحترم (التسجيل 404) · `true` مقبول · إعادة التزويد/التقارب لا يعدّل قناة قائمة ولا ينشئ قناة · المتجر الإضافي مفعّل ولا يمسّ المتاجر القائمة (مقارنة حقول وقت التحديث) · `false` الصريح للإضافي · **المفتاح العام مغلق ⇒ لا وصول فعلي ثم يصير فعّالاً عند فتحه** · الجملة والخارجي لا يتأثران وحارس النموذج قائم · المصدر والمستخدمون الوحيدون · افتراض العمود للمسارات الأخرى `false` · tenant_id/sales_channel_id من العميل مُتجاهَلان وقناة مستأجر آخر لا تُمسّ · staff/self_service/ضيف مرفوضون بلا إنشاء شيء · قيمة غير منطقية 422 بلا رسم جزئي · نقطة إعدادات القناة تقرأ القيمة الحقيقية وتحفظ التغيير مع تدقيقه · الإنشاء لا يكتب قيوداً محاسبية.

| الفحص | النتيجة |
|---|---|
| `NewRetailStoreAccountsDefaultTest` | 14/14 |
| `php artisan test` **الكامل** (محلي، sqlite، قبل دمج `main`) | 10285 ناجحاً، 307 متخطّى، **45 إخفاقاً كلها بيئية لا علاقة لها بالتغيير** (انظر أدناه) |
| إعادة تشغيل المتأثر بعد تثبيت bcmath ومزامنة `contracts/` ودمج `origin/main` (Fuel*، ApplicationCatalog، TenantApplication، PartnerStatement، الميزة الجديدة، MultiStore، CommerceWorkspaceStorefront*، StorefrontProvision*، RetailCustomerAccounts، StaffChannelPricingSettings، CommerceModuleBoundary، BranchIsolationGuard، InventoryReport/Service، ImportJob) | **533 ناجحاً، 7 متخطّى، 0 إخفاق** |
| إعادة تشغيل `AppTemplateRegistry`/`BuilderLivePointer`/`AppSchemaNavigationShell` بعد مزامنة `contracts/` | 41/41 |
| Vitest ذو الصلة (customer-accounts، create-store-dialog، stores) | 56/56 |
| CI على GitHub (على رأس الكود `c044e28`) | انظر القسم 8 |

**تفصيل الإخفاقات البيئية في التشغيل الكامل الأول (حُلّت دون أي تغيير في الكود):**
- 35 إخفاقاً في اختبارات الفيول: `Call to undefined function bcmul()` — امتداد bcmath غير مثبّت في بيئة الجلسة (تحذّر منه خطوة الإعداد، وهو مثبّت في CI). بعد تثبيته نجحت.
- 10 إخفاقات (`AppTemplateRegistry`، `BuilderLivePointer`، `AppSchemaNavigationShell`): ملف `contracts/app-builder/archive/*.json` لم أنسخه إلى المشروع المولَّد. بعد المزامنة نجحت.
- كلتاهما بعيدتان عن ملفات التغيير، ولا يمسّها فرق الـ PR.

لم يُمسّ: الفوترة، القيود، المدفوعات، ZATCA، الدفع كضيف، سلوك الجملة (لا ملف في `Invoice*`/`Ledger*`/`Payment*`/`Zatca*`).

## 4. التوافق الرجعي
- لا هجرة ولا تغيير بيانات: أي صف قائم يبقى كما هو (مُثبَت بمقارنة الحقول والـ`updated_at`).
- مستهلكو API القائمون الذين لا يرسلون الحقل: يحصلون على قناة جديدة مفعّلة (التغيير المقصود)، والرد لم يتغير شكلاً.
- فتح كل شيء يعتمد على المفتاح العام كما قبل.

## 5. المخاطر والمتبقي
1. **تفعيل مؤجَّل ضمني:** أي متجر يُنشأ والمفتاح العام مغلق سيكون مفعّلاً تلقائياً لحظة فتح المفتاح لاحقاً. هذا مقصود لكنه يستحق علماً عند قرار فتح المفتاح في بيئة لها متاجر جديدة.
2. **متاجر Beta القائمة** (مثل التي أُنشئت قبل هذا التغيير) تبقى `false` — لا تفعيل آلي (طلبك). تفعيلها يتم من شاشة «حسابات العملاء» لكل متجر.
3. **حد IP المشترك وجاهزية التفعيل** (B2C-ACTIVATION-READINESS) ما زالا قيدين معلنين لحسابات التجزئة في الإنتاج؛ هذا التغيير لا يعالجهما.
4. مستأجرون يُنشئون متجرهم الأول عبر مسارات أخرى (CLI/seed) لا يتأثرون — مقصود.
5. خيار الإيقاف عند الإنشاء متاح عبر API فقط حالياً (لا حقل في حوار الإنشاء).

## 6. Branch / PR / SHAs
- **Branch:** `feat/b2c-accounts-default-new-retail-stores`
- **PR:** يُضاف بعد الفتح
- **Base (بعد التحديث):** `main` @ `511a19e3f384cae9a62c0fc81a6142080fe6a1db` (كان الفرع قد بدأ من `40b6e35`؛ دُمج `main` بلا تعارض، وفرق الـ PR أمامه ملفاتنا التسعة فقط)
- **Head (كود):** `c044e2814debe4059bc36734a5025410e0e708e8` — تليه commits التقرير فقط

## 7. الإجراء التالي المقترح
1. مراجعة ChatGPT (التركيز: افتراض `true` مقابل البوابة العامة، وغياب حدث تدقيق عند الإنشاء).
2. بعد الدمج: إنشاء متجر تجريبي جديد والتحقق أن `GET store/v1/storefront` يعلن `customer_accounts: true` وأن التسجيل يعمل؛ ثم تفعيل المتاجر القائمة (إن رُغب) يدوياً من الشاشة متجراً متجراً.
3. لاحقاً (اختياري): خيار «تفعيل حسابات العملاء» في حوار إنشاء المتجر.

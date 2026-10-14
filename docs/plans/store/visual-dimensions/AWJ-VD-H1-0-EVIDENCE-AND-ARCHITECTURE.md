# AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 — H1-0 Evidence & Architecture Report

STATUS: **PROPOSED — awaiting owner Decision Gate** (no DB / API / runtime change is authorized by this document)
DATE: 2026-10-14
BASE: `origin/main` @ `f147fb6063d36952971724609250f9ba1baf42f5`
HORIZON: AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 (Master Plan: `AWJ-VD-H1-MASTER-PLAN.md`)

> المصطلحات: «البُعد» = `CommerceFacet`، «القيمة» = `CommerceFacetValue` (ADR-14). الواجهة العربية تسمّيها «الأبعاد الوصفية».
> كل ادعاء أدناه موسوم: **[REPO]** دليل من المستودع بمسار وسطر · **[EXT]** دليل خارجي (`AWJ-VD-H1-0-EXTERNAL-EVIDENCE.md`) · **[AWJ DECISION — PROPOSED]** قرار مقترح ينتظر الاعتماد.

---

## 1. الخلاصة التنفيذية

1. **لا نبني شيئاً من الصفر.** أَوْج يملك اليوم كل لبنات هذا الأفق تقريباً:
   - الأبعاد وقيمها وإسنادها للمنتجات وتصفية المتجر بها (ADR-14).
   - قسم متجر «تسوّق حسب…» جاهز اسمه `discovery`، بعرضَين نصيّين `tiles|chips` (ADR-21).
   - مكتبة وسائط للمستأجر (`storefront_media`) تحفظ **الأصل مرة واحدة**، وتولّد نسخاً بصيغة WebP/JPEG بعدة عروض، وتخزّن التأطير (احتواء/نقطة تركيز/تكبير) **لكل استخدام** لا داخل الصورة.
   - مكوّنات إدارة جاهزة: `MediaPicker` و`MediaRefField` و`MediaFramingEditor`.
   - سجلّ أيقونات مغلق مشترك بين PHP وTS (`IconRegistry`).
2. **الفجوة الحقيقية خمس نقاط فقط:**
   1. لا يوجد مكان يحفظ الهوية المرئية للبُعد والقيمة.
   2. ماسح مراجع الوسائط لا يرى إلا وثائق العرض، فإن أُشير لصورة من مكان آخر لا يحميها من الحذف ولا يسمح بنشرها.
   3. لا يوجد محرك أشكال.
   4. قسم `discovery` لا يملك تخطيطات ولا أعمدة ولا قوالب.
   5. محرر الإدارة نافذة حقلين فقط (اسم عربي وإنجليزي).
3. **المقترح المعماري** يقوم على ثلاث طبقات منفصلة:
   - **بيانات البُعد** (موجودة، لا تتغير).
   - **الهوية المرئية** (جدول جديد واحد إضافي `commerce_facet_visuals`).
   - **إعدادات العرض لكل واجهة** (حقول اختيارية جديدة داخل محتوى قسم `discovery` في وثيقة العرض القائمة، بلا جدول).
4. **تغيير قاعدة البيانات:** جدول إضافي واحد. لا تعديل ولا حذف على أي جدول قائم.
5. **تغيير الـAPI:** إضافي بالكامل:
   - مفتاح `visual` جديد في الردود القائمة.
   - مسارا كتابة جديدان في مساحة العمل.
   - مسار عام واحد لتقديم صور الأبعاد بحراسة.
   - لا يتغيّر عقد قائم، ولا يتغيّر `commerce/v1` المغلق.
6. **لا أثر محاسبي ولا ضريبي ولا مخزني ولا على الطلبات.**

---

## 2. Evidence — الحالة الحالية في المستودع

### 2.1 نموذج البيانات [REPO]

| الجدول | الأعمدة | القيود والفهارس | المصدر |
|---|---|---|---|
| `commerce_facets` | `id` uuid، `tenant_id`، `key`(64)، `system_key`(32, null)، `name`(120)، `name_en`(120, null)، `sort_order`، `is_active`، timestamps | `unique(tenant_id,key)`، `unique(tenant_id,system_key)` | `database/migrations/2026_10_22_020000_create_commerce_facets_table.php:18-30` |
| `commerce_facet_values` | `id`، `tenant_id`، `commerce_facet_id`(cascade)، `slug`(64)، `name`، `name_en`، `sort_order`، `is_active` | `unique(commerce_facet_id,slug)` | `…_030000_create_commerce_facet_values_table.php:13-24` |
| `commerce_product_facet_values` | `id`، `tenant_id`، `product_id`، `commerce_facet_value_id` | `unique(product_id,value_id)`، `cpfv_filter_idx` | `…_040000_…:19-26` |

- النماذج الثلاثة ترث `BaseModel` وتطبّق `CompanyWide`.
- لها حراسة `saving` تمنع أي مرجع عابر للمستأجرين (`app/Models/CommerceFacetValue.php:24-44`).
- **لا يوجد أي عمود صورة أو أيقونة أو شكل أو عرض.** ADR-14 §5 يصنّف «facet value images» عملاً مستقبلياً صريحاً.

### 2.2 الـAPI القائم [REPO]

**مسارات الإدارة** (`app/Providers/CommerceWorkspaceServiceProvider.php:115-145`):
- `GET|POST /api/commerce/workspace/facets`
- `PUT|DELETE …/facets/{id}`
- `POST …/facets/{id}/values`
- `PUT|DELETE …/values/{valueId}`
- `GET|PUT /products/{id}/facets`

**الحراسة على هذه المسارات:**
- الصلاحيات: القراءة `products.view` والكتابة `products.manage`، مع رفض `self_service` في المتحكّم (`CommerceFacetController.php:147-152`).
- **لا يُطبَّق `EnsureApplicationActive`** على هذه المسارات. هذا وضع قائم لا نوسّعه ولا نغيّره في هذا الأفق.

**شكل الرد** (`CommerceFacetService.php:399-424`):
- البُعد: `{id,key,system_key,name,name_en,sort_order,is_active,values[]}`.
- القيمة: `{id,slug,name,name_en,sort_order,is_active,product_count}`.

**التصفية العامة** (`app/Support/Commerce/CatalogFacetFilter.php`):
- صيغة الطلب: `facet[<key>]=slug,slug`.
- القيم داخل البُعد الواحد تُجمع بـ OR، والأبعاد المختلفة بـ AND.
- القيمة المجهولة تعيد نتيجة فارغة (fail closed، `:151-188`).
- `meta.facets` يحمل `{key,system_key,name,name_en,values[{slug,name,name_en,count,selected}]}` (`:244-250`).
- القيم غير النشطة لا تظهر، والقيم ذات العدّ صفر تُسقط ما لم تكن مختارة (`:236`).
- **لا يوجد endpoint عام مستقل للأبعاد.** تظهر فقط داخل `meta` قائمة المنتجات `store/v1/products` (`routes/api_storefront.php:53`) و`commerce/v1/products` (`routes/api_commerce.php:99`).

**الاختبارات:**
- `tests/Feature/CommerceFacetApiTest.php`: 17 حالة، تغطي العزل والـRBAC والحدود والتعارض.
- `tests/Feature/CommerceFacetStorefrontFilterTest.php`: 12 حالة، تغطي OR/AND والفشل المغلق والنشر والعزل.

### 2.3 البنية الإعلامية [REPO]

| المكدّس | الاستخدام | التحقق | النسخ المشتقة | الإطار لكل استخدام |
|---|---|---|---|---|
| **`storefront_media`** (`StorefrontMediaService`) | مكتبة المستأجر للمُخصِّص | فحص البايتات الفعلية (finfo) · jpeg/png/webp فقط · رفض المتحرك والمقطوع · 5MB · ≥320px · ≤8192px · ≤40MP · ميزانية ذاكرة · منع التكرار بـ sha256 · حصة 500/1GB | 160/320 مصغّرات + 480/768/1280/1920 بصيغتي WebP وJPEG، مع حذف البيانات الوصفية (EXIF) وعدم تقديم الأصل علناً | `MediaRef{mediaId,fit,focal,crop,rotate,alt,decorative}` |
| `product_media` | صور المنتج والخيارات | `mimes` فقط | `thumbnail`/`card` | لا |
| صور التصنيفات (أعمدة على `product_categories`) | صورة واحدة لكل تصنيف | `image|mimes` | لا (تُقدَّم البايتات الخام مع EXIF) | لا |

**القاعدة الحاكمة للمستهلكين الجدد:** «لا مخزن موازٍ ولا خدمة تخزين ثانية». المصادر:
- `docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md:37` (القرار D-01).
- `docs/storage.md:337-339`.
- `config/storefront_media.php:6-8`.
- أفق Media Storage مغلق، و`STOREFRONT_MEDIA_R2_ENABLED` معتمد من المالك (`AWJ-HORIZON-MEDIA-STORAGE-TRACKER.md:173-177`).

**مكتبة اختيار موجودة:** `GET/POST /api/commerce/workspace/storefront-media` بصلاحية `commerce.manage`، وتدعم البحث وفلتر «غير مستخدمة» وتقسيم الصفحات بمؤشر (`routes/api.php:1015-1046`).

**القيد الحاسم:**
- `StorefrontMediaReferenceScanner::containers()` (`:134-139`) يمسح ثلاث حاويات JSON فقط: نُسخ وثيقة العرض، والمسودة، والمنشور.
- `StorefrontMediaService::delete()` (`:156-166`) يمنع الحذف بالخطأ `409 media_in_use` بناءً على هذا الماسح وحده.
- `StorefrontPublishedMediaIndex` يسمح بتقديم الوسيط علناً فقط إن ظهر في وثيقة منشورة لمتجر بعينه.
- **النتيجة:** أي مرجع يُخزَّن خارج وثائق العرض **لن يُحمى من الحذف ولن يُقدَّم علناً** ما لم يُوسَّع الماسح وتُضف بوابة تقديم.

**ملاحظة عن الماسح:** يمشي على كل JSON ويلتقط أي كائن يحمل المفتاح `mediaId`. لذلك تكفي إضافة حاوية رابعة دون تعديل منطقه.

**التأطير:**
- `StorefrontMediaTransform`: crop بنسب محددة، rotate، `focal{x,y}` بين 0 و100، `fit` (cover/contain)، `zoom` بين 1 و4.
- الـcrop والـzoom **يُخبزان** في نسخ مشتقة تُولَّد داخل الطلب نفسه، لأن `QUEUE_CONNECTION=sync`.
- الـfocal والـfit يصيران CSS (`storefront/src/components/ui/media-image.tsx:20,79`).

### 2.4 الأيقونات [REPO]

**المكتبات:**
- `web`: `lucide-react 0.460.0` (متحقَّق منها محلياً).
- `storefront`: `^0.577.0` (غير مثبّتة في بيئة الفحص، وتُتحقَّق في VD-2).

**السجل المغلق، ثلاثي التوأمة:**
- `app/Support/Commerce/IconRegistry.php`
- `web/src/modules/store-experience-builder/presentation/icon-registry.ts`
- `storefront/src/lib/presentation/icon-registry.ts`

**خصائص السجل:**
- 24 مفتاحاً، لكل مفتاح وسوم بحث وتسمية عربية وإنجليزية.
- مفاتيح append-only، أي تُضاف ولا تُحذف (عقد V0 §11.4، والقرار D-22).
- لا رفع SVG.
- العرض عبر `StoreIcon` الذي يتجاهل المفتاح المجهول ويعكس الأيقونات الاتجاهية في RTL.

**الفجوات:**
- لا يوجد Icon Picker. الاختيار اليوم `<select>` أصلي مكرّر في ثلاثة مواضع.
- لا توجد أيقونات مناسبات (كعكة، تخرّج، مولود، خاتم…) في السجل.
- تحقّقنا أن كل الأيقونات المرشّحة موجودة في lucide 0.460، **عدا `Balloon`**.

### 2.5 أسطح الإدارة والمتجر [REPO]

**الإدارة:**
- `web/src/modules/commerce-workspace/merchandising/facets-panel.tsx` يعرض قائمة بطاقات ومفتاحاً للتفعيل، وأزرار تعديل وحذف تفتح `FieldsDialog` عاماً بحقول الاسمين فقط (`:205-271`).
- الحذف معطّل إن كانت للقيمة منتجات (`:140,175`).

**المتجر:**
- `storefront/src/components/home/DiscoverySection.tsx` يعرض `chips` أو `tiles` نصية في شبكة `2/3/4` أعمدة، بحد أقصى 12 قيمة.
- الروابط بصيغة `products?facet[key]=slug` (`:57-97`).
- البيانات تأتي من طلب واحد `products?per_page=1` (`lib/commerce/data-sections.ts:123-196`).

**عقد القسم وتصميمه:**
- محتوى `discovery` هو `{title,axis,dimension?,display}`. السلطة في PHP (`StorefrontPresentationNormalizer.php:1002-1016`)، وله توأمان TS، ومثبَّت بالـfixture `tests/Fixtures/presentation/data-sections.json`.
- قدرات تصميم `discovery` (`storefront/src/lib/presentation/section-design.ts:333-338`) هي background، text، spacing، separator فقط. **لا تخطيط ولا أعمدة.**

**صور التصنيفات في المتجر** (`CategoriesSection.tsx:52-85`):
- ترتيب العرض: صورة التاجر، ثم لون مُتحقَّق منه، ثم مربع محايد.
- `ProductImage` يعرض صندوقاً رمادياً بأيقونة عند فشل التحميل.

**الأشكال:** لا يوجد `mask-image` ولا `<clipPath>` في المستودع. الموجود فقط `clip-path: inset()` للأشرطة كاملة العرض.

**الوضع الداكن:**
- **في المتجر غير موجود فعلياً**، لأن `.dark` لا تمسّ متغيرات `--store-*`.
- في الإدارة (`web`) موجود عبر `next-themes`.

### 2.6 RBAC [REPO] (`app/Support/Rbac.php`)

- `owner`/`admin`: كل الصلاحيات (`*`).
- `accountant`: يملك `products.manage` **ولا يملك `commerce.manage`**، أي يحرّر الأبعاد ولا يصل لمكتبة الوسائط.
- `staff`: قراءة فقط.

### 2.7 الأعمال المتوازية [REPO/GitHub]

**الأفق النشط** حسب `docs/autonomous-engineering/CURRENT-STATE.md` هو TAX-ZATCA. هذا الأفق لا يلمس ملفاته (الفواتير، الضريبة، المحاسبة).

**PRs مفتوحة قد تتقاطع:**

| PR | الموضوع | نقطة التقاطع المحتملة | الإجراء |
|---|---|---|---|
| #1089 | CUST-H1-3 Theme Version publishing | وثيقة العرض ومساراتها | فحص التعارض في VD-4a قبل لمس `section-content.ts` والـnormalizer |
| #853 | Extended Store Customizer architecture (docs) | الأقسام | فحص التعارض في VD-4a قبل لمس `section-content.ts` والـnormalizer |

**لا يوجد PR مفتوح** على الأبعاد أو `merchandising` أو `CatalogFacetFilter`.

### 2.8 المرجع البصري المرفق

- النموذج التفاعلي `AWJ_Visual_Dimensions_Prototype` (ملف `index.html` واحد مستقل)، وقد فُحص بالكامل. يقدّم:
  - ثلاثة تبويبات: البيانات / الصورة والأيقونة / المظهر.
  - 12 شكلاً، وأنماط عرض شبكة / شريط / قائمة.
  - أعمدة 2–4، ومسافات ثلاث.
- **حدوده المعلنة:** لا يتصل بالـAPI، وليس موافقة على Schema أو API.
- **ما نأخذه:** بنية التبويبات، ومكتبة الأشكال، وفصل شكل الوسيط عن البطاقة، والمعاينة الحية.
- **ما لا نأخذه:**
  - ألوانه وخطّه المستقلّان (نلتزم بـ`DESIGN_SYSTEM.md`).
  - تطبيق `arch` بـ`border-radius`، لأنه لا يعطي قوساً إسلامياً مدبّباً.
  - `<input type=color>` الخام (لدينا `ColourField`).
- **الصور الفعلية للواجهة الحالية** المذكورة في الطلب لم تصل ضمن المرفقات (وصل ملف zip واحد). لذلك اعتمد الوصف الحالي على الكود في §2.5.

---

## 3. المخطط المعماري المقترح [AWJ DECISION — PROPOSED]

### 3.1 الطبقات الثلاث (تحقيق التعديل المعماري رقم 1)

```text
┌───────────────────────────────────────────────────────────────────────┐
│ L1  بيانات البُعد (قائمة — لا تتغيّر)                                    │
│     commerce_facets · commerce_facet_values · commerce_product_facet_values │
│     الاسم، الـslug، الحالة، الترتيب، الإسناد، التصفية (ADR-14)               │
├───────────────────────────────────────────────────────────────────────┤
│ L2  الهوية المرئية (جديد — جدول إضافي واحد)                              │
│     commerce_facet_visuals: 1:1 اختياري مع البُعد أو القيمة                │
│     نوع المحتوى · مرجع صورة (MediaRef) · أيقونة · شكل · حجم · ألوان         │
│     افتراضات البُعد للقيم (وراثة)                                          │
├───────────────────────────────────────────────────────────────────────┤
│ L3  إعدادات العرض لكل واجهة (امتداد قائم — بلا جدول)                      │
│     محتوى قسم discovery داخل وثيقة العرض (لكل متجر ولكل نسخة قسم)          │
│     التخطيط · القالب · الأعمدة لكل جهاز · المسافات · موضع النص · الترتيب      │
└───────────────────────────────────────────────────────────────────────┘
          ↑ الصورة الأصلية تبقى مرة واحدة في storefront_media (التعديل 3)
```

**لماذا الفصل:**
- L1 تملكه صلاحية `products.manage`، ويقرأه مسار التصفية الساخن، ولا يجب أن يتغيّر مخططه أو أداؤه.
- L2 هوية **مشتركة بين كل الواجهات**: المتجر، وأي متجر ثانٍ، ولاحقاً تطبيق الجوال. تعديلها يجب ألّا يمسّ اسم البُعد أو منطق التصفية.
- L3 قرار **سطح عرض بعينه**: قسمان على صفحة واحدة قد يعرضان البُعد نفسه بشكلين مختلفين (التعديل 4).

### 3.2 L2 — الجدول المقترح `commerce_facet_visuals`

| العمود | النوع | قيود |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid FK → tenants، cascade | يُملأ من `BelongsToTenant` |
| `commerce_facet_id` | uuid FK → commerce_facets، cascade | NOT NULL |
| `commerce_facet_value_id` | uuid FK → commerce_facet_values، cascade | NULL = صفّ البُعد نفسه |
| `schema_version` | unsignedSmallInteger | default 1 |
| `visual` | json | NOT NULL؛ مُطبَّع دائماً بـ`CommerceFacetVisualNormalizer` |
| `created_at`/`updated_at` | timestamps | `updated_at` شرطٌ مسبق للكتابة المتزامنة |

**الفهارس:**
- `unique(commerce_facet_value_id)`: صف واحد لكل قيمة. الـNULLs لا تتصادم.
- فهرس جزئي فريد `(commerce_facet_id) WHERE commerce_facet_value_id IS NULL`: صف واحد للبُعد. هذا هو نمط الفهرس الجزئي القائم في طبقة الترقيم (CLAUDE.md).
- `index(tenant_id, commerce_facet_id)`.

**النموذج:** `App\Models\CommerceFacetVisual extends BaseModel implements CompanyWide`، مثل بقية جداول الكتالوج التجاري (ADR-14 §2.1). حراسة `saving` تتحقق من:
1. البُعد والقيمة في المستأجر نفسه.
2. القيمة تتبع البُعد المذكور.
3. أي `mediaId` في الوثيقة يخص صفاً في `storefront_media` للمستأجر نفسه، غير محذوف، وحالته جاهزة.

**الحذف والإزالة:**
- حذف بُعد أو قيمة يحذف الهوية تلقائياً عبر cascade.
- إزالة الهوية (`visual: null`) تحذف الصف، فتعود الوراثة الكاملة.
- **لا يمسّ أيٌّ من ذلك** الإسنادات ولا المنتجات.

**لماذا جدول منفصل بـJSON مُطبَّع لا أعمدة مطبوعة؟** القرار D-01 في سجل القرارات:
- (أ) يطابق نمط أَوْج المعتمد لبيانات العرض: JSON مغلق تحكمه PHP، له توأمان TS، ويُثبَّت بـfixture مشترك.
- (ب) الماسح القائم يلتقط `mediaId` داخل JSON بلا تعديل منطقه.
- (ج) لا استعلام يصفّي على هذه الحقول.
- (د) إضافة شكل أو حقل لاحقاً لا تحتاج migration.

### 3.3 وثيقة الهوية المرئية v1

**صفّ القيمة.** المفتاح الغائب يعني «ورِّث»:
```jsonc
{
  "content": "image" | "icon" | "none",
  "image": { "mediaId": "<uuid>", "fit": "cover"|"contain", "focal": {"x":0-100,"y":0-100}, "zoom": 1.0-3.0,
             "alt": {"ar": "…", "en": "…"}, "decorative": true|false },
  "icon": "<IconKey>",
  "iconColor": "#RRGGBB",
  "background": "#RRGGBB",
  "shape": "<ShapeKey>",
  "size": "sm" | "md" | "lg",
  "showLabel": true | false
}
```

**صفّ البُعد.** هويته الذاتية + افتراضات للقيم:
```jsonc
{
  "self":     { "content": …, "image": MediaRef, "icon": …, "iconColor": …, "background": … },
  "defaults": { "content": …, "icon": …, "iconColor": …, "background": …, "shape": …, "size": …, "fit": …, "showLabel": … }
}
```

**قواعد التطبيع** (ثلاثية التوأمة: PHP سلطة + TS web + TS storefront، مع fixture مشترك `tests/Fixtures/presentation/facet-visual.json`):
- المفاتيح المجهولة تُسقط.
- القيم خارج القوائم المغلقة تُسقط، أي ترجع للوراثة.
- الألوان تُقبل فقط بصيغة hex سداسية عبر `isSafeHexColor`.
- الـalt محدود بـ150 نقطة ترميز، مثل `MAX_BANNER_IMAGE_ALT_LENGTH`.
- `zoom` يُقصّ إلى المدى 1–3.
- `crop` و`rotate` **مرفوضان** في هذا الاستخدام (القرار D-09)، لأن الشكل يُطبَّق بالـCSS على مصغّرات قائمة، فلا نسخ مخبوزة ولا كلفة توليد متزامن.

**الكتابة صارمة والقراءة متسامحة** (القرار D-11):
- المسار الكتابي يعيد **422** بأخطاء حقلية على المدخلات غير الصالحة: `mediaId` أجنبي أو غير جاهز، شكل مجهول، لون غير آمن.
- القراءة تطبّع بفشل مغلق دائماً.

### 3.4 الصورة الأصلية والأشكال (التعديل 3)

- **الأصل يُرفع مرة واحدة** إلى `storefront_media` عبر المسار والتحقق القائمين. لا رفع جديد ولا خدمة تخزين جديدة.
- **لا يُخبز أي شكل في البكسلات.** الشكل قناع عرض فقط، فالصورة نفسها تُعرض دائرية في قسم، وقوساً في قسم آخر، ومربعاً في المعاينة، **من البايتات والنسخ نفسها**.
- التأطير (`fit`/`focal`/`zoom`) مخزَّن **لكل استخدام** (في `visual`) لا على الأصل. لذلك تبقى الصورة الواحدة قابلة لإعادة الاستخدام في أبعاد وقيم أخرى بإطار مختلف.
- **النسخ المقدَّمة للمتجر محصورة** في `thumb-160`، `thumb-320`، `480w`، `768w` (webp/jpg). **الأصل لا يُقدَّم أبداً.** هذا يحقق شرط «عدم تحميل الصور الأصلية الثقيلة في قوائم المتجر».

**محرك الأشكال** (code-owned registry، ثلاثي التوأمة بقائمة المفاتيح، والهندسة في TS):

| المفتاح | التقنية | نسبة الإطار |
|---|---|---|
| `circle` | `border-radius:50%` | 1:1 |
| `square` | بلا انحناء | 1:1 |
| `rounded` | `border-radius` من رموز التصميم | 1:1 |
| `landscape` | `aspect-ratio` | 4:3 |
| `portrait` | `aspect-ratio` | 3:4 |
| `oval` | `border-radius:50%` | 4:3 |
| `star` · `diamond` · `hexagon` | `clip-path: polygon(%)` (متجاوب بطبيعته) | 1:1 |
| `heart` · `vase` · `arch` | SVG `<clipPath clipPathUnits="objectBoundingBox">` (مسارات منحنية بإحداثيات 0..1)، يُشار له بـ`clip-path:url(#awj-shape-…)` | 1:1 / 3:4 / 3:4 |

- **الأمان:** الهندسة ثوابت في الكود. البيانات تحمل **مفتاح الشكل فقط**، ولا مسار SVG ولا CSS من التاجر، ولا `dangerouslySetInnerHTML`.
- **RTL:** كل الأشكال متناظرة أفقياً فلا تحتاج عكساً. الإزاحة تستخدم خصائص منطقية.
- **فصل الشكل عن البطاقة:** `shape` يخص إطار الوسيط في L2. `cardStyle` (`plain|outlined|elevated|filled`) يخص الحاوية الخارجية في L3.

### 3.5 الأيقونات

- **نوسّع `IconRegistry` القائم بإضافات فقط** (append-only، القرار D-10). لا ننشئ سجلاً ثانياً.
- المرشحون (كلها متحقَّقة في lucide 0.460): `cake`، `graduation-cap`، `baby`، `flower`، `gem`، `party-popper`، `user`، `user-round`، `briefcase`، `house`، `hand-heart`، `heart-handshake`، `moon`، `sun`، `coffee`، `crown`، `trophy`، `smile`، `paw-print`، `shirt`، `watch`، `book-open`، `music`، `palette`، `school`، `stethoscope`، `utensils`، `snowflake`.
- الأسماء العربية والوسوم تُضاف في السجل نفسه.
- **التخزين:** مفتاح الأيقونة نصاً فقط، ولا JSX ولا SVG.
- **منتقي الأيقونات:** مكوّن جديد `IconPicker` (شبكة قابلة للبحث بالتسمية العربية والإنجليزية والوسوم). يستبدل لاحقاً الـ`<select>` المكرّر، لكن ذلك **خارج نطاق هذا الأفق**.

### 3.6 الوراثة والاستثناء (المتطلب F)

**سلسلة الحل:** الأعلى يفوز، والمفتاح الغائب ينتقل للمستوى التالي.

| الخاصية | 1. القسم (L3، إن صُرّح) | 2. القيمة | 3. افتراضات البُعد | 4. القالب (L3) | 5. افتراض النظام |
|---|---|---|---|---|---|
| `shape` | ✓ | ✓ | ✓ | ✓ | `circle` |
| `size` | ✓ | ✓ | ✓ | ✓ | `md` |
| `showLabel` | ✓ | ✓ | ✓ | ✓ | `true` |
| `content` | — | ✓ | ✓ | — | `none` |
| `icon` | — | ✓ | ✓ (أيقونة افتراضية لكل القيم) | — | لا أيقونة |
| `iconColor` / `background` | — | ✓ | ✓ | — | رموز سمة المتجر |
| `fit` | — | ✓ (داخل `image`) | ✓ | — | `cover` |
| `image` | — | ✓ | **لا يُورث** | — | — |

**قواعد صريحة:**
1. **الصورة لا تُورث من البُعد إلى القيم.** `self.image` هوية البُعد نفسه، كغلاف قسم أو بطاقة بُعد، ووراثتها تعني صورة متطابقة لكل القيم بلا معنى. الأيقونة **تُورث** لأن «أيقونة واحدة لكل المناسبات» نمط مفيد.
2. **سلسلة السقوط عند غياب الوسيط:**
   - المحتوى المحلول `image`، لكن الصورة غير صالحة (محذوفة، غير جاهزة، فشل التحميل) → أيقونة القيمة.
   - ثم أيقونة البُعد الافتراضية.
   - ثم نص فقط.
   - **لا تظهر صورة مكسورة أبداً** (المتطلب G).
3. القسم يفرض `shape`/`size`/`showLabel` **فقط عند تصريحه بها**. الافتراضي «ورِّث». الهدف أن يتمكن التاجر من توحيد شبكة بشكل واحد دون مسح تخصيص القيم.
4. التخطيط `text-list` يتجاهل الوسائط. `icon-grid` يفضّل الأيقونة، ثم الصورة، ثم النص.
5. **الحلّ يجري في الخادم** (`CommerceFacetVisualResolver`) لـL2، فيتلقى كل عميل (متجر الويب، وتطبيق الجوال لاحقاً) نتيجة واحدة متسقة. L3 يُطبَّق في العارض.

### 3.7 L3 — إعدادات العرض لكل واجهة وقوالبه (التعديلان 2 و4)

**امتداد اختياري لمحتوى قسم `discovery` القائم.** لا نوع قسم جديد، تطبيقاً للقاعدة 0 في ADR-21: «ثلاثة أنواع عامة لا عشرون».

| المفتاح | القيم | الافتراضي عند الغياب |
|---|---|---|
| `layout` | `image-grid` · `image-cards` · `carousel` · `icon-grid` · `text-list` | **غياب = السلوك القديم حسب `display`** (`tiles`/`chips`) |
| `template` | معرّف من سجل القوالب (أدناه) | لا قالب |
| `columns` | `{mobile:2–4, tablet:2–6, desktop:2–8}` | من القالب، وإلا `2/3/4` |
| `gap` | `tight` · `normal` · `loose` | `normal` |
| `textPosition` | `below` · `overlay` · `beside` | `below` |
| `contentOrder` | `media-first` · `label-first` | `media-first` |
| `valueOrder` | `merchant` · `count` | `merchant` (ترتيب `sort_order`) |
| `shape` / `size` / `showLabels` | كما في §3.4 | ورِّث |
| `cardStyle` | `plain` · `outlined` · `elevated` · `filled` | `plain` |
| `align` | `start` · `center` | `center` |
| `showCounts` | bool | `false` |
| `maxItems` | 4–24 | 12 (الحد الحالي) |

**سجل القوالب** (code-owned، ثلاثي التوأمة، يُضاف إليه ولا يُحذف منه). القالب **حزمة افتراضات** تتجاوزها أي قيمة صريحة في القسم:

| المعرّف | طبيعة المتجر | layout | shape | size | النص | البطاقة | أعمدة m/t/d |
|---|---|---|---|---|---|---|---|
| `gift-circles` | زهور وهدايا | image-grid | circle | md | below | plain | 3/4/6 |
| `boutique-arches` | عطور، أزياء، فاخر | image-cards | arch | lg | below | plain | 2/3/4 |
| `editorial-portrait` | أزياء ومحتوى | image-cards | portrait | lg | overlay | plain | 2/3/4 |
| `market-icons` | بقالة، صيدلية، خدمات | icon-grid | rounded | sm | below | filled | 4/6/8 |
| `swipe-rail` | عام للجوال | carousel | circle | md | below | plain | — |
| `minimal-text` | أي نشاط | text-list | — | — | beside | outlined | 1/2/3 |

**التوافق الخلفي (بوابة إصدار):**
- الـnormalizer لا يُخرج أي مفتاح جديد إلا إذا كان موجوداً وصالحاً. لذلك **كل وثيقة قائمة والوثيقة الافتراضية تبقى متطابقة بايتاً ببايت**، وهذا يُثبَّت بتوسيع `data-sections.json`.
- `display` يبقى، ويُقرأ عند غياب `layout`.
- حزمة Bloom (ADR-26) تستمر بلا تغيير.

**قوالب يحفظها التاجر بنفسه مؤجَّلة** (القرار D-07)، لأنها تحتاج persistence جديدة.

### 3.8 الـAPI المقترح

**أ) الإدارة.** كله إضافي، والعقود القائمة لا تتغيّر.

| المسار | التغيير | الحراسة |
|---|---|---|
| `GET /api/commerce/workspace/facets` | **إضافة** `visual` (الوثيقة المخزّنة أو `null`) و`visual_updated_at` لكل بُعد وقيمة | كما هي (`products.view`) |
| `PUT /api/commerce/workspace/facets/{id}/visual` | **جديد**. الجسم: `{visual: object|null, if_unmodified_since?: ISO8601}` | `commerce.manage` (القرار D-04) + `denySelfService` + throttle |
| `PUT /api/commerce/workspace/facets/{id}/values/{valueId}/visual` | **جديد**. الجسم كالسابق | كالسابق |

**الردود:**
- `200 {data:{visual, updated_at}}`.
- `404` لصف غير موجود أو من مستأجر آخر، بلا كشف لوجوده.
- `409` عند تعارض `if_unmodified_since`.
- `422` بأخطاء حقلية.

**ب) المتجر العام.** على `storefront.v1` فقط (القرار D-05)، على نمط صورة التصنيف (`StorefrontCategoryResource.php:60-62`). يبقى `commerce/v1` المغلق في OpenAPI بلا تغيير.

- **`meta.facets[]`** يضاف إليه `visual` (هوية البُعد المحلولة) أو `null`.
- **`meta.facets[].values[]`** يضاف إليه `visual` بهذا الشكل:
  ```jsonc
  { "content": "image"|"icon"|"none",
    "image": { "sources": [{"width":160,"format":"webp","src":"/store/v1/media/facet-visuals/{visualId}/thumb-160.webp"}, …],
               "alt": "…", "fit": "cover", "focal": {"x":50,"y":40}, "zoom": 1.2 },
    "icon": "cake", "iconColor": "#9d2449", "background": "#fdf2f4",
    "shape": "arch", "size": "md", "showLabel": true }
  ```
- يُحمَّل باستعلامين محدودين لكل رد: صفوف الهويات للأبعاد النشطة، ثم صفوف الوسائط المشار إليها. لا N+1.
- الحمل محدود سلفاً بحدّي 30 بُعداً و200 قيمة.

**ج) تقديم صور الأبعاد** (القرار D-03). مسار جديد محروس:

`GET store/v1/media/facet-visuals/{visualId}/{file}`

- `file` ∈ قائمة بيضاء: `thumb-160|thumb-320|480w|768w` × `webp|jpg`. **الأصل مرفوض دائماً.**
- يُقدَّم الملف فقط إذا تحققت كل الشروط التالية:
  1. صف الهوية موجود ضمن مستأجر نطاق المتجر.
  2. مالكه (البُعد، أو البُعد والقيمة) نشط.
  3. الوثيقة تشير فعلاً إلى هذا الوسيط.
  4. الوسيط جاهز وغير محذوف.
- إن لم تتحقق الشروط: **404**.
- الترويسات: `private, no-store` + ETag + `nosniff` عند المصدر، ونافذة 300 ثانية في بروكسي Next. هذا نمط مسار المُخصِّص القائم (القرار D-15)، فإيقاف القيمة يختفي أثره خلال دقائق لا ساعة.
- يُضاف بروكسي `storefront/src/app/api/storefront/media/facet-visuals/[id]/[file]/route.ts`.

**د) حماية الوسائط.**
- `StorefrontMediaReferenceScanner` يضاف إليه حاوية رابعة `facet_visual` (`storefront_id` فارغ لأن الهوية على مستوى المستأجر).
- النتيجة: الحذف يُمنع بـ`409 media_in_use` مع ذكر المكان، وفلتر «غير مستخدمة» يصبح صحيحاً، وتنظيف اليتامى لا يحذف صورة مستخدمة.

**هـ) لا تغيير** على مسارات الأبعاد القائمة ولا على `CatalogFacetFilter::apply()` ولا على صيغة `facet[key]=slug`. **التصفية لا تتغيّر حرفاً.**

### 3.9 الواجهات

**محرر الإدارة (VD-3):**
- يُستبدل `FieldsDialog` لتعديل البُعد والقيمة بـ`FacetVisualEditor`.
- الحاوية: `Sheet` جانبي عريض على الكمبيوتر، وملء الشاشة على الجوال.
- ثلاثة تبويبات بمكوّن `Tabs` القائم:
  1. **البيانات:** الاسم العربي والإنجليزي والحالة. يكتب للمسار القائم دون تغيير.
  2. **الصورة والأيقونة:**
     - اختيار نوع المحتوى (ورِّث / صورة / أيقونة / نص فقط).
     - `MediaRefField` + `MediaPicker` (رفع أو اختيار من المكتبة، استبدال، إزالة، نص بديل).
     - `IconPicker` مع `ColourField` للون.
  3. **المظهر:**
     - مكتبة الأشكال الـ12.
     - الحجم، والاحتواء.
     - نقطة التركيز: شبكة 3×3 أو سحب على المعاينة.
     - التكبير، والخلفية، وإظهار الاسم.
     - **كل حقل** يحمل حالة «موروث من البُعد» وزر استرجاع.
- **معاينة حيّة** بالمكوّن نفسه الذي يرسم المتجر (`FacetVisualTile`، توأم web وstorefront)، في ثلاثة تخطيطات مصغّرة.
- عند تعديل البُعد: قسم إضافي «افتراضات القيم».
- **الحفظ:** يكتب البيانات (إن تغيّرت) ثم الهوية (إن تغيّرت). يعرض نتيجة كل جزء على حدة، ولا يغلق المحرر إلا عند نجاح الكل. كل عملية idempotent.
- **قيود القدرة والصلاحية:**
  - عند غياب `commerce.manage`: تبويبا الهوية للقراءة فقط مع تفسير.
  - عند تعطّل مكتبة الوسائط (`use-media-capability`): خيار الصورة معطّل مع سبب صريح.
- **فك الارتباط:** `MediaRefField` يربطه نوع `t` بكتالوج رسائل المُخصِّص. يُفك بمحوّل رسائل صغير دون تكرار المكوّن.

**المتجر (VD-4b):**
- `FacetVisualTile` يعرض:
  - `<picture>` بمصادر webp/jpg و`srcset` من المصغّرات.
  - `loading="lazy"` و`decoding="async"`.
  - أبعاد صريحة تمنع إزاحة التخطيط (CLS).
  - `onError` ينتقل إلى سلسلة السقوط (§3.6).
- خمسة تخطيطات:
  - `carousel`: scroll-snap مع دعم RTL، ويحترم `prefers-reduced-motion`.
  - كل التخطيطات **روابط حقيقية** بالصيغة القائمة `products?facet[key]=slug`.
- **الوصولية:**
  - اسم الرابط هو اسم القيمة دائماً، حتى مع `showLabel=false` (يُخفى بصرياً فقط).
  - الصورة تزيينية (`alt=""`) لأن الرابط يحمل النص.
  - مساحة اللمس ≥ 44px.
  - حلقة تركيز واضحة.
  - لون الأيقونة يُفحص تباينه مقابل الخلفية بنسبة ≥ 3:1، وإلا يسقط إلى رموز السمة.
- **الأسماء العربية الطويلة:** `line-clamp-2` مع `title`، ولا تكسر الشبكة.

---

## 4. التوافق الخلفي

| السطح | الضمان | كيف يُثبت |
|---|---|---|
| جداول الأبعاد الثلاثة | لا تعديل إطلاقاً | diff الـmigrations: ملف إنشاء جديد فقط |
| أبعاد بلا هوية (كل البيانات الحالية) | `visual: null`، والمتجر يعرض كما اليوم | اختبار بيانات قديمة + لقطة المتجر قبل/بعد |
| ردود الإدارة | مفاتيح مضافة فقط | `client.ts` يقرأ ما يعرفه، واختبار mapper |
| `meta.facets` في `store/v1` | مفتاح `visual` مضاف | العارض القديم يتجاهله، و`listing-facets.ts` يطبّع ما يعرفه |
| `commerce/v1` (الجوال) | **بلا تغيير** | اختبارات `CommerceApiOpenApiContractTest` تبقى خضراء |
| وثائق العرض القائمة والوثيقة الافتراضية | متطابقة بايتاً ببايت | fixture `data-sections.json` + `default-config.json` + `pre-hv-golden.json` |
| `discovery` القديم (`tiles`/`chips`) | يُعرض كما هو حين يغيب `layout` | اختبارات عارض + لقطة بصرية |
| حزمة Bloom (ADR-26) | تضيف `discovery` بـ`display:tiles` كما اليوم | اختبار `flowers-pack` القائم |
| التصفية وعدّاداتها | لا تغيير | `CommerceFacetStorefrontFilterTest` كما هو |
| مكتبة الوسائط | حذف وسيط مستخدَم في هوية يُمنع الآن (409) | اختبار جديد. هذا **تشديد مقصود** لا كسر |

**Rollback:**
- الـmigration إضافية وقابلة للعكس (`dropIfExists`).
- تعطيل العرض ممكن بإزالة `layout` من الأقسام، فيعود السلوك القديم تلقائياً.
- لا يوجد backfill ولا تحويل بيانات.

---

## 5. تحليل المخاطر

| # | الخطر | الأثر | الاحتمال | التخفيف |
|---|---|---|---|---|
| R1 | حذف وسيط مستخدم في هوية بُعد يكسر المتجر | عالٍ | مؤكد بلا تخفيف | حاوية `facet_visual` في الماسح + سلسلة سقوط في العارض + اختبار |
| R2 | تقديم وسيط غير منشور أو لمستأجر آخر علناً | عالٍ (أمن) | متوسط | مسار محروس بأربعة شروط، وقائمة بيضاء للملفات، والأصل لا يُقدَّم، واختبارات سلبية لمستأجر أجنبي وقيمة معطلة ووسيط محذوف وملف غير مسموح |
| R3 | `mediaId` من مستأجر آخر يُحفظ في الهوية | عالٍ | منخفض | `TenantScope` عند التحقق + حراسة `saving` في النموذج + اختبار API واختبار نموذج |
| R4 | انحراف توائم PHP/TS (normalizer، الأشكال، الأيقونات، القوالب) | متوسط | متوسط | fixture مشترك لكل عقد + اختبار تطابق بايتي لسجل الأيقونات (قائم) |
| R5 | كسر وثائق العرض القائمة | عالٍ | منخفض | المفاتيح الجديدة تُكتب فقط إن وُجدت + golden fixtures |
| R6 | أداء `meta.facets` | متوسط | منخفض | استعلامان محدودان، لا N+1، مصغّرات فقط، `lazy` |
| R7 | تعارض PRs المُخصِّص (#1089، #853) على `section-content.ts` | متوسط | متوسط | فحص التعارض قبل VD-4a، وVD-4a صغير ومعزول |
| R8 | تقسيم RBAC: المحاسب يحرّر الأسماء ولا يصل للمكتبة | منخفض | مؤكد | قرار D-04 + واجهة تشرح القيد بدل كسرها |
| R9 | مكتبة الوسائط معطلة في بيئة ما | منخفض | منخفض | `use-media-capability` + خيار الصورة معطّل بسبب صريح، والأيقونة والنص يعملان |
| R10 | لا وضع داكن في المتجر اليوم | منخفض | مؤكد | القرار D-13: الوضع الداكن يُختبر في محرر الإدارة، والمتجر يحترم رموز السمة. وضع المتجر الداكن خارج النطاق ويحتاج قراراً مستقلاً |
| R11 | دعم `clip-path:url()` على عناصر HTML في متصفحات قديمة | منخفض | منخفض | الأشكال الستة البسيطة بـCSS خالص، والثلاثة المنحنية تسقط إلى `rounded` عبر `@supports`. يُتحقق في VD-5 بمتصفح فعلي |
| R12 | `Balloon` غير موجودة في lucide 0.460، وstorefront بإصدار مختلف | منخفض | مؤكد | لا تُضاف `balloon`، وكل مفتاح يُتحقق في الحزمتين باختبار |
| R13 | توليد مشتقات متزامن (`QUEUE_CONNECTION=sync`) | متوسط | منخفض | لا مشتقات جديدة: نستخدم النسخ الأساسية المولّدة عند الرفع |
| R14 | `EnsureApplicationActive` غائب عن مسارات الأبعاد | منخفض | قائم | لا نوسّعه هنا، ويُسجَّل backlog |
| R15 | أفق TAX-ZATCA نشط بالتوازي | منخفض | — | لا ملف مشترك |

---

## 6. ما لا يفعله هذا الأفق (حدود صريحة)

- لا يمسّ القيود أو الضريبة أو المخزون أو الطلبات أو التسعير أو ZATCA.
- لا يغيّر منطق التصفية ولا صيغتها ولا عدّاداتها.
- لا يضيف تخزيناً موازياً ولا رفع SVG ولا HTML أو CSS من التاجر.
- لا يغيّر `commerce/v1` ولا تطبيق الجوال (مؤجّل، القرار D-05).
- لا يضيف صوراً أو أيقونات لشرائح التصفية في صفحة القائمة (`GiftingFilters`) (مؤجّل، القرار D-12).
- لا يدعم قوالب يحفظها التاجر بنفسه (مؤجّل، القرار D-07).
- لا يضيف وضعاً داكناً للمتجر (القرار D-13).

## 7. التوصية

اعتماد القرارات D-01 حتى D-15 في `AWJ-VD-H1-DECISION-REGISTER.md` كما هي مقترحة.

بعد الاعتماد:
- تبدأ VD-1a (العقد والسجلّات، بلا DB ولا API).
- تليها VD-1b (الـmigration والـAPI).
- بالتوازي مع VD-2 وVD-4a عند استيفاء الاعتماديات.

الترتيب الكامل في `AWJ-VD-H1-TASK-QUEUE.md`.

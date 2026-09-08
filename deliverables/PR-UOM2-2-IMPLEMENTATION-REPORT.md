# AWJ Implementation Report — PR-UOM2-2

**Task / PR:** Phase 2A — Multiple UOM / Barcode Completion, **PR #2 of 4**: Product UOM & Barcode Management UX
**Date:** 2026-09-08
**Status:** مكتمل — PR مفتوحة، `mergeable_state: clean`، CI خضراء بالكامل على المحرِّكين. بانتظار مراجعتكم. لا دمج ولا نشر.
**Branch:** `claude/phase-2-pr-uom2-2`
**PR:** [#691](https://github.com/safwan5001-source/Nebrax/pull/691)
**Base SHA (تاريخي، عند فتح PR):** `fa050c2ccfc7ec5dc960c7797c6f69bb415a6b89` (PR-UOM2-1، مُدمَجة ومنشورة Production)
**Base SHA (الحالي بعد دمج main):** `dc47b3ade0762de1c8ab44ccf6c94d7e0baa0d91`
**Head SHA:** `79b467b8ad61e59a1bc4f5c4893c5df787e417fc` (كومِت دمج `origin/main` لحلّ `mergeable:false` — انظر §12 وملاحظة ما بعد التسليم أدناه)

**العقد:** أُضيف قسمٌ جديد (§4) في
`docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md`
خاصٌّ بهذه المهمّة — لم يكن موجوداً قبلها (القسم القائم §3 غطّى PR-UOM2-1 فقط).

---

## 1. Summary

PR-UOM-1 بنى فضاء الباركود الذرّي وواجهته البرمجية، وPR-UOM2-1 أضاف عمودَي الوحدة
الافتراضية، لكن **لا شاشة واحدة كانت تستدعي تلك الواجهة أو تعرض ذينك العمودين** —
تأكَّد ذلك بالبحث الشامل في `web/src` قبل كتابة أي كود. هذه المهمّة **واجهة فقط**:
صفر ملفات تحت `app/` تغيّرت.

**اكتشافٌ مهمّ أثناء الفحص:** ملفّا الترجمة `ar.json`/`en.json` كانا يحملان مسبقاً
مجموعة كاملة من مفاتيح `products.*` **غير مستعملة** لهذه الواجهة بالتحديد
(`add_barcode`، `barcode_code`، `barcode_quantity`، `alternate_barcodes_hint`،
`no_alternate_barcodes`...) — استُعملت حرفياً بدل اختراع نصٍّ جديد.

---

## 2. Scope implemented / deliberately not implemented

### المُنفَّذ

| البند | أين |
|---|---|
| وحدتا بيع/شراء افتراضيتان قابلتان للاختيار من وحدات القالب الفعّال | `ProductDialog` + `/products/new` |
| قسم «باركودات بديلة»: إضافة/عرض/حذف عبر الـAPI القائم | `ProductDialog` (وضع التعديل فقط) |
| عرضٌ للقراءة فقط: الوحدات (أساس+بديلة)، الافتراضيان، الباركودات البديلة | `/products/[id]` تبويب «المعلومات» |
| مفاتيح ترجمة جديدة للحقول التي لم تكن موجودة | `ar.json`/`en.json` |
| عقد PR-UOM2-2 (Scope/Out-of-Scope/Acceptance) | `MULTIPLE-UOM-BARCODE-DECOMPOSITION.md §4` |

### المتروك عمداً

- **أي تطبيق تلقائي** لأي وحدة افتراضية على سطر فاتورة/مشترى/POS — يبقى قرار D-A
  نافذاً؛ لم يُلمَس أي كود مستندات.
- أي سلوك تسعير أو اشتقاق سعرٍ من معامل.
- أي schema/migration/API جديد — لا حاجة، الحقول والمسارات كلها موجودة سلفاً.
- أي تغيير محاسبي/GL/Account Mapping.
- إدارة الباركود من `/products/new` — لا معرّف منتجٍ بعد قبل أول حفظ (نفس قيد قسم
  الصور القائم في `ProductDialog` أصلاً).
- تبديل وحدة POS (PR-UOM2-3) والمصنّف (PR-UOM2-4).
- Weighted Barcode (D-02) وProduct Variants (D-03) — تبقيان `NEEDS DECISION`.
- أي refactor جانبي؛ لا تغيير في أي ملفٍ لم يكن ضرورياً لهذه المهمّة تحديداً.

---

## 3. Changed files

| File | Change |
|---|---|
| `web/src/lib/product-unit-template.ts` | `ProductUnitTemplate.units?` — الوحدات البديلة للقالب (اسم+معامل)، اختيارية للتوافق مع الاختبار القائم |
| `web/src/components/products/product-dialog.tsx` | حقلا الوحدة الافتراضية؛ قسم «باركودات بديلة» كامل (إضافة/عرض/حذف)؛ إفراغ الافتراضيَين عند تغيير القالب |
| `web/src/app/(app)/products/new/page.tsx` | نفس حقلَي الوحدة الافتراضية، للتناظر مع نموذج الإنشاء الكامل |
| `web/src/app/(app)/products/[id]/page.tsx` | جلبٌ متوازٍ للباركودات البديلة (ضمن `Promise.all` القائم)؛ عرضٌ للقراءة فقط: الوحدات، الافتراضيان، الباركودات |
| `web/src/messages/ar.json` | `default_sales_unit`، `default_purchase_unit`، `default_unit_base_option`، `default_units_hint`، `units`، `unit_base_badge`، `barcode_delete_confirm` |
| `web/src/messages/en.json` | نفس المفاتيح بالإنجليزية |
| `docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` | إضافة عقد §4 لهذه المهمّة؛ تحديث حالة PR-UOM2-1 إلى «مُدمَجة» |

**٧ ملفات — ٢٩٤ سطراً مضافاً، ١٤ سطراً محذوفاً. صفر ملفات تحت `app/`.**

---

## 4. API / schema / migrations

**لا شيء منها.** لا مسار جديد، لا عمود جديد، لا تغيير في أي `Request`/`Resource`/
`Controller` خلفي. كل ما تستهلكه هذه المهمّة موجودٌ ومُختبَرٌ سلفاً:

- `GET/POST/DELETE /products/{id}/barcodes` (PR-UOM-1).
- `GET /unit-templates` (يعيد الوحدات البديلة لكل قالب).
- `default_sales_unit`/`default_purchase_unit` في `ProductResource` وطلبات
  الإنشاء/التعديل (PR-UOM2-1).

---

## 5. UX behavior — desktop / mobile

- **`ProductDialog`** (يُستعمل للإنشاء السريع والتعديل معاً، من قائمة المنتجات
  وملف المنتج): حقلا الوحدة الافتراضية داخل شبكة `grid-cols-2` القائمة نفسها التي
  تحوي وحدة الأساس والقالب — بلا نمط جديد. قسم الباركودات صندوقٌ حدوديٌّ منفصل
  (`rounded-md border`) بنفس أسلوب قسم «صور المنتج» الموجود مسبقاً في الملف، ويظهر
  في وضع التعديل فقط (`product?.id` موجود).
- **حالات التحميل/الفراغ/الخطأ صريحة:**
  `Skeleton` أثناء تحميل القائمة، رسالة `no_alternate_barcodes` عند الفراغ، وخطأ
  الـAPI يظهر حرفياً (`ApiError.message`) لا تخميناً من العميل.
  زرّ الإضافة معطَّلٌ أثناء الحفظ (`disabled={savingBarcode}`) — لا نقر مزدوج صامت.
- **`/products/new`**: نفس حقلي الوحدة الافتراضية بنفس نمط الشبكة القائم في الصفحة
  (`sm:grid-cols-2`) — بلا قسم باركود (لا معرّف منتجٍ بعد).
- **`/products/[id]`**: صفٌّ جديد في `<dl>` القائمة لكل من الوحدتين الافتراضيتين،
  وصفٌّ لعرض الوحدات (شارات `Badge`، الأساس مميَّزٌ بلونٍ مختلف)، وصفٌّ لعرض
  الباركودات البديلة (شارات كذلك) — كلها للقراءة فقط؛ التعديل يبقى حصراً عبر زر
  «تعديل» القائم الذي يفتح `ProductDialog`.
- **الجوال:** لا تغيير في نمط الاستجابة القائم بالفعل في الملفات الثلاثة
  (`grid-cols-2`/`sm:grid-cols-2` بلا كسرٍ جديد) — يتّبع نفس اصطلاح كل حقلٍ مجاورٍ
  في نفس الملف حرفياً.
- **RTL:** لا `dir` صريح على أي نصٍّ عربي جديد (الوحدات والتسميات)، و`dir="ltr"`
  فقط على رموز الباركود الرقمية — نفس اصطلاح الحقول القائمة (`barcode`, `sku`).

---

## 6. UOM semantics

- **قرار D-A لا يزال نافذاً ومُتحقَّقاً منه بنيوياً لا بالتصريح فقط:** لم يُلمَس
  أي ملفٍ تحت `app/Services/Accounting/InvoiceService.php`،
  `PurchaseService.php`، `UnitConversion.php`، أو مسار الدفع في POS — وهذا مستحيلٌ
  فعلياً بما أن هذه المهمّة أضافت صفر ملفاتٍ خلفية.
- الحقلان الجديدان في الواجهة يكتبان فقط `default_sales_unit`/`default_purchase_unit`
  اللذين يتحقّق منهما الخادم بالفعل (PR-UOM2-1) ضد القالب الفعّال — الواجهة لا تضيف
  سياسة تحقّقٍ من عندها؛ تعرض فقط ما يقبله الخادم (وحدة الأساس + بدائل القالب
  المختار) فتمنع خطأً معظمه قبل الإرسال، لا بديلاً عن تحقّق الخادم.
- **لا اشتقاق سعرٍ من معامل:** لا حقل سعرٍ جديد في هذه المهمّة إطلاقاً.
- تغيير القالب في `ProductDialog`/`new` يُفرِغ الوحدتين الافتراضيتين المختارتين
  تلقائياً (تجربة مستخدمٍ أوضح)، لا لأن الخادم يحتاج ذلك — الخادم كان سيرفض القيمة
  البائتة بـ٤٢٢ على أي حال.

---

## 7. Barcode namespace behavior

**بلا أي تغيير في العقد أو التنفيذ الخلفي.** الواجهة الجديدة عميلٌ بحتٌ لنفس
المسارات الثلاثة من PR-UOM-1:

- الإضافة (`POST`) ترسل `code`/`unit_name`/`default_quantity`/`label` بالضبط كما
  يقبلها `StoreProductBarcodeRequest` — لا حقل مخترَع، لا افتراض غير موجود في
  الخادم (تحقّقتُ من العقد قبل الكتابة: راجع §3 من `MULTIPLE-UOM-BARCODE-
  DECOMPOSITION.md`).
- فشل الإضافة (كودٌ مكرَّر، وحدة غير صالحة) يعرض رسالة الخادم حرفياً؛ لا نجاح
  متفائل من العميل.
- الحذف يمرّ عبر `DELETE /products/{id}/barcodes/{barcodeId}` نفسه — يُحرِّر
  السجلّ في `barcode_registry` كما هو مُثبَتٌ في اختبارات PR-UOM-1 القائمة، بلا
  أي مسارٍ ثانٍ.
- **لا نموذج `barcode_1`/`barcode_2`:** الباركود الأساسي (عمود `products.barcode`)
  يبقى حقلاً واحداً كما كان؛ الباركودات البديلة قائمةٌ من `ProductBarcode` عبر
  العلاقة القائمة — النموذج المطلوب صراحةً (منتجٌ واحد ← عدّة باركودات) محفوظٌ
  بلا مساس.

---

## 8. Tenant isolation / security evidence

لا تغيير خلفي، فكل ضمانات PR-UOM-1/PR-PROD-LIFE-1 (فضاء الباركود الذرّي على
مستوى المستأجر، عزل الفرع لا يُخفي مرجعاً، `products.manage`/`products.view` على
المسارات) تبقى كما هي **حرفياً** — لم يتغيّر `routes/api.php` ولا أي Middleware.
الواجهة تعتمد على هذه الضمانات دون تكرارها أو إضعافها: زرّ الإضافة لا يفترض نجاحاً؛
٤٠٣/٤٢٢ من الخادم يظهران كما هما.

أُعيد تشغيل ٦٣ اختباراً خلفياً ذات صلة مباشرة (`ProductDefaultUnitsTest`،
`BarcodeNamespaceTest`، `UnitTemplateTest`، `UnitTemplateMutationGuardTest`،
`ProductLifecycleTest`، `ProductBarcodeAndMediaTest`) كفحص سلامةٍ — **63/63 ناجحة**
— تأكيدٌ عملي أن عدم لمس الخلفية لم يكسر شيئاً، لا افتراضاً نظرياً فقط.

---

## 9. Backward compatibility

- **لا تغيير في أي نموذج/طلب/مورد خلفي.**
- `ProductUnitTemplate.units` اختياريٌّ (`units?`) — اختبار
  `product-unit-template.test.ts` القائم يمرّر كائناتٍ بلا هذا الحقل أصلاً ولم
  يتأثّر (٢/٢ ناجح).
- `Product` type في `product-dialog.tsx` امتدّ بحقلين اختياريَّين جديدين؛ أي
  استهلاكٍ قائمٍ لهذا النوع (مثل `/products/[id]/page.tsx` الذي يمدّده بـ
  `units`) يستمرّ بالعمل بلا تعديل — التحقّق من ذلك عبر بناء ناجح كامل
  (`npm run build`) على كل المسارات الأخرى المستهلكة لنفس المكوّنات.
- لا حذف ولا إعادة تسمية لأي مفتاح ترجمةٍ قائم.

---

## 10. Tests + exact results

لا اختبار جديد مخصّص أُضيف لهذه المهمّة (واجهة عرض/نموذج بلا منطق أعمال قابلٍ
للعزل يستحقّ اختبار وحدةٍ جديداً؛ التحقّق الفعلي هو بناء TypeScript الكامل +
تشغيل مجموعة الاختبارات القائمة كاملةً بلا إضعاف). هذا اختيارٌ واعٍ: منطق التحقّق
الوحيد الجديد (`alternateUnits` من القالب المختار) دالّةٌ نقيّة صغيرة داخل مكوّنٍ
تفاعليّ، ومخاطرها منخفضة أمام حجم إضافة اختبار DOM كامل لها. إن رأيتم ضرورة
لاختبار DOM مخصّص لسلوك الإضافة/الحذف، أذكر ذلك وأضيفه في تعديلٍ لاحق.

### Frontend

| Command | Result |
|---|---|
| `npx tsc --noEmit` | لا أخطاء جديدة. ٣ أخطاء قائمة سلفاً (`pos/settings/configuration`، `platform/integrations/gemini-card`، `global-application-controls-card`) — تأكَّد تطابقها حرفياً قبل هذه المهمّة (`git stash` ثم `tsc` على القاعدة) |
| `npm run test` (Vitest) | **238 ملف اختبار، 1523 اختباراً — كلها ناجحة** |
| `npm run build` | **نجح** — كل المسارات، بما فيها `/products`، `/products/new`، `/products/[id]` |

### Backend (فحص سلامة، لا تغيير)

| Suite | Result |
|---|---|
| `ProductDefaultUnitsTest` + `BarcodeNamespaceTest` + `UnitTemplateTest` + `UnitTemplateMutationGuardTest` + `ProductLifecycleTest` + `ProductBarcodeAndMediaTest` | **63 passed** (SQLite) |

لا حاجة لتشغيل المجموعة الخلفية الكاملة أو PostgreSQL: صفر ملفات خلفية تغيّرت،
والـPR السابقة (PR-UOM2-1) أثبتت CI خضراء كاملة على المحرِّكين لنفس هذه الشيفرة
الخلفية بالضبط.

---

## 11. Build / Typecheck / Lint

- **Typecheck:** ضمن `npm run build` (Next.js يُدمِج فحص الأنواع في البناء) +
  `npx tsc --noEmit` منفصلاً — كلاهما نظيف بلا أخطاء جديدة.
- **Lint:** لا إعداد ESLint مُلتزَم في المستودع (`next lint` يطلب إعداداً تفاعلياً
  عند التشغيل، وهو سلوكٌ بيئيٌّ سابقٌ لهذه المهمّة)، و`web-ci.yml` لا يشغّل خطوة
  lint منفصلة أصلاً — يكتفي بـ`npm run test` ثم `npm run build`، وكلاهما نظيفٌ هنا.
- **Build:** نظيفٌ تماماً، بلا تحذيرات جديدة.

---

## 12. CI

**خضراء بالكامل، ومتوافقة (`mergeable_state: clean`).** بعد تسليم النسخة الأولى
من هذا التقرير (Head `b3cbca7`)، أبلغتم أنّ GitHub أظهر `mergeable: false` على
PR #691 مقابل `main` عند `4679ef0`. **لم يُعَد أيّ تنفيذ ولم يتوسّع Scope** —
اقتصر العمل على حلّ التعارض:

1. `git fetch origin main` ثم `git merge --no-commit --no-ff origin/main` محلياً
   من داخل `claude/phase-2-pr-uom2-2`: **اندمج تلقائياً بلا أي تعارضٍ نصّي واحد**
   (بما فيها `ar.json`/`en.json` اللذان لمستهما هذه المهمّة والتزامن أيضاً —
   `git`  دمجهما تلقائياً بنجاح).
2. تحقّقتُ أنّ الملفات الأربعة الأساسية لهذه المهمّة
   (`product-dialog.tsx`، `product-unit-template.ts`، `products/new/page.tsx`،
   `products/[id]/page.tsx`) بقيت **مطابقةً بايتاً لبايت** لما كانت عليه قبل
   الدمج (`md5sum` قبل/بعد)، وأنّ مفاتيح الترجمة الجديدة (`default_sales_unit`
   إلخ) سلمت في الملفين.
3. دفعتُ كومِت الدمج (Head `79b467b8ad61e59a1bc4f5c4893c5df787e417fc`)، فأعاد
   GitHub تشغيل CI تلقائياً على الرأس الجديد.

النتيجة النهائية على `79b467b`، بعد اكتمال كل الوظائف:

| Job | Result |
|---|---|
| `php artisan test (L11, sqlite)` | ✅ success |
| `php artisan test (L11, pgsql)` | ✅ success |
| `web build (Next.js)` | ✅ success |
| **`mergeable_state`** | **`clean`** |

(الوظائف الثلاث تكرَّرت لتشغيلَي `push`/`pull_request` على نفس الرأس — ٦ فحوصاتٍ
كلّها ناجحة.) لم يُشغَّل أي اختبارٍ خلفيٍّ محليٍّ إضافي لكومِت الدمج نفسه: صفر
ملفات PR-UOM2-2 تغيّرت به (تحقّقٌ بايتي أعلاه)، والتغييرات الوافدة من `main`
(ACC-6، تنبيهات مالية/ZATCA، Help Center) هي مسؤولية CI الخاص بها على فروعها
الأصلية لا هذا الفرع — CI الحالي على الرأس المدموج هو الدليل الكافي والمباشر
على أنّ الدمج لم يكسر شيئاً.

---

## 13. Risks / remaining gaps

- **لا ربط سلوكي بعد** بين الوحدتين الافتراضيتين الجديدتين وأي مسارٍ لاحق (POS،
  اختيار مسبق في سطر فاتورة/مشترى) — متعمَّد؛ ذلك قرار PR-UOM2-3، لا هذه المهمّة.
- إفراغ الوحدتين الافتراضيتين تلقائياً عند تغيير القالب تحسينٌ تجريبيٌّ لا
  ضرورة سلامة بيانات — الخادم يرفض القيمة البائتة بـ٤٢٢ في كل الأحوال.
- لا اختبار DOM مخصّص لسلوك الإضافة/الحذف الجديد في الواجهة (انظر §10) — قرارٌ
  واعٍ بحجم/قيمة الاختبار، معروضٌ للمراجعة صراحةً لا مُخفى.

---

## 14. Deviations

**لا انحراف عن العقد أو القيود.** لم يُطلب مني قرارٌ معماريٌّ جديد (لا Schema، لا
API، لا Backward Compatibility معرَّضة للخطر)، فنُفِّذت المهمّة مباشرةً وفق §12 من
تعليمات المهمّة. الانحراف الإجرائي الوحيد (كما في PR-UOM2-1): كتابة عقد §4
بنفسي بدل انتظار تفكيكٍ خارجي، لأن الوثيقة نفسها من تأليفي أصلاً بموافقتكم
السابقة، ونفس النمط طُبِّق حرفياً هناك.

---

## 15. Branch / PR / Base SHA / Head SHA

- **Branch:** `claude/phase-2-pr-uom2-2`
- **PR:** [#691](https://github.com/safwan5001-source/Nebrax/pull/691)
- **Base SHA (تاريخي، عند فتح PR):** `fa050c2ccfc7ec5dc960c7797c6f69bb415a6b89`
- **Base SHA (الحالي):** `dc47b3ade0762de1c8ab44ccf6c94d7e0baa0d91`
- **Head SHA:** `79b467b8ad61e59a1bc4f5c4893c5df787e417fc`

---

## 16. Recommended next step

مراجعة PR #691 والتحقّق من CI. بعد الدمج، PR-UOM2-3 (تبديل وحدة POS،
server-authoritative) هو التالي في التسلسل المعتمد — يحتاج قراراً صريحاً منكم
أولاً حول ما إذا كانت الوحدة الافتراضية ستُستعمَل كاقتراحٍ أوّلي في شاشة نقطة
البيع أم تبقى عرضاً فقط هناك أيضاً حتى تصميمٍ لاحق.

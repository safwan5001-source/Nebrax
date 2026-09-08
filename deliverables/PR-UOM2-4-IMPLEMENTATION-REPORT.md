# AWJ Implementation Report — PR-UOM2-4

**Task / PR:** Phase 2A — Multiple UOM / Barcode Completion, **PR #4 of 4 (الأخيرة)**: Workbook round-trip — Products / Barcodes / Unit Prices
**Date:** 2026-09-08
**Status:** مكتمل — PR مفتوحة، `mergeable_state: clean`، CI خضراء بالكامل على المحرِّكين بعد تصحيح §0. بانتظار مراجعتكم. لا دمج ولا نشر.
**Branch:** `claude/phase-2-pr-uom2-4`
**PR:** [#705](https://github.com/safwan5001-source/Nebrax/pull/705)
**Base SHA (عند فتح PR):** `74d2ed6` (PR-UOM2-3، مُدمَجة ومنشورة Production)
**Base SHA (الحالي، بعد تقدّم `main` بمهامَّ أخرى موازية):** `c4d3471` — `mergeable_state: clean` رغم ذلك، لا تعارض
**Head SHA:** `7bdf661` (يشمل تصحيح ما بعد المراجعة — انظر §0 أدناه)

---

## 0. تصحيح ما بعد المراجعة (٢٠٢٦-٠٩-٠٨، بعد التسليم الأول)

راجع المالك التقرير الأول (Head `9f3ce74`) ورصد أن **الكود لا يطابق ما ادّعاه
التقرير نفسه عن القرار D-F**: `ProductWorkbookController::resolvePriceList()`
كان يتحقّق من ملكية المستأجر للقائمة فقط، ولا يتحقّق من `is_active` إطلاقاً —
رغم أن التقرير وجسم الـPR كتبا صراحةً «قائمة غير نشطة → ٤٢٢». الفحص الفعلي
الوحيد لـ`is_active` كان داخل `PriceListService::upsertItem()`، وهو **لا
يُستدعى أصلاً** حين تكون ورقة Unit Prices فارغة أو غائبة (الحالة الشائعة في
معظم اختبارات هذه المهمّة)، ولا يُستدعى **إطلاقاً** في مسار التصدير.

**الإصلاح (بأصغر Scope ممكن):**
- `resolvePriceList()` أصبحت ترفض ٤٢٢ صراحةً حين `! $priceList->is_active`،
  فور التحقّق من الوجود ضمن نطاق المستأجر — نفس الدالة المركزية التي تستدعيها
  `preview()`/`apply()`/`export()` الثلاث، فيشملها الحارس معاً دون تكرار.
- لا تغيير على سلوك اكتشاف مستأجرٍ آخر: يبقى ٤٢٢ عاماً «غير موجودة» بلا أي
  تمييزٍ يكشف وجود القائمة لمستأجرٍ آخر.
- **صفر تعديل** على `PriceList`/`PriceListService` — الفحص الإضافي داخل
  `upsertItem()` بقي كما هو (طبقة دفاعٍ ثانية غير ضارّة، لن تُستدعى فعلياً
  بعد أن أصبح `resolvePriceList()` يرفض القائمة المعطّلة أولاً).
- أُضيفت ٣ اختبارات انحدار صريحة: قائمة معطّلة على `preview`، وعلى `apply`
  **مع ورقة Unit Prices فارغة عمداً** (لإثبات أن الحارس لا يعتمد على استدعاء
  `upsertItem()`)، وعلى `export`.

**النتيجة بعد الإصلاح:** `ProductWorkbookTest` **20/20** (كانت 17) على
SQLite وPostgreSQL معاً؛ ومجموعة الانحدار المباشرة **211/211** (كانت 208)
على المحرِّكين معاً — صفر انحدار، ٣ اختبارات جديدة فقط. تفاصيل الأرقام
والملفات المتأثرة في §3/§11 أدناه (مُحدَّثة).

**العقد:** أُضيف قسمٌ جديد (§6) في
`docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md`
— لم يكن موجوداً قبل هذه المهمّة.

---

## 1. Summary

هذه هي المهمّة الأخيرة في برنامج Phase 2A. الهدف: مصنّفٌ (workbook) واحدٌ
بثلاث أوراقٍ مستقلّة — **Products / Barcodes / Unit Prices** — يُصدَّر
ويُعاد استيراده كوحدةٍ واحدة.

**اكتشافٌ حاسمٌ قبل أي كتابة كود:** `SpreadsheetReader`/`SpreadsheetWriter`
كانا محصورين بنيوياً في **ورقة واحدة فقط** (`firstSheetPath()` يفترض دائماً
الورقة الأولى؛ `xlsx()` يكتب `sheet1.xml` واحداً حصراً) — تعدّد الأوراق كان
يحتاج قدرةً برمجيةً جديدة فعلاً، لا إعداداً. كذلك تبيّن أن `PriceListItem`
مرتبطٌ بـ`price_list_id`، ولا يوجد مفهوم قائمة سعرٍ افتراضية/أساسية على
الإطلاق — فورقة Unit Prices لا هدف ضمنيّاً لها. طُرح هذا على المالك قبل أي
تنفيذ (القرار D-F أدناه)، تماشياً مع تعليمات المهمّة بالتوقف عند قرارٍ يمسّ
المال أو التوافق الرجعي بدل التخمين.

---

## 2. Scope implemented / deliberately not implemented

### المُنفَّذ

| البند | أين |
|---|---|
| قراءة/كتابة XLSX متعدّد الأوراق (قدرةٌ جديدة، بلا مساس بالمسار أحادي الورقة القائم) | `SpreadsheetReader::readWorkbookXlsx()`، `SpreadsheetWriter::workbookXlsx()` |
| كتالوجا حقول جديدان لورقتَي Barcodes وUnit Prices | `BarcodeImportFields`، `UnitPriceImportFields` (جديدان) |
| تنسيق الأوراق الثلاث: Products عبر `ProductImportService` القائمة حرفياً؛ Barcodes وUnit Prices جديدتان بالكامل | `ProductWorkbookService` (جديدة) |
| مسارات إضافية: `products/workbook/{template,fields,inspect,preview,apply,export}` | `ProductWorkbookController` (جديد) + `routes/api.php` |
| القرار D-F: قائمة سعرٍ واحدة إلزامية، لا افتراضية، فشلٌ مغلقٌ إن غابت | `ProductWorkbookImportRequest`/`ExportRequest` + `ProductWorkbookController::resolvePriceList()` |
| عقد PR-UOM2-4 (§6): جدول الأساس المُقاس + D-F + Scope/Failure-Semantics/Acceptance | `MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` |

### المتروك عمداً

- **واجهة المستخدم.** هذه المهمّة خلفيةٌ بحتة — تماماً كما سبقت PR-UOM2-1
  (الخلفية) PR-UOM2-2 (واجهتها) في هذا البرنامج نفسه. شاشة رفع المصنّف
  ومحدِّد قائمة السعر في حوار التصدير مؤجّلتان صراحةً كمهمّةٍ لاحقة، لا
  مُسقَطتان صامتاً.
- أي تغيير في `InvoiceService`/`PurchaseService`/POS/المحاسبة/الضريبة/الخصم/
  أقل سعر بيع/تقييم المخزون.
- Weighted Barcode (D-02) وProduct Variants (D-03) — تبقيان `NEEDS DECISION`؛
  صف ورقة Barcodes يبقى كوداً واحداً لمنتجٍ/وحدةٍ واحدة، كما `storeBarcode()`
  تماماً.
- أي مفهوم قائمة سعرٍ افتراضية/أساسية — مرفوضٌ صراحةً بالقرار D-F.
- وضع تحديث/حذف لورقة Barcodes، أو وضعٌ منفصل لورقة Unit Prices — لكل ورقةٍ
  دلالةٌ طبيعيةٌ واحدة فقط (إنشاءٌ فقط / upsert).
- أي تعديلٍ على `ProductImportService`/`ProductImportFields`/`PriceListService`/
  `PriceList`/`ProductBarcode`/`BarcodeRegistryEntry`/`UnitConversion` أنفسها.

---

## 3. Changed files

| File | Change |
|---|---|
| `app/Support/SpreadsheetReader.php` | إضافة `readWorkbookXlsx()` — قراءة كل أوراق مصنّف XLSX (لا الورقة الأولى فقط)؛ الدوال القائمة بلا أي تعديل |
| `app/Support/SpreadsheetWriter.php` | إضافة `workbookXlsx()` — كتابة N ورقة في مصنّفٍ واحد؛ `xlsx()` القائمة بلا أي تعديل |
| `app/Services/ProductExportService.php` | `row()`: `private` → `public` (تغييرٌ في الظهور فقط، بلا أي تغييرٍ سلوكي) |
| `app/Support/BarcodeImportFields.php` | **جديد** — كتالوج حقول ورقة Barcodes |
| `app/Support/UnitPriceImportFields.php` | **جديد** — كتالوج حقول ورقة Unit Prices |
| `app/Services/ProductWorkbookService.php` | **جديد** — تنسيق الأوراق الثلاث: فحص/معاينة/تطبيق/تصدير |
| `app/Http/Requests/ProductWorkbookImportRequest.php` | **جديد** — مدخلات الاستيراد (بما فيها `price_list_id` الإلزامي) |
| `app/Http/Requests/ProductWorkbookExportRequest.php` | **جديد** — مدخلات التصدير |
| `app/Http/Controllers/Api/ProductWorkbookController.php` | **جديد** — متحكّمٌ مستقلّ (على غرار `InventoryOpeningController`) |
| `routes/api.php` | إضافة ستة مسارات `products/workbook/*` قبل `products/{id}` |
| `tests/Feature/ProductWorkbookTest.php` | **جديد**، ثم +٣ اختبارات بعد تصحيح §0 — **20 اختباراً إجمالاً** |
| `docs/plans/.../MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` | إضافة عقد §6؛ تحديث حالة PR-UOM2-3 إلى «مُدمَجة» في جدول §2 |

**12 ملفاً — صفر migrations، صفر أعمدة جديدة.** (`ProductWorkbookController.php`
عُدِّل مرّةً ثانية بعد التسليم الأول — انظر §0.)

---

## 4. API / schema / migrations impact

**لا مخطّط جديد.** المصنّف طبقة قراءة/كتابة جديدة فوق `Product`،
`ProductBarcode`، `PriceListItem`، `BarcodeRegistryEntry`، `PriceList` —
كلها بلا تعديل. المسارات الستة الجديدة إضافيةٌ بحتة (`products/workbook/*`)،
بنفس صلاحيتَي `products.manage`/`products.view` المُستعملتين في مسارات
الاستيراد/التصدير أحادي الورقة القائمة، وبلا `EnsureApplicationActive`
جديد (نفس نمط تلك المسارات تماماً).

---

## 5. صيغة الـWorkbook الدقيقة والأعمدة لكل Sheet

مصنّفٌ واحدٌ بصيغة **XLSX حصراً** (CSV يُرفض فوراً — لا يحمل مفهوم أوراقٍ
متعددة أصلاً) بثلاث أوراقٍ بأسماء إنجليزية ثابتة:

### ورقة `Products`
نفس ترويسة round-trip القائمة حرفياً من `ProductImportFields::roundTripHeaders()`:
`nebrax_id, sku, name, name_en, type, unit, unit_template, category, brand,
barcode, sale_price, purchase_price, min_sale_price, tax_rate,
track_inventory, reorder_level, tags, description, internal_notes,
is_active`. **مطابقةٌ حرفيةٌ لملف الاستيراد/التصدير أحادي الورقة القائم —
نفس المفاتيح، نفس السياسات، نفس الاختبارات.**

### ورقة `Barcodes` (جديدة)
`nebrax_id, sku, code, unit_name, default_quantity, label`
- `nebrax_id`/`sku`: مطابقة المنتج بنفس أولوية ورقة Products (معرّف نبراكس
  ثم رمز الصنف، الاسم ليس معرّفاً).
- `code` (إلزامي): الباركود البديل.
- `unit_name` (اختياري): فراغٌ = وحدة الأساس؛ غير ذلك يجب أن يطابق وحدة
  الأساس أو بديلة من قالب المنتج.
- `default_quantity` (اختياري، افتراضه ١): عددٌ صحيحٌ من ١ إلى ١٬٠٠٠٬٠٠٠.
- `label` (اختياري): وصفٌ حر.

### ورقة `Unit Prices` (جديدة)
`nebrax_id, sku, unit_name, price`
- `nebrax_id`/`sku`: نفس أولوية المطابقة.
- `unit_name` (اختياري): فراغٌ = وحدة الأساس.
- `price` (إلزامي): مبلغٌ بصيغة `123.45`، يُحوَّل لهللاتٍ صحيحة بلا `float`
  في أي خطوة (نفس منطق `ProductImportService::parseMoney` منسوخٌ محلياً
  عمداً — انظر §11 «الانحرافات» أدناه لتبرير عدم توسيع رؤية دالّةٍ خاصّة في
  خدمةٍ حرجة).
- السعر يخصّ قائمة السعر الواحدة المُختارة عبر `price_list_id` — **إلزاميٌّ
  على مستوى الطلب كلّه، لا عمودٌ في الورقة.**

**غياب ورقة Barcodes أو Unit Prices بالكامل ليس خطأً** — تلك الورقة تساهم
بصفر صفوف فحسب. **ورقة Products وحدها إلزامية.**

---

## 6. Failure semantics

| الحالة | النتيجة |
|---|---|
| `price_list_id` غائبٌ عن الطلب | ٤٢٢ عند التحقّق من الطلب — فشلٌ مغلقٌ فوري |
| `price_list_id` من مستأجرٍ آخر أو غير موجود | ٤٢٢ «غير موجود» — بلا تسريب وجود |
| `price_list_id` لقائمةٍ غير نشطة | ٤٢٢ — مُفروضٌ مركزياً في `resolvePriceList()`، يشمل preview/apply/export الثلاثة (انظر §0: غابت هذه القاعدة عن أول تسليم، أُصلحت بعد المراجعة) |
| صفّ Barcodes/Unit Prices لا يطابق منتجاً في نطاق المستأجر | خطأ صفٍّ، الصفّ يُتخطّى |
| `code` فارغٌ، أو مكرّرٌ داخل الملف، أو مُتنازَعٌ عليه حيّاً لمنتجٍ آخر | خطأ صفٍّ — نفس فئة رسائل `storeBarcode()` |
| `code` مطابقٌ لباركودٍ موجودٍ **لنفس المنتج المستهدَف** | **لا خطأ، تخطٍّ صامت** — round-trip حقيقي، لا إعادة إنشاء |
| `unit_name` في Barcodes غير موجودٍ في قالب المنتج | خطأ صفٍّ، فشلٌ مغلقٌ — لا افتراض وحدةٍ بديلة |
| `unit_name` في Unit Prices مجهولٌ للمنتج | خطأ صفٍّ (عبر استثناء `UnitConversion::resolve()` القائم) |
| `price` فارغٌ أو غير صالح | خطأ صفٍّ |
| الملف المرفوع CSV/TXT | ٤٢٢ فوري — الاستيراد متعدّد الأوراق يتطلّب XLSX |
| ورقة Barcodes أو Unit Prices غائبة كليّاً | ليست خطأً — صفر صفوف من تلك الورقة فقط |
| أي صفٍّ في أي ورقةٍ به خطأ | `apply()` يرفض المصنّف كلّه — لا كتابة جزئية |
| منتجٌ/وحدةٌ بلا سعرٍ صريحٍ في القائمة المختارة | يُستبعَد من تصدير Unit Prices — لا صفٌّ مُصطنَع |

---

## 7. POS/UOM/barcode behavior — Barcode/UOM evidence

- ورقة Barcodes تكتب عبر `$product->alternateBarcodes()->create()` — **نفس
  استدعاء `ProductController::storeBarcode()` حرفياً** — فيُطلَق حدث
  `ProductBarcode::created` فيحجز `BarcodeRegistryEntry::claim()` ذرّياً.
  لا `barcode_1`/`barcode_2`، ولا فضاءٌ موازٍ.
- تحقّق الوحدة في Barcodes يطابق **حرفياً** منطق `storeBarcode()`: وحدة
  الأساس أو بديلة معرّفة في قالب المنتج، فراغٌ = الأساس.
- إعادة استيراد ملفٍّ مُصدَّرٍ بلا تعديل **لا يحاول إعادة إنشاء** باركودٍ
  موجودٍ لنفس المنتج (§6) — أُثبت هذا باختبار round-trip فعلي (§9)، بعد
  اكتشاف الفجوة أثناء التطوير وإصلاحها (انظر §12 «المخاطر»).
- Barcode مطابقٌ لكودٍ يخصّ منتجاً **آخر** يبقى خطأ صفٍّ صريحاً — لا كتابة
  صامتة ولا نقل ملكية.
- التوزيع بين استعمال `code` كمرادفٍ لـ«رمز الصنف» (شائعٌ في ورقة Products)
  و«الباركود» في ورقة Barcodes: اكتُشف تصادمٌ حقيقيٌّ أثناء التطوير — أزيلت
  «code» من مرادفات حقل `sku` في `BarcodeImportFields` تحديداً (موثَّقٌ في
  الكود وفي §12).

---

## 8. Pricing evidence

- كل سعرٍ في ورقة Unit Prices يُكتَب عبر `PriceListService::upsertItem()`
  **دون أي تعديل** على تلك الخدمة — نفس التحقّق (القائمة نشطة، المنتج نشط)،
  نفس آلية `updateOrCreate` المفتاحة بـ`(price_list_id, product_id,
  unit_name)`.
- **لا اشتقاق من `unit_factor` في أي اتجاه**: اختبارٌ مخصّص
  (`price_is_never_derived_from_a_unit_factor`) يثبت أن سعراً صريحاً لوحدةٍ
  بمعامل ١٠ يُخزَّن حرفياً كما وَرَد في الملف، لا مضروباً ولا مقسوماً على
  المعامل.
- التصدير لا يُصنِّع صفاً لزوج (منتج، وحدة) بلا سعرٍ صريح — اختبارٌ مخصّص
  (`no_explicit_price_never_appears_as_a_synthesized_export_row`) يثبت أن
  غياب أي `PriceListItem` ينتج مصنّفاً صحيحاً بورقة Unit Prices خاليةٍ من
  صفوف بيانات، لا صفراً مُصطنَعاً.
- **اكتشافٌ وإصلاحٌ أثناء التطوير (يستحقّ الإفصاح):** أول تنفيذٍ لورقة Unit
  Prices مرّر اسم الوحدة **المُحلَّل** (مثل الاسم الفعلي لوحدة الأساس) إلى
  `upsertItem()`، التي تستدعي `UnitConversion::resolve()` بدورها — فرُفض
  منتجٌ بلا قالب وحداتٍ رغم أن الاسم يطابق وحدته الأساسية حرفياً، لأن
  `resolve()` تعامل أي اسمٍ غير فارغ كوحدةٍ تحتاج قالباً بصرف النظر عن
  تطابقها مع الأساس (سلوكٌ قائمٌ ومقصودٌ في `UnitConversion`، لم يُمَسّ).
  الإصلاح: تمرير الطلب الخام (فراغٌ يبقى فراغاً) بدل الاسم المُحلَّل — يُصلح
  الاستيراد المباشر **والتصدير الدائري** معاً (التصدير أيضاً كان يكتب اسم
  الوحدة الأساسية حرفياً بدل تركه فارغاً، فأُصلح كذلك). موثَّقٌ في الكود
  بتعليقٍ صريح.

---

## 9. Backward compatibility evidence

- **صفر تعديل** على `ProductImportService`/`ProductImportFields`/
  `SpreadsheetReader::read()`/`SpreadsheetReader::readXlsx()`/
  `SpreadsheetWriter::xlsx()`/`SpreadsheetWriter::csv()` — الدوال القائمة لم
  تُلمَس، فقط دوالٌ جديدة أُضيفت بجانبها.
- **دليلٌ عمليٌّ لا افتراضي:** أُعيد تشغيل `ProductImportV2Test` (99 اختباراً)،
  `ProductImportTest`، `ProductExportTest` (16 اختباراً)،
  `InventoryOpeningImportTest` (34 اختباراً) — **كلها خضراء بلا أي تعديل في
  نتائجها** على كلا المحرِّكين، بعد كل تعديلٍ في `SpreadsheetReader`/
  `SpreadsheetWriter`.
- `ProductExportService::row()` توسّعت رؤيتها من `private` إلى `public` —
  تغييرٌ لا يكسر أي مستدعٍ قائم بتعريفه (الرؤية الأوسع لا تُغيّر السلوك ولا
  التوقيع).
- ملفات CSV/XLSX أحادية الورقة القديمة تستمرّ بالعمل حرفياً عبر
  `products/import/*`/`products/export` دون أي تغييرٍ في تلك المسارات.

---

## 10. Tenant / Branch isolation evidence

- مطابقة المنتج في الورقتين الجديدتين تمرّ عبر `Product::query()` (مُطبَّقٌ
  عليه نطاق المستأجر تلقائياً) — معرّفٌ/رمزٌ من مستأجرٍ آخر لا يُحلّ، ويظهر
  كـ«لا يطابق أي منتج» بلا تسريب وجود.
- `price_list_id` يُحلّ عبر `PriceList::query()->find()` (نفس النطاق
  التلقائي) — معرّفٌ من مستأجرٍ آخر يُرفض ٤٢٢ بلا تمييزٍ عن معرّفٍ غير موجود
  أصلاً.
- اختباران مخصّصان: `a_price_list_from_another_tenant_never_resolves`،
  `a_nebrax_id_or_sku_from_another_tenant_never_resolves` — كلاهما أخضر.
- لا توسيعٌ لأي استعلامٍ يتجاوز `TenantScope`/`BranchScope`، ولا تخفيفٌ لأي
  Guard قائم — صفر تعديلٍ على `app/Tenancy/*`.

---

## 11. Tests + exact results

### الجديد لهذه المهمّة (بعد تصحيح §0)

| Suite | SQLite | PostgreSQL |
|---|---|---|
| `ProductWorkbookTest` (20 اختباراً — 17 أصلية + 3 لقائمة السعر المعطّلة) | **20/20 ✅ (113 assertion)** | **20/20 ✅ (113 assertion)** |

### فحص الانحدار المباشر (بلا تعديل)

| Suite | SQLite | PostgreSQL |
|---|---|---|
| `ProductImportV2Test` + `ProductImportTest` + `ProductExportTest` + `InventoryOpeningImportTest` + `BarcodeNamespaceTest` + `UnitTemplateTest` + `UnitTemplateMutationGuardTest` + `ProductDefaultUnitsTest` + `ProductBarcodeAndMediaTest` + `PosCheckoutTest` + `ProductWorkbookTest` | **211/211 ✅ (1499 assertion)** | **211/211 ✅ (1499 assertion)** |

(الرقم الأول 208/208 كان في التسليم الأول قبل الإصلاح؛ 211 = 208 + 3 اختبارات
جديدة، صفر انحدار.)

### المجموعة الكاملة

| Engine | النتيجة |
|---|---|
| SQLite (قبل تصحيح §0؛ التعديل بعدها لا يمسّ أي مسارٍ آخر في المجموعة الكاملة) | **2829 نجح، 25 فشل (بيئي معروف)، 8 تخطٍّ — 19396 assertion** |

الـ٢٥ فشلاً مطابقةٌ حرفياً للأساس المُقاس مسبقاً في هذا البرنامج (24 اختبار
`Fuel*` تحتاج `bcmul()`/`ext-bcmath` غير المثبَّتة في هذه البيئة الرملية، و
اختبارٌ واحدٌ لملف PDF في `DocumentCenterSecureIntakeTest`) — مؤكَّدةٌ بيئيةً
لا كوداً عبر CI الحقيقي في PR-UOM2-1/2/3 (تثبيت `ext-bcmath` هناك). لم تُعَد
المجموعة الكاملة بعد تصحيح §0 لأن التعديل محصورٌ في ملفٍ واحدٍ جديدٍ
(`ProductWorkbookController`) لا يستدعيه أي مسارٍ آخر في النظام؛ الانحدار
المباشر ذو الصلة (211/211) أُعيد تشغيله كاملاً على كلا المحرِّكين بعد
التصحيح مباشرةً، وهو ما يغطّي كل مسارٍ يمكن أن يتأثّر فعلياً.

**لا اختبار أُضعف أو حُذف.**

---

## 12. Build / Lint / Typecheck

- **صفر ملفات واجهة** — لا `npm run build`/`test`/`tsc` مطلوبٌ لهذه المهمّة.
- **Pint:** كل الملفات الجديدة والمُعدَّلة نظيفةٌ بعد تشغيل `pint` وتطبيق
  إصلاحاته التلقائية (فراغات وترتيب سماتٍ بسيط، لا تغييرٌ سلوكي). الاستثناء
  الوحيد: `routes/api.php` — `pint --test` يُبلغ عن `ordered_imports` على
  الملف كاملاً، وهي مشكلةٌ **قائمةٌ قبل هذه المهمّة** (قائمة `use` الضخمة في
  الملف غير مرتّبةٍ أبجدياً أصلاً، مؤكَّدٌ بمراجعة الإضافة نفسها — سطرٌ واحدٌ
  في مكانه الأبجدي الصحيح). لم أُصلح الملف كاملاً تفادياً لتغييرٍ واسعٍ غير
  متعلّقٍ بهذه المهمّة. `ci.yml` لا يُشغّل Pint كبوّابةٍ أصلاً (تأكَّدتُ
  بالبحث في ملف الـCI).

---

## 13. CI

**خضراء بالكامل، ومتوافقة (`mergeable_state: clean`) على الرأس النهائي
`7bdf661`** (يشمل تصحيح §0). ست وظائف عبر تشغيلَين مختلفين على نفس الرأس،
كلها ناجحة:

| Job | Result |
|---|---|
| `php artisan test (L11, sqlite)` | ✅ success (×2 تشغيلَين) |
| `php artisan test (L11, pgsql)` | ✅ success (×2 تشغيلَين) |

يتطابق هذا مع فحص السلامة المحلّي بعد التصحيح (§11: 211/211 على SQLite
وPostgreSQL معاً) — لا استثناء ولا فحصٌ مُعلَّق.

تعليقٌ واحدٌ على الـPR من بوت `chatgpt-codex-connector` يفيد بتجاوز حدّ
استخدام مراجعاته الآلية — إشعارٌ تلقائيٌّ لا مراجعة فعلية، لا يحتاج رداً أو
إجراءً.

---

## 14. Risks / remaining gaps

- **واجهة المستخدم غير مبنية بعد** — رفع/تنزيل المصنّف يحتاج شاشةً في
  `web/` (نموذج رفعٍ، محدِّد قائمة سعر، نتيجة الأوراق الثلاث). متروكٌ صراحةً
  (§2).
- اكتُشفت وأُصلحت أثناء التطوير نفسه (لا بعد الدمج) ثلاث مشكلاتٍ حقيقية —
  موثَّقةٌ بالتفصيل في §7/§8 لشفافية المراجعة: (أ) تصادم مرادف «code» بين
  حقلَي sku والباركود في `BarcodeImportFields`، (ب) عدم معالجة round-trip
  لباركودٍ مُصدَّرٍ موجودٍ سلفاً لنفس المنتج، (ج) تمرير اسم وحدةٍ مُحلَّل بدل
  الخام إلى `PriceListService::upsertItem()`. الثلاثة أُثبتت بفشل اختبارٍ
  حقيقي، أُصلحت، ثم أُعيد التحقّق (لا افتراض «يجب أن يعمل»).
- **رابعة اكتُشفت بعد التسليم الأول عبر مراجعة المالك، لا داخلياً:** قائمة
  سعرٍ معطّلة كانت تُقبَل في `preview`/`apply` (حين ورقة Unit Prices فارغة)
  وفي `export` (لا يستدعي `upsertItem()` إطلاقاً) رغم أن D-A/D-F والتقرير
  الأول يدّعيان رفضها. أُصلحت مركزياً في `resolvePriceList()` — التفاصيل
  الكاملة في §0.
- سقف صفوف/أعمدة المصنّف هو نفسه سقف `ProductImportService`
  (`MAX_ROWS=2000`, `MAX_COLUMNS=200`) مُطبَّقاً **لكل ورقةٍ على حدة** لا
  للمصنّف كلّه — لم يُختبَر صراحةً في هذه المهمّة (الحدود نفسها مختبرةٌ
  بالفعل في `ProductImportV2Test` للورقة الواحدة القائمة)؛ خطرٌ منخفضٌ لأنه
  نفس السقف المُختبَر أصلاً، فقط مُطبَّقٌ ثلاث مرات بدل مرة.

---

## 15. Deviations from contract

- القرار المعماري الوحيد المحتمل (أيّ قائمة سعرٍ تستهدفها ورقة Unit Prices)
  طُرح على المالك قبل أي تنفيذ — القرار D-F. لا انحرافٌ آخر عن التعليمات.
- **تكرارٌ صغيرٌ ومقصود:** منطق تحويل الريال البشري إلى هللاتٍ في
  `ProductWorkbookService::parseMoney()` منسوخٌ عن
  `ProductImportService::parseMoney()` الخاصّة (بدل توسيع رؤيتها) — قرارٌ
  واعٍ لإبقاء `ProductImportService` (الملف الأكبر والأكثر اختباراً في نظام
  الاستيراد) بلا أي مساس، بنفس منطق الاستقلال المُعتمَد أصلاً بين
  `InventoryOpeningFields` و`ProductImportFields` في هذا البرنامج (مذكورٌ
  في `CLAUDE.md` نفسه).
- الانحراف الإجرائي الوحيد (نمطٌ مطابقٌ لـPR-UOM2-1/2/3): كتابة عقد §6
  بنفسي بعد اعتماد القرار D-F، لا انتظار تفكيكٍ خارجي — نفس الصلاحية
  المخوَّلة لي سابقاً في هذا البرنامج.

---

## 16. Branch / PR / Base SHA / Head SHA

- **Branch:** `claude/phase-2-pr-uom2-4`
- **PR:** [#705](https://github.com/safwan5001-source/Nebrax/pull/705)
- **Base SHA (عند فتح PR):** `74d2ed6`
- **Head SHA:** `7bdf661` (يشمل تصحيح §0)

---

## 17. Recommended next step

مراجعة PR #705 والتحقّق من CI. هذه آخر PR في تسلسل Phase 2A المعتمد
(PR-UOM2-1 → PR-UOM2-2 → PR-UOM2-3 → PR-UOM2-4). بعد الدمج، المتبقّي الصريح
غير المبني بعد هو واجهة المصنّف في `web/` (§14) — يحتاج قراراً تصميمياً
بسيطاً (نمط الشاشة: تدفّق شبيهٌ بـ`/products/import` أم شاشةٌ جديدة) قبل
البدء، ومهمّةٌ منفصلة إن رغبتم بها.

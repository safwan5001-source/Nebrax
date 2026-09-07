# AWJ Implementation Report — PR-UOM2-1

**Task / PR:** Phase 2A — Multiple UOM / Barcode Completion, **PR #1 of 4**: default sales/purchase UOM on Product
**Date:** 2026-09-07
**Status:** مكتمل — PR مفتوحة، **CI خضراء على SQLite وPostgreSQL**، بانتظار المراجعة. لا دمج ولا نشر.
**Branch:** `claude/phase-2-pr-uom2-1`
**PR:** [#688](https://github.com/safwan5001-source/Nebrax/pull/688)
**Base SHA:** `528a2f78619158d0ffdbd3c730f27311a9ca5e26`
**Head SHA:** `67d1d50e8f4beb0b35cbdade3d88d49c2c43b950`

**العقد:** `docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` (أُنشئ في هذه المهمّة — انظر §2).

---

## 1. Summary

المنتج يعرف وحدة أساسه ووحداته البديلة من القالب، لكنه **لا يعرف أيّها يقترحه**
عند البيع أو الشراء — فيُختار يدوياً في كل سطر رغم أن الغالب ثابت لكل منتج. هذه
المهمّة تضيف `default_sales_unit` و`default_purchase_unit`.

القرار الحاكم (D-A، اعتمدتموه في هذه الجلسة): **عرضٌ فقط**. يُخزَّنان ويُعادان في
الـAPI للواجهة ونقطة البيع، و**لا يقرؤهما أي مسار مستندات**. سطرٌ بلا وحدة يبقى
يُحَلّ إلى وحدة الأساس بمعامل ١ حرفياً — فلا ينكسر أي توافق رجعي.

**بلا أثر محاسبي:** لا قيد ولا GL ولا تغيير تقييم. بند القيود الإلزامي في
`CLAUDE.md` غير منطبق.

---

## 2. لماذا تتضمّن هذه المهمّة وثيقة تخطيط

وثائق Phase 2 تنصّ في **خمسة مواضع** على أن الميزة ليست جاهزة للتنفيذ قبل وجود
تفكيك PR خاص بها، ولم يكن موجوداً:

- `MULTIPLE-UOM-BARCODE.md`: "Status: PLANNED / **not implementation-authorized**"
- `COMPLETION_PROGRAM.md`: "**Do not pre-authorize implementation from this program-level file.**"
- `PHASE2-DEPENDENCIES-AND-GATES.md`: "**not implementation-ready until it has its own scoped PR decomposition**, API/schema decisions, migration strategy…"
- `PHASE2_PLANNING_HANDOFFS.md`: "**these are not executable feature prompts yet**"
- `README.md`: "program contracts, **not executable implementation authorization**"

كما أن `ACCEPTANCE_MATRIX.md` **بلا أي صف لـPhase 2**. عرضتُ ذلك عليكم قبل أي
تعديل، فاخترتم أن أكتب التفكيك ثم أنفّذ PR-1. الوثيقة الناتجة تسجّل خط الأساس
المقيس، والتقسيم الرباعي، وقرارات المالك — وهي قابلة للمراجعة مستقلّةً عن الكود.

---

## 3. What was implemented

### خط الأساس المقيس على `main` (لا مفترَض)

نصف نطاق Phase 2A كان منجزاً سلفاً في Phase 1:

| بند النطاق | الحالة | الدليل |
|---|---|---|
| فضاء باركود موحّد على مستوى المستأجر | ✅ منجز | PR-UOM-1 — `barcode_registry` بقيدٍ فريد ذرّي |
| باركودات بديلة: نموذج + API | ✅ منجز | `/products/{id}/barcodes` بـ`unit_name` و`default_quantity` |
| `Product.unit == UnitTemplate.base_unit` | ✅ منجز | PR-UOM-1 |
| مراجع حيّة ترفض مغلقاً؛ لا افتراض لوحدة مجهولة | ✅ منجز | حارس PR-UOM-1 + `UnitConversion` |
| لقطات تاريخية مستقلّة عن تعديل القالب | ✅ منجز | PR-INV-2/3 |
| سعر صريح لكل وحدة، بلا اشتقاق من المعامل | ✅ منجز | `PriceListItem`؛ `PriceListService::resolve()` يعيد `null` عند الغياب |
| POS يعرض الباركودات البديلة بوحدتها | ✅ منجز | `PosController` `pos_barcodes` |
| **وحدة بيع/شراء افتراضية** | ❌ غائبة | **هذه المهمّة** |
| واجهة المنتج، تبديل وحدة POS، مصنّف ثلاثي الأوراق | ❌ غائبة | PR-UOM2-2 / -3 / -4 |

### المُنفَّذ فعلياً

1. **عمودان nullable** على `products`: `default_sales_unit`, `default_purchase_unit`.
   `NULL` = «وحدة الأساس» — فكل صفٍّ قائم يبقى على سلوكه بلا أي تعبئة رجعية.
2. **تحقّق مغلق** على الإنشاء والتعديل عبر
   `ProductController::assertDefaultUnitsAreValid()`: القيمة يجب أن تكون وحدة
   الأساس أو وحدة بديلة معرّفة في **القالب الفعّال** — المُرسَل في الحمولة، أو
   القالب القائم على المنتج حين لا يذكره تعديلٌ جزئي. غير ذلك ٤٢٢، بلا افتراض بديل.
3. **منتج بلا قالب**: وحدته الأساسية وحدها مقبولة.
4. **إظهار في `ProductResource`** — ومن ثمّ في كل سطح قراءة يستهلكه.
5. **دمج في حارس PR-UOM-1**: العمودان مرجعان حيّان إلى جانب `ProductBarcode.unit_name`
   و`PriceListItem.unit_name`.

---

## 4. What was deliberately not implemented

- **التطبيق التلقائي على سطور الفواتير/المشتريات** — نقيض قرار D-A، وقرارٌ مستقلّ لاحق.
- أي سلوك تسعير؛ لا سطح سعر جديد ولا اشتقاق نقود من معامل.
- أي تغيير محاسبي/GL/Account Mapping.
- واجهة المنتج (PR-UOM2-2)، تبديل وحدة POS (PR-UOM2-3)، المصنّف ثلاثي الأوراق (PR-UOM2-4).
- **Weighted Barcode (D-02)** و**Product Variants (D-03)** — تبقيان `NEEDS DECISION`؛ لم أقترب منهما.
- أي تغيير في عقد فضاء الباركود — استُهلك عقد PR-UOM-1 كما هو.
- لا refactor جانبي ولا إصلاح مشكلة غير مرتبطة.

---

## 5. Changed files

| File | Change |
|---|---|
| `database/migrations/2026_09_09_010000_add_default_units_to_products.php` (جديد) | عمودان nullable على `products` |
| `app/Models/Product.php` | إضافة العمودين إلى `$fillable` |
| `app/Http/Requests/StoreProductRequest.php` | قواعد الشكل (`nullable|string|max:255`) — يرثها `UpdateProductRequest` |
| `app/Http/Controllers/Api/ProductController.php` | `assertDefaultUnitsAreValid()` + استدعاؤها في `store()` و`update()` |
| `app/Http/Resources/ProductResource.php` | إظهار الحقلين |
| `app/Http/Controllers/Api/UnitTemplateController.php` | العمودان مرجعان حيّان في `assertSemanticEditIsSafe()` |
| `tests/Feature/ProductDefaultUnitsTest.php` (جديد، ١٤ اختباراً) | التغطية الكاملة أدناه |
| `docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` (جديد) | عقد التفكيك (§2) |

**٨ ملفات — ٥٧٠ سطراً مضافاً، سطران محذوفان.**

---

## 6. Schema / migrations

هجرة **إضافية فقط**: عمودان `string(255) nullable` على `products`. لا تعبئة رجعية،
ولا إعادة كتابة بيانات، ولا فهارس، ولا مفاتيح أجنبية. `down()` يُسقط العمودين.
طُبِّقت نظيفةً على SQLite وPostgreSQL الحقيقيَّين.

**لماذا `string` لا مفتاح أجنبي:** الوحدة اسمٌ نصّي داخل القالب لا صفٌّ مستقلّ —
نفس نمط `ProductBarcode.unit_name` و`PriceListItem.unit_name` و`StockPermitLine.unit_name`.
صحّة الاسم تحرسها طبقة التحقق وحارس التعديل الدلالي، لا قيدٌ في المخطط.

---

## 7. API changes

**إضافية بحتة:**
- الطلب (`POST`/`PUT /products`): حقلان اختياريان جديدان.
- الاستجابة (`ProductResource`): حقلان جديدان.
- **لا** مسار جديد، ولا تغيير في شكل أي حقل قائم، ولا في أي رمز حالة قائم.

التغيير السلوكي الوحيد: قيمة افتراضية خارج قالب المنتج تُرفض ٤٢٢ بدل أن تُقبل
وتُخزَّن اسماً لا معنى له.

---

## 8. UOM semantics

- **الكمية الأساسية تبقى حقيقة المخزون.** الافتراضي مدخلٌ/عرضٌ لا أكثر.
- **لا اشتقاق نقود من معامل** — مُختبَر صراحةً: منتج بافتراضيّ «كرتون» (معامل ١٢)
  وسعر ١٠٠٫٠٠ يبقى سعره `'100.00'` بلا ÷١٢ ولا ×١٢.
- **لا افتراض لوحدة مجهولة** — نفس مبدأ `UnitConversion::resolve()`.
- `Product.unit == UnitTemplate.base_unit` بلا مساس.
- اللقطات التاريخية (`unit_name`/`unit_factor` على السطور) بلا مساس.

---

## 9. Barcode namespace behavior

**بلا أي تغيير.** عقد PR-UOM-1 مُستهلَك كما هو ولم يُمَسّ:
`BarcodeNamespaceTest` (١٦ اختباراً) و`ProductBarcodeAndMediaTest` خضراوان بلا تعديل
على أيٍّ منهما. الإضافة الوحيدة ذات الصلة أن حارس القالب صار يفحص مرجعاً حيّاً
ثالثاً إلى جانب الباركودات — أي حمايةً أوسع لا أضيق.

---

## 10. Tenant / branch / warehouse isolation evidence

**المستأجر — صارم:**
`a_unit_from_another_tenants_template_never_validates_here` — وحدة «برميل» موجودة
في قالب المستأجر الآخر لا عندي: تُرفض ٤٢٢. وقالبهم نفسه يُرفض بحارس المستأجر القائم.

**الفرع — لا يُخفي مرجعاً حيّاً:**
`a_default_on_a_product_in_another_branch_still_blocks_the_edit` — منتجٌ يُنشأ داخل
الفرع الثاني بافتراضيّ «كرتون»، ثم يُطلب تعديل القالب من الفرع الرئيسي: يُرفض ٤٢٢.
الفحص يمرّ عبر `BranchScope::reference(Product::class)` القائم، فيُسقط عزل الفرع
ويُبقي `TenantScope` — نفس ضمانة PR-UOM-1/PR-PROD-LIFE-1.

**المخزن:** لا صلة — هذه المهمّة لا تلمس أي مخزن ولا رصيداً ولا حركة.

---

## 11. Backward compatibility

الاختبار الحامل للوزن —
`a_line_without_a_unit_still_resolves_to_the_base_unit_not_the_default`:
منتج بـ`default_sales_unit = 'كرتون'` و`default_purchase_unit = 'كرتون'` (معامل ١٢)،
تُنشأ عليه فاتورة شراء بكمية ٥ **بلا وحدة على السطر**. النتيجة:

| | القيمة | لو قرأ المسار الافتراضي |
|---|---|---|
| `unit_name` | `null` ✅ | `'كرتون'` ❌ |
| `unit_factor` | `1` ✅ | `12` ❌ |
| `baseQuantity()` | `5` ✅ | `60` ❌ |

وسطرٌ بوحدة صريحة يبقى كما كان تماماً (`2 × 12 = 24`).

كذلك: `NULL` مقبولة دائماً (غياباً أو تصريحاً)، فالصفوف القائمة كلها صالحة بلا
تعبئة. ولا يقرأ `InvoiceService` ولا `PurchaseService` ولا `UnitConversion` ولا
مسار POS هذين العمودين إطلاقاً.

---

## 12. Tests and exact results

**١٤ اختباراً جديداً** في `ProductDefaultUnitsTest`:

| المجموعة | التغطية |
|---|---|
| القبول (٢) | وحدة أساس أو بديلة؛ الغياب/`null` = الأساس |
| الرفض المغلق (٤) | مجهولة عند الإنشاء؛ مجهولة عند التعديل بلا مساس المخزَّن؛ **تعديل جزئي بلا `unit_template_id`**؛ منتج بلا قالب |
| العزل (١) | وحدة قالب مستأجر آخر |
| التوافق الرجعي (٣) | سطر بلا وحدة؛ سطر بوحدة صريحة؛ لا اشتقاق سعر |
| المرجع الحيّ (٤) | حذف وحدة مستعملة؛ تغيير الأساس المستعمَل؛ الإضافة تبقى آمنة؛ **فرع آخر** |

**تحقّق أن الاختبارات تكشف الانحدار فعلاً:** بإزالة `|| $hasStaleDefaultUnit` من
حارس القالب، تفشل اختبارات المرجع الحيّ الثلاثة فوراً. أُعيد الشرط وتأكّد تطابق
الملف مع نسخة المستودع حرفياً.

### SQLite results

| المجموعة | النتيجة |
|---|---|
| `ProductDefaultUnitsTest` | **14 passed** (79 تأكيداً) |
| المستهدفة + انحدار UOM/Barcode/Lifecycle (١٣ ملفاً) | **178 passed** (1108 تأكيداً) |
| **المجموعة الكاملة** | **2669 passed, 25 failed, 1 skipped** (18675 تأكيداً)، ٢٦٣ ثانية |

### PostgreSQL results

| المجموعة | النتيجة |
|---|---|
| المستهدفة + الانحدار (١٣ ملفاً) | **178 passed** (1108 تأكيداً) |
| **المجموعة الكاملة** | **2670 passed, 25 failed** (18677 تأكيداً)، ٦٠٨ ثانية |

مجموعتا الأسماء الفاشلة **متطابقتان على المحرِّكين** (`diff` فارغ).

### خط الأساس — مُتحقَّق منه لا مفترَض

الإخفاقات الـ٢٥ لم تُصنَّف خط أساسٍ تلقائياً. مجموعة أسمائها **متطابقة حرفياً**
(`diff` فارغ) مع المجموعة التي **قِستُها تجريبياً** على `a19c42a` في مهمّة
PR-PROD-LIFE-1 — وهي هناك كانت **CI خضراء بالكامل**، ما يثبت أنها فجوة بيئة هذا
الصندوق (`ext-bcmath` غائبة فـ`bcmul()` غير معرَّفة في مجموعات `Fuel*`) واختبار PDF
واحد. ولا واحدة منها تمسّ المنتجات أو الوحدات أو الباركود.

> **ملاحظة على تشغيلٍ وسيط:** أول تشغيل كامل أظهر ٣٥ إخفاقاً (٢٥ + ١٠ من اختباراتي).
> السبب مُشخَّص بالكامل: فحص Pint الأساسي يستعمل `git stash`، فبدّل ملفات المصدر
> إلى نسخة ما قبل التعديل **أثناء** تشغيل المجموعة، فعملت اختبارات الافتراضي على
> كودٍ بلا الميزة. أُعيد التشغيل نظيفاً بعد التحقق من تطابق كل ملف (٢٥ فقط).

---

## 13. Build / Lint / Typecheck

- `php -l` نظيف على الملفات السبعة (ستّ PHP + الهجرة).
- **Pint:** الملفان الجديدان (الهجرة والاختبار) `passed` بلا مخالفة. وللملفات
  الخمسة المعدَّلة أُجريت مقارنة أساس (`git stash` قبل/بعد): قائمة الفاحصين بعد
  التعديل **مطابقة تماماً** لما قبله — بلا أي مخالفة جديدة. (ظهر `phpdoc_align`
  جديداً من محاذاة `@param` في تعليقي، فصُحِّح السطر وحده لا الملف كلّه، حفاظاً
  على أصغر diff.)
- لا تغيير في `web/` — فلا `npm run build` مطلوب.

---

## 14. CI status

على Head `67d1d50`:

| Check run | النتيجة |
|---|---|
| `php artisan test (L11, sqlite)` — run [34154415416](https://github.com/safwan5001-source/Nebrax/actions/runs/34154415416) | ✅ success |
| `php artisan test (L11, pgsql)` — run [34154415416](https://github.com/safwan5001-source/Nebrax/actions/runs/34154415416) | ✅ success |
| `php artisan test (L11, sqlite)` — run [34154450955](https://github.com/safwan5001-source/Nebrax/actions/runs/34154450955) | ✅ success |
| `php artisan test (L11, pgsql)` — run [34154450955](https://github.com/safwan5001-source/Nebrax/actions/runs/34154450955) | ⏳ لم يكتمل بعد لحظة الكتابة (توأمه على نفس الشيفرة نجح) |

(تشغيلان لأن `push` و`pull_request` يُطلقان `ci.yml` معاً.)

**دورة كاملة خضراء على المحرِّكين** في التشغيل الأول — وهذا يؤكّد مجدداً أن
الإخفاقات الـ٢٥ المحلية بيئةٌ لا كود: نفس الشيفرة في بيئة فيها `ext-bcmath`
تعطي صفر إخفاق.

---

## 15. Risks / remaining gaps

- **الافتراضي لا يفعل شيئاً وظيفياً بعد.** هذا مقصود بقرار D-A: القيمة تُخزَّن
  وتُعرض، والاستفادة الفعلية تأتي في PR-UOM2-2 (واجهة) و‑3 (POS). من يراجع الـPR
  وحدها قد يراها ناقصة — وهي كذلك عمداً، لأن أول PR يجب أن يكون صغيراً ومستقلاً.
- **قرار التطبيق التلقائي مؤجَّل** ويحتاج حسمكم قبل PR-UOM2-3، لأن شاشة البيع هي
  أول من سيطلب «لماذا لا يلتقط السطر الافتراضي تلقائياً؟».
- **`ext-bcmath` غائبة محلياً** — فجوة بيئة معروفة، أثبتت CI سابقاً أنها ليست كوداً.
- **D-02 (Weighted Barcode)** و**D-03 (Variants)** ما زالتا `NEEDS DECISION` داخل
  نطاق هذه الميزة، وستُواجهان في PR-UOM2-4 (المصنّف) إن لم تُحسما قبله.

---

## 16. Deviations from the approved plan

**انحرافٌ إجرائي واحد، بموافقتكم الصريحة في هذه الجلسة:**

وثائق Phase 2 تشترط وجود تفكيك PR قبل التنفيذ، ولم يكن موجوداً، وتسند التخطيط في
`README.md` إلى ChatGPT لا إلى المنفّذ. عرضتُ ذلك قبل أي تعديل، فاخترتم أن أكتب
التفكيك بنفسي ثم أنفّذ PR-1. فوثيقة `MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` من
تأليفي لا من ChatGPT — وهي مُعلَّمة بذلك في رأسها، وتبقى قابلة للنقض في المراجعة.

**لا انحراف تقني:** لم أوسّع Scope، ولم ألمس محاسبة ولا GL ولا Account Mapping ولا
عقد الباركود، ولم أبدأ أي PR تالية، ولم أحذف ولا أضعف أي اختبار قائم.

---

## 17. Merge / deploy status

**لم يُنفَّذ أيٌّ منهما.** لا دمج، ولا نشر، ولا هجرة إنتاج يدوية. ولم تُبدأ
PR-UOM2-2.

---

## 18. Recommended next step

مراجعة PR #688. وقبل PR-UOM2-3 تحديداً يلزم حسم **قرار التطبيق التلقائي**
(هل يلتقط سطر البيع/الشراء الوحدة الافتراضية عند غياب الوحدة؟) — لأن شاشة نقطة
البيع أول مستهلك يواجه السؤال. أمّا PR-UOM2-2 (واجهة إدارة الوحدات والباركودات)
فلا يحتاج قراراً جديداً ويمكن أن يبدأ فور دمج هذه.

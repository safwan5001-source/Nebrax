# AWJ Implementation Report — PR-UOM2-3

**Task / PR:** Phase 2A — Multiple UOM / Barcode Completion, **PR #3 of 4**: POS UOM Switching
**Date:** 2026-09-08
**Status:** مكتمل — PR مفتوحة، بانتظار CI والمراجعة. لا دمج ولا نشر.
**Branch:** `claude/phase-2-pr-uom2-3`
**PR:** [#699](https://github.com/safwan5001-source/Nebrax/pull/699)
**Base SHA:** `e47b249` (PR-UOM2-2، مُدمَجة ومنشورة Production)
**Head SHA:** `4177353` (كومِت التنفيذ — سأتحقق من تطابقه بعد أي دفعٍ لاحق)

**العقد:** أُضيف قسمٌ جديد (§5) في
`docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md`
— لم يكن موجوداً قبل هذه المهمّة (كان آخر قسمٍ مكتوبٍ هو §4 لـPR-UOM2-2).

---

## 1. Summary

هذه المهمّة بدأت بفحصٍ شامل قبل أي كتابة كود، والنتيجة الحاسمة: **تبديل الوحدة
في نقطة البيع مبنيٌّ ومختبَرٌ بالفعل من قبل** (فضاء الباركود PR-UOM-1 وعمل POS
سابق) — الكتالوج، محدِّد الوحدة بالسطر، حلّ الباركود إلى وحدة+كمية، التسعير
الصريح لكل وحدة، والتحويل الخادمي لكمية الأساس، كلها موجودة ومغطّاة باختبارات
قائمة. الفجوة الحقيقية الوحيدة — المذكورة حرفياً في تذييل تقرير PR-UOM2-2 نفسه
— هي: هل `default_sales_unit` يصبح اقتراحاً أوّلياً يحدِّد وحدة السطر تلقائياً
عند إضافة منتجٍ بالنقر؟ لم يكن هناك عقد PR-UOM2-3 يحسم هذا، وهو بالضبط نوع
القرار (يؤثر على افتراضيات الدفع والتوافق الرجعي) الذي طُلب مني التوقف بشأنه
بدل التخمين.

**القرار (D-E) عُرض على المالك قبل أي تنفيذ واعتُمد:** لا — الإضافة بالنقر
تبقى على الوحدة الأساسية تماماً كما كانت؛ `default_sales_unit` يظهر كعلامةٍ
معلوماتية فقط في قائمة اختيار الوحدة، ولا يُقرأ في أي منطق اختيارٍ أو دفع.

---

## 2. Scope implemented / deliberately not implemented

### المُنفَّذ

| البند | أين |
|---|---|
| وسمٌ معلوماتيٌّ `(افتراضي)`/`(default)` على خيار `default_sales_unit` داخل قائمة اختيار الوحدة بالسطر | `web/src/app/(pos)/pos/page.tsx` |
| تعريف `Product.default_sales_unit?: string | null` في نوع POS المحلي | نفس الملف |
| اختبار حراسة بنيوي يثبت أن الحقل محصورٌ في هذين الموضعين فقط | `default-sales-unit-guard.test.ts` (جديد) |
| مفتاح ترجمة جديد `default_sales_unit_marker` | `ar.json`/`en.json` |
| عقد PR-UOM2-3 (§5): جدول الأساس المُقاس + قرار D-E + Scope/Acceptance | `MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` |

### المتروك عمداً

- **أي تغيير سلوكي** في `addProduct()`، `pricedUnit()`، `setUnit()`، أو حمولة
  الدفع — القرار D-E يمنع ذلك صراحةً؛ الإضافة بالنقر تستمر على الوحدة الأساسية
  بلا استثناء.
- `default_purchase_unit` في POS — نقطة البيع مسارُ بيعٍ فقط، لا صلة له بوحدة
  الشراء الافتراضية.
- أي تعديل خلفي: لا مسار جديد، لا عمود، لا تغيير في `PosController`/
  `PosService`/`InvoiceService`/`UnitConversion`/`PosCustomerPriceListResolver`
  — كل هذه المسارات كانت (ولا تزال) تعمل كما هي.
- أي سلوك تسعير جديد أو اشتقاق سعرٍ من `unit_factor`.
- Weighted Barcode (D-02) وProduct Variants (D-03) — تبقيان `NEEDS DECISION`.
- PR-UOM2-4 (المصنّف) — لم يبدأ.
- أي تخفيفٍ لعزل المستأجر/الفرع أو أي Guard قائم.
- إعادة تصميم عامة لنقطة البيع — التغيير المرئي الوحيد هو لاحقة نصية قصيرة
  داخل خيارٍ من قائمة `<select>` موجودة أصلاً.

---

## 3. Changed files

| File | Change |
|---|---|
| `web/src/app/(pos)/pos/page.tsx` | حقل `default_sales_unit` في نوع `Product` المحلي؛ وسم الخيار الافتراضي داخل قائمة اختيار الوحدة بالسطر |
| `web/src/app/(pos)/pos/default-sales-unit-guard.test.ts` | **جديد** — اختبار بنيوي يثبت أن `default_sales_unit` لا يُستعمَل إلا في تعريف النوع والوسم |
| `web/src/messages/ar.json` | `default_sales_unit_marker: "افتراضي"` |
| `web/src/messages/en.json` | `default_sales_unit_marker: "default"` |
| `docs/plans/products-inventory/phase-2-completion/MULTIPLE-UOM-BARCODE-DECOMPOSITION.md` | إضافة عقد §5 لهذه المهمّة؛ تحديث حالة PR-UOM2-2 إلى «مُدمَجة» في جدول §2 |

**٥ ملفات — صفر ملفات تحت `app/` (الخلفية بلا أي تغيير).**

---

## 4. API / schema / migrations impact

**لا شيء منها.** لا مسار جديد، لا عمود جديد، لا تغيير في أي `Controller`/
`Service`/`Request`/`Resource` خلفي. `default_sales_unit` كان موجوداً بالفعل
على سلك الشبكة عبر `ProductResource` العام الذي يستهلكه `PosController::products()`
(من PR-UOM2-1) — هذه المهمّة فقط قرأته في الواجهة لأول مرة.

---

## 5. POS/UOM/barcode behavior

### الأساس المقيس قبل أي تنفيذ (موثَّقٌ بالتفصيل في §5 من العقد)

فحصٌ شامل (وكيلُ بحثٍ مخصَّص، بلا كتابة كود) أثبت أن كل ما يلي **موجودٌ ومختبَرٌ
من قبل هذه المهمّة**:

- كتالوج POS (`PosController::products()`) يُرجع `pos_units` (الأساس + بدائل
  بسعرٍ صريح لقائمة سعر العميل) و`pos_barcodes` (مُصفّاة على الوحدات المسموحة).
- سطر السلة (`PosCartLine.unit`) ومحدِّد وحدة `<select>` موجودان ويعملان.
- مسح باركودٍ بديل يملأ `unit_name`/`default_quantity` الخاصين به تلقائياً في
  السطر الجديد (`pos-barcode.ts`).
- الدفع يمرّ عبر `InvoiceService` نفسه المستعمل لأي مستند — `UnitConversion::resolve()`
  ثم لقطة `unit_name`/`unit_factor` على السطر، و`InventoryService::recordSaleCogs()`
  يقرأ `baseQuantity()` (`quantity × factor`) لا الكمية المُدخلة مباشرةً — هو ما
  يُخصم فعلياً من المخزون.
- بيع وحدةٍ بديلة يتطلّب سعراً صريحاً في `PriceListItem` (أو تجاوزاً يُعاد
  التحقّق منه خادمياً) — لا اشتقاق من `factor` مطلقاً.
- السلال المحفوظة (`PosHeldSale` + لقطة localStorage المُصدَّرة) تحمل `unit`
  لكل سطرٍ أصلاً.

### ما أضافته هذه المهمّة فعلياً

فقط: وسمٌ نصّيٌّ داخل خيار `<select>` قائم، يعرض للكاشير أيّ خيارٍ هو
`default_sales_unit` للمنتج. لا تغيير في أي دالة اختيارٍ أو حساب.

### إثبات أن D-E نافذٌ بنيوياً لا بالتصريح فقط

اختبار `default-sales-unit-guard.test.ts` يقرأ مصدر `page.tsx` فعلياً ويرفض
البناء إن ظهر `default_sales_unit` في أي سطرٍ غير تعريف النوع أو سطر الوسم.
**أُثبت أنه فعّالٌ فعلاً لا شكلياً:** وصلتُ الحقل مؤقتاً بمتغيّرٍ داخل نطاق
`addProduct`، شغّلت الاختبار فرأيته يفشل بالضبط كما يجب، ثم استعدت الملف
وتحقّقت بـ`grep` من عودته لحالته الأصلية حرفياً (سطرا الاستعمال فقط، كما كانا).

---

## 6. Entered quantity / base quantity evidence

لم تتغيّر آلية `entered quantity × unit_factor = base quantity` بأي شكل —
صفر ملفات خلفية لُمِست. الدليل العملي: `UnitTemplateTest` (تحويل الوحدات
الأساسي)، `ProductDefaultUnitsTest` (خط الأساس لا يتأثر بالوحدة الافتراضية)،
و`PosReturnUomTest` تحديداً — ست حالات ترجع بالضبط الكمية الأساسية المحسوبة
من `unit_factor` عبر شراء/بيع/إرجاع/استبدال بوحداتٍ مختلفة — كلها **90/90
ناجحة** على نفس الشيفرة الخلفية غير المُعدَّلة (انظر §10).

---

## 7. Pricing evidence

لا تغيير في `PosCustomerPriceListResolver` ولا `PosService::assertUnitPricesAllowedForPos()`.
الوسم الجديد لا يقرأ سعراً ولا يعرضه — فقط اسم الوحدة. `pricedUnit()` في
`page.tsx` يبقى المصدر الوحيد للسعر المعروض، ويستمدّه من `pos_units` المُحلَّل
خادمياً كما كان قبل هذه المهمّة تماماً. اختبار `PosCheckoutTest` (تسعير الوحدة
البديلة يتطلّب سعراً صريحاً، وإلا رُفض) بقي أخضر بلا تعديل.

---

## 8. Backward compatibility evidence

- منتجٌ بلا `default_sales_unit` (`null`، وهو الحال الافتراضي لكل المنتجات
  القائمة): الخيار المُطابق غير موجود أصلاً، فلا يظهر أي وسمٍ — القائمة تبدو
  بالضبط كما كانت قبل هذه المهمّة.
- منتجٌ بلا قالب وحداتٍ أو بلا وحداتٍ بديلة: `units.length` يبقى ١، فالقائمة
  المنسدلة لا تظهر أصلاً (نفس الشرط القائم `units.length > 1`) — سلوك الوحدة
  الأساسية فقط يستمر حرفياً.
- السلال المحفوظة/المستعادة (`PosHeldSale`، لقطة localStorage): شكلها لم
  يتغيّر — `unit` كان موجوداً فيها أصلاً؛ هذه المهمّة لم تُضف حقلاً جديداً لأي
  منهما.
- عدم اختيار وحدة (الإضافة العادية بالنقر) لا يغيّر أي سلوكٍ تاريخي — القرار
  D-E يضمن ذلك صراحةً وبُرهن عليه بنيوياً (§5).

---

## 9. Tenant / Branch isolation evidence

لا تغيير خلفي إطلاقاً، فكل ضمانات `TenantScope`/`BranchScope`/RBAC القائمة في
`PosController`/`PosService` تبقى حرفياً كما هي. أُعيد تشغيل مجموعة اختبارات
خلفية شاملة (٩٠ اختباراً) تتضمّن حالات عزل صريحة (`it isolates references to
the tenant`, `checkout rejects a foreign tenant payment method...`) — **كلها
ناجحة** — تأكيدٌ عمليٌّ لا افتراضٌ نظري.

---

## 10. Tests + exact results

### Frontend

| Command | Result |
|---|---|
| `npx tsc --noEmit` | لا أخطاء جديدة. نفس الأخطاء الثلاثة القائمة سلفاً من تقرير PR-UOM2-2 (`pos/settings/configuration`، `platform/integrations/gemini-card`، `global-application-controls-card`) — غير متعلقة بهذا التغيير |
| `npm run test` (Vitest) | **244 ملف اختبار، 1560 اختباراً — كلها ناجحة** (تشمل اختبار الحراسة الجديد) |
| `npm run build` | **نجح** — كل المسارات، بما فيها `/pos` |

### Backend (فحص سلامة على SQLite، لا تغيير خلفي)

| Suite | Result |
|---|---|
| `PosCheckoutTest` + `PosHeldSaleTest` + `PosReturnUomTest` + `ProductDefaultUnitsTest` + `UnitTemplateTest` + `UnitTemplateMutationGuardTest` + `BarcodeNamespaceTest` | **90 passed (803 assertions)** |

لا اختبار أُضعف أو حُذف. الاختبار الجديد الوحيد (`default-sales-unit-guard.test.ts`)
أُثبت أنه حَمّالٌ فعلياً (§5) لا زخرفة.

**لماذا لا اختبار تفاعلي إضافي في POS:** `page.test.tsx` القائم يوثّق صراحةً
(تعليق PR-8 في الملف نفسه) أن تغطية POS التفاعلية الكاملة (فتح جلسةٍ حقيقية،
إضافة سلة، مسح باركود) مؤجَّلةٌ عمداً لأنها تحتاج محاكاة كاملة لكل نقطة API
تستدعيها الصفحة عند الإقلاع — قرارٌ سابقٌ للمشروع، لا اتخذته هذه المهمّة. بما
أن التغيير الفعلي الوحيد هنا نصٌّ ثابتٌ داخل خيارٍ موجود، اخترتُ اختبار حراسةٍ
بنيوياً مُثبَتاً فعّالاً (§5) بدل توسيع بنية اختبار الصفحة بالكامل — وهو نفس
نمط القرار المُفصَح عنه صراحةً في تقرير PR-UOM2-2 §10.

---

## 11. Build / Typecheck / Lint

- **Typecheck:** ضمن `npm run build` + `npx tsc --noEmit` منفصلاً — كلاهما
  نظيفٌ بلا أخطاء جديدة.
- **Lint:** لا إعداد ESLint مُلتزَم في المستودع (نفس ملاحظة PR-UOM2-2)،
  و`web-ci.yml` لا يشغّل خطوة lint منفصلة.
- **Build:** نظيفٌ تماماً، بلا تحذيرات جديدة.

---

## 12. CI

قيد التنفيذ لحظة كتابة هذا التقرير على Head `4177353`. سأتحقّق من النتيجة
وأحدّث هذا القسم فور اكتمالها، على غرار البروتوكول المتّبع في PR-UOM2-1 وPR-UOM2-2.

---

## 13. Risks / remaining gaps

- الوسم الجديد نصٌّ ثابتٌ داخل الخيار (`unit.name (افتراضي)`) بلا تنسيقٍ بصريٍّ
  خاص (لا شارة/لون) — بساطةٌ متعمَّدة تماشياً مع بند «لا يضيف ازدحاماً» في
  متطلبات المهمّة؛ إن رغب المالك بإبرازٍ بصريٍّ أوضح لاحقاً فهذا تحسينٌ مستقل
  لا يغيّر السلوك.
- `default_purchase_unit` يبقى بلا أي استهلاكٍ في POS — متعمَّد (§2)، إذ لا
  معنى له في مسار بيعٍ فقط.
- PR-UOM2-4 (تصدير/استيراد المصنّف Products/Barcodes/Unit Prices) لم يبدأ.

---

## 14. Deviations from contract

**لا انحراف عن العقد أو القيود.** القرار المعماري الوحيد المحتمل (هل
`default_sales_unit` يُطبَّق تلقائياً في POS) طُرح على المالك صراحةً قبل أي
تنفيذ (D-E)، تماماً وفق تعليمات المهمّة رقم ٨ التي تطلب التوقف بدل التخمين عند
عدم حسم العقد لهذه النقطة. الانحراف الإجرائي الوحيد (مطابقٌ لنمط PR-UOM2-1/
PR-UOM2-2): كتابة عقد §5 بنفسي بعد اعتماد القرار، لا انتظار تفكيكٍ خارجي —
نفس الصلاحية المخوَّلة لي سابقاً في هذا البرنامج.

---

## 15. Branch / PR / Base SHA / Head SHA

- **Branch:** `claude/phase-2-pr-uom2-3`
- **PR:** [#699](https://github.com/safwan5001-source/Nebrax/pull/699)
- **Base SHA:** `e47b249`
- **Head SHA:** `4177353`

---

## 16. Recommended next step

مراجعة PR #699 والتحقّق من CI. بعد الدمج، PR-UOM2-4 (تصدير/استيراد المصنّف:
Products / Barcodes / Unit Prices) هو الأخير في التسلسل المعتمد — لا يحتاج
قراراً معمارياً معلَّقاً معروفاً حتى الآن حسب عقد §2 القائم (`Schema: none`،
`Depends on: PR-UOM2-1`)، لكن يُفضَّل تأكيد ذلك بفحصٍ مشابه قبل البدء، تماشياً
مع النمط المتّبع في هذا البرنامج.

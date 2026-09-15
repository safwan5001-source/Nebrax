# تقرير نهائي: إصلاح `ReportEffectiveScopeTest` لعقد `InventoryState` (VAR-INV-1)

**PR #815** — `var-inv-1/report-tests-inventory-states` → `main`. **لم يُدمَج ولم يُنشَر.**

## السبب الجذري (مُثبَت في المهمة السابقة، مُعتمَد هنا)

VAR-INV-1 (#812) حوّل `Product::quantity_on_hand`/`avg_cost` إلى **Eloquent
Accessors** تُقرأ من جدول جديد `InventoryState` (`product_id` +
`product_variant_id = null` للمنتج البسيط)، وجمّد العمودين الفيزيائيين
`products.quantity_on_hand`/`avg_cost` بلا قراءة بعد الآن. النموذج نفسه يوفّر
مسار توافقٍ خلفي مصمَّماً: تحديثٌ على **نسخة نموذج** (`Model::update()`/`save()`)
يمرّ عبر مُعدِّل الـAttribute ثم حدث `saved()` (`flushPendingInventorySeed()`)
ليكتب فعليًا إلى `InventoryState`.

`ReportEffectiveScopeTest.php` (غير مرتبط بـVAR-INV-1 إطلاقًا، ولم يُعدَّل معه) كان
يبذر بيانات المنتج عبر:
```php
Product::whereKey($id)->update(['quantity_on_hand' => 12, 'avg_cost' => 10000]);
```
وهذا **تحديث Query Builder** (`Eloquent\Builder::update()`) يتجاوز الـAccessor
وحدث `saved()` كليًا — يكتب العمود المجمَّد فقط. كل تقرير يقرأ عبر Eloquent
(`InventoryReportService`, `InventoryWorkspaceQuery`, `InventoryBalanceFilters`,
`InventoryBalanceExportService`) يجد `InventoryState` فارغة، فيعيد **صفراً** بدل
القيمة المتوقَّعة — يطابق الفشول الخمسة الأصلية حرفيًا.

## جميع المواضع المتأثرة (فُحصت بالكامل، لا خمسة فقط)

بحثٌ نصي شامل عبر `tests/` بحثًا عن نمط `Product::(where|whereKey)(...)->update([...quantity_on_hand|avg_cost...])`:

- **11 موضعًا، كلها في `ReportEffectiveScopeTest.php` حصرًا** (الأسطر 633، 648،
  666، 683، 704، 717، 736، 750، 780، 800، 815 في نسخة ما قبل الإصلاح) — لا وجود
  لهذا النمط في أي ملف اختبار آخر في المستودع.
- تحقّق سلبي: كل الاستعمالات الأخرى لـ`avg_cost`/`quantity_on_hand` عبر ملفات
  اختبار أخرى (`FuelReconciliationTest`, `InventoryAlertServiceTest`,
  `InventoryReservationServiceTest`) تستعمل بالفعل تحديث **نسخة نموذج**
  (`Product::findOrFail(...)->update([...])` أو `$product->update([...])`) —
  الصيغة الصحيحة أصلًا، فلا تأثّرت.
- موضعٌ واحدٌ إضافي في نفس الملف (`Product::create([...'quantity_on_hand'=>999...])`)
  **سليمٌ بالفعل** — `create()` يمرّ بدورة حياة Eloquent كاملة (لا يحتاج تعديلاً).

## الإصلاح

استبدال الأنماط الـ11 بـ`Product::findOrFail($this->trackedProductId)->update([...])`
— يمرّ عبر مُعدِّل الـAttribute وحدث `saved()` فيكتب فعليًا إلى `InventoryState` بهوية
`product_id` + `product_variant_id = null`، ويحافظ على `tenant_id` الصحيح
(Tenant Isolation) تمامًا كما صمَّمه VAR-INV-1. **لا تعديل على أي كود إنتاجي**، لا
تراجع عن VAR-INV-1/VAR-PRICE-1، ولا إعادة اعتماد الأعمدة القديمة كمصدر حقيقة.

## Regression Coverage (اختبار جديد)

`seeding_quantity_and_avg_cost_via_model_update_reaches_inventory_state_not_the_frozen_columns`
— يثبت العقد مباشرة: تحديث نسخة النموذج يُنشئ/يحدّث صفّ `InventoryState` البسيط
(بالمستأجر الصحيح) وهو ما تقرأه كل التقارير؛ وتحديث Query Builder على نفس المنتج
**لا يصل إلى `InventoryState`** إطلاقًا (يُثبَت صراحة بقراءة القيمة القديمة بعده).
أي اختبار تقارير جديد يُزرَع بالطريقة الخاطئة يفشل هنا أولًا برسالة واضحة، لا كتقرير
غامض "صفر بدل رقم".

## إصلاحٌ إضافي حُمِل على `main`: قفل ImportJob

تشغيل المجموعة الكاملة (لازمٌ لإثبات عدم كسر أي شيء) كشف فشلاً منفصلاً تمامًا
(`SQLSTATE[55P03]`) في `ImportJobInventoryOpeningApplyTest`/`ImportJobWorkbookApplyTest`
— مُشخَّصٌ ومُصلَح سابقًا على فرعٍ آخر (`com-checkout-1c/storefront-wiring`,
commit `3d27771`) لكنه لم يُدمَج قط إلى `main`. بما أن VAR-CORE-1 (قفل سجلّ SKU)
موجودٌ على `main` بالفعل، يتكرّر نفس العطل هنا ويمنع CI نظيفًا لهذا الـPR. نُقل
نفس الإصلاح المُثبَت بلا تعديل (`Product::withoutEvents()` في تجهيزَي الاختبارين) —
لا علاقة له بـReports أو VAR-INV-1/VAR-PRICE-1.

## الملفات المتغيرة

- `tests/Feature/ReportEffectiveScopeTest.php` — 11 موضع إصلاح + اختبار regression جديد.
- `tests/Feature/ImportJobInventoryOpeningApplyTest.php` — إصلاح قفل مُنقول.
- `tests/Feature/ImportJobWorkbookApplyTest.php` — إصلاح قفل مُنقول.

**لا تعديل على أي ملف إنتاجي.**

## الاختبارات والأعداد

| المجموعة | التكرار | النتيجة |
|---|---|---|
| `ReportEffectiveScopeTest` منعزلًا | 5× SQLite + 5× PostgreSQL | 34/34 ✓ في كل تشغيلة (33 أصلي + 1 جديد) |
| `Report\|Inventory` (فلتر) | 1× PostgreSQL | صفر فشل متعلق؛ فقط فجوة `setup.sh` المحلية المعروفة |
| `ImportJob*` كاملة | 1× PostgreSQL | 57/57 ✓ |
| كامل مجموعة الاختبارات | 1× SQLite + 1× PostgreSQL | 3685–3688 ناجح؛ 48 فشلًا **متطابقًا حرفيًا على المحرّكين**، كلها فجوة بيئة محلية معروفة (`MovementSourceResolver` غير منسوخ محليًا خلافًا لـ`ci.yml`، وفجوة محرّك PDF محلية) — صفر فشل في `ReportEffectiveScopeTest`/`ImportJob*` |

## CI (فعلي، مفتوح ومفحوص)

PR #815 — 4/4 checks ناجحة (push + pull_request، كلا المحرّكين):

| Job | Run | النتيجة |
|---|---|---|
| sqlite (push) | 34893525922 | ✓ success |
| pgsql (push) | 34893525922 | ✓ success |
| sqlite (pull_request) | 34893578118 | ✓ success |
| pgsql (pull_request) | 34893578118 | ✓ success |

`mergeable_state: clean`. **صفر فشل فعلي على CI الحقيقي.**

## Branch / PR / Base / Head SHA

- Branch: `var-inv-1/report-tests-inventory-states`
- PR: https://github.com/safwan5001-source/Nebrax/pull/815 (**مفتوح، غير مدموج**)
- Base: `main` @ `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e`
- Head: `76865bf9520a3750cdb704a7003e039c7646f19b`

## المخاطر والمتبقي

- **لم يُدمَج** — بانتظار المراجعة كما طُلب صراحة.
- إصلاح ImportJob المنقول هنا يعني أن الفرع الأصلي (`com-checkout-1c/storefront-wiring`
  / PR #811) لا يزال يحمل نسخته الخاصة من نفس الإصلاح بشكل مستقل — لا تعارض، لكن
  يستحق ملاحظة أن كلا الفرعين يحملان نفس التصحيح الآن بمعزل عن بعضهما.
- فجوة `setup.sh` المحلية (`MovementSourceResolver`) وفجوة محرّك PDF المحلية تبقيان
  خارج نطاق هذه المهمة — لا تظهران في CI الحقيقي، وغير متعلقتين بأي من التغييرات هنا.
- PR #811 لم يُلمَس في هذه المهمة كما طُلب صراحة.

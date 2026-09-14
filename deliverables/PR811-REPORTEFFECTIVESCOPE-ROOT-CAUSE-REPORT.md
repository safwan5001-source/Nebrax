# تقرير تشخيصي: لماذا Head `cce1497` ينجح على push ويفشل على pull_request

**لا تعديل على الكود في هذه المهمة — تشخيص فقط، كما طُلب صراحة.**

## الخلاصة الحاسمة أولًا

الـ`push` والـ`pull_request` **لا يختبران نفس الشجرة رغم نفس head_sha**. `pull_request`
يبني refs/pull/811/merge (رأس الفرع **مدموجًا** مع `main` الحالي)، بينما `push` يبني
رأس الفرع **وحده** فوق `main` القديم وقت إنشاء الفرع. بين قاعدة PR #811
(`c152e3e`) والآن، تقدّم `main` بدمج PR **منفصلَين تمامًا** (#812 VAR-INV-1،
#813 VAR-PRICE-1) غيّرا **مصدر قراءة** `avg_cost`/`quantity_on_hand` في كل استعلامات
التقارير — و`ReportEffectiveScopeTest.php` نفسه **لم يتغيّر حرفًا واحدًا** منذ ذلك،
فتجهيزاته لا تزال تكتب بالطريقة القديمة التي لم تعد كافية تحت الشجرة المدموجة.

## ١. إثبات اختلاف الشجرة (checkout SHA / merge-ref)

- `.github/workflows/ci.yml` يستعمل `actions/checkout@v4` **بلا** `with: ref:` —
  فيتّبع سلوك GitHub الافتراضي الموثَّق: حدث `pull_request` يُسجّل
  `refs/pull/811/merge` (رأس الفرع مدموجًا مع قاعدته الحالية)، وحدث `push` يُسجّل
  الـcommit المدفوع فقط. هذا يفسّر بنيويًّا كيف يحمل الـrunّان "نفس head_sha" ظاهريًا
  بينما يبنيان شجرتين مختلفتين فعليًا.
- تأكيد مباشر: `git fetch origin main` يُظهر أن `main` تقدّم بمقدار **commitين** فوق
  قاعدة PR #811 (`c152e3e`):
  ```
  4689f1b VAR-PRICE-1: Variant and UOM canonical pricing (#813)
  ec9ee5c VAR-INV-1: Variant inventory and valuation identity (#812)
  ```
  هذان الدمجان **لا علاقة لهما بـPR #811 إطلاقًا** — ميزات منفصلة مُدمجة بعد إنشاء
  هذا الفرع.
- `git diff --stat c152e3e origin/main` يُظهر أن الملف المختبَر (`ReportEffectiveScopeTest.php`)
  **صفر تغيير** — بينما 23 ملف إنتاجي تغيّر، أبرزها مباشرةً ذو صلة:
  `app/Services/Accounting/InventoryService.php`،
  `app/Services/InventoryWorkspaceQuery.php`،
  `app/Support/InventoryBalanceFilters.php`،
  `app/Support/InventoryWorkspaceFilters.php`،
  `app/Support/ProductWarehouseBalanceQuery.php`،
  `app/Services/InventoryBalanceExportService.php`، ومهاجرة جديدة
  `create_inventory_states`.

## ٢. الآلية الدقيقة (لا تلوّث ترتيب اختبارات — شجرتان مختلفتان فعلًا)

VAR-INV-1 (#812) "جمّد" `products.avg_cost`/`quantity_on_hand` وحوّل **كل** مصادر
القراءة في طبقة التقارير/المخزون إلى جدول جديد `inventory_states` عبر
`LEFT JOIN ... WHERE product_variant_id IS NULL`، مع تغليف كل قراءة بـ
`COALESCE(inventory_states.xxx, 0)`. أمثلة حرفية من الفرق:

```diff
// InventoryWorkspaceQuery.php
- 'products.avg_cost',
+ 'inventory_states.avg_cost',
- ->selectRaw('... products.avg_cost) as value_minor')
+ ->selectRaw('... COALESCE(inventory_states.avg_cost, 0)) as value_minor')

// InventoryBalanceFilters.php
- 'avg_cost' => 'avg_cost',
+ 'avg_cost' => 'COALESCE(inventory_states.avg_cost, 0)',
  public static function query(): Builder {
-     return Product::query()->where('track_inventory', true);
+     return Product::query()->where('track_inventory', true)
+         ->leftJoin('inventory_states', fn($j) => $j->on(...)->whereNull('product_variant_id'))
+         ->select('products.*');
  }

// InventoryBalanceExportService.php
- $query->where('quantity_on_hand', '!=', 0);
+ $query->whereRaw('COALESCE(inventory_states.quantity_on_hand, 0) != 0');
```

`ReportEffectiveScopeTest.php` **لم يُحدَّث** ليواكب هذا التحويل — تجهيزاته (غير
المعدَّلة) لا تزال تكتب `avg_cost`/الكمية على `products`/`product_warehouse_stock`
مباشرةً، ولا تُنشئ أي صفّ مقابل في `inventory_states` الجديد. تحت الشجرة المدموجة
(main + PR811)، كل قراءة `avg_cost`/الكمية لهذه المنتجات تُرجع
`COALESCE(inventory_states.avg_cost, 0)` = **صفر** — لأن لا صفّ `inventory_states`
موجودًا لها إطلاقًا — وهذا يطابق حرفيًا كل الفشول الخمسة الملاحظة (`0` بدل `9`/`12`،
`0.00` بدل `100.00`/`500.00`).

هذا **ليس تلوّث حالة أو ترتيب اختبارات**: الفشل ثابت رقميًا (قيمة متوقَّعة محدَّدة
مقابل صفر)، متطابق حرفيًا على المحرّكين معًا في نفس الـrun، وغائبٌ تمامًا في تشغيلة
الـpush (التي لا ترى `inventory_states` من الأساس لأنها لا تختبر main الجديد). دليلٌ
حاسم على أن السبب هو اختلاف الشجرة نفسها، لا حالة اختبار مشتركة.

## السبب الجذري (مُثبَت)

اختلاف بنيويّ بين ما يختبره push (فرع PR811 وحده فوق main القديم) وما يختبره
pull_request (فرع PR811 **مدموجًا** مع main الحالي عبر merge-ref الافتراضي لـ
`actions/checkout@v4`)؛ main الحالي يحمل VAR-INV-1 (#812) الذي حوّل مصدر
`avg_cost`/`quantity_on_hand` في طبقة التقارير إلى جدول `inventory_states` جديد؛
و`ReportEffectiveScopeTest.php` (غير المُعدَّل، وغير المرتبط بـPR811) لا يملأ هذا
الجدول الجديد في تجهيزاته، فتُرجع كل قراءاته صفرًا تحت الشجرة المدموجة فقط.

## أصغر إصلاح مقترح (لم يُطبَّق)

الإصلاح الصحيح **في تجهيز الاختبار نفسه**، لا في منطق `Reports`/`InventoryService`
الإنتاجي (الذي يعمل كما صُمِّم في VAR-INV-1، وتعديله كان سيكسر الميزة المُدمجة
فعليًا): تحديث تجهيزات `ReportEffectiveScopeTest.php` لتُنشئ صفّ `InventoryState`
مطابقًا (بنفس `avg_cost`/الحالة) لكل منتج تتبعه الحالة (`track_inventory=true`)
الذي يفترض الاختبار له تكلفة/كمية غير صفرية — بما يعكس عقد VAR-INV-1 الجديد
(`product_id` + `product_variant_id = null` للهويّة البسيطة).

هذا **ليس من نطاق تغييرات PR #811 نفسه** (لا الاختبار ولا الميزة التي كسرته من
ملفات هذا الفرع) — فهو دَينٌ تكامليٌّ سببه دمج PR811 مع تطورات main منفصلة، يظهر
فقط عبر آلية merge-ref في CI. لم أطبّقه هنا امتثالًا لتعليمة "لا تغيّر أي كود حتى
تحدد السبب الجذري"، والتقرير هذا هو تسليم التشخيص فقط كما طُلب.

## الملفات المتغيرة في هذه المهمة

لا شيء — تشخيص فقط، بلا أي commit أو push.

## CI

- Base: `c152e3ee634be3e7c2bb12db299a5ddd44472558` (main وقت إنشاء PR811)
- Head: `cce149787a00467b1b079e40a19d580024aabe3b` (بلا تغيير)
- main الحالي: `4689f1bba1d285b4f8b57b96ad0522bf253fbc8e` (متقدّم بـ2 commit عن base)
- push run `34883847492`: أخضر بالكامل (لا يرى main الجديد).
- pull_request run `34883853192`: أحمر — 5 فشول متطابقة في `ReportEffectiveScopeTest`
  على كلا المحرّكين (يرى main الجديد عبر merge-ref).

## المخاطر والمتبقي

- **المشكلة ستبقى قائمة** طالما main لم يتوقف عن التقدّم — أي push جديد لهذا الفرع
  سيستمر بإظهار نفس التباين بين push وpull_request حتى يُصلَح تجهيز الاختبار (أو
  يُدمَج main في الفرع، وهو وحده لن يكفي بلا تحديث التجهيز كما تقدّم).
- إصلاح تجهيز `ReportEffectiveScopeTest` مسؤوليةٌ منطقيًا أقرب لصيانة main نفسه
  (الاختبار لم يكن جزءًا من نطاق PR811 قط)، لكنه يظهر كحاجز أمام هذا الـPR بحكم
  آلية CI — قرار مكان الإصلاح (هنا في هذا الفرع، أو كـPR منفصل على main) يعود لك.
- PR #811 **لا يزال ممنوع الدمج**. لم يُدمَج ولم يُنشَر شيء.

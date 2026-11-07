# AWJ Stations — Tank Balance P1: عقد قراءة الرصيد الدفتري للخزان

**الحالة: READY_FOR_REVIEW** — قراءة فقط، إضافي ومتوافق رجعياً. لا migrations، ولا كتابة، ولا تغيير في المبيعات أو الاستلامات أو الحركات، ولا ربط للواجهة.

| | |
|---|---|
| Branch | `claude/jolly-rubin-suk9ka` |
| PR | #2042 |
| Base SHA | `0f59ccc5fa1b638043fcd7bb33d4a5f02dedbe31` (`origin/main`) |
| Head SHA قبل P1 | `96dc22c3b7e3a3f0f0170688bc9993b09f2f5a66` (P0، CI أخضر) |
| Head SHA بعد P1 | رأس الـPR بعد دفع هذا الـcommit (التقرير جزء منه فلا يحمل SHA نفسه) |
| دمج / نشر | لم يتما |

## 1) العقد

`GET fuel-stations/tanks` و`GET fuel-stations/tanks/{id}` يضيفان مفتاحين **بعد** المفاتيح القديمة (ترتيبها وقيمها لم تتغير):

```json
"book_level": { "milliliters": 18700000, "basis": "warehouse_book", "as_of": null },
"book_level_unavailable_reason": null
```

وعند عدم توفر رصيد موثوق: `"book_level": null` مع `book_level_unavailable_reason` من القائمة المغلقة:

| السبب | المعنى |
|---|---|
| `multi_tank` | أكثر من خزان (بأي حالة، في أي محطة من المؤسسة) يغذّي المجمّع نفسه (مخزن × منتج) |
| `no_stock_record` | لا سجل في `product_warehouse_stock` — **ليس صفراً** |
| `ambiguous_stock_record` | أكثر من سجل لنفس (مخزن، منتج) (متغيّرات) |
| `invalid_stock_record` | رصيد سالب |
| `no_warehouse` | محطة الخزان بلا مخزن |
| `tank_inactive` | الخزان نفسه `inactive` |
| `unit_mismatch` | وحدة الوقود/المنتج ليست mL/L |
| `invalid_configuration` | علاقة أو منتج ناقص/محذوف ناعماً |

استجابات `POST/PUT tanks` **لم تتغير** (بلا المفتاحين).

## 2) التصميم

- **`app/Services/FuelTankBookBalanceReader.php`** (جديد): خدمة قراءة نقية. لا قفل، لا كتابة، لا استدعاء لأي خدمة محاسبة/مخزون/مبيعات.
- **المصدر الوحيد** `product_warehouse_stock` (نموذج `BaseModel` ⇒ عزل المستأجر؛ `CompanyWide` ⇒ لا تصفية فرع، وهو المطلوب لرؤية الرصيد الرسمي).
- **الانفراد (بند 4):** عدّ كل `fuel_tanks` المرتبطة بـ(مخزن المحطة، `fuel_products.product_id`) **بغضّ النظر عن الحالة وعن نطاق المستخدم**، عبر كل محطات المؤسسة التي تتشارك المخزن. هذا أشد من فحص المطابقة القائم `FS-01` (الذي يستثني المعطَّل). المنتجان المختلفان في مخزن واحد مجمّعان مستقلان.
- **لا صفر مخترع (بند 5):** غياب السجل ⇒ `no_stock_record`، والصفر الحقيقي يُعاد `0`.
- **`as_of` دائماً `null` (بند 6):** لا دلالة مثبتة لـ`updated_at` على "آخر حركة"، فلا يُستنتج منه وقت (يحرسه اختبار يعدّل `updated_at` ويتأكد أنه لا يظهر).
- **`FuelTankResource`**: الإضافة اختيارية بمنفذ صريح (`withBookLevel`/`collectionWithBookLevels`)؛ لا تعديل لنموذج `FuelTank` ولا لأي استدعاء آخر للـResource.
- **المتحكّم:** `indexTanks`/`showTank` يمرّران الخزانات **بعد** تقييدها بنطاق المحطة/الفرع/المخزن/المحطة المسنَدة (`restrictToAccessibleStations`) إلى الخدمة. الصلاحية كما كانت (`fuel_stations.view`).

### عدد الاستعلامات (بند 7)
ثلاثة فوق القائمة مهما بلغ عدد الخزانات: (1) عدّ الخزانات المشتركة بـjoin وتجميع، (2) وحدة المنتج، (3) سجلات الرصيد؛ وتُتخطّى (2) و(3) حين لا خزان وحيد. الاختبار لا يكتفي بمقارنة العدد: يقارن **قائمة عبارات SQL الموحَّدة** (بعد توحيد أعداد عناصر `IN (…)` واستثناء تحديث `last_used_at` لرمز Sanctum) بين خزان واحد وثمانية خزانات بحالات متنوعة — متطابقة، فلا استعلام لكل صف.

### العزل والتسريب (بنود 8 و9)
- مستأجر: `BaseModel` + شرط `tenant_id` صريح على الـjoins. الاختبار يضع مستأجراً آخر برصيد `99,999,999` ولا يظهر في أي استجابة ولا يؤثر في العدّ.
- فرع/محطة مسنَدة/مخزن: القائمة مقيَّدة قبل الخدمة؛ **الرصيد المجمَّع لا يُعاد إلا لخزان وحيد ظاهر للمستخدم**. في مخزن مشترك مع محطة مخفية عن المستخدم يحصل على `multi_tank` بلا أي رقم (اختبار: `8888888` لا يظهر في الاستجابة)، وعرض الخزان المخفي = 404.
- **أثر جانبي معلن:** رمز `multi_tank` يكشف وجود خزان آخر يشارك المجمّع (دون هويته أو رصيده). اعتُبر ثمن لازم للصدق (البديل تخمين).

## 3) الاختبارات (`tests/Feature/FuelTankBookBalanceApiTest.php` — 15 اختباراً)

| المتطلب | الاختبار |
|---|---|
| خزان واحد | `a_sole_tank_returns_the_official_book_balance_in_list_and_show` |
| خزانان للمنتج نفسه | `two_tanks_for_the_same_product_in_one_warehouse_…multi_tank_and_no_pooled_number` |
| خزان معطل | `a_disabled_second_tank_still_counts…` + `a_sole_inactive_tank_is_not_given_a_level` |
| مخزن مشترك بين محطات | `a_warehouse_shared_by_stations_in_different_branches…` (فرعان + منتج آخر مستقل) |
| غياب سجل المخزون | `a_missing_stock_record_is_never_read_as_zero_while_a_real_zero_balance_is_zero` |
| حالات غامضة/غير صالحة | `ambiguous_negative_unit_and_warehouse_configuration_problems…` (متغيّر، سالب، وحدتان، منتج محذوف، بلا مخزن) |
| `as_of` | `as_of_is_always_null_and_never_derived_from_updated_at` |
| اختلاف المستأجر | `another_tenants_tanks_and_stock_are_never_visible_or_counted` |
| نطاق الفرع / المحطة المسنَدة / المخزن | `a_branch_restricted_user_gets_no_pooled_balance…` و`a_station_assigned_user_and_a_warehouse_restricted_user…` (ومنها المقيَّد صراحةً بلا محطات ⇒ `[]`) |
| الصلاحية كما هي | `the_endpoint_permission_is_unchanged…` (403 بلا `fuel_stations.view`) |
| بلا N+1 | `the_number_of_queries_is_constant_regardless_of_the_number_of_tanks` |
| قراءة فقط + توافق رجعي | `reading_is_pure_read_only_and_existing_response_contract_is_backward_compatible` (لا INSERT/UPDATE/DELETE، المفاتيح القديمة وترتيبها، والإنشاء/التعديل بلا المفتاحين) |
| من الحركات الحقيقية إلى المؤشر | `the_level_follows_real_approved_receipts_and_finalized_sales_but_not_drafts` (لا سجل ⇒ `no_stock_record`؛ مسودة استلام ⇒ لا أثر؛ اعتماد +10 L؛ مسودة بيع ⇒ لا أثر؛ اعتماد بيع 1.234 L ⇒ 8,766؛ إعادة الاعتماد ⇒ لا خصم ثانٍ؛ استلام 5 L ⇒ 13,766) |

## 4) النتائج

| التشغيل | النتيجة |
|---|---|
| الاختبارات الجديدة — SQLite | 15 ناجحة (170 تأكيداً) |
| الاختبارات الجديدة — PostgreSQL 16 | 15 ناجحة (170 تأكيداً) |
| كل `Fuel*` — SQLite | 360 ناجحة، 20 متخطاة (PostgreSQL فقط) |
| كل `Fuel*` — PostgreSQL | 380 ناجحة (تشمل P0 والتزامن) |
| حراسة معمارية (`Guard|Architecture|Isolation|Psr|Classif|BranchScope`) — SQLite | 369 ناجحة، 2 متخطاة |
| `WholesaleCartCheckoutBoundaryTest` (يقرأ CLAUDE.md) | 24 ناجحاً |
| `php -l` للملفات المتغيرة | سليم |

> الجولات الواسعة (`Fuel*` والحراسة) أُجريت قبل تصحيح صغير في الخدمة (منتج محذوف ناعماً ⇒ `invalid_configuration` بدل `unit_mismatch` المضلِّل)؛ أُعيد بعده تشغيل `FuelTankBookBalanceApiTest` على المحرّكين (15/15)، والمجموعة الكاملة تعمل في CI.
| CI | يُحدَّث بعد الدفع |

**حساسية الاختبارات** (أعطال مؤقتة في نسخة التشغيل `nibras-app` فقط ثم استُعيدت وتحقق `diff` أنها مطابقة للمستودع):

| العطل | النتيجة |
|---|---|
| استثناء الخزانات المعطَّلة من العدّ (أسلوب FS-01) | فشل اختبار المعطَّل |
| قراءة غياب السجل صفراً | فشل اختبار الغياب واختبار التدفق الحقيقي |
| `as_of` من `updated_at` | فشل اختبارا `as_of` والخزان الوحيد |
| استعلام لكل خزان (N+1) | فشل اختبار الاستعلامات |

أثناء التطوير ظهر فرق استعلام واحد بين الحالتين؛ **حُقّق منه بمقارنة عبارات SQL** فتبيّن أنه تحديث `last_used_at` لرمز Sanctum (أول طلب فقط)، لا N+1، فصار الاختبار يقارن العبارات الموحَّدة بدل العدد الخام.

## 5) الملفات

| ملف | تغيير |
|---|---|
| `app/Services/FuelTankBookBalanceReader.php` | جديد |
| `app/Http/Resources/FuelTankResource.php` | إضافي (منفذ اختياري للمفتاحين) |
| `app/Http/Controllers/Api/FuelStationMasterDataController.php` | `indexTanks`/`showTank` + حقن الخدمة |
| `tests/Feature/FuelTankBookBalanceApiTest.php` | جديد |
| `CLAUDE.md` | قسم موجز للعقد |
| `docs/fuel-stations/AWJ_STATIONS_TANK_BALANCE_P1_REPORT.md` | هذا التقرير |

لا تغيير في `database/`، `routes/`، الخدمات المحاسبية/المخزنية، المبيعات، الاستلامات، ولا `web/`.

## 6) المخاطر والحدود

1. **الرصيد دفتري لا قياس.** الخسائر غير المسجلة (تبخر، تسريب، صرف غير مسجل) لا تظهر حتى تسوية الجرد. `basis: warehouse_book` يقول ذلك صراحةً؛ الواجهة يجب أن تسمّيه "رصيد دفتري".
2. **خزان واحد لا يضمن صحة الرصيد المخزني السابق:** إن وُجد رصيد تاريخي سابق للدفتر التشغيلي فهو داخل المجمّع. لم أضف فحص مطابقة مع الدفتر التشغيلي (O(تاريخ) ورفضته في Discovery) ولا مع `FuelInventoryCostState` (مرشّح لحارس رخيص لاحقاً).
3. **`multi_tank` يعني أن النظام لا يعرف رصيد خزان بعينه** حتى لو كان أحد الخزانات خارج الخدمة فعلياً؛ تشدّد مقصود وفق التعليمات. دفتر لكل خزان = P4/قرار محاسبي منفصل.
4. **الصلاحية لم تُضيَّق:** من يقرأ الخزانات (`fuel_stations.view`) يقرأ الكمية. الكمية لا تحمل تكلفة (التكلفة تبقى خلف `products.view_cost`)، لكن قرار فصلها (مثلاً `fuel.reading.view`) ما زال بانتظارك.
5. **كشف وجود خزان آخر** عبر `multi_tank` (انظر §2).
6. قراءات `index` تُحمّل كل الخزانات المسموحة (سلوك قائم بلا ترقيم)؛ ثلاثة استعلامات إضافية لا تغيّر ذلك.

## 7) المتبقي

- **P2:** توصيل الواجهة (مخطط zod، تمرير `book_level` إلى `TankLevelIndicator` بأصل `book`، نص "رصيد دفتري" لا "فعلي"). يحتاج قراراتك: المقام (`capacity` أم `safe_capacity` أم الصافي بعد `dead_stock`)، والعتبات، والصلاحية.
- **P3 (اختياري):** الفرق عن آخر قياس مادي.
- **P4 (إن طُلب تعدد الخزانات):** وثيقة تصميم لدفتر لكل خزان قبل أي كود.
- بيئة التشغيل المحلية: bcmath وPostgreSQL 16 مؤقت في `/tmp` لهذه الجلسة (ليسا في المستودع).

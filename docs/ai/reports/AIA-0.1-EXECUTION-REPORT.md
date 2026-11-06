# AIA-0.1 — الغلاف المالي لكشف حساب الطرف (تقرير التنفيذ)

**الحالة:** جاهز للمراجعة. لا Merge ولا Deploy ولا تفعيل سياسة الاستقلالية. لم يبدأ AIA-0.2 ولا AIA-0.3.
**PR:** #2043 · **Branch:** `claude/jolly-cray-4dgo88` · **Base SHA:** `0f59ccc5fa1b638043fcd7bb33d4a5f02dedbe31` (= `origin/main` عند البدء).
**التسلسل:** `b8500e98` (التنفيذ الأول) ← `4382708a` (التقرير الأول، رأس المراجعة الأولى) ← `b780db49` (**تصحيح المراجعة المالية — الكود**) ← commit هذا التقرير المحدَّث (رأس الفرع النهائي يُذكر في وصف الـPR وفي رد التسليم؛ لا يمكن لتقرير أن يحمل SHA الـcommit الذي يحويه).

## 0) تصحيح المراجعة المالية على الرأس `4382708a` (مغلق في `b780db49`)

| # | الملاحظة | التصحيح |
|---|---|---|
| 1 | كشف فيض `int` لا يكفي؛ يجب منع `final` عند تجاوز أي مجموع أو رصيد وسيط محسوب `2^53−1` ولو كانت كل حركة آمنة | كل جمع محسوب (مجموع المدين، مجموع الدائن، الصافي، الرصيد الجاري المُعاد حسابه، الختامي المتوقع) يمرّ عبر `StatementIntegrity::addSafe` الذي يعيد `null` عند فيض `int` **أو** تجاوز `±MAX_SAFE_MINOR` (متماثل: `−MAX` مقبول و`−MAX−1` مرفوض). فحص جديد مستقل `computed_values_within_safe_range` يفشل عندها، فيصبح التقرير `unverified` بلا `display` ولا `position`. |
| 2 | اختبار حركات متوازنة متكررة | `balanced_repeated_movements_exceed_the_safe_total_without_overflowing_php`: ست حركات (مدين/دائن بقيمة `2^52`) — الأرصدة الجارية ≤ `2^52` (آمنة) وإجمالي كل جانب `3×2^52 = 1.35e16 > 2^53−1` وهو ≪ `PHP_INT_MAX` (9.22e18)، فلا يكشفه فحص الفيض القديم. يثبت: `passed=false`، السبب الجذري `computed_values_within_safe_range`، و`minor_units_are_integers` و`running_balance_chain` **سليمان**. وبنسخته التكاملية عبر HTTP (`unsafe totals`): `report_status=unverified`، `display=null`، `position=null`، `failed_checks=[computed_values_within_safe_range, closing_equals_opening_plus_net]`. **تحقق عكسي:** شغّلت الاختبارات الجديدة على `StatementIntegrity` القديم من `HEAD` فسقطت خمسة منها (القديم لا يكشف الحالة)، وتنجح على الجديد. |
| 3 | لا إجماليات جزئية مضللة؛ حدود موجبة وسالبة | عند فشل الجمع: `totals.debit_minor/credit_minor/net_minor = null` (لا صفر)، و`row_count` وحده يبقى لأنه عدّ لا جمع. اختبارات: الحد الموجب (مجموع مدين = `MAX` مقبول، `MAX+1` مرفوض)، الحد السالب (صافي `−MAX` مقبول، مجموع دائن `MAX+1` مرفوض)، رصيد سالب `−MAX` مقبول و`−MAX−1` مرفوض، رصيد وسيط خارج النطاق يكسر السلسلة، وكل حالة فاشلة تثبت `null` للمجاميع الثلاثة. |
| 4 | توضيح أن `row_count_matches_rows` ليس إثبات اكتمال | كان العدد المتوقع يُشتق من `count($rows)` نفسه (فحص تحصيل حاصل دائماً ناجح). صار `Envelope::build(..., emittedRowCount: count($rows))` يمرّر عدد الصفوف **المُخرَجة** في الاستجابة (بعد التحويل)، فيحرس طبقة التسلسل (صف مفقود/مكرَّر) فقط. وُثِّق ذلك في الشيفرة وOpenAPI وCLAUDE.md، وأُضيف `completeness_independent_verification` إلى `integrity.not_checked`. **لا ادعاء بأن الاكتمال المستقل تم؛ مؤجَّل إلى AIA-0.2.** |

**القرارات المعتمدة (ثُبّتت دون تغيير):** `PUBLIC_API_STATEMENT_REJECT_ON_INTEGRITY_FAILURE=false` افتراضياً · `internal_error` مع `details.reason=report_integrity_failed` · استعلام العملات قراءة مجمَّعة بمشغّل مخوَّل فقط ولا توسعة للعملات (لم أنفّذ أي استعلام).

**تغييرات العقد (إضافية داخل الإصدار نفسه غير المدموج):** معرّف فحص جديد في `integrity.checks[].id`؛ و`totals.debit_minor/credit_minor/net_minor` صارت `integer|null` (null عند فشل الجمع). `PartnerStatementEnvelope::build` اكتسب معاملاً اختيارياً أخيراً `emittedRowCount` (لا كسر للاستدعاءات القائمة).

## 1) المعمارية

ثلاث فئات نقية (لا قاعدة بيانات ولا حالة) في `app/Support/` مباشرةً — لا في `Support/Reports/` كما اقترح الـroadmap — لأن `setup.sh` و`ci.yml` ينسخان `Support/*.php` فقط، ومجلد فرعي جديد كان سيتطلب تعديل سكربتات البناء.

| الفئة | الدور |
|---|---|
| `CurrencyMinorUnits` | قائمة بيضاء `SAR => 2` (D-12 الخيار C). تطبّع الحروف/الفراغات؛ غيرها `null`. |
| `StatementIntegrity` | يحسب الإجماليات من الصفوف الأصلية بأعداد صحيحة ويقيّم الفحوص الستة. كل جمع عبر `addSafe` (فيض `int` **وتجاوز `±(2^53−1)`** لأي مجموع أو رصيد وسيط)؛ لا تحويل صامت لأي قيمة (`is_int` صارم). |
| `PartnerStatementEnvelope` | يركّب الحقول الإضافية، `position`، `display` (عبر `Money::toRiyal` دون تعديلها)، و`report_status`. |

`PublicPartnerStatementController` يستدعي الغلاف بعد فحص السقف 2000 ويدمجه (`+`) بعد الحقول القديمة. لا تغيير في `ReportService` ولا `LedgerService` ولا `Money` ولا ZATCA، ولا هجرة، ولا عمليات مالية أو قيود جديدة.

### قواعد الاتجاه (من الخدمات القائمة، دون تغيير)
الرصيد الجاري = **مدين − دائن لكل الأدوار**؛ الموجب = الطرف مدين لنا، السالب = نحن مدينون له. لم يظهر أي تعارض محاسبي في تفسير المدين/الدائن: مشتريات المورد تُنتج دائناً على حساب الطرف (رصيد سالب = `payable`)، ويؤكد ذلك اختبارات الكشف على قيود حقيقية. الجانب يُحدَّد من إشارة الرصيد لا من الدور؛ `opposite_sign=true` لعميل دائن أو مورد مدين.

## 2) عقد JSON (حقول `data` الجديدة؛ القديمة بلا تغيير)

```jsonc
{
  "partner": {…}, "currency": "SAR", "from": null, "to": null,
  "opening_balance_minor": 0, "rows": […], "closing_balance_minor": -65000,   // قديمة، حرفياً

  "role": "supplier",                       // المطلوب أو null
  "row_count": 2,
  "totals": { "row_count": 2, "debit_minor": 50000, "credit_minor": 115000, "net_minor": -65000 },
                                            // debit/credit/net = null إن تعذّر الجمع الآمن (لا صفر ولا جزئي)
  "balance_convention": { "formula": "debit_minus_credit", "positive_means": "partner_owes_us", "negative_means": "we_owe_partner" },
  "position": {                             // null إن لم يكن verified+SAR
    "opening": { "side": "settled",  "amount_minor": 0,     "opposite_sign": false },
    "closing": { "side": "payable",  "amount_minor": 65000, "opposite_sign": false }
  },
  "display": {                              // null إن لم يكن verified+SAR
    "currency": "SAR", "minor_unit_exponent": 2,
    "opening": "0.00", "opening_side": "settled",
    "debit": "500.00", "credit": "1150.00", "net": "-650.00",
    "closing": "650.00", "closing_side": "payable"
  },
  "minor_unit_exponent": 2,                 // null لغير SAR
  "integrity": {
    "status": "verified",                   // verified | failed | unsupported
    "checks": [ {"id":"minor_units_are_integers","passed":true}, … ],
    "failed_checks": […],                   // عند الفشل فقط
    "reason": "currency_exponent_unsupported", // عند unsupported فقط
    "not_checked": ["role_attribution_independent_verification", "source_documents_reconciliation"]
  },
  "report_status": "final"                  // final | partial | unverified | unsupported
}
```

الفحوص: `minor_units_are_integers` · `computed_values_within_safe_range` · `amounts_are_non_negative` · `running_balance_chain` · `closing_equals_opening_plus_net` · `row_count_matches_rows`. فشل الأولى يُسقط تبعاً الفحوص المعتمدة عليها (ما لا يمكن التحقق منه لا يُعدّ ناجحاً). **الفحوص اتساق حسابي داخلي فقط** ولا تطابق دفاتر الطرف ولا المستندات؛ لذلك `not_checked` معلن. لم أُضف فحص `role_filter_applied` من الـroadmap لأنه لا يمكن التحقق منه بشكل مستقل داخل المتحكّم دون استعلام إضافي — فحص صوري كان سيعطي ثقة كاذبة. وللسبب نفسه `row_count_matches_rows` **ليس إثبات اكتمال** (انظر §0، البند 4).

### سلوك الفشل
- **الافتراضي (تدرّج آمن، حسب D-02 §1.2.5):** يُسجَّل الفشل (معرّفات الفحوص فقط، بلا قيم) ويُردّ 200 بحقول قديمة كاملة مع `report_status=unverified` و`display`/`position = null`. لا يمكن أن يظهر `final`.
- **صلب (مغلق افتراضياً):** `PUBLIC_API_STATEMENT_REJECT_ON_INTEGRITY_FAILURE=true` (`config/public_api.php`) ⇒ 500 `internal_error` مع `details.reason=report_integrity_failed` وبلا بيانات. استعملت `internal_error` بدل رمز جديد كي لا أوسّع قائمة الرموز العامة. فتحه قرار لاحق.

## 3) D-12 (الخيار C)
SAR فقط، `minor_unit_exponent=2`. KWD/JPY/USD/رمز غير معروف/فارغ ⇒ `report_status=unsupported`، `integrity.status=unsupported`، `display=null`، `position=null`، `minor_unit_exponent=null`، والقيم الخام القديمة (`*_minor`، `currency`) بلا تغيير. `sar` بحروف صغيرة مدعومة ويبقى كما خُزّن في الحقل القديم `currency` بينما `display.currency=SAR`. OpenAPI يصرّح أن القيم الخام لغير SAR غير مضمونة كوحدات فعلية. لم يُغيَّر `Money::toRiyal` (حارس في الاختبارات).

## 4) إثبات التوافق الخلفي
- `the_legacy_fields_are_unchanged_and_the_envelope_is_purely_additive`: مفاتيح `data` = القديمة بترتيبها ثم التسعة الإضافية فقط؛ كل صف مفاتيحه السبعة القديمة؛ القيم تساوي ناتج `ReportService::partnerStatement` مباشرة؛ رصيد المورد يبقى سالباً.
- `PublicApiPartnerStatementTest` الأصلي (11 اختباراً) يمرّ دون أي تعديل، وسقف 2000 ⇒ 422 كما كان.
- OpenAPI: إضافات فقط (`required` لحقول الاستجابة الجديدة)؛ `PublicApiOpenApiContractTest` واختبار انجراف الويب أخضران.

## 5) الاختبارات
ملفات جديدة (سطر لكل مجال): `CurrencyMinorUnitsTest` · `StatementIntegrityTest` (يتضمن قيم باشت المُبلَّغة وفيض `PHP_INT_MAX` وقرب 2^53 **وحركات متوازنة متكررة تتجاوز المجموع الآمن دون فيض، والحدود الموجبة والسالبة، وانعدام الإجماليات الجزئية**) · `PartnerStatementEnvelopeTest` · `PublicApiPartnerStatementIntegrityTest` (قيود حقيقية عبر الخدمات: مورد، عميل، both، افتتاحي غير صفري، ختامي مدين/دائن، بلا حركات، `from`/`to`، 2000/2001، حقن 5 أنواع فساد، رفض صلب، KWD/JPY/USD/XYZ، عزل، 403) · `StatementEnvelopeNoFloatArchitectureTest` (فحص tokens: لا ثابت عشري ولا cast ولا round/number_format ولا قسمة، مع ضابط تعطيل يثبت أن الماسح يلتقط الخطأ).

حالة باشت المرجعية (6 حركات، 586086/608511/705403 لكل جانب): بيانات **اصطناعية** عبر مشتريات ودفعات حقيقية بـ`role=supplier` وبدونه ⇒ مدين = دائن = 1,900,000 هللة (`19000.00`)، افتتاحي = ختامي = 0، `settled`، `final`. هذا اختبار حسابي مستقل ولا يؤكد بيانات الإنتاج.

| البيئة | النتيجة |
|---|---|
| SQLite، الاختبارات الجديدة + `PublicApi*` (280) + كشف الحساب | كلها خضراء |
| SQLite، **المجموعة الكاملة** `php artisan test` | 11194 نجح، 145 فشل، 402 متخطّى، 1 incomplete |
| تصنيف الـ145 | كلها بيئية: 144 في وحدات الوقود/الأذون (`bcmul` غير معرّفة — امتداد bcmath ناقص في الحاوية، وهو التحذير الذي يطبعه `setup.sh`) و1 `AiPlatformBudgetTest` (تخزين مستندات، يمرّ منفرداً 11/11). بعد تثبيت bcmath أُعيد تشغيل `Fuel*` و`Ai*`: **847 نجح، 24 متخطّى، 0 فشل**. |
| الـ incomplete الوحيد | الاختبار المصمَّم `incomplete` عمداً في `PublicApiScopeCeilingProofTest` (لا علاقة بهذا التغيير) |
| PostgreSQL 16 محلي، الاختبارات الجديدة + `PublicApi*` + كشف الحساب | كلها خضراء (91 في الجولة الأولى؛ ثم الحزمة الأوسع 989 نجح/12 فشل بيئياً: `bcmul` ×10 وقتها، `PGOPTIONS` lock_timeout غير مضبوط ×1، `PartnerImportApiTest` ×1 **لم أحدّد سببه** وغير متصل بالكشف) |
| PostgreSQL، **المجموعة الكاملة** | **لم تُشغَّل محلياً** — تُترك لـCI |
| Web | `vitest src/modules/developer` أخضر؛ النموذج المولَّد بـ`npm run openapi:generate` |

**جولة تصحيح المراجعة (على `b780db49`، محلياً):**

| البيئة | النتيجة |
|---|---|
| وحدات + تكامل + OpenAPI + كشف الحساب، SQLite (`PublicApi\|PartnerStatement\|Report` + الملفات الخمسة الجديدة) | **835 نجح، 34 متخطّى، 0 فشل** |
| PostgreSQL 16 محلي (`StatementIntegrity\|PartnerStatementEnvelope\|PublicApi\|CurrencyMinorUnits\|StatementEnvelopeNoFloat\|PartnerStatementReport\|StorefrontOfferPublicApi`) | **345 نجح، 0 فشل** |
| Web `vitest src/modules/developer` (يشمل انجراف النموذج المولَّد) | 8 نجح |
| تحقق عكسي | الاختبارات الجديدة على `StatementIntegrity` القديم: **5 فشلت** (تثبت أنها تلتقط الثغرة) |

ملاحظة صدق: أول محاولة PG في هذه الجولة أعطت 269 `QueryException` لأن خادم PostgreSQL المحلي كان متوقفاً بعد إعادة تشغيل الحاوية؛ أُعيدت بعد تشغيله والنتيجة أعلاه. **المجموعة الكاملة** لم أعدها محلياً (التغيير محصور في ملفات الغلاف ومتحكّمه، والجولة الكاملة السابقة نجحت عدا إخفاقات بيئية موثَّقة)؛ التغطية الكاملة على SQLite وPostgreSQL تتم في CI.

## 6) CI وBuild
CI على رأس المراجعة الأولى `4382708a` كان **أخضر بالكامل** (sqlite وpgsql وweb build وبوابة الأداء وCI Gate). بعد التصحيح يعيد CI التشغيل على الرأس الجديد؛ نتيجته الرسمية في فحوص الـPR وتُذكر في رد التسليم (لا يمكن لتقرير أن يحمل نتيجة commit يحويه). `npm run build` الكامل للويب لم أشغّله محلياً (التغيير في ملف مولَّد فقط، واختبار الانجراف أخضر).

## 7) مخاطر الدقة المالية
1. **الفحوص ≠ مطابقة دفاتر.** `verified` يعني اتساقاً حسابياً داخلياً؛ إسناد الدور (`role`) يأتي من `ReportService` ولا يُتحقَّق منه مستقلاً (`not_checked`).
2. **غير SAR:** القيم الخام قد لا تكون وحدات صغرى حقيقية؛ الغلاف يمنع `final` و`display` لكنه لا يصلح البيانات. استعلام قراءة الإنتاج لعدد المستأجرين بعملة ≠ SAR (D-12.3/D-12.5) ما زال مطلوباً قبل أي توسعة.
3. **حدّ 2^53−1** لوكلاء JS يسري على المدخلات **وعلى كل مجموع ورصيد محسوب**؛ ما فوقه ⇒ `computed_values_within_safe_range` يفشل، `unverified`، ومجاميع `null`. لا `*_minor_str` بعد؛ كشف بإجمالي جانب يتجاوز 9.007e15 هللة (≈ 90 تريليون ريال) سيبقى `unverified` حتى يُضاف ذلك الحقل.
4. **الرفض الصلب مغلق:** مستهلك لا يقرأ `report_status` سيظل يرى 200 عند `unverified`. مقصود للتوافق؛ الوكيل ملزم (AIA-0.3) بعدم تقديم أي مخرج غير `final`.
5. **إشارة الرصيد في الحقول القديمة غير مقلوبة** (مورد دائن = سالب)؛ من يكتفي بها بلا `position`/`display` معرّض للخلط نفسه. الغلاف يعالج ذلك للقارئين الجدد فقط.
6. حقن الفساد في الاختبارات يتم بـMockery على `ReportService` (لا يمكن إنتاج صفوف مكسورة من الدفتر الحقيقي)؛ لا يثبت حدوث فساد فعلي في الإنتاج.
7. السبب الجذري لـ«خطأ المقياس ×10» المُبلَّغ من باشت (1900 بدل 19000) **لم يُثبَت** هنا؛ الغلاف يوفّر نصوصاً جاهزة تلغي حاجة الوكيل للحساب، لكنه لا يفسّر الحادثة.

## 8) الملفات
جديدة: `app/Support/{CurrencyMinorUnits,StatementIntegrity,PartnerStatementEnvelope}.php` · `config/public_api.php` · `tests/Feature/{CurrencyMinorUnits,StatementIntegrity,PartnerStatementEnvelope,PublicApiPartnerStatementIntegrity,StatementEnvelopeNoFloatArchitecture}Test.php` · هذا التقرير.
معدّلة: `app/Http/Controllers/Api/PublicPartnerStatementController.php` · `docs/openapi/public-api-v1.yaml` · `web/src/modules/developer/docs/openapi-model.generated.ts` · `CLAUDE.md`.

## 9) المتبقي والخطوة التالية
- قرارات المالك: (أ) فتح الرفض الصلب أم إبقاؤه مغلقاً؟ (ب) هل يكفي `internal_error`+`details.reason` أم رمز عام جديد؟ (ج) استعلام عملات المستأجرين.
- **AIA-0.2:** الترقيم بالمؤشر، و`completeness`/`as_of`/`data_checksum` (خارج النطاق عمداً هنا). `PartnerStatementEnvelope::build(..., $complete)` جاهز لـ`partial`.
- **AIA-0.3:** مهارة `awj-erp` v2 والمُتحقِّق غير المتصل.
- مراجعة JSON حقيقي مقابل شاشة أَوْج (بوابة الـroadmap) قبل فتح الرفض الصلب.

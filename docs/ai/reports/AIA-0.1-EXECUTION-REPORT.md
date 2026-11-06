# AIA-0.1 — الغلاف المالي لكشف حساب الطرف (تقرير التنفيذ)

**الحالة:** جاهز للمراجعة. لا Merge ولا Deploy ولا تفعيل سياسة الاستقلالية. لم يبدأ AIA-0.2 ولا AIA-0.3.
**Branch:** `claude/jolly-cray-4dgo88` · **Base SHA:** `0f59ccc5fa1b638043fcd7bb33d4a5f02dedbe31` (= `origin/main` عند البدء) · **Code Head SHA:** `b8500e986f3da93605a659be20fad0a4180eff2a` (التقرير في commit لاحق؛ رقم الـPR ورأس الفرع النهائي في وصف الـPR).

## 1) المعمارية

ثلاث فئات نقية (لا قاعدة بيانات ولا حالة) في `app/Support/` مباشرةً — لا في `Support/Reports/` كما اقترح الـroadmap — لأن `setup.sh` و`ci.yml` ينسخان `Support/*.php` فقط، ومجلد فرعي جديد كان سيتطلب تعديل سكربتات البناء.

| الفئة | الدور |
|---|---|
| `CurrencyMinorUnits` | قائمة بيضاء `SAR => 2` (D-12 الخيار C). تطبّع الحروف/الفراغات؛ غيرها `null`. |
| `StatementIntegrity` | يحسب الإجماليات من الصفوف الأصلية بأعداد صحيحة ويقيّم الفحوص الخمسة. جمع عبر `addExact` يكتشف فيض `int`؛ حدّ كل مبلغ `2^53−1`؛ لا تحويل صامت لأي قيمة (`is_int` صارم). |
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

الفحوص: `minor_units_are_integers` · `amounts_are_non_negative` · `running_balance_chain` · `closing_equals_opening_plus_net` · `row_count_matches_rows`. فشل الأولى يُسقط تبعاً الفحوص المعتمدة عليها (ما لا يمكن التحقق منه لا يُعدّ ناجحاً). **الفحوص اتساق حسابي داخلي فقط** ولا تطابق دفاتر الطرف ولا المستندات؛ لذلك `not_checked` معلن. لم أُضف فحص `role_filter_applied` من الـroadmap لأنه لا يمكن التحقق منه بشكل مستقل داخل المتحكّم دون استعلام إضافي — فحص صوري كان سيعطي ثقة كاذبة.

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
ملفات جديدة (سطر لكل مجال): `CurrencyMinorUnitsTest` · `StatementIntegrityTest` (يتضمن قيم باشت المُبلَّغة وفيض الجمع وقرب 2^53) · `PartnerStatementEnvelopeTest` · `PublicApiPartnerStatementIntegrityTest` (قيود حقيقية عبر الخدمات: مورد، عميل، both، افتتاحي غير صفري، ختامي مدين/دائن، بلا حركات، `from`/`to`، 2000/2001، حقن 5 أنواع فساد، رفض صلب، KWD/JPY/USD/XYZ، عزل، 403) · `StatementEnvelopeNoFloatArchitectureTest` (فحص tokens: لا ثابت عشري ولا cast ولا round/number_format ولا قسمة، مع ضابط تعطيل يثبت أن الماسح يلتقط الخطأ).

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

## 6) CI وBuild
لم يكن CI قد اكتمل وقت كتابة التقرير؛ النتيجة الرسمية في فحوص الـPR (matrix sqlite/pgsql + Web CI). `npm run build` الكامل للويب لم أشغّله محلياً (التغيير في ملف مولَّد فقط، واختبار الانجراف أخضر).

## 7) مخاطر الدقة المالية
1. **الفحوص ≠ مطابقة دفاتر.** `verified` يعني اتساقاً حسابياً داخلياً؛ إسناد الدور (`role`) يأتي من `ReportService` ولا يُتحقَّق منه مستقلاً (`not_checked`).
2. **غير SAR:** القيم الخام قد لا تكون وحدات صغرى حقيقية؛ الغلاف يمنع `final` و`display` لكنه لا يصلح البيانات. استعلام قراءة الإنتاج لعدد المستأجرين بعملة ≠ SAR (D-12.3/D-12.5) ما زال مطلوباً قبل أي توسعة.
3. **حدّ 2^53−1** لوكلاء JS؛ ما فوقه ⇒ فشل سلامة لا تقريب. لا `*_minor_str` بعد.
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

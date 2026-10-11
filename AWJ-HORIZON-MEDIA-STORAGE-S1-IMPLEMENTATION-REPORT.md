# AWJ-HORIZON-MEDIA-STORAGE — S1 Implementation Report

> **الشريحة:** S1 — مرفقات دائمة وذرّية الطلب (المسار A). **المرجع:** `AWJ-HORIZON-MEDIA-STORAGE-MASTER-PLAN.md` §7 و§9 و§11.
> **Branch:** `horizon/media-storage-s1-attachments` · **Base:** `e501e4b` (main) · PR/Head SHA: انظر `AWJ-HORIZON-MEDIA-STORAGE-TRACKER.md` §3 (المرجع القاطع).

## 1. الهدف

ألّا يُكتب مرفق جديد على القرص الزائل (لا Volume لـ`nibras-api`)، وألّا يُنتج فشلُ رفعٍ سجلاً مالياً مكرَّراً عند إعادة الطلب. العلم `AWJ_ATTACHMENTS_R2_ENABLED` **افتراضه `false`** ⇒ دمج الكود لا يغيّر سلوك Production.

## 2. ما تغيّر

| الملف | التغيير |
|---|---|
| `app/Services/AttachmentStorage.php` (جديد) | غلاف رقيق على `R2StorageService` (غير معدَّل — Q4). `put`/`putMany` **ترمي دائماً**؛ `discard` تعويضٌ لا يرمي؛ `delete` صارم؛ `download`/`inlineImage` خلف المتحكّم مع `nosniff`؛ يحلّ مسار R2 بشرط تطابق المستأجر والنطاق |
| `app/Services/AttachmentStorageException.php` (جديد) | يُعرض `503 {code: storage_unavailable}` برسالة آمنة بلا أسرار |
| `config/attachments.php` (جديد) | علم `AWJ_ATTACHMENTS_R2_ENABLED` |
| `database/migrations/2026_11_06_010000_add_photo_disk_to_employees.php` (جديد) | `employees.photo_disk` string(50) nullable، إضافي بحت، بلا backfill (Q13) |
| `Expense/Payment/Purchase/Invoice/EmployeeController` | الكتابة والتنزيل والحذف عبر `AttachmentStorage`؛ ذرّية الطلب؛ ترتيب استبدال صورة الموظف |
| `docs/storage.md` | قسم عقد المرفقات |
| `tests/Feature/AttachmentDurabilityS1Test.php` + `FakeR2Bucket.php` (جديدان) | 19 اختباراً، دلو R2 في الذاكرة يحفظ البايتات ويحقن الفشل |

**لم يُمَس:** `R2StorageService` · أي خدمة مالية (`ExpenseService`/`PaymentService`/`LedgerService`) · `UpdatePlatformIntegrationRequest`/`PlatformIntegrationService` (A-18) · `DocumentStorageService` (A-19) · أي اختبار قائم (BC-4: صفر تعديل على اختبار موجود).

## 3. التصميم الأساسي — ذرّية الطلب (Q12)

```
1) putMany(...)                 ← الملفات أولاً، خارج المعاملة (فشل الملف N يحذف 1..N-1 ويرمي)
2) DB::transaction {            ← في المتحكّم، دون لمس الخدمة المالية
       الأب المالي (إنشاء/تعديل) + صفوف المرفقات
   }
3) catch → discard(الكائنات)    ← والمعاملة الخارجية تُسقط الأب والقيد (المعاملات الداخلية savepoints)
```

مفتاح R2 في مسارات الإنشاء: `tenant/{tenant}/{domain}/{uuid تجميع}/{uuid}.{ext}` (الأب غير موجود بعد). في مسارات التعديل/الإضافة: معرّف الأب.

## 4. إثبات معايير القبول

| # | المعيار | الحالة | الدليل |
|---|---|---|---|
| A-01 | `php artisan test` كاملاً | ⚠️ محلياً: **6298 نجاح · 73 skipped · 38 إخفاقاً بيئياً** (انظر §6) — CI هو المرجع | `Tests: 38 failed, 73 skipped, 6298 passed` |
| A-02 | دوام فعلي | ✅ محاكى | `an_expense_attachment_lands_on_r2_and_survives_losing_the_local_disk` (يُمحى القرص المحلي ويُقرأ من R2). **إعادة بناء حاوية حقيقية = تحقق إنتاجي معلّق (§7)** |
| A-03/A-08 | تعايش `null`/`local`/`r2` | ✅ | `employee_photo_disk_null_local_and_r2_all_read_side_by_side` |
| A-04 | تراجع العلم | ✅ | `with_the_flag_closed_new_writes_stay_local…` (صفوف R2 ما زالت تُقرأ) |
| A-05 | ذرّية الطلب المالي | ✅ | مصروف إنشاءً وتعديلاً · دفعة بتخصيص · ملاحظة فاتورة — لا أب، لا صف، لا كائن، **لا قيود** (`JournalEntry`/`JournalLine` قبل=بعد) · وفشل **DB** بعد كتابة الملفات (`creating` يرمي) يُسقط الأب ويحذف الكائنات |
| A-05-و | **Idempotency**: إعادة الطلب بعد الفشل | ✅ | ثلاثة اختبارات: فشل ثم نجاح ⇒ **صف أب واحد بالضبط** |
| A-06 | `put` يرمي | ✅ | `put_throws_when_the_local_write_fails…` · `put_throws_when_r2_fails` |
| A-07 | عزل المستأجر | ✅ | مفاتيح مستأجرين مختلفة · مرفق A غير قابل للقراءة/الحذف من B · مسار R2 لمستأجر آخر لا يُحلّ |
| A-09 | استبدال الصورة | ✅ | `a_failed_photo_replacement_does_not_lose_the_existing_photo` |
| A-10 | نفس الملف مرتين | ✅ | مفتاحان مختلفان |
| A-11 | حدود الوحدة | ✅ | `PhpUploadLimitsContractTest` أخضر بلا تعديل |
| A-12 | لا اختبار قائم عُدِّل | ✅ | `git diff --stat` — ملفات جديدة فقط في `tests/` |
| A-13 | `BranchIsolationGuardTest` | ✅ | لا نموذج جديد |
| A-14 | لا قيود ناتجة | ✅ | §5 |
| A-15..17 | الوصول | ✅ | لا presigned/302؛ طلب بلا توكن ⇒ 401 **بصفر قراءة** من R2؛ `nosniff` على كل تنزيل |
| A-18/19 | عقد شاشة الإدارة | ✅ | لا ملف من `UpdatePlatformIntegrationRequest`/`PlatformIntegrationService`/`DocumentStorageService` في الفرق |

## 5. الجانب المحاسبي (D-i)

**لا عملية مالية جديدة ⇒ لا قيود ناتجة ⇒ لا جدول قيود.** لا تغيير في أي قاعدة محاسبية أو خدمة مالية. الأثر **وقائي**: يُغلق خطر مصروف/دفعة/قيد مكرَّر ناتج عن فشل رفع ثم إعادة المحاولة (`B4`/`K-03`). المبالغ هللات `bigint` كما هي.

### حدٌّ معلَن لـ Idempotency (لا أُخفيه)
الذرّية تمنع التكرار **بعد فشل**. أما **«نجح الحفظ ثم انقطعت الاستجابة»** فإعادة الطلب تُنشئ مصروفاً/دفعةً ثانية، لأن `POST /expenses` و`POST /payments` لا يقبلان مفتاح idempotency اليوم (سلوك قائم قبل هذا الأفق، وليس من نطاق المرفقات). معالجته = ترويسة `Idempotency-Key` + جدول مفاتيح على الخدمات المالية ⇒ **تغيير معماري مالي يحتاج قرارك** (يوجد نمط قائم: `PublicApiIdempotencyKey`). لم أنفّذه.

## 6. CI والبيئة المحلية

- محلياً (مجموعة كاملة): **38 إخفاقاً كلها بيئية** وغير مرتبطة: `Fuel*` ×26 (غياب `bcmath` في PHP هذه الجلسة؛ `ci.yml` يثبّته)، و`AuthRecoveryTest`/`UserInvitationTest`/`ResendMailTransportTest` ×12 (`App\Mail\AuthActionMail` غائب لأن `setup.sh` لا ينسخ المجلد — الانحراف `K-11`). ثبّتُّ `league/flysystem-aws-s3-v3` محلياً فقط (يثبّته CI/`assemble.sh`، لا `setup.sh`).
- **CI هو المرجع** — النتيجة في الـPR.

## 7. المعلّق على المالك (بوابات)

1. **تفعيل `AWJ_ATTACHMENTS_R2_ENABLED=true` في Railway** (يُعيد نشر الخدمة). بلا ذلك تبقى المرفقات الجديدة على القرص الزائل. شروطه: `awj:r2-smoke-test` ناجح حاضراً (بتفويضك) على بيئة تملك اعتماد R2.
2. **تحقق إنتاجي A-02:** بعد التفعيل: ارفع مرفق مصروف → أعد نشر الخدمة → نزّله بنجاح.

## 8. مخاطر معروفة

- **عيب كامن في `R2StorageService::put`:** يفحص `is_readable($body)` على resource فيرمي TypeError في PHP 8؛ مسار stream لم يُستخدم قط. تجاوزته بتمرير البايتات (≤20MB ضمن 256M) ولم أعدّل الخدمة (Q4). يُنصح بإصلاحه عند أول حاجة لـstream.
- كائن يتيم إن انهارت العملية بين كتابة الملف والـcommit (بلا سرد لا يُكتشف — `DF11`).
- `K-01`/`K-03` تُغلقان فعلياً فقط بعد نشر هذه الشريحة **وتفعيل العلم**.

## 9. الشريحة التالية

S2 — مركز المستندات (`DOCUMENT_DURABLE_STORAGE_ENABLED=false`، تخزين محلي زائل): يحتاج قراءة `DocumentStorageService`/`PlatformIntegrationResolver` وقراراً بشأن أسبقية الاعتماد (`K-12`) قبل أي كود.

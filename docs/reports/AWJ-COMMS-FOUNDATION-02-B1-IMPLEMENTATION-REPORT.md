# AWJ-COMMS-FOUNDATION-02-B1 — Implementation Report

**PR:** [#1514](https://github.com/safwan5001-source/Nebrax/pull/1514) · **Branch:** `feat/awj-comms-foundation-02b1-fingerprint-schema`
**لا Merge ولا Deploy ولا ترحيل إنتاجي. بانتظار المراجعة.**

## 1. الملخص
ترحيل إضافي واحد على `communication_messages` يضيف عمودين nullable لدعم بصمة الطلب وإصدار مفتاح HMAC. **Schema فقط:** لا حساب HMAC ولا Enqueue ولا مزوّد ولا عامل ولا OTP ولا Routes/APIs ولا RBAC، ولا `recipient_hash`، ولا فهارس جديدة، ولا تعديل لهجرة 02-A، ولا Backfill، ولا تغيير على جداول قائمة أخرى.

| العمود | النوع | Null | Default |
|---|---|---|---|
| `request_fingerprint` | `char(64)` | نعم | — |
| `hash_key_version` | `smallint` | نعم | — |

## 2. الملفات (11)
| الملف | التغيير |
|---|---|
| `database/migrations/2026_11_10_020000_add_request_fingerprint_to_communication_messages.php` | **جديد** — العمودان + القيود + Triggers + `down()` |
| `app/Models/CommunicationMessage.php` | `IDENTITY_COLUMNS` و`$fillable` و`$hidden` (البصمة) و`cast` (`hash_key_version` عدد صحيح) + `assertFingerprintMetadata()` |
| `tests/Feature/CommunicationFingerprintSchemaTest.php` | **جديد** — قيود البصمة (المحرّكان) |
| `tests/Feature/CommunicationFingerprintMigrationTest.php` | **جديد** — up/down، الصفوف القديمة، حفظ الفهارس/الـTriggers |
| `tests/Feature/InteractsWithCommunicationSchema.php` | الصف الافتراضي يحمل بصمة صالحة؛ `legacyCommMessageRow()`؛ قائمة Triggers لـPG |
| `tests/Feature/CommunicationSchemaTest.php` · `…IdentityProtectionTest.php` · `…PrivacyTest.php` · `…TenantIsolationTest.php` · `…SchemaPostgresTest.php` · `…MigrationSafetyTest.php` | تحديثات ناتجة عن الامتداد (قائمة الأعمدة، الأعمدة المجمّدة، قوائم الـTriggers، إنشاء النماذج بالبصمة، ترتيب تراجع 02-B1 ثم 02-A) |

لم يُمسّ `2026_11_10_010000_create_communication_messages_tables.php`.

## 3. سلوك الترحيل
**up():** إضافة العمودين بـSchema Builder (على SQLite: `ALTER TABLE ADD COLUMN` الأصلي **بلا إعادة بناء الجدول** — تحقّق: الفهارس والـTriggers بقيت)، ثم:

| القاعدة | PostgreSQL | SQLite |
|---|---|---|
| معاً أو لا شيء | CHECK `comm_msg_fingerprint_pair_chk` | Triggers `comm_msg_fingerprint_insert/update` |
| صيغة `^[0-9a-f]{64}$` | CHECK `comm_msg_fingerprint_format_chk` | نفسهما (`length` + `GLOB` + `typeof`) |
| إصدار 1..32767 | CHECK `comm_msg_hash_key_version_chk` (+ نوع smallint) | نفسهما (`typeof`=integer) |
| **ثبات بعد الإدراج** (حتى NULL → قيمة) | الدالة `communication_messages_guard_identity()` موسَّعة (`CREATE OR REPLACE`) | `comm_msg_identity_immutable` يُعاد إنشاؤه (DROP+CREATE) بقائمة موسَّعة |
| الصف الجديد يجب أن يحمل البصمة | Trigger `comm_msg_fingerprint_required` (`BEFORE INSERT`) | داخل `comm_msg_fingerprint_insert` |

**لماذا Trigger إدراج لا `NOT NULL`/`CHECK … NOT VALID` (الحدّ المطلوب توثيقه):** `NOT NULL` يتعارض مع الصفوف القديمة ومع `ADD COLUMN` على SQLite. وCHECK `NOT VALID` يُفحص أيضاً عند **تحديث** صف قديم — **تحقّقتُ على PostgreSQL 16:** `UPDATE … SET status` على صف NULL فشل بعد إضافته. فكان سيكسر دورة حياة أي صف سابق. Trigger الإدراج هو أصغر حلّ آمن: يفرض الشرط على الجديد فقط دون المساس بالقديم. الحدّ الباقي: مالك الجدول/superuser قادر على تعطيل Triggers (CHECK/FK/UNIQUE تبقى).

**الصفوف القديمة:** NULL/NULL، صالحة وقابلة للتحديث الكامل (تنتقل بين الحالات)، **لا تكتسب بصمة لاحقاً** (ثبات NULL)، ولا Backfill مختلق.

**down():** يرفض في كل البيئات إن حمل أي صف بصمة أو إصداراً (بلا رسالة تحوي قيماً)؛ يسمح بالصفوف القديمة لأنه بلا فقد؛ يعيد تعريفات 02-A الأصلية لـTrigger الهوية قبل حذف العمودين (SQLite يمنع حذف عمود يشير إليه Trigger)؛ لا يفعل شيئاً إن كان الجدول غائباً (مع تنظيف دالة PG المتبقية). ترتيب `migrate:rollback` الحقيقي: 02-B1 ثم 02-A.

## 4. توافق مع القائم
- `idempotency_hash`/الفرادات/الـFK/الفهارس: **لم تتغيّر** (اختبار يقارن قوائم الفهارس قبل/بعد: 4 فرادات فقط).
- العقود المدمجة (#1494): لم تُمسّ. `MessageIntent::idempotencyHash()` كما هو.
- النموذج: الصف **الجديد** عبر Eloquent يتطلب البيانات؛ الصف القديم المحمَّل يبقى قابلاً للتحديث؛ البصمة مخفيّة من `toArray()/toJson()`.

## 5. نتائج الاختبارات (محلياً)

### SQLite
| الفحص | النتيجة |
|---|---|
| ملفا 02-B1 الجديدان | 38 نجح · **2 مُهمَل** (اختباران خاصان بـPG) |
| `CommunicationMigrationSafetyTest` | 18 نجح · 1 مُهمَل (دوال PG المتبقية) |
| Schema/Identity/Privacy/Tenant + اختبارات PG-only | 63 نجح · **30 مُهمَل** (اختبارات PG فقط) |
| `BranchIsolationGuardTest` + عقود الاتصالات + OTP | 47 نجح · 4 مُهمَل |
| **المجموعة الكاملة** | **7092 نجح · 134 مُهمَل · 26 فشل** — الـ26 كلها Fuel (`bcmul`، غياب `bcmath` محلياً فقط) |

### PostgreSQL 16.15
| الفحص | النتيجة |
|---|---|
| ملفا 02-B1 | 40 نجح |
| `CommunicationMigrationSafetyTest` | 19 نجح |
| Schema 17 · Identity 28 · Privacy 11 · Tenant 7 · SchemaPostgres 27 · Concurrency (`pcntl_fork`) 3 | كلها نجحت |
| `BranchIsolationGuardTest` | 4 نجح |
| **المجموعة الكاملة** | **7221 نجح · 3 مُهمَل · 28 فشل** = 26 Fuel (`bcmath`) + `StorefrontMediaApiTest` (خطأ ربط PDO في مكتبة الوسائط، معروف محلياً وينجح في CI) + `DocumentSourceChannelTest` |

`DocumentSourceChannelTest` فشل في التشغيل الكامل لأن تشغيلَي SQLite وPostgreSQL جرَيا بالتوازي على نفس مجلد التخزين المحلي (ملفات متبقية، `allFiles()` = 4)؛ **نجح 9/9 عند إعادته منفرداً**. لا علاقة له بالاتصالات.

الإهمال لا يُحتسب نجاحاً في أي رقم أعلاه.

## 6. التحقق الأمني وعزل المستأجر
- البصمة ليست فريدة ولا مفهرسة: نفس القيمة داخل مستأجر وبين مستأجرين مقبولة ⇒ لا قناة كشف عبر القيود (اختبار صريح)؛ لا فهارس جديدة.
- القراءة/التحديث عبر النموذج المقيَّد لا تصل لمستأجر آخر (0 صفوف)؛ تثبيت `tenant_id` وبقية الهوية سارٍ وموسَّع، بما فيه `DB::table()->update()` و`Model::query()->update()`.
- لا بصمة في أي مخرجات تسلسل؛ رسائل الـTriggers/CHECK/الاستثناءات ثابتة بلا قيم.
- حارس الخصوصية على أسماء الأعمدة يستثني `request_fingerprint` صراحةً (HMAC مفتاحي لا جسم طلب).
- ثوابت 02-A كلها باقية بعد up/down/up (OTP، الحمولة، الهوية، محاولة جارية واحدة) — مُثبَتة باختبار.

## 7. CI (Head `810dfb888023bfde5367ae2a5e4f14901289caec`)
| الفحص | النتيجة |
|---|---|
| php artisan test (L11, sqlite) | ✅ [success](https://github.com/safwan5001-source/Nebrax/actions/runs/38762423405/job/116516892528) |
| php artisan test (L11, pgsql) | ✅ [success](https://github.com/safwan5001-source/Nebrax/actions/runs/38762423405/job/116516891912) |
| CI Gate | ✅ [success](https://github.com/safwan5001-source/Nebrax/actions/runs/38762423356/job/116516892198) |

`mergeable_state: clean`. Codex review آلي: اكتمل بلا تعليقات. (أعداد الاختبارات من CI غير متاحة لي؛ الأرقام أعلاه محلية.) هذا التقرير أُضيف بعد CI في commit توثيقي منفصل.

## 8. المخاطر والمتبقي
1. **تعطيل الـTriggers** من مالك الجدول/superuser يتجاوز شرط البصمة وثباتها (CHECK/FK/UNIQUE تبقى)؛ خارج نموذج تهديد التطبيق.
2. **عمودان nullable:** الصف القديم لا يحمل بصمة؛ إعادة تنفيذ طلب مرتبط به لا يمكن التحقق من بصمته (سيعامله 02-B كـ«غير قابل للتحقق» لا كتطابق). لا صفوف إنتاجية اليوم (لا كاتب بعد).
3. **SQLite:** قواعد الصيغة تُفرض بـTriggers لا CHECK؛ إعادة بناء الجدول في ترحيل مستقبلي تُسقطها (اختبار وجود الـTriggers يكشف ذلك).
4. **اقتران الـTrigger الموسَّع:** أي عمود هوية جديد مستقبلاً يتطلب تحديث الـTrigger في المحرّكين (نمط 02-A نفسه).
5. **المتبقي:** مفتاح HMAC والـKeyring وحساب البصمة والـCanonicalizer (02-B)؛ سياسة OTP (استثناء المتغيرات من بصمة OTP) والقرارات D-A3 تُحسم قبلها.

## 9. Base / Head
- **Base:** `8b2b424389910d1622828683f1ca3538bbf36f56` (`main`)
- **Head (الكود):** `810dfb888023bfde5367ae2a5e4f14901289caec` — يليه commit توثيقي لهذا التقرير.

## 10. الخطوة التالية
بعد مراجعة PR #1514 ودمجه بقرارك: **02-B** — Keyring (مفاتيح مخصّصة بإصدارات، fail-closed)، الـCanonicalizer v1، وخدمة Enqueue (`insertOrIgnore` + مقارنة البصمة بإصدار الصف + `EnqueueResult`/`IdempotencyConflict`)، مع اختبار تزامن PostgreSQL. يلزم قبلها حسم: استثناء `variables` من بصمة OTP، تضمين `source`، تطبيع البريد، ومصدر المفتاح وجدول التدوير.

**توقفتُ هنا: لا Merge ولا Deploy.**

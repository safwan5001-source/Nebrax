# AWJ-COMMS-02-B — Secure Idempotent Enqueue (Implementation Report)

**Branch:** `feat/awj-comms-02b-enqueue` · **Base:** `f792a51876ec1f9c6969a38341fb8263278bef5f` (PR #1514)
**لا إرسال، لا مزوّد، لا شبكة، لا Routes/APIs، لا تغيير Schema.**

## 1. النطاق
خدمة إدراج (`CommunicationOutbox::enqueue(MessageIntent): EnqueueResult`) فوق Schema 02-A/02-B1 المدمجتين، مع Keyring لمفاتيح HMAC مخصّصة بإصدارات، وCanonicalizer v1، وبصمة طلب HMAC. لا ترحيل جديد.

## 2. الملفات
| الملف | الدور |
|---|---|
| `config/communications.php` | مفاتيح HMAC (متغيرات بيئة بإصدارات، بلا قيم افتراضية) + سياسة TTL/المحاولات لكل تصنيف |
| `app/Support/Communications/RequestCanonicalizer.php` | التمثيل القياسي v1 (نقيّ، بطول مسبق) |
| `app/Support/Communications/EnqueueOutcome.php` · `EnqueueResult.php` | نتيجة الإدراج (`Created`/`Replayed`) |
| `app/Support/Communications/*Exception.php` (6) | `IdempotencyConflict`، `IdempotencyUnverifiable`، `CommunicationsConfiguration`، `CommunicationsStorage`، `CommunicationsPolicy`، `TenantMismatch` |
| `app/Services/Communications/HmacKeyring.php` | مفاتيح مخصّصة، فشل مغلق، HKDF لكل (إصدار، مستأجر) |
| `app/Services/Communications/RequestFingerprinter.php` | بصمة للصف الجديد؛ تحقق بإصدار **الصف المخزّن** |
| `app/Services/Communications/CommunicationOutbox.php` | الإدراج + إعادة التشغيل + التعارض |
| `setup.sh` · `ci.yml` · `deploy/assemble.sh` | قوائم النسخ للمجلد الجديد `app/Services/Communications` |
| 5 ملفات اختبار | Canonicalizer، Keyring، Enqueue، تزامن PostgreSQL، أدوات مشتركة |

## 3. القرارات المعمارية
- **المستأجر موثوق من `TenantContext` فقط**؛ عدم تطابق `intent.tenantId` ⇒ `TenantMismatchException` قبل أي لمس للقاعدة.
- **القيد الفريد `(tenant_id, idempotency_hash)` هو الحكم النهائي.** الفحص المسبق تحسين فقط؛ الإدراج داخل `DB::transaction` (savepoint داخل معاملة محيطة) فلا يُجهَض تعامل PostgreSQL. بعد فشل الإدراج يُعاد البحث: صف موجود ⇒ مقارنة (Replay/Conflict)؛ لا صف ⇒ `CommunicationsStorageException` (لا يتحوّل أبداً إلى تعارض).
- **المقارنة:** نفس المفتاح + نفس البصمة ⇒ `Replayed` بالرسالة القائمة؛ بصمة مختلفة ⇒ `IdempotencyConflictException`؛ صف قديم بلا بصمة ⇒ `IdempotencyUnverifiableException` (لا يُفترض تطابق).
- **Canonicalizer v1:** وسم الإصدار · القناة · التصنيف · العنوان (البريد lowercase) · القالب · `source` · سياسة المتغيرات · المتغيرات مرتبة. **OTP يستثني المتغيرات** (فضاء الرمز صغير فلا بصمة تخمّنه). المستأجر خارج النص ويدخل بالاشتقاق.
- **Keyring:** مفاتيح من `COMMUNICATIONS_HMAC_KEY_<n>` + `COMMUNICATIONS_HMAC_ACTIVE_VERSION`؛ مستقلة عن `APP_KEY` (ترفض المساوي بالترميزين)؛ ≥32 بايت وليست ضعيفة؛ لا توليد ولا قيم افتراضية؛ الاستثناءات بنص ثابت بلا مادة مفتاح. التدوير: التحقق بإصدار الصف المخزّن.
- **OTP:** صف «سجل فقط»: `payload_encrypted = NULL`، `max_attempts = 1`، `recipient_masked` فقط. لا جسر OTP.
- **غير OTP:** الحمولة `{address, variables}` مشفّرة بـcast النموذج.
- **السياسة:** TTL/المحاولات من الإعداد مع تحقق صارم (حدود 30 يوماً / 10 محاولات)؛ `marketing` مرفوض (`CommunicationsPolicyException`) حتى سجل الموافقات (D3/D4).
- **مفتاح التكرار** لا يجوز أن يحمل عنوان المستلم/أرقامه (أو رمز OTP) ⇒ `CommunicationsPolicyException`. (قيد `MessageIntent::KEY_PATTERN` يمنع أصلاً `+` و`@` فيبقى فحص الأرقام.)
- **التسجيل:** عند فشل التخزين يُسجَّل `tenant_id` و`sqlstate` فقط؛ لا حمولة، لا عنوان، لا bindings، ولا يُسلسَل الاستثناء الأصلي.

## 4. الاختبارات
### SQLite
| المجموعة | النتيجة |
|---|---|
| Canonicalizer + Keyring + Enqueue (02-B) | 58 نجح |
| كل `Communication*` + `BranchIsolationGuardTest` | 206 نجح · 36 مُهمَل (اختبارات PostgreSQL فقط) |

### PostgreSQL 16 (محلي)
| المجموعة | النتيجة |
|---|---|
| كل اختبارات `Communication*` + `BranchIsolationGuardTest` (بعد إصلاحات المراجعة) | 242 نجح · 0 مُهمَل |
| تزامن `pcntl_fork` (3 اختبارات: متطابق / مختلف المحتوى / مستأجران) | نجحت (صف واحد فقط، نتيجة واحدة `Created` والباقي `Replayed` أو `Conflict`) |
| `BranchIsolationGuardTest` + OTP + عقود الاتصالات | نجحت |

### المجموعة الكاملة (محلياً)
| المحرّك | النتيجة |
|---|---|
| SQLite | 7147 نجح · 137 مُهمَل · 26 فشل (كلها Fuel: غياب `bcmath` محلياً فقط) |
| PostgreSQL | 7277 نجح · 3 مُهمَل · 30 فشل = 26 Fuel (`bcmath`) + `StorefrontMediaApiTest` (خطأ ربط PDO محلي معروف) + 3 في `PostgresTestLockTimeoutTest` (يتطلب `PGOPTIONS='-c lock_timeout=60s'` كما في `ci.yml`؛ **نجحت 3/3 عند إعادتها به**) |

لا فشل في أي اختبار اتصالات. الإهمال لا يُحتسب نجاحاً.

## 5. التحقق الأمني وعزل المستأجر
- نفس مفتاح التكرار في مستأجرين ⇒ صفان مستقلان؛ لا تسرّب إقرار/تعارض عبر المستأجرين (اختبار تزامن + اختبار عزل).
- لا عنوان خام ولا رمز OTP في أي عمود غير مشفّر ولا في البصمة ولا في الاستثناءات ولا في السجلات (اختبارات صريحة).
- فشل الإعداد (مفتاح مفقود/ضعيف/= APP_KEY/إصدار غير صالح) ⇒ فشل مغلق **قبل** أي إدراج.
- لا استدعاء شبكة ولا ربط لـ`CommunicationProvider` في الحاوية (اختبار).
- لا تغيير على المحاسبة/المصادقة/عزل المستأجر/الأذونات/العقود المدمجة.

## 5ب. مراجعة Codex (جولتان) — عولجت كل الملاحظات
1. **اكتشاف المفاتيح** كان محدوداً بالإصدارات 1..16 رغم أن Schema والـKeyring يقبلان حتى 32767 ⇒ صار الاكتشاف من أسماء متغيرات البيئة (`COMMUNICATIONS_HMAC_KEY_<1..32767>` بلا أصفار بادئة).
2. **استعلام الاسترداد** بعد فشل الإدراج كان يُسرّب `QueryException` خاماً عند انقطاع مستمر ⇒ صار أي فشل بحث (المسار السريع أو الاسترداد) `CommunicationsStorageException` بسجل مُعقَّم واحد (tenant + sqlstate) ودون سلسلة استثناء سابقة.
3. **(جولة 2، P2)** فحص «المفتاح لا يحمل رمز OTP» كان يتجاهل القيم الأقصر من 4 محارف ⇒ رمز من 3 خانات يمرّ في مفتاح تُخزَّن تجزئته بلا مفتاح (تعداد سهل). صار يُرفض أي متغير OTP يطابق **جزءاً كاملاً** من المفتاح (بين `._:-`) بأي طول، أو يظهر **سلسلة فرعية** بطول 3 فأكثر. (قيمة بحرف/حرفين لا تُرفض كسلسلة فرعية لأنها تُسقط كل مفتاح عرضياً.)
4. **(جولة 2، P3)** عند فشل الإدراج بتعارض ثم فشل البحث بانقطاع كان يُسجَّل SQLSTATE الإدراج؛ صار يُسجَّل SQLSTATE البحث الذي أفشل الاسترداد.
اختبارات جديدة/موسَّعة لكل البنود تفشل على الشيفرة السابقة وتنجح بعد الإصلاح.

## 6. CI
تُملأ بعد تشغيل CI على الـHead النهائي (انظر وصف الـPR).

## 7. المخاطر والمتبقي
1. **مفاتيح HMAC غير مضبوطة في أي بيئة**: الخدمة تفشل مغلقة حتى يُضبط مفتاح مخصّص (شرط تفعيل لاحق، ليس ضمن هذا النطاق).
2. **الصفوف القديمة بلا بصمة** (لا صفوف إنتاجية اليوم) ⇒ `Unverifiable` لا تطابق.
3. **لا جدولة ولا عامل ولا إرسال**: الإدراج فقط؛ الرسائل تبقى `queued` حتى شريحة 03-A.
4. **تدوير المفاتيح**: إزالة مفتاح قديم لا يزال مرتبطاً بصفوف يجعل إعادة التحقق تفشل مغلقة؛ لا إعادة تجزئة (لا نملك العنوان الخام).
5. **ترتيب إدراج داخل معاملة أعمال محيطة**: الإدراج يلتزم مع معاملة المستدعي؛ تراجعها يزيل الرسالة (مقصود).

## 8. الخطوة التالية
03-A: Dispatcher (claim/lease/finalize/recovery) بمزوّد وهمي فقط، وأوامر artisan غير مجدولة.

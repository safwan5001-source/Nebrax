# AWJ-HORIZON-MEDIA-STORAGE — S8 Report: فشل كتابة R2 لمركز المستندات في Production

> **الحالة: S6 = BLOCKED — R2 WRITE FAILED.** `DOCUMENT_DURABLE_STORAGE_ENABLED` **مغلق ولن يُفتح** قبل نجاح الكتابة والقراءة والحذف في Production.
> **Branch:** `horizon/media-storage-s8-r2-diagnose` · **Base:** `main` (S6 `11abda9` + S7 `40832b2` منشوران، النشر `efa32d11` SUCCESS قبل تشغيل المالك).

## 1. ما أبلغ عنه المالك (Production، بعد نشر S7)

| الخطوة | النتيجة |
|---|---|
| `flag DOCUMENT_DURABLE_STORAGE_ENABLED` / `runtime driver now` | OFF / local (كما يجب) |
| `bucket` | `awj-documents` |
| `integration_enabled` · `configuration_valid` | PASS · PASS (كل الحقول موجودة؛ لا ينقص endpoint ولا مفتاح) |
| `error` | FAIL (`UnableToWriteFile`) |
| `deleted` · `cleanup_error` | FAIL · FAIL (`UnableToDeleteFile`) |

## 2. التحليل (بلا افتراض أن الفشلين مستقلان)

1. **الكتابة والحذف ليسا مشكلتين مستقلتين.** `DeleteObject` لا يحمل ACL ولا جسماً. فشله **يستبعد ACL سبباً وحيداً**، ويدلّ على فشل على مستوى الطلب نفسه مشترك بين العمليتين: اعتماد/صلاحية دلو/endpoint/عنونة/اتصال. (لو كان ACL وحده، لنجح الحذف — حذف مفتاح غير موجود يعيد نجاحاً على S3 وR2.)
2. **لا كائن يتيم.** الكتابة رمت قبل أن تنجح ⇒ لم يُكتب شيء؛ فشل `deleted` هو الخطأ الجذري نفسه لا أثر «تنظيف» فاشل. لا إجراء تنظيف مطلوب.
3. **ACL احتمال ثانٍ حقيقي لكنه غير مُستبعَد بعد.** فحصتُ مصدر Flysystem-S3 (v3.35.3 مع aws-sdk 3.400.1): `upload()` يحسب `$acl = ... ?? determineAcl()` الذي يعود افتراضياً إلى `private`، و`ObjectUploader` يضع `ACL` دائماً. ⇒ **حذف `visibility` (إصلاح S2) لا يمنع إرسال `x-amz-acl: private`** على PutObject. وثائق Cloudflare تصنّف `x-amz-acl` «غير مُنفَّذ» في PutObject **دون بيان رفضه أو تجاهله**. أي أنّ S2 لم يغلق هذا الاحتمال كما ظُنّ، ولا يمكن إثباته أو نفيه بلا تشغيل فعلي.
4. **فرق عن المسار الناجح.** `R2StorageService` (يعمل في Production للمرفقات) ينشئ `S3Client` مباشرة، **بلا ACL**، وبعنونة `virtual-hosted` (`use_path_style_endpoint=false`)، باعتماد ودلو مختلفين. مركز المستندات: Flysystem (ACL=private دائماً) وافتراضه `path-style=true` وتكامل جديد.

| الفرضية | تتوقع المصفوفة | الإجراء |
|---|---|---|
| اعتماد خاطئ (Secret ≠ Token value، أو Key خاطئ) | كل الطلبات `InvalidAccessKeyId`/`SignatureDoesNotMatch` 403 في النمطين | إعادة إدخال Access Key ID وSecret **من شاشة إنشاء Token نفسها** |
| صلاحية/نطاق الـToken لا يشمل `awj-documents` | `get` و`put` و`delete` ⇒ `AccessDenied` 403 | إصلاح نطاق الـToken: Object Read & Write + **Specify bucket = awj-documents** (وليس الحساب كله بلا دلو) |
| endpoint خاطئ (فيه اسم الدلو/ولاية EU) | `endpoint_has_path: YES` أو `jurisdiction: eu` + `NoSuchBucket` (404) أو 403 | endpoint بلا مسار؛ لدلو EU استعمل عنوان `.eu.` |
| عنونة path-style لا تناسب | `virtual.*` OK و`path.*` FAIL | افتراض `virtual` للتكامل |
| ACL يُرفض (`NotImplemented`) | `put_no_acl` OK و`put_acl_private` FAIL | إصلاح كود: إزالة رأس `x-amz-acl` لمضيف R2 (انظر §4) |
| شبكة/TLS | `FAIL: ConnectException` بلا رمز S3 | فحص خروج الشبكة من الخدمة |

## 3. ما نُفِّذ في هذه الشريحة (تشخيص، بلا تغيير في التشغيل)

- `verifyPlatformConfiguration()`: **كل خطوة مستقلة** (كتابة/وجود/قراءة/حذف) فلا تُخفي الأولى نتيجة الأخريات، وتعيد السبب بلا أسرار: فئة الاستثناء ← **رمز خطأ S3** ← **حالة HTTP** (مثال: `FAIL: UnableToWriteFile ← S3Exception AccessDenied http=403`). لا رسالة خام (قد تحوي عنوان الطلب).
- `diagnosePlatformConfiguration()` (يُستدعى تلقائياً من الأمر **عند الفشل فقط**): بالإعداد المحفوظ نفسه، SDK مباشر (كما يعمل `R2StorageService`) بنمطَي العنونة `path`/`virtual` × (`get` لمفتاح غير موجود — يجب أن يعيد `NoSuchKey` إن كان الاعتماد والدلو سليمين، و`NoSuchBucket` يعني دلو/endpoint خاطئاً؛ استُعمل GET لا HEAD لأن أخطاء HEAD بلا جسم فيتساوى الاثنان (404) — ملاحظة مراجعة · `put` بلا ACL · `put` بـ`ACL=private` · `delete` لكل كائن **بمحاولة مستقلة** فلا يبقى كائن اصطناعي إن فشل الأول) + صفات الـendpoint (مضيف R2؟ فيه مسار؟ ولاية؟ region؟ نمط العنونة المضبوط). كائنات اصطناعية تحت `healthchecks/` وتُحذف.
- الأمر يطبع المصفوفة بعد `--- diagnose (codes only, no secrets) ---`. **لا أسرار** (يُختبر صراحةً).
- `DocumentStorageDiagnoseTest` (4) + تحديث اختبار S6 الذي افترض مفتاح `error`.

## 4. ما لم ألمسه عمداً (حتى يُحدِّد الدليل السبب)

لم أغيّر طريقة الكتابة (Flysystem/ACL/العنونة) ولا قيمة افتراض. تعديل كهذا قبل معرفة السبب تخمين. إن أظهرت المصفوفة أن `put_acl_private` يفشل و`put_no_acl` ينجح فالإصلاح المحدود هو إزالة `x-amz-acl` لمضيف R2 (وسيط طلب على عميل S3 أو بناء المحوّل يدوياً) مع اختبارات — شريحة S9.

## 5. المطلوب من المالك بعد نشر S8

أعد تشغيل `php artisan awj:documents-storage-verify` وأرسل **كامل المخرجات** (رموز وحالات فقط). سأقرأ المصفوفة وأحدّد السبب وأنفّذ الإصلاح الأصغر. إن كان السبب صلاحيات Cloudflare/إعدادات فسأعطيك إجراءً محدداً بلا طلب أي سرّ.

# AWJ-HORIZON-MEDIA-STORAGE — S9 Report: `InvalidArgument` 400 على كل طلبات R2 لمركز المستندات

> **الحالة: S6 ما زال BLOCKED — R2 WRITE FAILED**، لكن السبب صار محصوراً. `DOCUMENT_DURABLE_STORAGE_ENABLED` **مغلق**.
> **Base:** `main` (S8 `d92a365` منشور `276c6ff9`).

## 1. أدلة S8 من Production (المالك)

`endpoint_is_r2_host: yes` · `endpoint_has_path: no` · `endpoint_jurisdiction: default` · `region: auto` · `configured_path_style: true`.
**كل** المجسّات العشرة فشلت بـ**`InvalidArgument` HTTP 400**: `get_missing_key` · `put_no_acl` · `put_acl_private` · `delete` · `delete_acl_object` × نمطَي العنونة `path` و`virtual`.

## 2. التشخيص (من الكود والتهيئة، بلا افتراض أن الاعتماد خاطئ)

| ما استُبعد | لماذا |
|---|---|
| ACL | `get` و`delete` بلا ACL فشلا بالرمز نفسه |
| نمط العنونة | `path` و`virtual` فشلا بالرمز نفسه |
| صياغة endpoint | مضيف R2 صالح، بلا مسار، ولاية افتراضية؛ **نفسه** الشكل الذي يعمل في `R2StorageService` |
| Region | `auto` — القيمة الصحيحة لـR2 وهي ما يستعمله المسار الناجح |
| كود الكتابة/Flysystem | المجسّات تستعمل **AWS SDK مباشرة** (كما يفعل `R2StorageService`) لا Flysystem |
| إصدار SDK/تهيئته | مقارنة سطر بسطر: `S3Client(['version'=>'latest','region','endpoint','use_path_style_endpoint','credentials'=>[key,secret]])` — **متطابقة** في `makeS3Client` و`R2StorageService::client()`. الفرق الوحيد **القيم**: المفتاح والسرّ والدلو |

لذا ما يتبقى خطأ في **قيمة** مشتركة بين كل الطلبات الموقَّعة. وتمييز مهم لرموز R2/S3:

- مفتاح **مجهول بصيغة سليمة** ⇒ `InvalidAccessKeyId` (403)؛ سرّ **خاطئ بصيغة سليمة** ⇒ `SignatureDoesNotMatch` (403).
- **`InvalidArgument` 400 على كل طلب** هو سلوك **معرِّف مفتاح مشوَّه** (طوله ≠ 32 أو فيه فراغ/سطر جديد/محارف غير سداسية): تقارير منشورة تعرض R2 تعيد `InvalidArgument` برسالة «Credential access key has length N, should be 32» بـ400 ([مثال](https://community.transloadit.com/t/cloudflare-r2-invalid-argument/17126)). وثائق Cloudflare تعرّف **Access Key ID = `id` الـToken** و**Secret Access Key = SHA-256 لـ`value` الـToken** ([R2 tokens](https://developers.cloudflare.com/r2/api/s3/tokens/)) — أي أن لصق «Token value» في حقل Access Key ID، أو قيمة مقتطعة/بفراغ لاصق، يطابق هذا العَرَض.

> **الفرضية الراجحة (غير مُثبَتة بعد):** قيمة **Access Key ID** المحفوظة في التكامل ليست معرّفاً سليماً من 32 محرفاً سداسياً. أنا لا أرى القيمة ولا أفترض سببها؛ S9 يثبت أو ينفي ذلك بلا كشف أي قيمة.

## 3. ما نُفِّذ (تشخيص آمن، بلا تغيير في التشغيل)

1. **رسالة S3 المُنقّاة** في كل خطوة فاشلة: عنصر `Message` من استجابة الخدمة (لا رسالة الاستثناء الكاملة التي تحوي عنوان الطلب) بعد تنقية: تُحجب قيم الاعتماد الفعلية إن ظهرت، وأي سلسلة ≥20 محرفاً (أبجدية المفاتيح) تصير `[REDACTED]`، وتُقصّ عند 200. فتظهر عبارة مثل `Credential access key has length 40, should be 32` — **اسم الوسيط غير المقبول** — بلا أي سرّ.
2. **شكل الاعتماد بلا قيمته** (في مصفوفة التشخيص): طول Access Key ID (يُتوقَّع 32) وSecret (64) ونوع المحارف (سداسي) ووجود فراغ/سطر جديد، وهل المفتاح = السرّ، وصلاحية اسم الدلو (3–63 حرفاً صغيراً/رقماً/شرطة). أطوال وأنواع فقط.
3. اختبارات (+3): تنقية الرسالة لا تسرّب · شكل اعتماد مشوَّه يُعلَّم بلا قيمه · شكل سليم يُبلَّغ نظيفاً.

## 4. ما لم أغيّره عمداً

لا تغيير في تخزين المستندات ولا في تحقق الإدخال بشاشة المنصة. إن أكدت S9 أن Access Key ID مشوَّه، فقد يستحق الإدخال **تحققاً عند الحفظ** (R2: 32/64 سداسياً، قصّ الفراغ) يمنع تكرار الخطأ — شريحة منفصلة بعد التأكيد، لأنها تمسّ شاشة المنصة.

## 5. إجراء المالك الآن (لا أسرار تُرسَل)

1. **قارن آخر 4 محارف:** في Cloudflare ← R2 ← Manage API tokens ← الـToken: انظر **Access Key ID** (32 محرفاً). في `/platform/integrations` ← «التخزين الخاص» يظهر تحت الحقل قناع `••••••••xxxx`. **تطابق آخر 4 محارف** يعني أن القيمة المحفوظة هي نفسها (وإلا فهي خطأ).
2. **أعد إدخال الحقلين** من شاشة إنشاء الـToken: **Access Key ID** = المعرّف ذو الـ32 محرفاً (لا «Token value»)، و**Secret Access Key** = السرّ ذو الـ64 محرفاً المعروض **مرة واحدة** عند الإنشاء (لا «Token value»). انسخ بالزر لا بتحديد يدوي (تجنّباً لفراغ/سطر جديد). إن ضاع السرّ فأنشئ Token جديداً بالنطاق نفسه (Object Read & Write على `awj-documents`) وانسخ القيمتين فوراً.
3. شغّل `php artisan awj:documents-storage-verify` وأرسل المخرجات كاملة. بعد نشر S9 ستظهر فيها رسالة S3 المُنقّاة وشكل الاعتماد.

**لا قيود محاسبية · لا migration · لا علم يتغيّر.**

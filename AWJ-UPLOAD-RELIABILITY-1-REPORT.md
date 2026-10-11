# AWJ-UPLOAD-RELIABILITY-1 — تقرير تدقيق موثوقية الرفع والوسائط

> **النوع:** Audit Only — لا تعديل كود، لا Migrations، لا تغيير في Railway، لا Merge، لا Deploy.
> **التاريخ:** 2026-10-11 · **المراجع:** المالك

## 0. بيانات المراجعة

| البند | القيمة |
|---|---|
| Repository | `safwan5001-source/Nebrax` |
| Branch | لا فرع مسمّى — `HEAD` منفصل (detached) عند `main` (= `origin/main`) |
| Base SHA | `4d8e1a66673d970b318514664d383a9c4455e999` (`CUST-HV V8d: gallery content model and Publish rule (#1310)`، 2026-10-11) |
| Head SHA | `4d8e1a66673d970b318514664d383a9c4455e999` (لا commits جديدة؛ الملف الوحيد المضاف هو هذا التقرير، غير مُرتكَب) |
| شجرة العمل قبل/بعد التشغيل | نظيفة (تحقّقت بـ `git status` بعد تشغيل الاختبارات) |

### مستويات الدليل المستخدمة في التقرير

| الرمز | المعنى |
|---|---|
| **[C-CODE]** | مؤكَّد من الكود/الإعدادات في هذا SHA |
| **[C-REPRO]** | مؤكَّد بتجربة تشغيل فعلية في بيئة التدقيق (ليست Production) |
| **[DOC]** | مذكور في وثائق المستودع نفسه، لم أتحقق منه تشغيلياً |
| **[SUSP]** | مشتبه به؛ يحتاج تحققاً تشغيلياً أو من Production |
| **[PROD-UNVERIFIED]** | يتعلق بحالة Production/Railway التي **لا أملك وصولاً إليها** |

> **تنبيه جوهري:** لم يُنفَّذ أي تحقق على Production أو Railway أو Cloudflare. كل ما يخصّ قيم متغيرات Railway الفعلية، وحالة دلو R2، وسجلات Production = **غير متحقَّق منه**. نجاح الاختبارات البرمجية أدناه **لا** يعني أن الرفع يعمل في Production.

---

## 1. الخلاصة التنفيذية

1. **سبب `The media.0 failed to upload.` — مؤكَّد بالآلية، غير مُلاحَظ في Production.**
   صورة Docker (`php:8.3-apache`) **لا تضبط أي `php.ini`** [C-CODE]، فتسري القيم الافتراضية: `upload_max_filesize=2M`، `post_max_size=8M`.
   أي ملف > 2MB (وهو حال أغلب صور iPhone) يصل Laravel بخطأ `UPLOAD_ERR_INI_SIZE`، فيُنتج قاعدة `uploaded` رسالة «The media.N failed to upload.». أعدتُ إنتاج السلوك فعلياً بـ PHP بالإعدادات الافتراضية [C-REPRO] (القسم 5). الحقل `media.*` لا يوجد إلا في رفع صور المنتج (`StoreProductMediaRequest`)، فالعطل المُبلَّغ هو **رفع صور المنتج**.
   وثيقة المستودع نفسها (`CUST-HV-V2A-IMPLEMENTATION-REPORT.md:66`) حذّرت من هذا ولم يُعالَج [DOC].

2. **`STOREFRONT_MEDIA_R2_ENABLED` غير موجود → رفع منشئ المتجر معطّل بالتصميم — مؤكَّد.**
   الافتراضي `false` (`config/storefront_media.php:18`) → `POST /commerce/workspace/storefront-media` يردّ **503 `storage_not_enabled`** → الواجهة تُظهر «رفع الوسائط غير مفعّل لهذا الحساب بعد». هذا fail-closed مقصود وليس عطلاً برمجياً.
   ⚠️ **لكن تفعيل العلم وحده لن يُصلح الرفع**: حدّ 2MB في PHP سيُسقط ملفات منشئ المتجر أيضاً (حدّه 5MB) — فالإصلاح مرتّب: **PHP limits أولاً ثم R2**.

3. **المتانة (Durability) هي الخطر الأكبر.** كل ما لا يمرّ عبر R2 يُكتب على قرص الحاوية الزائل: مرفقات المصروفات والمدفوعات والمشتريات وملاحظات الفواتير وصور الموظفين ومرفقاتهم (مكتوبة بصلابة على `Storage::disk('local')` — لا يوجد مفتاح إعداد يجعلها دائمة)، إضافةً إلى وسائط المنتجات والتصنيفات ما لم تُفعَّل أعلامها. الصفوف تبقى بعد إعادة النشر والملفات تضيع → 404. [C-CODE + DOC]

4. **الواجهة تُخفي السبب:** `extractErrorMessage` يقرأ `message` فقط؛ رسالة إنجليزية خام تظهر في واجهة عربية، و413 بجسم فارغ تصبح «حدث خطأ»، وفشل الشبكة في صور المنتج يظهر «تعذر تحميل ملف المنتج». منشئ المتجر يحوّل كل خطأ (503/413/422) إلى «تعذّر رفع الملف». [C-CODE]

5. **الاختبارات لا تغطي أصل المشكلة:** كل اختبارات الرفع تستخدم `UploadedFile::fake()` أو وضع test (`isValid()` دائماً true)؛ لا اختبار لـ `UPLOAD_ERR_*` ولا HEIC ولا حدود PHP. [C-CODE]

---

## 2. جرد مواضع الرفع الكامل

> الفحص شمل: `app/`، `routes/`، `config/`، `database/migrations/`، `Dockerfile`، `deploy/`، `web/src`، `storefront/`، `mobile/`، `local-hardware-bridge/`. وُجد **17 عنصر رفع في web/** و**15 نقطة دخول في الـ backend**. لا رفع في `storefront/` (إنتاج) ولا `mobile/` ولا `local-hardware-bridge/` ولا App Builder.

### 2.1 جدول الجرد الموحّد (الصور والشعارات والأيقونات والبنرات)

| # | الوظيفة | الشاشة / المكوّن | Endpoint · الحقل | التخزين | الصلاحية |
|---|---|---|---|---|---|
| 1 | صور المنتج | `components/products/product-media-section.tsx` (+`product-workspace.tsx:350`, legacy `product-dialog.tsx:300`) | `POST /api/products/{id}/media` · `media[]` (≤8، 5120KB، jpg/png/webp) | `disk=document` → `DocumentStorageService` → local افتراضياً؛ `r2` إن `PRODUCT_MEDIA_R2_ENABLED` | `products.manage` |
| 2 | صورة التصنيف | `app/(app)/inventory-settings/categories/page.tsx` | `POST /api/product-categories` (+`_method=PUT`) · `image` (5120KB) | `DocumentStorageService`؛ `r2` إن `CATEGORY_MEDIA_R2_ENABLED` | `products.manage` |
| 3 | صورة الموظف | `components/hr/employee-dialog.tsx` | `POST /api/employees/{id}/photo` · `photo` (5120KB) | **`Storage::disk('local')` مكتوب صراحة** | `hr.manage` + `hr.employees` |
| 4 | شعار الشركة | `components/settings/company-dialog.tsx` | `PUT /api/company` · JSON `logo` = data URL PNG (≤512000 حرف) | DB: `tenants.settings.company.logo` | `company.manage` |
| 5 | شعار/ختم/توقيع التصاميم | `components/settings/designs-settings-card.tsx` | `PUT /api/sales-config/designs` · data URLs داخل JSON | DB: `tenants.settings.sales_config.designs` | `company.manage` |
| 6 | مكتبة وسائط منشئ المتجر (بنرات/سلايدر/خلفيات) | `store-experience-builder/media/MediaPicker.tsx` | `POST /api/commerce/workspace/storefront-media` · `files[]` (ملف/طلب، 5MB، ≥320px) | **R2 فقط** (`R2StorageService`) خلف `STOREFRONT_MEDIA_R2_ENABLED` | `commerce.manage` |
| 7 | هوية المتجر (شعار/أيقونة، legacy) | `store-experience-builder/ControlPanels.tsx:749` | ضمن `PUT .../presentation` · `*DataUrl` | DB JSON (يُصفَّر بصمت إن > 512KiB) | `commerce.manage` |
| 8 | شعارات الهوية (مع المكتبة) | `media/LogoMediaSlot.tsx` | يستعمل #6 إن كانت القدرة `available`، وإلا #7 | — | — |

### 2.2 المرفقات والملفات

| # | الوظيفة | الشاشة | Endpoint · الحقل | التخزين · نمط المفتاح | حدود الخادم |
|---|---|---|---|---|---|
| 9 | مرفقات مصروف | `expenses/new/page.tsx` | `POST/PUT /api/expenses` · `attachments[]` | `local` · `expenses/{id}/{hash}` (بلا بادئة tenant) | ≤10 ملفات، 10240KB |
| 10 | مرفقات دفعة | `general-payment-form.tsx`, `document-payment-form.tsx` | `POST /api/payments` · `attachments[]` | `local` · `payments/{id}/…` | نفسه |
| 11 | مرفقات مشتريات | `purchase-form.tsx` | `POST /api/purchases/{id}/attachments` | `local` · `purchases/{id}/…` | نفسه |
| 12 | مرفقات ملاحظة فاتورة | `invoice-note-dialog.tsx` | `POST /api/invoices/{id}/notes` | `local` · `invoices/{inv}/notes/{n}/…` | نفسه |
| 13 | مرفقات موظف | `hr/employees/[id]/page.tsx` | `POST /api/employees/{id}/attachments` | `local` · `employees/{id}/attachments/…` | نفسه |
| 14 | مركز المستندات | `document-center/document-upload-dialog.tsx` | `POST /api/document-batches/{b}/files` · `file` | `DocumentStorageService` (local ما لم `DOCUMENT_DURABLE_STORAGE_ENABLED`) · `tenants/{t}/branches/{b}/…` | 20480KB، ≤10 ملفات/دفعة، فحص magic bytes |
| 15 | مهام الاستيراد | `modules/import-jobs/client.ts` | `POST /api/import-jobs` · `file` | `ImportJobFileStorage` (local افتراضياً، S3 اختياري) · `imports/{tenant}/{job}/original.{ext}` | 5120KB |
| 16 | استيراد منتجات/Workbook/أرصدة افتتاحية | `products/import`, `workbook-import`, `inventory-openings/import` | `/inspect`/`/preview`/`/apply` | ملف PHP مؤقت فقط | 5MB |

### 2.3 ما ليس رفعاً (وُثِّق لقطع الشك)

| العنصر | الحكم |
|---|---|
| ZATCA credentials | نصوص مشفّرة، لا ملفات (`encrypted:array`) |
| App Builder (`ASSET_URL` props) | سلاسل https حرة؛ لا رفع ولا أيقونات تطبيق/Splash في الـ backend |
| Delivery platform `logo_asset_key` | حقل regex بلا مخزن خلفه |
| `readAsDataURL`/`toDataURL` في `invoice-pdf.ts`, `payment-pdf.ts`, `lib/pdf.ts` | تحويل لأغراض PDF فقط |
| `storefront/.../ControlPanels.tsx:514` | حقل legacy يستعمله `src/app/dev/*` فقط |

> لا مسار يستعمل `Storage::disk('public')` ولا `storage:link` ولا `Storage::url/temporaryUrl` [C-CODE]. لا مسار رفع من `mobile/` أو `local-hardware-bridge/`.

---

## 3. حالة كل مسار والأدلة

> «حالة» = تقييم **من الكود والاختبارات** فقط. لا شيء هنا مُتحقَّق منه في Production.

| # | المسار | الحالة | الدليل |
|---|---|---|---|
| 1 | صور المنتج | 🔴 **معطوب عملياً عند ≥2MB** (افتراضات PHP) · 🟠 زائل ما لم يُفعَّل `PRODUCT_MEDIA_R2_ENABLED` | لا `php.ini` (`Dockerfile`)، `StoreProductMediaRequest.php:17-18`، `config/product_media.php`، [C-REPRO] |
| 2 | صورة التصنيف | 🔴 نفس سبب 1 (5MB) · 🟠 زائل ما لم `CATEGORY_MEDIA_R2_ENABLED` | `StoreProductCategoryRequest.php:22`, `ProductCategoryController.php:126-185` |
| 3 | صورة الموظف | 🔴 PHP limit · 🔴 **زائل دائماً** (لا مسار R2) · 🟠 حذف القديم قبل حفظ الجديد | `EmployeeController.php:123-133` |
| 4 | شعار الشركة | 🟢 يعمل (JSON، PNG مصغّر 320px) · 🟡 قد يتجاوز 512000 حرف لصور فوتوغرافية فيُرفض بـ 422 إنجليزي | `UpdateCompanyRequest.php:33`, `lib/image.ts` |
| 5 | تصاميم (شعار/ختم/توقيع) | 🟡 يعمل لكن **بلا تحقق** من النوع/الحجم في الخادم؛ `logo` يتجاوز regex الـ PNG | `SalesConfigController.php:60-63,169-172` |
| 6 | مكتبة منشئ المتجر | ⚪ **معطّلة بالتصميم** (العلم مغلق) · 🔴 وحتى عند فتحه: 2MB يسقط الملفات · 🟡 رسالة الواجهة تقول 20MB والخادم 5MB | `config/storefront_media.php:18,23`, `messages.ts:1222` |
| 7 | هوية legacy | 🟡 تُصفَّر بصمت إن > 512KiB | `StorefrontPresentationNormalizer.php:54,663-665` |
| 9-13 | مرفقات المصروف/الدفعة/المشتريات/الملاحظة/الموظف | 🔴 PHP limit (10MB) · 🔴 **زائلة** · 🟠 لا فحص نتيجة الكتابة | `*Controller` (`->store(…,'local')`)، `filesystems.php:32 throw=false` |
| 14 | مركز المستندات | 🔴 PHP limit (20MB) · 🟠 زائل ما لم `DOCUMENT_DURABLE_STORAGE_ENABLED` · 🟢 أفضل تصميم فحص (finfo، sha256، تنظيف عند الفشل) | `DocumentFileInspector.php:29-67`, `DocumentStorageService.php:124` |
| 15-16 | الاستيراد | 🔴 PHP limit (5MB) · 🟢 ملف عابر للتحليل | `StoreImportJobRequest.php:23-28` |

**دلالة 🔴 «PHP limit»:** حدود الخادم المعلنة (5/10/20MB) أكبر من 2MB الفعلية، فكل مسار منها يفشل لأي ملف في (2MB، حدّه المعلن].

---

## 4. خريطة Frontend → API → Storage → Retrieval

```
صور المنتج
  product-media-section.tsx ──FormData media[]──▶ POST /api/products/{id}/media
     (≤8, ≤5MB, jpeg/png/webp)         │  [PHP: upload_max_filesize 2M ✗ ]  ← نقطة العطل
                                       ▼
                      StoreProductMediaRequest (5120KB, mimes)
                                       ▼
                      ProductMediaService::store ─▶ DocumentStorageService ─▶ local: storage/app/private (زائل)
                                       │                         └─(PRODUCT_MEDIA_R2_ENABLED)─▶ R2 tenant/{t}/product-media/{p}/{uuid}.{ext}
                                       ▼  + مشتقات thumbnail/card (متزامنة، GD)
  عرض: GET /products/{id}/media → download_url ─▶ fetchImageUrl (Bearer) ─▶ blob: URL ─▶ <Image unoptimized>
       (فشل الجلب يُعرض كأيقونة ImageOff + إعادة محاولة)           │
  المتجر العام: GET /store/v1/media/{id}  (بوابة النشر على قناة المتجر، 404 موحّد)

مكتبة منشئ المتجر
  MediaPicker.tsx ─ فحص قدرة: GET /commerce/workspace/storefront-media (meta.uploads_enabled)
        ├─ false/أي خطأ ─▶ "gated": الإدخال معطّل + لافتة
        └─ true ─▶ POST …/storefront-media files[] (ملف/طلب) ─▶ StorefrontMediaService (finfo, 320px-8192px, 5MB, sha256 dedup, quota)
                                   ▼  R2 فقط: tenant/{t}/storefront-media/{id}/original.* + سلّم WebP/JPG
  عرض (مساحة العمل): رابط موقَّع 20 دقيقة (APP_KEY) ─▶ <img src> بلا Authorization
  عرض (عام): /store/v1/media/customizer/{id}/{file}  ← فقط إن أشارت إليه الوثيقة المنشورة، ETag، no-store

مرفقات (مصروف/دفعة/مشتريات/ملاحظة/موظف)
  FormData attachments[] ─▶ Controller ─▶ $file->store(…, 'local') ─▶ storage/app/private (زائل)
  عرض: GET …/attachments/{id} (Bearer) ─▶ $disk->download

شعار الشركة/التصاميم
  canvas → PNG 320px → data URL ─▶ PUT /company | /sales-config/designs ─▶ JSON في tenants.settings (دائم مع قاعدة البيانات)
  ─▶ يُرجَع في كل /me وعلنياً عبر GET /company-browser-identity
```

**ما يبقى بعد إعادة النشر:** (أ) R2 · (ب) PostgreSQL (data URLs). **ما يضيع:** كل ما على `storage/app/private` المحلي [C-CODE/DOC: `deploy/DEPLOY.md:29-31`, `docs/storage.md:102`].

---

## 5. الأعطال المُبلَّغة: الأسباب المؤكدة والاحتمالات غير المحسومة

### 5.1 `The media.0 failed to upload.`

| | |
|---|---|
| **الآلية [C-CODE]** | `Validator.php` (Laravel): إن كان `UploadedFile` غير صالح (`isValid()===false`) وعليه قاعدة ملف → يُضاف فشل `uploaded` = «The :attribute failed to upload.». تعليق Laravel نفسه: «may not successfully upload if they are too large based on PHP's settings». |
| **السبب الجذري [C-CODE]** | لا `php.ini` في `Dockerfile`/`deploy/`/`render.yaml`/`entrypoint.sh` → `upload_max_filesize=2M`. حدّ الواجهة (`MAX 5MB`) وحدّ Laravel (`max:5120`) يسمحان بما يرفضه PHP قبل وصول Laravel. |
| **إعادة الإنتاج [C-REPRO]** | خادم `php -n -S` (القيم الافتراضية 2M/8M): طلب بملفين (1.5MB ثم 3.5MB) → `media[0]` `error=0`، **`media[1]` `error=1` (UPLOAD_ERR_INI_SIZE)** → «media.1 failed to upload». ثلاثة ملفات 3.5MB (مجموع 10.5MB > 8M) → `$_FILES` فارغ → خطأ مختلف («media is required» / 413 حسب الطبقة). مع `upload_max_filesize=6M; post_max_size=48M` نجح الملفان. |
| **الشواهد من المستودع [DOC]** | `CUST-HV-V2A-IMPLEMENTATION-REPORT.md:66`: «The same limit affects Product Media's 5 MB cap today — worth verifying on the live service … I did not edit the Dockerfile.» |
| **لماذا iPhone؟** | صور iPhone عادةً 2–6MB (≥12MP). تقع تحت حدّ الواجهة (5MB) لكن فوق 2MB فتصل «ناجحة» عميلياً وتسقط في PHP. |
| **غير محسوم [PROD-UNVERIFIED]** | (أ) هل في Railway متغير/ملف يضبط `PHP_INI_*`؟ لا أثر له في المستودع لكن لا أرى Railway. (ب) أسباب أخرى لنفس الرسالة: `UPLOAD_ERR_PARTIAL` (انقطاع اتصال خلوي أثناء الرفع)، `UPLOAD_ERR_NO_TMP_DIR/CANT_WRITE` (نادر). (ج) هل الخطأ ظهر من رفع المنتج فعلاً أم عبر مسار آخر بحقل `media`؟ **الحقل `media.*` لا يوجد إلا في `StoreProductMediaRequest`** [C-CODE] فالاحتمال الأرجح قوي. |
| **للحسم** | قراءة `php -i` من الحاوية الحية (`upload_max_filesize`, `post_max_size`) أو سطر سجل `Warning: POST Content-Length … exceeds the limit` (LOG_CHANNEL=stderr). خطوة قراءة فقط، لم أنفّذها. |

### 5.2 `STOREFRONT_MEDIA_R2_ENABLED` غير موجود

| | |
|---|---|
| **أثر الغياب [C-CODE]** | `filter_var(env(..., false))` → `false` → `uploadsEnabled()=false` → `store()` يردّ 503 `storage_not_enabled` قبل لمس الملفات (`CommerceWorkspaceStorefrontMediaController.php:101-103`). لا تراجع إلى القرص المحلي (قرار V0 §7.1 المقصود). |
| **حكم [C-CODE]** | **السلوك صحيح وفق التصميم؛ الغياب = قرار تشغيلي لم يُتّخذ بعد** (بند N-2 في الوثيقة). ليس خللاً برمجياً. |
| **ما لا يكفي** | وجود العلم لا يكفي: يحتاج `R2_ACCESS_KEY_ID/SECRET/BUCKET/ENDPOINT` صالحة (`R2StorageService::settings()` يرمي RuntimeException إن نقص أي منها) **و** رفع حدود PHP (5.1). |
| **غير محسوم [PROD-UNVERIFIED]** | هل متغيرات `R2_*` موجودة في Railway لـ `nibras-api`؟ `docs/storage.md:70-74` تذكر نجاح smoke test إنتاجي سابقاً (AWJ-R2-3) [DOC]؛ لم أعد التحقق. لا وثيقة تسرد مجموعة متغيرات Railway الكاملة، و`render.yaml` قديم مقابل Railway. |

### 5.3 «تعطيل رفع الوسائط في منشئ المتجر» — السلسلة الكاملة [C-CODE]

1. `use-media-capability.ts:25-36` يستدعي `GET /commerce/workspace/storefront-media` ويقرأ `meta.uploadsEnabled`.
2. `storefront-media.ts:107` يشترط `uploads_enabled === true` حرفياً (غياب الحقل = معطّل).
3. **أي** فشل (401/403/5xx/شبكة) يُترجَم إلى `"gated"` (`.catch → "gated"`) ويُخزَّن 60 ثانية على مستوى الوحدة دون ربط بالمستأجر → خطأ عابر يخفي المكتبة بلا رسالة سبب.
4. `LogoMediaSlot.tsx:60`: gated ⇒ يعرض التحكم legacy (data URL) بلا أي إشعار.
5. `MediaPicker`: gated ⇒ لافتة «غير مفعّل لهذا الحساب» (والسبب فعلياً علم بيئة وليس الحساب)، وتعطيل الإدخال، والإفلات (drag-drop) يُتجاهل بصمت.

### 5.4 أعطال أخرى مؤكدة أثناء التدقيق

| # | العطل | الأثر | الدليل |
|---|---|---|---|
| F1 | رسائل Laravel الإنجليزية الخام في واجهة عربية؛ لا قراءة لـ `errors{}`؛ لا تعيين لـ 413/422/`storage_not_enabled` | المستخدم لا يعرف السبب | `lib/api.ts:38-47,110-113` |
| F2 | فشل شبكة/غير-ApiError في صور المنتج → «تعذر تحميل ملف المنتج» | رسالة مضلّلة | `product-media-section.tsx:147` |
| F3 | رفع الوسائط بعد إنشاء المنتج: `catch {}` يبتلع السبب ثم **يمسح الملفات المعلّقة** | يُعاد اختيارها يدوياً دون معرفة السبب | `product-workspace.tsx:353-358` |
| F4 | ملف HEIC/غير معروف يمرّ `mimes`/الامتداد ثم يفشل توليد المشتقات → **503** برسالة «تحقق من إعداد التخزين» (مضلّلة) + ملفات سابقة في نفس الطلب تبقى محفوظة | رسالة خاطئة + حفظ جزئي | `ProductController.php:632-633`, `ProductMediaService.php:100-148` |
| F5 | نص الواجهة «حتى ٢٠ ميغابايت» مقابل 5MB فعلية؛ حد 320px الأدنى غير مذكور | رفض لا يفهمه المستخدم | `messages.ts:1222`, `storefront_media.php:23-24` |
| F6 | لا حد حجم/نوع في عميل منشئ المتجر ولا موظف ولا مرفقات (باستثناء المشتريات والمستندات) | الرفض يأتي متأخراً من الخادم | `MediaPicker.tsx`, `employee-dialog.tsx`, … |
| F7 | `.slice(0,10)` صامت للمرفقات (5 مواضع) | فقدان ملفات دون إشعار | `expenses/new/page.tsx:119`, … |
| F8 | لا مهلة ولا إلغاء لأي رفع؛ 401 أثناء الرفع يعيد التوجيه لـ `/login` ويفقد الحالة | تعليق/فقدان بيانات | `lib/api.ts:102-108` |
| F9 | شعار الشركة data URL > 512000 حرف → 422 إنجليزي | رفض لشعار فوتوغرافي | `UpdateCompanyRequest.php:33` |
| F10 | شعارات legacy تُصفَّر بصمت فوق 512KiB | يختفي الشعار | `StorefrontPresentationNormalizer.php:663-665` |
| F11 | صورة موظف: لا cache-bust ولا `.catch` عند الاستبدال | قد تظهر الصورة القديمة | `employee-dialog.tsx:245` |
| F12 | `PosProductImage` يبتلع كل الأخطاء ويعرض شعار الشركة | صورة تالفة = «لا صورة» | `pos-product-image.tsx:184-253` |

---

## 6. فحص النوع والحجم وحدود PHP/Laravel وiPhone

### 6.1 الأنواع والأحجام

| المسار | الصيغ | الحجم | فحص المحتوى |
|---|---|---|---|
| صور المنتج | jpg/jpeg/png/webp (`mimes`) | 5120KB ×≤8 | **لا** `image`/`dimensions`؛ المحتوى يُفحص ضمنياً عند توليد المشتقات (GD) |
| التصنيف/الموظف | + قاعدة `image` | 5120KB | `image` فقط |
| مكتبة المتجر | JPG/PNG/WebP بـ finfo | 5MB، 320–8192px، ≤40MP، ميزانية فك 256MB | **الأقوى**: magic bytes، رفض المتحرك والمبتور، EXIF بلا امتداد exif |
| المرفقات | pdf/doc/docx/xls/xlsx/csv/jpg/jpeg/png/gif/zip (`mimes`) | 10240KB ×≤10 | امتداد/`mimes` فقط (لا finfo) [SUSP: اعتماد جزئي على الامتداد] |
| مركز المستندات | pdf/jpg/png/webp | 20480KB، ≤10/دفعة | **قوي**: finfo + تطابق الامتداد + حدود الأبعاد + sha256 |
| الاستيراد | csv/txt/xlsx | 5120KB | امتداد العميل يحدد المحلّل؛ حراسة ZIP/XXE جيدة |

### 6.2 حدود PHP الفعلية (استنتاج من غياب الإعداد [C-CODE] + تأكيد القيم الافتراضية [C-REPRO])

| الإعداد | الفعلي | المطلوب الأدنى لتحمّل الحدود المعلنة | ملاحظة |
|---|---|---|---|
| `upload_max_filesize` | **2M** | **20M** (مركز المستندات) | 5MB للصور، 10MB للمرفقات |
| `post_max_size` | **8M** | **≥128M** (10×10MB مرفقات = 100MB نظرياً)؛ 48M تكفي الصور فقط | |
| `max_file_uploads` | 20 | 20 كافٍ (الحد الأقصى 10) | |
| `memory_limit` | 128M | 256M (فكّ صورتين كاملتين لكل مشتق + ميزانية 256MB في المكتبة) | GD يخصّص خارج `memory_limit` لكن الحاوية محدودة |
| `max_execution_time` | 30s (mod_php) | 60–120s | المشتقات متزامنة (`QUEUE_CONNECTION=sync`)؛ التقرير V2B يذكر عدم قياسه في Production |
| Apache `LimitRequestBody` | بلا حد | — | لم يُعدَّل |
| مهلة وكيل Railway | غير موثقة | — | [PROD-UNVERIFIED] |
| Next/Vercel | **لا أثر**: الواجهة تتصل مباشرة بـ `NEXT_PUBLIC_API_URL` ولا rewrites/middleware | — | حد 4.5MB لـ Vercel لا ينطبق [C-CODE] |

### 6.3 iPhone / HEIC

- **لا أي معالجة HEIC/HEIF** في الواجهة أو الخادم؛ لا `imagick`/libheif؛ GD بلا AVIF/HEIF [C-CODE].
- Safari على iOS يحوّل HEIC إلى JPEG غالباً عند الاختيار من مكتبة الصور مع `accept` المقيّد، **أما الاختيار من «الملفات» فقد يمرر HEIC خاماً** — سلوك المنصة، **غير مُتحقَّق منه على جهاز** [SUSP].
- الأثر الحالي لـ HEIC خام: المنتج → رسالة تحقق إنجليزية أو 503 مضلّلة (F4)؛ منشئ المتجر → `unsupported_type` بنص عربي واضح (لكنه يُبتلع في الواجهة F-منشئ)؛ `designs-settings-card` يقبل `image/*` فيفشل فك الترميز على غير Safari.
- **لا مشكلة EXIF/دوران** في مكتبة المتجر: قارئ اتجاه JPEG مدمج لغياب امتداد exif (الصورة الإنتاجية لا تثبّته) ومُختبَر بالاتجاهات 1–8. لصور المنتج لا اختبار دوران [C-CODE].

---

## 7. العرض بعد الحفظ وإعادة فتح الصفحة، وصلاحية الروابط بعد إعادة النشر

| الحالة | السلوك | الحكم |
|---|---|---|
| صور المنتج (R2 مفعّل) | blob عبر Bearer، يُعاد جلبها عند فتح الصفحة | تدوم بعد إعادة النشر |
| صور المنتج (افتراضي، قرص محلي) | الصف يبقى والملف يضيع → `404 ملف الوسيط غير موجود` → أيقونة ImageOff | **تضيع بعد إعادة النشر/استبدال الحاوية** [DOC `docs/storage.md:102`] |
| مرفقات/صور موظف | نفسه ولا مسار R2 | تضيع |
| مكتبة المتجر | رابط موقَّع كل مرة؛ التوقيع مرتبط بـ `APP_KEY` | تدوم إن ثبت `APP_KEY`؛ **إن غاب `APP_KEY` يُولَّد مفتاح مؤقت عند كل إقلاع** (`entrypoint.sh`) فتبطل الروابط الموقعة القديمة، وتتعذّر قراءة أعمدة `encrypted` (بيانات ZATCA) [C-CODE؛ حالة Railway: PROD-UNVERIFIED] |
| روابط موقَّعة 20 دقيقة بلا `onError`/تجديد | جلسة تحرير طويلة تُكسَر الصور بصمت | [SUSP] |
| روابط موقَّعة خلف الوكيل | لا `TrustProxies`/`forceScheme` في المستودع؛ الاعتماد على هيكل Laravel 11 الافتراضي | [SUSP: قد يُولَّد `http://` فيُحجب كمحتوى مختلط أو يفشل التوقيع] |
| شعار الشركة/التصاميم | في قاعدة البيانات | يدوم |
| `fetchImageUrl` | يعيد `null` بصمت عند أي فشل؛ لا cache-bust | تشخيص ضعيف |
| مخبأ شعار POS | مُفتَّح بالـ token فقط | قد يظهر الشعار القديم حتى إعادة تحميل [SUSP] |

---

## 8. Tenant Isolation وصلاحيات الملفات العامة والخاصة

### 8.1 النتيجة العامة [C-CODE]
لا ثغرة عزل مباشرة وُجدت في مسارات الرفع/التنزيل: كلها تمرّ عبر نماذج `BaseModel`+`TenantScope` (`findOrFail` يُقيَّد بالمستأجر)، و`R2StorageService::key` **fail-closed** (يرمي بلا tenant، مقاطع آمنة، المستأجر من `TenantContext` فقط). مكتبة المتجر: dedup داخل المستأجر فقط، 404 موحّد للأجنبي، الرابط الموقَّع يضمّن `tenant` ويُعاد التحقق منه يدوياً. الاختبارات تغطي العزل في أغلب المسارات.

### 8.2 جدول الملفات العامة والخاصة

| المسار | الوصول | الضابط |
|---|---|---|
| تنزيل ميديا المنتج الداخلية | Bearer + `products.view` | tenant scope |
| `GET /commerce/workspace/storefronts/{id}/media/{m}` | **عام** بتوقيع 20 دقيقة | `signed` + تحقق يدوي من tenant + نشر على قناة المتجر؛ يخدم **الأصل** |
| `GET /store/v1/media/{id}` | عام | منشور على قناة المتجر المحلولة، وإلا 404 |
| `GET /store/v1/media/customizer/{id}/{file}` | عام | وثيقة **منشورة** فقط، `private, no-store` + ETag |
| `GET /company-browser-identity` | **عام بلا مصادقة** (throttle 60/د) | يُرجع الشعار كاملاً حسب المضيف (مقصود) |
| مرفقات المصروف/الدفعة/…/الموظف | Bearer + صلاحيات الوحدة | tenant scope |
| مركز المستندات | رابط موقَّع 5 د + Bearer + فرع + فحص أمني CLEAN | `nosniff`, `no-store` |
| الاستيراد | لا يُرجع الملف للعميل | — |

### 8.3 مخاطر أمنية (مرتّبة)

| # | الخطر | الشدة | الحالة |
|---|---|---|---|
| SEC-1 | `sales-config/designs`: `logo`/`stamp`/`signature` **بلا تحقق نوع/حجم/regex**؛ `logo` يُكتب إلى `company.logo` متجاوزاً regex الـ PNG ثم يُنشر علناً عبر `company-browser-identity` ويضخّم كل `/me` | متوسطة | [C-CODE] `SalesConfigController.php:60-63,169-172` |
| SEC-2 | مفاتيح التخزين المحلية للمرفقات/الموظفين بلا بادئة tenant؛ العزل يعتمد على tenant scope للأب ومعرّف غير قابل للتخمين | منخفضة | [C-CODE] |
| SEC-3 | تنزيلات المرفقات وصورة الموظف بلا `X-Content-Type-Options: nosniff`؛ و`mimes` قد يعتمد جزئياً على الامتداد، ولا finfo خلفه | منخفضة–متوسطة | [SUSP] |
| SEC-4 | الرابط الموقَّع للمساحة يخدم **الأصل** غير المنقّى (EXIF/GPS) لـ 20 دقيقة؛ و`/commerce/v1/media/{id}` يخدم الأصل | منخفضة (خصوصية) | [C-CODE] |
| SEC-5 | الامتداد من العميل داخل مفتاح التخزين (منتج/تصنيف/استيراد): `import_jobs.extension` varchar(10) فيفشل الإدراج ويبقى ملف يتيم | منخفضة | [C-CODE] |
| SEC-6 | `ImportJob.error_message = $e->getMessage()` يُعاد للعميل (تسريب تفاصيل داخلية محتمل) | منخفضة | [C-CODE] |
| SEC-7 | `TenantScope` يفشل مفتوحاً بلا سياق tenant (`ImportJobService` يحوّل null إلى `''`)؛ تصميم قائم لا خاص بالرفع | معلوماتية | [C-CODE] |
| SEC-8 | `APP_KEY` المؤقت عند الإقلاع يكسر التوقيع والتشفير بعد كل نشر | عالية **مشروطة** | [PROD-UNVERIFIED] |
| SEC-9 | SVG: لا يُقبل في أي رفع ضمن النطاق؛ محجوب صراحة في هوية المتجر؛ غير محجوب صراحة في designs/logo (لكن regex الشعار يقتصر على PNG) | منخفضة | [C-CODE] |

---

## 9. الاستبدال والحذف والملفات المشتركة

| الحالة | السلوك الحالي | الحكم |
|---|---|---|
| **مكتبة المتجر — حذف** | `StorefrontMediaReferenceScanner` يمنع حذف أصل مُشار إليه (409 مع قائمة الاستخدام، يشمل المسودات والنسخ والمنشور)؛ حذف ناعم + `purge_after` 30 يوماً؛ مصالِح لاحق | 🟢 **النموذج المرجعي** |
| مكتبة المتجر — dedup | نفس sha256 داخل المستأجر = نفس الأصل → أصل واحد لعدة مواضع محمي بالمرجع أعلاه | 🟢 |
| مكتبة المتجر — استبدال | لا عملية استبدال بايتات؛ تعديل الاسم/alt فقط | 🟢 (لا خطر) |
| وسائط المنتج — حذف | المشتقات ثم الأصل (فشل → 503 والصف يبقى) ثم الصف | 🟢 ترتيب آمن |
| وسائط المنتج — مشاركة | كل صف يملك ملفاً فريداً (uuid) فلا مشاركة؛ `image_media_id` على قيمة الخيار `nullOnDelete` | 🟢 |
| وسائط المنتج — سباق الحد 8 | count ثم insert بلا قفل | 🟡 [SUSP] |
| التصنيف — استبدال | كتابة الجديد ← تحديث الصف ← حذف القديم (best-effort) | 🟢 |
| التصنيف — إنشاء | الصف يُنشأ ثم تُرفع الصورة؛ فشل الصورة 503 يترك تصنيفاً بلا صورة، وإعادة المحاولة قد تصطدم باسم مكرر | 🟡 |
| **الموظف — استبدال الصورة** | **حذف القديم ثم حفظ الجديد** | 🔴 فشل الحفظ يُضيع الصورتين |
| **الموظف — حذف** | حذف الصورة قبل `$employee->delete()` | 🔴 فشل الحذف (FK) يُضيع الصورة |
| كل المرفقات | الكتابة ثم إنشاء الصف بلا تنظيف عند فشل DB؛ نتيجة `->store()` لا تُفحص (`throw=false` ← `path=false`) | 🔴 ملفات يتيمة/مسار فارغ |
| حذف مسودة فاتورة | تُحذف صفوف مرفقات الملاحظات (cascade) وتبقى الملفات | 🟠 يتامى |
| استبدال R2 backfill | لا ينسخ المشتقات؛ بعد الترحيل تُخدَّم الأصول بدل المصغّرات | 🟡 |
| مرفق مشتريات مرحَّلة | الرفع مسموح بعد الترحيل، الحذف للمسودة فقط | 🟢 (يحفظ أثر التدقيق) |
| ملاحظات الفواتير | لا مسار حذف | 🟢 |

---

## 10. مخاطر محاسبية وتشغيلية

- **أثر الأدلة المحاسبية:** مرفقات المصروفات والدفعات والمشتريات وملاحظات الفواتير هي المستندات الداعمة لقيود مرحّلة. فقدانها بعد إعادة النشر يكسر أثر التدقيق رغم بقاء القيد (المحرك `LedgerService` غير متأثر — لم أجد أي مسار رفع يكتب قيوداً أو يمسّ `journal_lines`). فهي مخاطرة **توثيق/امتثال** لا **اتزان قيود**.
- **الاحتفاظ:** `DOCUMENT_RETENTION_DAYS` يطبّق سياسة احتفاظ على مركز المستندات فقط؛ لا سياسة موازية ولا نسخ احتياطي لمرفقات القرص المحلي.
- **الإيقاف الجزئي للأوضاع:** رفع مرفقات المشتريات المرحَّلة مسموح بينما حذفها للمسودة فقط — سلوك سليم محاسبياً لكنه غير موثق في الواجهة.
- **ZATCA:** لا ملفات؛ لكن `encrypted:array` يعتمد على ثبات `APP_KEY` (SEC-8).
- **التشغيل:** `QUEUE_CONNECTION=sync` ولا worker → المشتقات والسلالم تُولَّد داخل الطلب بحد 30 ثانية.
- **انحراف CI/Production:** CI يعمل على PHP 8.4 مع `intl`؛ الإنتاج 8.3 بلا `intl`؛ `runtime-smoke.yml` لا يختبر حدود الرفع.

---

## 11. الاختبارات الموجودة والفجوات

### 11.1 ما نُفِّذ فعلاً في هذا التدقيق

| الحزمة | الأمر | النتيجة |
|---|---|---|
| **PHPUnit — تشغيل 1** (بيئة التدقيق، SQLite، تجميعة Laravel 11 خارج المستودع) | `php artisan test --filter='ProductMedia\|CategoryMedia\|StorefrontMedia\|R2\|CompanyLogo\|EmployeeAttachments\|CommerceMediaApi\|CommerceWorkspaceMedia\|DocumentCenterSecureIntake\|ImportJob\|InventoryOpeningImport\|ProductBarcodeAndMedia\|PosVariantMedia\|StorefrontCustomizerMedia\|StorefrontSlider'` | **385 نجح · 90 فشل · 5 تخطّي** — **كل الإخفاقات بيئية**: التجميعة المحلية خلت من `aws/aws-sdk-php` (`Class "Aws\Exception\AwsException" not found` ×10، و72 `Undefined array key "data"` ناتجة عن سقوط الرفع نفسه). الإنتاج وCI يثبّتان `league/flysystem-aws-s3-v3` (`deploy/assemble.sh:20`). **ليس عيباً في المنتج.** |
| **PHPUnit — تشغيل 2** بعد تثبيت `league/flysystem-aws-s3-v3` في التجميعة المحلية (خارج المستودع) | نفس المرشّحات | **384 نجح · 1 تخطّي · 0 فشل** (2562 assertion، 214 ثانية). المرشّح أضيق قليلاً من التشغيل 1 (استُبعدت `ImportJob*`/`InventoryOpeningImport`/`StorefrontCustomizerMedia`)، والمستبعد لم يكن ضمن الإخفاقات البيئية. **لم يُشغَّل `php artisan test` الكامل** (المطلوب قبل أي PR وفق CLAUDE.md؛ هذا تدقيق بلا PR). |
| **Vitest (الواجهة)** | `npx vitest run` على 113 ملف اختبار تخص: product-workspace، store-experience-builder (MediaPicker وغيره)، storefront-media-client، purchase-form، document-center/intake، import pages، inventory-openings، mock-product-media | **113 ملفاً · 1921 اختباراً — كلها نجحت** |

> ⚠️ **نجاح هذه الاختبارات لا يثبت أن الرفع يعمل في Production**: كلها تستعمل ملفات مزيفة بلا `UPLOAD_ERR_*`، و`Storage::fake`/R2 مُحاكى، وبلا حدود PHP حقيقية.

### 11.2 الفجوات (مرتّبة حسب الأثر)

| # | الفجوة |
|---|---|
| T1 | **لا اختبار لـ `UPLOAD_ERR_INI_SIZE/FORM_SIZE/PARTIAL`** ولا `$_FILES` الفارغ عند تجاوز `post_max_size` (بحث `UPLOAD_ERR`/`upload_max`/`post_max` في `tests/` = صفر). فرع `upload_failed` في المتحكم غير مُختبَر (وهو أصلاً غير قابل للوصول لأن `files.*` `file` يفشل أولاً بـ 422). |
| T2 | لا اختبار HEIC/iPhone في أي طبقة |
| T3 | رفع صور المنتج: لا اختبار > 5MB، > 8 ملفات/طلب، نوع مرفوض، صورة تالفة تمر `mimes` (F4)، حدود الأبعاد |
| T4 | لا اختبار فشل R2 في منتصف دفعة منتج متعددة الملفات |
| T5 | لا اختبار دوام ما بعد إعادة النشر للتخزين المحلي |
| T6 | لا اختبار استبدال/حذف أصل مشترك بين عدة متغيرات للمنتج |
| T7 | `CategoryMediaR2Test` اختباران فقط؛ لا رفض حجم/نوع |
| T8 | لا اختبار حجم لمرفقات الـ 10MB، ولا لحد `max:512000` للشعار، ولا لغير-PNG |
| T9 | لا اختبار لـ `sales-config` (شعار/ختم/توقيع) تحققاً |
| T10 | الواجهة: لا اختبار لرفع التصنيف/صورة الموظف/شعار الشركة/designs؛ لا محاكاة 413/422/503 في `MediaPicker` أو صور المنتج؛ لا اختبار عرض «failed to upload» |
| T11 | E2E: لا اختبار رفع فعلي (`cust-hv-v4b-media.spec.ts` بصري فقط)؛ لا اختبار موبايل/iOS |
| T12 | CI `runtime-smoke` لا يتحقق من `php -i` للحدود |
| T13 | لا اختبار تكامل بحدود PHP حقيقية (Apache+mod_php) |

---

## 12. المتبقي غير المحسوم (يحتاج وصولاً تشغيلياً)

| # | السؤال | كيف يُحسم (قراءة فقط) |
|---|---|---|
| U1 | القيم الفعلية لـ `upload_max_filesize`/`post_max_size` في الحاوية الحية | `php -i` داخل الحاوية أو سجل التحذير |
| U2 | هل `R2_*` مضبوطة في Railway وهل ما زال الدلو `awj-production` صالحاً؟ | عرض أسماء المتغيرات (دون قيمها) + `php artisan awj:r2-smoke-test` (أمر يدوي موثق) — يكتب/يحذف كائناً مؤقتاً، فيحتاج موافقتك |
| U3 | قيم `PRODUCT_MEDIA_R2_ENABLED` و`CATEGORY_MEDIA_R2_ENABLED` و`DOCUMENT_DURABLE_STORAGE_ENABLED` | أسماء/قيم Boolean من Railway |
| U4 | هل `APP_KEY` مضبوط؟ هل يوجد Volume مركّب على `storage/app`؟ | إعدادات Railway |
| U5 | هل يتعامل Safari/iOS مع `accept` بتحويل HEIC فعلاً في بيئة المستخدمين؟ | اختبار جهاز |
| U6 | مهلة وكيل Railway وحد جسمه | وثائق/إعدادات Railway |
| U7 | سلوك `mimes` مع الامتداد المزيَّف في إصدار Laravel المثبَّت | اختبار صغير (يمكن إضافته في المرحلة 4) |
| U8 | عدد الصفوف اليتيمة الحالية (ملف مفقود لصف قائم) | استعلام قراءة فقط على Production |

---

## 13. اقتراح بنية رفع مشتركة قابلة لإعادة الاستخدام

> **المبدأ:** لا مكتبة مرئية جديدة، ولا إعادة بناء. استخراج ما هو موجود فعلاً وأفضل نموذج لدينا (مكتبة المتجر + مركز المستندات + `R2StorageService`) إلى طبقة صغيرة تُعتمد تدريجياً مسارٌ بعد مسار.

### 13.1 الخادم

| المكوّن | الوظيفة | يعتمد على الموجود |
|---|---|---|
| `UploadProfile` (config `uploads.php`) | تعريف واحد لكل نوع: `kind`, `max_kb`, `max_files`, `mimes` بالـ finfo، حدود الأبعاد/البكسل، `storage: r2\|document`، `public: false` | يوحّد 6 قواعد FormRequest متفرقة |
| `InspectsUploadedFile` | فحص magic bytes + تطابق الامتداد + الأبعاد + اكتمال الذيل + رفض المتحرك/SVG | يُستخرج من `StorefrontMediaService::inspect` و`DocumentFileInspector` |
| `ManagedFileStore` (واجهة) + محوّلات `R2`/`Document` | `put` يرمي عند الفشل (لا `false` صامت)؛ المفتاح من الخادم فقط؛ **الامتداد من النوع المكتشف لا من العميل** | غلاف رقيق على `R2StorageService` و`DocumentStorageService`؛ التفرّع بـ `disk` المخزّن كما في المنتج الآن |
| `UploadOutcomeError` + **وسيط `NormalizeUploadErrors`** | يحوّل `UPLOAD_ERR_*` و`$_FILES` الفارغ (`CONTENT_LENGTH > post_max_size`) و413 إلى JSON ثابت: `{code, message(ar), limits:{max_kb, post_max}}` بدل «failed to upload» | يعالج F1/F4 في نقطة واحدة |
| `GET /api/uploads/capabilities` | يعيد **الحد الفعّال** = min(`config`, ini) + حالة R2 لكل نطاق (`product_media`, `storefront_media`, …) دون أسرار | يحلّ إشكال الإعلان 20MB/5MB/2MB ويُغني الواجهة عن الاستنتاج من فشل |
| نمط الترتيب | رفع جديد: (1) كتابة مفحوصة (2) صف DB في معاملة (3) عند فشل 2 → حذف الكتابة. استبدال: جديد ثم تحديث الصف ثم حذف القديم best-effort (نموذج التصنيف). حذف: ملف ثم صف للمقدّسات، أو صف ثم ملف مع سجل يتامى (نموذج المرفقات) | يوحّد 3 أنماط متضاربة |
| `awj:uploads-doctor` (Artisan، قراءة فقط) | يطبع حدود PHP الفعلية، حالة الأعلام (أسماء فقط)، وجود `R2_*`، `APP_KEY`، امتدادات GD/fileinfo/exif، ويقارنها بالحدود المعلنة | لتحقق Production دون تخمين |
| `awj:uploads-orphans` (قراءة فقط) | صفوف بلا ملف وملفات بلا صف | يقيس U8 |

### 13.2 الواجهة (دون واجهات جديدة)

| المكوّن | الوظيفة |
|---|---|
| `mapUploadError(err)` في `lib/api.ts` | يقرأ `errors{}` و`code` ويعيّن 413/422/503 إلى رسائل عربية/إنجليزية عبر i18n؛ يعيد نوع خطأ للشبكة بدل `TypeError` |
| `validateImageFile(file, profile)` | فحص عميل موحّد (النوع، الحجم، الحد الأدنى للأبعاد) يقرأ حدود `/uploads/capabilities` |
| `useUpload()` hook | مهلة + `AbortController` + تقدم + تتبّع لكل ملف + إعادة محاولة؛ يحتفظ بالملفات عند الفشل (يعالج F3/F8) |
| تطبيع صور الصور الفوتوغرافية | توسيع `lib/image.ts` الموجود: `createImageBitmap → canvas → JPEG/WebP` بجودة ثابتة وحد أقصى للبعد قبل الرفع؛ **يحلّ HEIC من Safari ويُخفّض حجم صور iPhone دون تعديل Dockerfile** كطبقة دفاع ثانية (لا بديل عن رفع حدود PHP) |
| إدخال `<input>` الحالي | يبقى كما هو؛ يُغلَّف فقط |

### 13.3 ما لا تفعله البنية (حدود)
لا تنقل بيانات القائمة؛ لا تغيّر عقود الـ Commerce (SalesChannel/PaymentIntent…)؛ لا تمسّ `LedgerService`؛ تعتمد التفعيل عبر Settings بافتراض يحمي القائم (قاعدة «السياسة تُضبط»).

---

## 14. خطة الإصلاح المرحلية

> كل مرحلة = PR مستقل صغير. تتطلب موافقتك قبل أي تنفيذ؛ هذا التدقيق لم ينفّذ شيئاً منها.

### المرحلة 0 — تثبيت الحقيقة في Production (قراءة فقط · 0 كود)
**الإجراءات:** U1–U8 أعلاه. **القرار المطلوب منك:** السماح بتنفيذ `awj:r2-smoke-test` وقراءة أسماء المتغيرات.
**القبول:** جدول موقَّع بالقيم الفعلية (دون أسرار) مرفق بالتقرير.

### المرحلة 1 — Hotfix حدود PHP (أولوية قصوى · تغيير تشغيلي صغير)
**المحتوى:** ملف `docker-php-ext`/`conf.d/awj-uploads.ini` في `Dockerfile` (قرار تشغيلي يخصّك — لم أعدّل شيئاً):

```ini
upload_max_filesize = 20M
post_max_size       = 128M
max_file_uploads    = 20
memory_limit        = 256M
max_execution_time  = 120
```
(تُشتق القيم من أعلى حدود معلنة: مستندات 20MB؛ مرفقات 10×10MB.) وتأكد من مهلة/حد جسم وكيل Railway.
**القبول:** (أ) `php -i` في الحاوية يطابق القيم؛ (ب) رفع صورة 4.5MB لمنتج من iPhone ينجح؛ (ج) رفع ملف 25MB يردّ برسالة عربية واضحة لا «failed to upload»؛ (د) `runtime-smoke.yml` يتحقق من القيم.
**الاختبار:** اختبار تكامل يحقن `UPLOAD_ERR_INI_SIZE` وآخر يفحص `ini_get`؛ ويدوي على iPhone.

### المرحلة 2 — سطح الأخطاء (الواجهة + وسيط خادم)
**المحتوى:** `NormalizeUploadErrors` + `mapUploadError` + ربط رسائل `storage_not_enabled`/413/422؛ إصلاح F2/F3/F5/F7؛ تصحيح 503 المضلّل في F4 إلى 422 برمز `unsupported_image`/`corrupt_image`؛ تنظيف ملفات الطلب الجزئي.
**القبول:** كل سيناريو فشل يُظهر سبباً عربياً محدداً؛ لا رسالة «The … failed to upload» تصل المستخدم؛ الملفات المعلّقة لا تُمسح عند الفشل.
**الاختبار:** PHPUnit لـ T1/T3؛ Vitest لـ T10 (413/422/503).

### المرحلة 3 — المتانة (Durability)
**المحتوى (بالترتيب، كل خطوة بعلم وقابلة للتراجع):**
1. التحقق من `R2_*` (smoke test) ثم `PRODUCT_MEDIA_R2_ENABLED=true`، `CATEGORY_MEDIA_R2_ENABLED=true`، ثم `STOREFRONT_MEDIA_R2_ENABLED=true` — **بعد المرحلة 1**.
2. قرار منك: المرفقات/الموظفون → إما ترحيلها إلى `DocumentStorageService` (ثم `DOCUMENT_DURABLE_STORAGE_ENABLED`) أو Railway Volume كحل مؤقت.
3. أمر backfill للمرفقات (مثل `awj:product-media-r2-backfill`) مع التحقق بالهاش.
4. تنبيه المستخدمين برفع الصور المفقودة مجدداً (غير قابلة للاسترجاع).
**القبول:** رفع → إعادة نشر → إعادة فتح: الملف يظهر؛ `awj:uploads-orphans` = 0 للمسارات المنقولة.
**الاختبار:** اختبار R2 مُحاكى لكل مسار + اختبار تشغيلي بعد نشر تجريبي.

### المرحلة 4 — سلامة البيانات والتنظيف
**المحتوى:** فحص نتيجة `store()` (throw) في المرفقات؛ ترتيب استبدال/حذف صورة الموظف؛ تنظيف ملفات الملاحظات عند حذف مسودة الفاتورة؛ تعويض الفشل عند إنشاء صف المرفق؛ إنشاء التصنيف ذرّي؛ قفل سباق حد الـ8.
**القبول:** فشل أي خطوة لا يترك يتيماً ولا يُضيع الأصل.
**الاختبار:** اختبارات فشل مقصود لكل مسار (T4–T6).

### المرحلة 5 — تحصين أمني
**المحتوى:** تحقق `sales-config/designs` (PNG/JPEG/WebP، حد حجم، بلا SVG)؛ فك الامتداد من النوع المكتشف؛ finfo خلف `mimes`؛ `nosniff` على التنزيلات؛ تقديم نسخة منقّاة من EXIF في الروابط الموقعة بدل الأصل؛ إخفاء `error_message` الخام؛ تثبيت `APP_KEY` إلزامياً وإفشال الإقلاع بدل توليد مؤقت في الإنتاج؛ مراجعة TrustProxies للروابط الموقعة.
**القبول:** اختبارات رفض (SVG، PHP كـ JPEG، GPS) خضراء.

### المرحلة 6 — التوحيد وHEIC
**المحتوى:** إدخال `UploadProfile`+`ManagedFileStore`+`useUpload` تدريجياً (المنتج أولاً)، وتطبيع الصور في العميل، و`/uploads/capabilities`، وأمر `uploads-doctor`، وقرار HEIC (تطبيع عميل أولاً؛ imagick+libheif خادماً فقط إن لزم).
**القبول:** مسارا صور على الأقل يستخدمان الطبقة المشتركة بلا تغيير سلوك المستخدم؛ اختبار iPhone حقيقي ناجح.

### المرحلة 7 — شبكة الأمان في الاختبارات
Playwright رفع فعلي (desktop + mobile)، واختبار Apache+mod_php بحدود حقيقية في CI، وتغطية T1–T13.

---

## 15. الملفات التي فُحصت (الرئيسية)

**Backend:** `config/{filesystems,storefront_media,product_media,category_media,document_center,imports}.php` · `app/Services/{R2StorageService,ProductMediaService,ProductMediaDerivativeService,ProductMediaR2BackfillService,ImportJobService,ImportJobFileStorage}.php` · `app/Services/Commerce/{StorefrontMediaService,StorefrontMediaVariantGenerator,StorefrontMediaOrientation,StorefrontMediaReferenceScanner,StorefrontMediaReconciler,StorefrontPresentationNormalizer}.php` · `app/Services/DocumentCenter/{DocumentStorageService,DocumentFileInspector,DocumentFileIntakeService}.php` · `app/Http/Controllers/Api/{Product,ProductCategory,Employee,Expense,Payment,Purchase,Invoice,DocumentIntake,ImportJob,InventoryOpening,ProductWorkbook,Company,SalesConfig,ZatcaCredential,CommerceMedia,StorefrontMedia,StorefrontCustomizerMedia,CommerceWorkspaceStorefrontMedia,CommerceWorkspaceStorefrontMediaFile,CommerceWorkspaceMedia}Controller.php` · `app/Http/Requests/{StoreProductMedia,StoreProductCategory,UploadEmployeePhoto,StoreEmployeeAttachments,StoreExpense,StorePayment,StorePurchaseAttachments,StoreInvoiceNote,StoreDocumentFile,StoreImportJob,UpdateCompany}Request.php` · `routes/{api,api_storefront,api_commerce}.php` · migrations ذات الصلة.
**البنية:** `Dockerfile`, `deploy/{entrypoint.sh,assemble.sh,DEPLOY.md,cors.php}`, `render.yaml`, `setup.sh`, `docs/storage.md`, `.github/workflows/{ci,web-ci,runtime-smoke}.yml`, `CLAUDE.md`.
**الواجهة:** `web/src/lib/{api,platform-api,document-intake,image,storefront-media-demo}.ts`, `components/products/*`, `components/settings/{company-dialog,designs-settings-card}.tsx`, `components/hr/employee-dialog.tsx`, `components/{purchases,payments,invoices,document-center,pos}/*`, `app/(app)/{expenses,inventory-settings/categories,hr/employees,products/import,...}`, `modules/store-experience-builder/{media/*,ControlPanels.tsx,messages.ts}`, `modules/commerce-workspace/storefront-media.ts`, `modules/import-jobs/client.ts`, `web/{next.config.mjs,vercel.json}`.
**وثائق:** `docs/plans/store/CUST-HV-V2A/V2B-IMPLEMENTATION-REPORT.md`, `...MASTER-GAP.md`, `...V0-DECISIONS...`.
**استُبعد عمداً:** أي اتصال بـ Production/Railway/Cloudflare؛ أي قراءة لقيم أسرار.

> **ملاحظة منهجية:** جزء من الجرد (backend وfrontend) أجرته وكلاء فرعيون للقراءة فقط، وتحققتُ بنفسي من النقاط الحاسمة: غياب `php.ini` وقيم PHP الافتراضية، آلية رسالة Laravel، تدفق `STOREFRONT_MEDIA_R2_ENABLED`، منطق `use-media-capability`، `storeMedia`/`uploadPhoto`/`ExpenseController`، `UpdateCompanyRequest`، وإعادة إنتاج حدود PHP. بقية الادعاءات (مثل أرقام أسطر محددة في ملفات ثانوية) مأخوذة من تقارير الوكلاء وتحتاج مراجعة عند التنفيذ.

---

## 16. المخاطر المتبقية والخطوة التالية

**المخاطر المتبقية بعد هذا التدقيق:** (1) لم يُتحقَّق من Production إطلاقاً. (2) كل ملفات المرفقات الحالية على قرص زائل قد تضيع في أي إعادة نشر. (3) أسباب بديلة لـ «failed to upload» (انقطاع اتصال) غير مستبعدة. (4) سلوك iOS/HEIC غير مختبَر على جهاز.

**الخطوة التالية المقترحة (بانتظار موافقتك):**
1. اعتماد **المرحلة 0** (قراءة Production: `php -i`، أسماء المتغيرات، smoke test).
2. اعتماد **المرحلة 1** كتغيير تشغيلي عاجل لأنها تُصلح العطل المُبلَّغ مباشرة.
3. قرار منك بشأن مصير مرفقات الموظفين/المحاسبة (R2 عبر `DocumentStorageService` أم Volume مؤقت).

**توقفت عند التقرير كما طُلب — لا تنفيذ، لا Merge، لا Deploy.**

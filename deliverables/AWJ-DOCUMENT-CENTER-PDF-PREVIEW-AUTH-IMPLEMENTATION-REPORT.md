# AWJ — إصلاح مصادقة معاينة PDF في مركز المستندات

## الحالة

إصلاح محدود النطاق جاهز للمراجعة في فرع مستقل. لم يتم الدمج أو النشر.

- **Branch:** `fix/document-center-pdf-preview-auth`
- **Base:** `main`
- **Base SHA:** `a60fe8ef323f28d6fcbf782a56468f7e8bbdfadb`
- **Implementation Head SHA:** `41d35a2711a2afc268b6dae16fbcf2ff7e55972c`
- **المجال:** واجهة المعاينة واختبارات النقل فقط؛ لا تغييرات في قاعدة البيانات أو المحاسبة أو عقد Backend.

## السبب الجذري المؤكد

مسار الشاشة كان:

```text
ReviewWorkspace
  → DocumentPreviewPanel
  → GET /api/document-files/{file}/download-url  (api() مع Bearer)
  → رابط تنزيل موقّع ومحمي
  → <iframe src="...">
```

الطلب الأول كان مصادقًا عبر `api()`، لكن الطلب الثاني الذي ينفذه المتصفح داخل `iframe` لا يرسل ترويسة `Authorization: Bearer`. مسار التنزيل نفسه محمي ببنية التطبيق القائمة:

- `auth:sanctum`
- صلاحية `documents.center.view`
- بوابة التطبيق التجاري `document_center.core`
- `signed` للتوقيع المؤقت
- `SetTenant`/`BranchContext` وـ route model binding لعزل المستأجر والفرع
- `CLEAN` وعدم `purged_at` قبل إتاحة الملف

لذلك أعاد Backend HTTP 401 مع `{"message":"Unauthenticated."}`. وبسبب وضع الاستجابة مباشرة في `iframe`، عُرض JSON بصريًا كأنه محتوى PDF، وهو السلوك الظاهر في `TAX_Invoice-007256.pdf`.

## الإصلاح المنفذ

1. إضافة `fetchPrivateFileUrl()` إلى `web/src/lib/api.ts`:
   - يستخدم نفس Bearer token و`X-Branch-Id` الموجودين في طبقة API.
   - يجلب الرابط الموقّع عبر `fetch` ثم ينشئ `blob:` محليًا.
   - لا ينشئ مسارًا عامًا ولا يتجاوز التوقيع أو صلاحيات Backend.
   - يعالج 401 بنفس مسار انتهاء الجلسة المركزي: تنظيف الجلسة وإعادة التوجيه إلى الدخول.
   - يتحقق من `Content-Type` المتوقع ويرفض `application/json` أو النوع غير المطابق قبل تمريره إلى عارض PDF.

2. تعديل `DocumentPreviewPanel`:
   - يبقى طلب `download-url` عبر `api()`.
   - لا يضع رابط API الموقّع مباشرةً في `iframe` أو `img`.
   - يستخدم blob URL المصادق، مع تحرير الروابط القديمة.
   - يحتفظ بحالات التحميل وعدم الإتاحة والخطأ وإعادة المحاولة.
   - يعرض رسالة واضحة عند وصول محتوى غير صالح، ولا يركّب `iframe` لاستجابة JSON.
   - لا يغيّر قرار زر «إكمال المراجعة»: يظل محكومًا بصلاحيات المراجع وحالة المراجعة والعوائق الحالية، كما يحكمه Backend عند الإرسال. فشل المعاينة لا يمنح صلاحية ولا يغيّر قواعد الإكمال.

3. أضيفت تغطية الاختبارات للواجهة وطبقة API.

## عزل المستأجر والصلاحيات

لم تتم إضافة endpoint أو رابط عام. الطلب الثاني يستخدم نفس الرابط الموقّع الموجود حاليًا، لكنه يرسل Credentials صراحةً من خلال طبقة API. لذلك تظل قرارات الوصول في Backend كما هي:

- المستخدم غير المصادق يحصل على 401.
- المستخدم بلا `documents.center.view` يُمنع عبر middleware.
- المستخدم من مستأجر آخر أو فرع آخر لا يمر عبر النطاق/الربط الحالي، وتثبت الاختبارات الحالية 404 للعزل.
- ملف غير `CLEAN` أو ملف منتهي/مفقود لا يصبح قابلاً للمعاينة بسبب هذا التغيير.
- انتهاء الجلسة لا يتحول إلى مستند JSON؛ يعالج كـ401 مع مسار الدخول الحالي.

## الملفات المتغيرة

- `web/src/lib/api.ts`
- `web/src/lib/__tests__/api.test.ts`
- `web/src/components/document-center/document-preview-panel.tsx`
- `web/src/components/document-center/document-preview-panel.test.tsx`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`

## الاختبارات

نجحت الاختبارات المستهدفة:

```text
2 test files passed
15 tests passed
```

وتغطي:

- معاينة PDF مصادق عليها مع `Bearer` و`X-Branch-Id`.
- MIME صحيح وblob URL.
- رفض JSON الناجح أو استجابة 401 التي لا تمثل PDF.
- عدم تركيب iframe عند الاستجابة غير الصالحة.
- فشل الشبكة وإعادة المحاولة.
- حالة الملف غير المتاح وحالة استثناء الفحص.
- الحفاظ على عرض اسم الملف وعدد الصفحات.

الأمر:

```text
cd web
./node_modules/.bin/vitest run \
  src/components/document-center/document-preview-panel.test.tsx \
  src/lib/__tests__/api.test.ts
```

فحص TypeScript لم يُظهر أخطاء في الملفات المعدلة. فحص JSON للترجمتين و`git diff --check` نجحا.

اختبار Backend الأمني الكامل لم يُشغّل محليًا لأن `vendor/bin/phpunit` غير موجود في checkout الحالي؛ لم تُعدّل اختبارات Backend أو مساراته. توجد اختبارات العزل/التنزيل الحالية في `tests/Feature/DocumentCenterSecureIntakeTest.php` و`tests/Feature/DocumentCenterIsolationMatrixTest.php`، ويجب أن تكون جزءًا من CI.

## Build / CI

- `next build`: **نجح**.
- Vitest المستهدف: **نجح، 15/15**.
- TypeScript للملفات المعدلة: **لا أخطاء**.
- PHPUnit محليًا: **غير متاح** بسبب غياب الاعتماديات (`vendor/bin/phpunit`).
- CI: لم يُشغّل يدويًا من هذه الجلسة؛ ينتظر رفع PR وتشغيل فحوصات GitHub.

## المخاطر المتبقية

- يعتمد الإصلاح على أن رابط `download-url` الموقّع قابل للجلب من Origin الواجهة مع ترويسات المصادقة؛ يجب أن يثبت CI/البيئة المنشورة إعدادات CORS الحالية بين الواجهة وAPI.
- إذا أعاد proxy أو التخزين `Content-Type` غير صحيح لملف سليم، ستظهر حالة خطأ قابلة لإعادة المحاولة بدل عرض محتوى غير موثوق؛ هذا fail-closed مقصود.
- لم يتغير حد صلاحية الرابط المؤقت أو سياسة الفحص أو عزل المستأجرين.
- لم تتغير مسارات الرفع أو إكمال المراجعة أو قواعد المحاسبة.

## الخطوة التالية

مراجعة PR وتشغيل CI، ثم اختبار يدوي/طرفي على سطح المكتب والجوال لملف PDF متعدد الصفحات، مع التحقق من حالات 401 و403/404 وانتهاء الجلسة. بعد موافقة المالك فقط يمكن اتخاذ قرار الدمج؛ لا يوجد Merge أو Deploy ضمن هذا التنفيذ.

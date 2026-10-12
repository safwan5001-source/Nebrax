# AWJ-HORIZON-MEDIA-STORAGE — S2 Implementation Report (مركز المستندات: توافق R2)

> **الحالة:** كود جاهز ومُختبَر. **التفعيل الإنتاجي غير منفَّذ** (انظر §5). Branch: `horizon/media-storage-s2-r2-no-acl` · Base: `981663a`/main. PR/SHAs: انظر الـTracker.

## 1. الهدف
تمكين مركز المستندات من التخزين الدائم على R2 عبر **المسار الحالي** (شاشة المنصة `document_storage` + `DOCUMENT_DURABLE_STORAGE_ENABLED`) دون تغيير الأسبقية (`A-19`) ولا عقد شاشة الإدارة (`D-e`).

## 2. External Evidence
- Cloudflare R2 — S3 API compatibility: في `PutObject` ترويسات الـACL (`x-amz-acl` وما معها) **غير مدعومة (❌)**؛ الصفحة **لا تحدّد** هل تُتجاهَل أم تُرفض.
- Flysystem-S3 (الذي يستعمله `Storage::build(['driver'=>'s3'])`) يترجم `visibility` إلى ACL عند الكتابة. `DocumentStorageService` كان يمرّر `visibility: private` في تهيئة القرص وفي كل `put`.

## 3. AWJ Decision
على endpoint من R2 (`*.r2.cloudflarestorage.com`، بما فيها نطاقات الولاية القضائية) **لا تُرسل `visibility`** لا في تهيئة القرص ولا في `put`/`healthCheck`. الخصوصية يحكمها الدلو الخاص والاعتماد المحدود. أي سائق آخر (local، S3 العادي) **بلا أي تغيير**. المطابقة بالمضيف بدقة (لا `contains`): `r2.cloudflarestorage.com.evil.example` لا يُعامَل كـR2 (اختبار صريح).
**Rejected:** سائق R2 جديد داخل `DocumentStorageService` (يُغيّر البنية ويكسر `A-19`) · تفعيل العلم دون إثبات الكتابة الفعلية.

## 4. الملفات والاختبارات
- `app/Services/DocumentCenter/DocumentStorageService.php` (+32/−5): `writeOptions()` · `isCloudflareR2()`.
- `tests/Feature/DocumentStorageR2CompatTest.php` (جديد، 5 اختبارات): R2 · R2 EU · AWS S3 يحتفظ بـprivate · مضيف مُقلِّد · محلي افتراضي.
- مجموعة `Document|PlatformIntegration|ProductMedia|CategoryMedia` محلياً: **582 نجاح، 1 skipped، 0 فشل**. لا اختبار قائم عُدِّل. لا ملف من `UpdatePlatformIntegrationRequest`/`PlatformIntegrationService`/المخطط في الفرق.
- لا عملية مالية ⇒ **لا قيود ناتجة**.

## 5. ما لم يُثبَت (لا أدّعيه)
1. **لم أختبر الكتابة على R2 حقيقية**: لا اعتماد في بيئة الاختبار ولا يوجد R2 اختباري. الاختبارات تُثبت أن الترويسة لا تُرسل، لا أن R2 تقبل الطلب.
2. **التفعيل الإنتاجي (`DOCUMENT_DURABLE_STORAGE_ENABLED=true` + إدخال إعداد `document_storage` في شاشة المنصة)** لم يُنفَّذ: يحتاج إدخال سرّ R2 في شاشة المنصة (لا أعرضه ولا أُدخله)، وإثباتاً بالرفع/القراءة/الحذف على كائن تجريبي. بوابة: `healthCheck` في شاشة المنصة يكتب كائناً مؤقتاً `healthchecks/{uuid}.txt` فقط.
3. تحذير تفعيل: قلب العلم يغيّر مكان حلّ صفوف `ProductMedia.disk='document'` القديمة (الصور القديمة تجريبية بقرار المالك؛ لا حذف).

## 6. التالي
بعد دمج S2: التفعيل التجريبي لمركز المستندات بعد إثبات `healthCheck` (بوابة المالك/Railway)، ثم تصميم Idempotency.

# AWJ-UPLOAD-RELIABILITY-1 — Phase 0: Production Read-Only Verification

> **الحالة: متوقفة عند حاجز الوصول — لم يُنفَّذ أي تحقق على Production.**
> لا أملك في هذه الجلسة أي وصول قراءة آمن إلى Railway أو Cloudflare R2 أو قاعدة بيانات Production أو حاوية التشغيل. وفق تعليماتك لم أخمّن، ولم أستعمل بيانات اعتماد غير مخصّصة للمهمة. هذا التقرير يوثّق ما تحقّقتُ منه فعلاً، وما لا يمكن إثباته من هنا، وقائمة قراءة-فقط دقيقة ينفّذها المالك (أو من يملك الوصول) لإغلاق الفجوات.

| البند | القيمة |
|---|---|
| تاريخ | 2026-10-11 |
| PR المرتبط | #1314 (مفتوح، غير مدموج) |
| Head SHA للفرع | `095810fab7b7e382a0ded945c7862261c518fcfe` (`audit/upload-reliability-1`) |
| `origin/main` الحالي | `ab51046` (+1 commit عن Base التدقيق `4d8e1a6`: `#1311` واجهة المتجر فقط؛ لا يمسّ Dockerfile/deploy/config/رفع) |
| ما غُيِّر | لا شيء في الكود/Railway/قاعدة البيانات. لم أنفّذ `awj:r2-smoke-test` ولا أي كتابة. |

---

## 1. ما تحقّقتُ منه فعلاً (مع الدليل)

### 1.1 حالة PR #1314 [مؤكَّد]

| العنصر | الحالة وقت الفحص (13:20 UTC) |
|---|---|
| الحالة | `open`، غير مسودة، غير مدموج |
| الملفات | ملف docs واحد (+473 سطراً)؛ لا تعارض ممكن مع `main` (ملف جديد) |
| `mergeable_state` | `unstable` — بسبب فحوص CI قيد التشغيل لا بسبب تعارض |
| CI | 4 فحوص كلها `in_progress`: `php artisan test (L11, sqlite)` و`(L11, pgsql)` × تشغيلان (حدثا push وPR). **لم تنتهِ بعد ⇒ لا حكم أخضر/أحمر.** |
| التعليقات | تعليق واحد آلي من `chatgpt-codex-connector[bot]`: «reached your Codex usage limits for code reviews» — **ليست مراجعة** ولا تحمل ملاحظات على الملف |
| المراجعات / threads | صفر مراجعات، صفر review threads |
| الاستنتاج | لا شيء يوجب إجراءً حالياً. لا أدمج. أعيد فحص نتيجة CI عند اكتمالها (انظر §6). |

> ملاحظة: PR توثيقي بحت، فإخفاق CI فيه — إن حدث — سيكون من اختبارات المستودع القائمة لا من التقرير؛ سأحلّله ولن أخفيه.

### 1.2 مستوى الوصول المتاح لي [مؤكَّد]

| الوصول | متاح؟ |
|---|---|
| Railway CLI / API / لوحة المتغيرات / سجلات النشر | ❌ لا CLI، لا توكن، لا متغيرات `RAILWAY_*` في الجلسة |
| Cloudflare R2 (لوحة / API / wrangler) | ❌ |
| قاعدة بيانات Production | ❌ |
| حاوية Production (`php -i`، `df`، `find`) | ❌ |
| رابط API الإنتاجي | ❌ غير معروف لي: المستودع يذكر `nibras-api.onrender.com` و`nibras.vercel.app` و`app.awj.app` (وثائق قديمة؛ الوثائق نفسها تقول إن `render.yaml` قديم مقابل Railway)، ولا رابط Railway الفعلي. لا أخمّن مضيفاً. |
| GitHub (PR / Actions) | ✅ قراءة |

**ملاحظة أمنية:** تحتوي بيئة الجلسة على متغيّرين باسم `AWS_ACCESS_KEY_ID` و`AWS_SECRET_ACCESS_KEY` لم أحدّد مصدرهما ولا نطاقهما، وليسا مُسنَدَين لهذه المهمة. **لم أقرأ قيمتيهما ولم أستعملهما** (لا مع R2 ولا غيره). أوصي بالتأكد أنهما ليسا اعتمادات إنتاج قبل أي مهمة لاحقة تتصل بـ R2.

> الفحص الخارجي غير الموثَّق (مثل طلب HTTP إلى مضيف مخمَّن) ليس إجابة عن أيٍّ من أسئلة المرحلة 0: حدود PHP وأسماء المتغيرات و`APP_KEY` والتخزين لا تُقرأ من خارج الحاوية.

---

## 2. نتائج بنود المرحلة 0

| # | البند المطلوب | النتيجة | ما يلزم لإغلاقه |
|---|---|---|---|
| 1 | حدود PHP الفعلية | **غير متحقَّق منه في Production.** من الكود: لا `php.ini` ولا `conf.d` في الصورة ⇒ المتوقع 2M/8M (أُعيد إنتاجه في بيئة التدقيق، لا في Production) | §4-A |
| 2 | أسماء وإتاحة إعدادات R2 | **غير متحقَّق منه.** المستودع لا يحوي قائمة متغيرات Railway؛ الوثائق تقول `R2_*` موجودة لـ `nibras-api` (AWJ-R2-3) [DOC] | §4-B + §4-F |
| 3 | `APP_KEY` ثابت | **غير متحقَّق منه.** من الكود: `entrypoint.sh` يولّد مفتاحاً مؤقتاً إن غاب `APP_KEY` ويطبع تحذيراً | §4-C |
| 4 | إعدادات التخزين الفعلية لكل مسار | **جدول متوقع من الكود جاهز (§3)**؛ القيم الفعلية للأعلام غير معروفة | §4-B |
| 5 | تقييم خطر فقدان الملفات الموجودة | **تقييم نظري من الكود (§5)**؛ حجم الفقد الفعلي غير معروف | §4-D + §4-E |
| 6 | CI وتعليقات PR #1314 | **منجز** (§1.1) — CI لم يكتمل بعد | إعادة فحص |
| 7 | التقرير والفجوات والخطوة التالية | هذا الملف | — |

---

## 3. إعداد التخزين المتوقع لكل مسار (مستخرج من الكود — يُؤكَّد بقيم الأعلام الفعلية)

> «الافتراضي» = الأعلام غير مضبوطة. المسارات التي تتفرّع عبر `DocumentStorageService` قد تكون دائمة **أيضاً** إن كان `DOCUMENT_DURABLE_STORAGE_ENABLED=true` وتكامل المنصة `document_storage` فعّال — هذه حالة لا يمكن استبعادها من الكود (render.yaml يقول false لكنه قديم).

| المسار | الافتراضي (أعلام غير مضبوطة) | يصبح دائماً إذا | القراءة |
|---|---|---|---|
| صور المنتج | `disk='document'` → `DocumentStorageService` → قرص `local` المحلي | `PRODUCT_MEDIA_R2_ENABLED=true` (للجديد فقط) **أو** `DOCUMENT_DURABLE_STORAGE_ENABLED=true` (+تكامل منصة) | `product_media.disk` يكشف `r2` مقابل `document` |
| صور التصنيف | نفسه | `CATEGORY_MEDIA_R2_ENABLED=true` (جديد فقط) أو التخزين الدائم للمستندات | شكل `image_path`: `tenant/…` = R2 |
| مكتبة منشئ المتجر | **معطّلة** (503) | `STOREFRONT_MEDIA_R2_ENABLED=true` + `R2_*` | R2 فقط، لا تراجع محلي |
| صورة الموظف | `Storage::disk('local')` **مكتوب صراحة** | لا شيء (لا مفتاح إعداد) — يتطلب تغيير كود | — |
| مرفقات موظف/مصروف/دفعة/مشتريات/ملاحظة فاتورة | `local` صراحة | لا شيء (كذلك) | عمود `disk='local'` |
| مركز المستندات | `DocumentStorageService` → local | `DOCUMENT_DURABLE_STORAGE_ENABLED=true` + تكامل منصة `document_storage` | `document_files.storage_profile/object_key` |
| ملفات الاستيراد | `IMPORTS_STORAGE_DRIVER=local` افتراضياً | `IMPORTS_STORAGE_*` (S3/R2) | عابرة (تُحذف بعد التحليل) |
| شعار الشركة / التصاميم / هوية legacy | قاعدة البيانات (data URL) | — دائمة أصلاً | — |

---

## 4. قائمة القراءة-فقط للمالك (لا تغيّر شيئاً)

> **قاعدة إخراج:** الصق النتائج كما هي **باستثناء أي سر**. كل الأوامر أدناه مصمَّمة لتطبع حالة (`SET`/`EMPTY`/`MISSING`) أو قيماً غير سرّية فقط. لا تُشغّل `printenv` ولا `env` كاملاً ولا `cat .env`.
> الأوامر تُنفَّذ من Shell/SSH حاوية خدمة `nibras-api` في Railway (قراءة فقط).

### A. حدود PHP الفعلية
```bash
php --ini                                   # Loaded Configuration File: (none) ؟
ls /usr/local/etc/php/conf.d                # يُتوقع docker-php-ext-*.ini فقط
php -r 'foreach(["upload_max_filesize","post_max_size","max_file_uploads","memory_limit","max_execution_time"] as $k) echo $k,"=",ini_get($k),PHP_EOL;'
env | cut -d= -f1 | grep -E '^PHP_'         # أسماء فقط: هل يوجد PHP_INI_SCAN_DIR أو غيره؟
apache2ctl -M 2>/dev/null | grep -i php     # mod_php مفعّل؟
```
**التفسير:** `Loaded Configuration File: (none)` + `2M/8M` ⇒ تأكيد السبب الجذري للفشل. أي قيم أكبر ⇒ السبب الجذري يتغيّر ويجب إعادة التحليل (الأولوية: الفحص §5.1 من التقرير الرئيسي بديل: انقطاع اتصال/`UPLOAD_ERR_PARTIAL`).
**دليل ثانوي (اختياري):** سطر في سجل Railway بنص `POST Content-Length of … bytes exceeds the limit of …` عند محاولة رفع فاشلة سابقة.

### B. أسماء/حالة المتغيرات (دون كشف أسرار)
```bash
php -r '
$secret=["APP_KEY","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","DOCUMENT_STORAGE_KEY","DOCUMENT_STORAGE_SECRET","IMPORTS_STORAGE_KEY","IMPORTS_STORAGE_SECRET","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY"];
$plain=["APP_ENV","APP_DEBUG","APP_URL","R2_BUCKET","R2_ENDPOINT","R2_REGION","R2_USE_PATH_STYLE_ENDPOINT","PRODUCT_MEDIA_R2_ENABLED","CATEGORY_MEDIA_R2_ENABLED","STOREFRONT_MEDIA_R2_ENABLED","DOCUMENT_DURABLE_STORAGE_ENABLED","DOCUMENT_STORAGE_DRIVER","DOCUMENT_STORAGE_DISK","DOCUMENT_STORAGE_BUCKET","FILESYSTEM_DISK","IMPORTS_STORAGE_DRIVER","QUEUE_CONNECTION","STOREFRONT_MEDIA_DECODE_BUDGET_MB"];
foreach($secret as $k){$v=getenv($k);echo str_pad($k,34),($v===false?"MISSING":($v===""?"EMPTY":"SET")),PHP_EOL;}
foreach($plain as $k){$v=getenv($k);if(str_contains($k,"BUCKET")||str_contains($k,"ENDPOINT")||$k==="APP_URL"){echo str_pad($k,34),($v===false?"MISSING":($v===""?"EMPTY":"SET")),PHP_EOL;}else{echo str_pad($k,34),($v===false?"MISSING":$v),PHP_EOL;}}'
```
القيم المطبوعة صراحة غير سرّية (أعلام Boolean، أسماء drivers، بيئة). الدلو والـendpoint يُطبعان كحالة فقط.
**ما يحسمه:** هل `R2_*` الأربعة الإلزامية (`KEY/SECRET/BUCKET/ENDPOINT`) كلها `SET`؟ قيم الأعلام الثلاثة + `DOCUMENT_DURABLE_STORAGE_ENABLED`؟

### C. ثبات `APP_KEY` (دون كشفه أو استبداله)
```bash
php -r 'echo substr(hash("sha256",(string)getenv("APP_KEY")),0,8),PHP_EOL;'   # بصمة 8 خانات، لا تكشف المفتاح
```
1. سجّل البصمة الآن، وقارنها بعد **أول نشر طبيعي قادم** (لا تُجرِ نشراً لهذا الغرض). تطابقها = ثبات.
2. ابحث في سجلات الإقلاع الأخيرة عن السطر `APP_KEY غير مضبوط — أُولّد مفتاحاً مؤقتاً`. وجوده في أي نشر حديث = **مفتاح غير ثابت** (يكسر الروابط الموقّعة ويجعل أعمدة `encrypted` — ومنها بيانات اعتماد ZATCA — غير قابلة للقراءة بعد النشر التالي).
3. تأكد في لوحة Railway (عرض الأسماء فقط) أن `APP_KEY` معرّف على مستوى **الخدمة** لا في ملف محلي.
**ممنوع:** `php artisan key:generate`، أو تعديل `APP_KEY`.

### D. التخزين المحلي: هل هو زائل فعلاً؟
```bash
mount | grep -E ' /app/storage| /app ' ; df -h /app/storage/app        # هل يوجد Volume مركّب؟
ps -o lstart= -p 1                                                      # وقت إقلاع الحاوية الحالية
find /app/storage/app -type f | wc -l                                   # عدد الملفات المحلية الآن
find /app/storage/app -maxdepth 3 -type d | sed 's#/app/storage/app/##' | cut -d/ -f1-2 | sort | uniq -c | head -30   # أسماء مجلدات فقط
```
**التفسير:** لا Volume + إقلاع حديث ⇒ لا ملفات قبل ذلك الوقت (مُتوقَّع أن تكون مفقودة). Volume موجود ⇒ يُسجَّل كحقيقة وتُراجع حدود القرار 2 (لا حلاً دائماً) دون المساس به.

### E. حجم الخطر: صفوف مقابل ملفات (قراءة فقط، أعداد لا محتوى)
على قاعدة Production بحساب قراءة فقط (PostgreSQL):
```sql
select 'product_media' src, disk, count(*) from product_media group by disk
union all select 'product_categories_r2', 'r2', count(*) from product_categories where image_path like 'tenant/%'
union all select 'product_categories_legacy', 'local/document', count(*) from product_categories where image_path is not null and image_path not like 'tenant/%'
union all select 'employees_photo', 'local', count(*) from employees where photo_path is not null
union all select 'employee_attachments', disk, count(*) from employee_attachments group by disk
union all select 'expense_attachments', disk, count(*) from expense_attachments group by disk
union all select 'payment_attachments', disk, count(*) from payment_attachments group by disk
union all select 'purchase_attachments', disk, count(*) from purchase_attachments group by disk
union all select 'invoice_note_attachments', disk, count(*) from invoice_note_attachments group by disk
union all select 'document_files', storage_profile, count(*) from document_files group by storage_profile
union all select 'storefront_media_active', 'r2', count(*) from storefront_media where state='active';
```
ثم **عيّنة وجود** (20 صفاً أحدث + 20 أقدم لكل عائلة، مسارات فقط): نفّذ من داخل الحاوية `[ -f "/app/storage/app/private/<path>" ]` للمسارات المحلية وسجّل نسبة المفقود. **لا تحذف الصفوف اليتيمة ولا تنقل الملفات** (قرار 3).
**مخرَج مطلوب:** جدول `family | rows | sampled | missing%`.

### F. توفّر R2 دون كتابة
1. **لوحة Cloudflare (قراءة):** الدلو موجود؛ الوصول العام معطّل (لا `r2.dev` ولا نطاق مخصص عام)؛ رمز API محصور بالدلو بصلاحية Object Read & Write (ليس Admin)؛ الرمز غير منتهٍ.
2. **قراءة بلا كتابة:** إن وُجد صف `product_media.disk='r2'`، يُنفَّذ `HeadObject` لمفتاحه من جهة المالك (`aws s3api head-object --endpoint-url <R2 endpoint> …` باعتماداته هو) — يثبت أن الدلو والاعتماد يعملان دون أي كتابة. إن لم يوجد صف `r2` فهذا بحد ذاته دليل على أن العلم لم يُفعَّل قط.
3. شاشة تكاملات المنصة (`/platform` ← `document_storage`) إن كانت تعرض الحالة دون أسرار: سجّل «مُفعَّل/غير مُفعَّل». **لا تضغط «اختبار الاتصال»** — `PlatformIntegrationService::healthCheck` يكتب كائناً مؤقتاً ويحذفه (كتابة).
4. **`awj:r2-smoke-test` لم يُنفَّذ** وينتظر موافقتك المنفصلة.

---

## 5. تقييم خطر فقدان الملفات الموجودة (نظري — يُثبت بنتائج §4-D/E)

| العائلة | خطر الفقد | منطق |
|---|---|---|
| مرفقات المصروفات والمدفوعات والمشتريات وملاحظات الفواتير | 🔴 **مرتفع** (مستندات داعمة لقيود مرحّلة) | `local` صراحة؛ كل نشر/إعادة تشغيل/استبدال حاوية بلا Volume يمسح ما كُتب بعد بناء الصورة |
| صور ومرفقات الموظفين | 🔴 مرتفع (بيانات شخصية/وثائق) | نفسه |
| صور المنتجات | 🟠 مرتفع ما لم `PRODUCT_MEDIA_R2_ENABLED` أو التخزين الدائم للمستندات؛ الصفوف القديمة `disk='document'` تضيع إن كان التخزين محلياً | الوثيقة نفسها: «bytes already lost … must be uploaded once more» |
| صور التصنيفات | 🟠 نفسه | |
| مركز المستندات | 🟠 يعتمد على `DOCUMENT_DURABLE_STORAGE_ENABLED` | |
| شعار الشركة/التصاميم | 🟢 لا خطر | قاعدة البيانات |
| مكتبة منشئ المتجر | 🟢 لا بيانات (معطّلة) | |

**مبدأ التقدير:** الفقد ليس حدثاً مستقبلياً بل **متراكم**: الصف يبقى والملف يضيع عند أول نشر بعد الرفع. المتوقع إذن أن أغلب الملفات المحلية الأقدم من آخر نشر مفقودة فعلاً، وكل نشر قادم يمسح الجديد منها. هذا يرفع أولوية القرار 1 (R2) ويجعل **كل نشر جديد قبل نقل المسارات الحرجة يُضيف خسارة** — قرار توقيت النشر بيدك.

**قيود قراراتك محترمة في هذه المرحلة:** لا نقل ولا حذف للملفات القديمة؛ لا Volume كحل دائم؛ كل الفحوص أعلاه قراءة فقط.

---

## 6. الفجوات المتبقية بعد المرحلة 0

| # | الفجوة | تُغلق بـ |
|---|---|---|
| G1 | القيم الفعلية لحدود PHP | §4-A |
| G2 | وجود `R2_*` الإلزامية وقيم الأعلام الأربعة | §4-B |
| G3 | ثبات `APP_KEY` | §4-C |
| G4 | وجود Volume / وقت إقلاع الحاوية / عدد الملفات المحلية | §4-D |
| G5 | نسبة الفقد الفعلية لكل عائلة | §4-E |
| G6 | صلاحية الدلو والرمز في Cloudflare | §4-F |
| G7 | اكتمال CI على PR #1314 | إعادة فحص (أستطيعها) |
| G8 | أصل متغيرَي `AWS_*` في بيئة الجلسة | توضيح منك |

## 7. الخطوة التالية

1. **المالك:** نفّذ §4-A…F (أو امنحني قراءة آمنة محدّدة: مثلاً رمز Railway للقراءة فقط بنطاق المشروع، أو نتائج الأوامر الملصقة) وأرسل المخرجات دون أسرار. أحتاج على الأقل: **A وB وC وD**.
2. **أنا (بعد استلام المخرجات):** أحدّث التقرير بجدول الحقائق الفعلية، وأحسم السبب الجذري نهائياً، وأعيد ترتيب خطة المرحلة 1 على الواقع، وأفحص نتيجة CI.
3. **قرار منفصل مطلوب منك لاحقاً:** تفويض صريح لـ `awj:r2-smoke-test` (يكتب ويحذف كائناً مؤقتاً)، ولأي تغيير في Dockerfile (المرحلة 1).
4. **PR #1314 يبقى غير مدموج** حتى إغلاق مراجعة التقرير.

**لم يُغيَّر شيء. توقفت عند حاجز الوصول كما طُلب.**

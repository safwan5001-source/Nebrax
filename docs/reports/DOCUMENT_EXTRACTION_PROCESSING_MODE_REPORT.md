# تقرير تنفيذ نمط معالجة استخراج المستندات (SYNC / ASYNC)

**المهمة:** إعداد منصة `document_extraction.processing_mode` بأضيق نطاق آمن، مع الإبقاء على سياسة فحص البرمجيات الضارة كما هي.
**الفرع:** `cursor/extraction-processing-mode-b8de`
**Base SHA:** `61f4dc1e5a93c4dc44d25114e78262750545a36b` (`main`)
**Head SHA:** `5ce34503542053c1a653dd8b272673b88c06eb85`
**PR:** [#640](https://github.com/safwan5001-source/Nebrax/pull/640) — للمراجعة فقط.

**NOT MERGED / NOT DEPLOYED**

لا تغيير على إعدادات الإنتاج، Railway، مفاتيح/نماذج Gemini، `APP_KEY`، المحاسبة، المخزون، أو ZATCA. لا ترحيلات.

---

## ما تغيّر

إعداد منصة واحد داخل JSON المشفّر لـ `document_ai`:

- المفتاح: `processing_mode`
- القيم: `sync` | `async`
- الافتراض الآمن عند الغياب أو القيمة غير الصالحة: **`async`**
- الحفظ يتطلب كلمة مرور مدير المنصة (`sometimes|nullable|in:sync,async`)
- حذف الحقل من طلب الحفظ يُبقي القيمة السابقة، أو `async` إن لم تُحفظ من قبل

خط الاستخراج يبقى واحداً: `DocumentExtractionService::process()`. الفرق الوحيد هو **أين** تُستدعى المحاولة الأولى (داخل الطلب أو عبر طابور `documents`).

جاهزية الاستخراج واعية بالنمط:

- **SYNC:** شبكة مفتوحة + محرك مفعّل + مزود أساسي جاهز. لا يُشترط طابور ولا عامل.
- **ASYNC:** الشروط الثلاثة + طابور Redis مضبوط فعلياً (`queue_configured`: redis + URL، لا مجرد `!== 'sync'`) + نبضة عامل `online`. سائق غير Redis أو غياب URL أو غياب النبضة ⇒ غير جاهز.

إصلاح تشخيصي مرافق: `DocumentDiagnosticsService` يشتق `worker_online` من `runtime.worker_status` بدل مفتاح غير موجود.

تحسين استعلامات: نظرة العمليات لا تستدعي `runtime()` بالكامل (كانت تضيف عدّادات تشغيل غير لازمة للجاهزية). تُحمَّل صفوف `document_ai` / `malware_scanner` / `document_processing` دفعة واحدة داخل الطلب، ونبضة العامل تُقرأ وحدها في ASYNC.

---

## دلالات التنفيذ الدقيقة

### ASYNC (الافتراض، بلا تغيير سلوكي مقصود)

1. `DocumentFileIntakeService::complete()` ينتقل إلى `received` ثم `queueSafetyScans()`.
2. إن لم يكن `document_processing` **و** `malware_scanner` مفعّلين: إعادة `0`، الملفات تبقى `PENDING`، لا تشغيل.
3. إن كان `queue.default === 'sync'`: إعادة `0` كما كان (طابور Laravel المتزامن ليس نمط التطبيق).
4. وإلا: إنشاء تشغيل `safety_scan` و`ScanDocumentFile::dispatch()->onQueue('documents')` مع `max_attempts` / `timeout` / `backoff` من سياسة المعالجة الخلفية.
5. العامل يشغّل الفاحص الفعلي عبر `DocumentFileScanService::scanAndRecord()`.
6. بعد `CLEAN` فقط: `queueExtractions()` ثم `ExtractDocumentFile` على `documents`.
7. `process($run, $file)` بدون حد محاولة لهذه الاستدعاء — ميزانية المزود كما هي (محاولات المزود + backoff الطابور).
8. إعادة المحاولة: `dispatch`؛ فشل الإرسال يعيد التشغيل إلى `FAILED` قابل للإعادة (`document_retry_dispatch_failed`).

### SYNC (محاولة واحدة داخل الطلب)

1. نفس بوابات الفاحص/`document_processing`. تعطيل أي منهما = لا فحص ولا استخراج.
2. لا يُرفض بسبب `queue.default === 'sync'`.
3. الفحص inline: `claim()` ثم `scanAndRecord()` ثم إنهاء تشغيل الفحص. محاولة واحدة، بلا backoff طابور.
4. بعد `CLEAN` فقط: `queueExtractions()` ينفّذ `claim()` ثم `process($run, $file, 1)` داخل الطلب. لا `dispatch`.
5. تسلسل محاولات المزود يُكمَل من `max(sequence)` حتى لا يصطدم قيد `(run_id, sequence)` عند إعادة المحاولة.
6. مهلة HTTP للوسيط قد تقطع الطلب؛ لا إعادة محاولة مزود تلقائية داخل نفس الطلب.
7. إعادة المحاولة: تنفيذ inline مرة أخرى (محاولة مزود واحدة لكل طلب). لا مسار `dispatch` وبالتالي لا `document_retry_dispatch_failed` من إرسال الطابور.

`complete()` يعيد `$completed->fresh()` حتى تظهر `needs_review` بعد نجاح SYNC داخل نفس الاستجابة.

---

## سلوك فحص الملفات / البرمجيات الضارة

**لم تُضعف السياسة، ولم يُتجاوز الفاحص، ولم تُخترع دلالة `CLEAN` جديدة.**

| الحالة | السلوك |
|---|---|
| الملف عند الرفع | `PENDING` دائماً |
| `malware_scanner` معطّل أو `document_processing` معطّل | `queueSafetyScans()` يعيد `0`. الملف يبقى `PENDING`. لا استخراج |
| فاصل SYNC | `scanAndRecord()` يستدعي الفاحص الفعلي. `CLEAN` فقط بقرار الفاحص |
| فاصل ASYNC | نفس `scanAndRecord()` من العامل، مع backoff عند الفشل ثم إغلاق آمن |
| `record(PENDING, …)` | مرفوض (`InvalidArgumentException`) |
| استخراج أي نمط | يرفض أي ملف ليس `CLEAN`، وقبل ذلك إن وُجد ملف غير نظيف في الحزمة |
| فشل الفاحص في SYNC | تشغيل الفحص `FAILED`، الملف `FAILED` إن بقي `PENDING`، حجر الحزمة عند `INFECTED`/`FAILED` |
| فشل الفاحص في ASYNC | إعادة محاولة بحسب السياسة ثم الإغلاق نفسه |

لا يوجد مسار يعلّم ملفاً غير مفحوص `CLEAN` لجعل طيار Gemini يعمل.

---

## الملفات المتغيّرة

**Backend**

- `app/Services/DocumentCenter/DocumentExtractionPolicy.php`
- `app/Services/PlatformIntegrationResolver.php`
- `app/Services/PlatformIntegrationService.php`
- `app/Http/Requests/UpdatePlatformIntegrationRequest.php`
- `app/Services/DocumentCenter/DocumentOperationsService.php`
- `app/Services/DocumentCenter/DocumentProcessingService.php`
- `app/Services/DocumentCenter/DocumentExtractionService.php`
- `app/Services/DocumentCenter/DocumentRetryService.php`
- `app/Services/DocumentCenter/DocumentFileScanService.php`
- `app/Services/DocumentCenter/DocumentFileIntakeService.php`
- `app/Services/DocumentCenter/DocumentDiagnosticsService.php`
- `app/Jobs/DocumentCenter/ScanDocumentFile.php`
- `app/Console/Commands/DocumentReadinessCommand.php`

**Frontend**

- `web/src/app/platform/integrations/page.tsx`
- `web/src/app/platform/integrations/payload.ts`
- `web/src/app/platform/integrations/ai-form.ts`
- `web/src/app/platform/document-operations/page.tsx`
- `web/src/app/(app)/documents/settings/page.tsx`
- `web/src/messages/ar.json`
- `web/src/messages/en.json`

**Tests**

- `tests/Feature/DocumentExtractionProcessingModeTest.php` (جديد)
- `tests/Feature/DocumentGovernanceReadinessTest.php`
- `tests/Feature/DocumentOperationsGovernanceTest.php`
- `web/src/app/platform/integrations/page.test.tsx`
- `web/src/app/(app)/documents/settings/page.test.tsx`

**هذا التقرير**

- `docs/reports/DOCUMENT_EXTRACTION_PROCESSING_MODE_REPORT.md`

---

## الاختبارات والنتائج

تشغيل محلي عبر تطبيق Laravel المجمّع في `/tmp/nibras-app` (SQLite) و`web/`.

| المجموعة | النتيجة |
|---|---|
| مركّز PHP (`DocumentExtractionProcessingModeTest` + `DocumentGovernanceReadinessTest` + فشل إعادة إرسال الحوكمة) | 20 نجح |
| انحدار مركز المستندات / التكامل / Gemini / العزل | 76 ثم 36 بعد إصلاح الاستعلامات (نجح) |
| `DocumentCenterPerformanceBaselineTest` | فشل أولاً (34 > 30 استعلاماً) ثم نجح بعد عدم استدعاء `runtime()` الكامل وتحميل صفوف التكامل دفعة واحدة |
| `php artisan test` كاملاً | **2283 نجح، 1 متخطّى** (16164 assertion) |
| Vitest مركّز (تكاملات + إعدادات المستندات) | 11 نجح |
| `npm test` كاملاً | **222 ملف / 1405 اختبار نجح** |
| `npm run build` | نجح (Next.js 15.5.19، 150 صفحة) |

لا متصفح متاح للتحقق التفاعلي لشاشات المنصة؛ عُوِّض باختبارات الواجهة والعقد وبناء الإنتاج.

---

## البناء / CI

- لا تعديل على `.github/workflows` أو `render.yaml` أو Railway.
- CI الحالي عند الدفع: `php artisan test` على sqlite+pgsql، وبناء الواجهة عبر `web-ci.yml`.
- الاشتراك على CI للفرع `cursor/extraction-processing-mode-b8de` فعّال للمراجعة.

---

## مراجعة الأمن وعزل المستأجر

- النمط إعداد **منصة** فقط، ليس إعداد مستأجر.
- حفظ `document_ai` ما زال يتطلب كلمة مرور مدير المنصة الصحيحة.
- النظرة العامة تُموّه أسرار المزود؛ اختبار الحفظ يؤكد أن مفتاح Gemini لا يظهر في JSON العام.
- الاستخراج المتزامن يجري داخل طلب المستأجر الحالي مع `TenantScope` + `BranchContext` القائمين.
- اختبار `sync_extraction_is_isolated_to_the_request_tenant` يؤكد أن مستأجراً ثانياً لا يرى نتيجة الأول.
- بوابة نوع المستند (`DocumentIntelligencePolicy`) تمنع الإرسال للمزود في SYNC كما في ASYNC؛ المستند يبقى في المركز.
- لا كتابة في `journal_entries` أو `stock_movements` من هذا المسار.
- الفاحص المعطّل لا يُتجاوز.

---

## المخاطر والعمل المتبقي

- SYNC قد يصطدم بمهلة HTTP للوسيط على مزود بطيء أو ملف كبير. ملاحظة الواجهة تذكر ذلك؛ يمكن خفض مهلة المزود يدوياً دون تغيير النموذج/المفتاح من هذا PR.
- تفعيل SYNC في الإنتاج خطوة تشغيل يدوية لاحقة. هذا PR لا يغيّر القيمة المخزّنة في الإنتاج (الافتراض يبقى `async`).
- طيار Gemini ما زال يحتاج `malware_scanner` و`document_processing` مفعّلين حسب السياسة القائمة؛ وإلا تبقى الملفات `PENDING`.
- لا حالة `needs_configuration`، ولا توسيع إنفاذ الكتالوج، ولا عامل طابور جديد.

---

## Branch

`cursor/extraction-processing-mode-b8de`

## PR

https://github.com/safwan5001-source/Nebrax/pull/640

## Base SHA

`61f4dc1e5a93c4dc44d25114e78262750545a36b`

## Head SHA

`5ce34503542053c1a653dd8b272673b88c06eb85`

## الخطوة التالية الموصى بها

بعد مراجعة ودمج هذا PR (منفصل، ليس جزءاً من المهمة): اختيار **متزامن** يدوياً في منصة الإنتاج لطيار Gemini، مع الإبقاء على فاصل البرمجيات الضارة ومعالجة الخلفية مفعّلين حسب السياسة الحالية. لا تغيير مفتاح أو نموذج Gemini، ولا نشر من هنا.

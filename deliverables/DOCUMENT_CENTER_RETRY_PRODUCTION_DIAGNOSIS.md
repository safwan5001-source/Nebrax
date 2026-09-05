# AWJ — تشخيص فشل إعادة المحاولة في الإنتاج (Document Center Retry)

**وضع القراءة فقط — لا تعديل كود، لا PR، لا دمج، لا نشر. كل ما يلي مبني على قراءة الكود الفعلي (لا افتراضات من جلسات سابقة).**

**الدفعة المتأثرة:** `a2abffb0-3740-4e40-99cf-0e029b5b1030` · نوع المستند: `delivery_note`

---

## 1. المسار الكامل لإعادة المحاولة: UI ← API ← Controller ← Service ← Processing

⚠️ **ملاحظة أولى مهمة:** زر "إعادة المحاولة" في شاشة المراجعة نفسها (`review-status-banner.tsx`) **ليس فعل إعادة محاولة** — هو مجرد `<Link href="/documents/operations">` ينقل المستخدم إلى شاشة العمليات. الفعل الحقيقي موجود فقط في `/documents/operations`، لكل `run` فاشل على حدة:

```
web/.../documents/operations/page.tsx: retry(run)
  → POST /document-processing-runs/{run.id}/retry   body: {version: run.updated_at}
routes/api.php:282
  → middleware: EnsurePermission(documents.center.retry) + commercialApp(document_center.core,write) + throttle:10,1
DocumentOperationsController::retry()
  → $request->validate(['version'=>'nullable|string|max:64'])
  → DocumentRetryService::retry($run, $user, $version)
  → response()->json(['data'=>[...]], accepted ? 202 : 422)
DocumentRetryService::retry()
  → قفل الصف (lockForUpdate) داخل معاملة
  → سلسلة بوّابات رفض (rejected()) — أي بوّابة ترفض تُنهي المعاملة دون تعديل الـ run
  → عند القبول: يُعاد ضبط نفس صف document_processing_run (status=QUEUED, job_uuid جديد...) — لا يُنشأ صف جديد
  → بعد المعاملة: SYNC → executeSynchronously() مباشرة ضمن نفس الطلب | ASYNC → dispatch(ExtractDocumentFile) على قائمة documents
DocumentExtractionService::executeSynchronously()/process()
  → DocumentProcessingService::claim() (attempt_count++, status=RUNNING)
  → محاولات المزوّد الفعلية → DocumentProviderAttempt rows
```

---

## 2. الملفات/الأصناف/الدوال المعنية

- `web/src/components/document-center/review-status-banner.tsx` (رابط تصفح فقط)
- `web/src/app/(app)/documents/operations/page.tsx` — `retry()`
- `web/src/lib/api.ts` — `api()`, `ApiError`
- `routes/api.php:282`
- `app/Http/Controllers/Api/DocumentOperationsController.php::retry()`
- `app/Services/DocumentCenter/DocumentRetryService.php::retry()` (المحور)
- `app/Services/DocumentCenter/DocumentProcessingService.php::claim()`
- `app/Services/DocumentCenter/DocumentExtractionService.php::process()`, `executeSynchronously()`, `queueExtractions()`
- `app/Services/DocumentCenter/DocumentProviderConfiguration.php`
- `app/Services/DocumentCenter/DocumentFileScanAdmissionService.php::authorize()`
- `app/Services/DocumentCenter/DocumentProviderNetworkGate.php`
- `app/Services/PlatformIntegrationResolver.php::documentProcessingMode()`
- `Dockerfile:45` — `QUEUE_CONNECTION=sync`

---

## 3. السبب الجذري المُثبَت بالكود

**الآلية المُثبَتة بيقين تام (لا شك فيها):** أي بوّابة رفض داخل `DocumentRetryService::retry()` **لا تلمس صف `document_processing_run` إطلاقاً** — الكتابة الوحيدة عند الرفض هي صف `DocumentGovernanceEvent` (`action=retry_rejected`, `reason_code=<CODE_*>`). التعديل على الـ `run` (status→QUEUED، إلخ) يحدث فقط بعد اجتياز **كل** البوّابات (`DocumentRetryService.php:96-106`). إذن: *"لا صف جديد، لا تغيّر على الصف القائم"* هو بالضبط التوقيع المتوقَّع لطلب **مرفوض** — وليس دليلاً على أن الطلب لم يصل الخادم أو أن شيئاً "معطّل بصمت".

**المرشّح الأقوى المدعوم بالكود لسبب الرفض تحديداً:** `CODE_LIMIT_REACHED` عند `attempt_count >= configuration->maxAttempts` (`DocumentRetryService.php:91-93`)، وذلك عبر سلسلة استنتاج حتمية:

1. `Dockerfile:45` يثبّت `QUEUE_CONNECTION=sync` في صورة الإنتاج فعلياً — هذه حقيقة بنيوية دائمة، لا إعداد متغيّر.
2. البوّابة `(! $synchronous && config('queue.default') === 'sync')` موجودة **حرفياً بنفس الصيغة** في كل من `queueExtractions()` (`DocumentExtractionService.php:41`) و`DocumentRetryService::retry()` (`:85`). بما أن الاستخراج الأصلي **وصل فعلاً إلى Gemini**، فهذا يُثبت أن `documentProcessingMode()` كان `sync` وقت المعالجة الأصلية (وإلا لكانت `queueExtractions()` رجعت `0` دون إنشاء أي `run`).
3. تحت `sync`، `executeSynchronously()` يستدعي `process($claimed, $file, 1)` — الوسيط الثالث `$maxProviderAttemptsThisInvocation=1` **يقصر كل دورة تنفيذ (كل `claim()`) على محاولة واحدة فقط لكل مزوّد** (`DocumentExtractionService.php:162-165`)، بصرف النظر عن `configuration->maxAttempts` المُعدّة. بالمقابل، مسار الـ Job غير المتزامن (`ExtractDocumentFile::handle()`) يستدعي `process($run,$file)` بلا سقف، فيستهلك الميزانية الكاملة (الافتراضي 2) في استدعاء واحد.
4. الدليل الإنتاجي يُظهر **محاولتَي مزوّد لنفس `google_gemini`/`gemini-3.8-flash`** — وبما أن `orderedProviders()` يمرّ عبر `array_unique()` (يستحيل تكرار نفس المزوّد داخل حلقة واحدة)، فالمحاولتان لا يمكن أن تنبعا من دورة `claim()` واحدة تحت `sync` (سقفها محاولة واحدة). إذن **لا بد من دورتَي `claim()` منفصلتين** أنتجتا محاولة واحدة لكل منهما — أي أن `attempt_count` على هذا الـ `run` **أصبح فعلياً 2** قبل الضغطة التي يجري تشخيصها الآن.
5. `DocumentProviderConfiguration::fromArray()` (`:36`): `max_attempts` الافتراضي = **2** (محدود 1..5) إن لم يُضبط صراحة.
6. النتيجة: `attempt_count(2) >= configuration->maxAttempts(2)` → **صحيح** → `CODE_LIMIT_REACHED` يرفض الطلب **قبل** أي لمسة لصف الـ `run` وقبل أي محاولة مزوّد جديدة — يطابق تماماً "لا جديد، لا تغيّر" الملاحَظ في الإنتاج.

**كيف يُثبَت هذا نهائياً (خارج نطاق هذه الجلسة القرائية):** استعلام واحد يحسم الأمر:
```sql
SELECT attempt_count FROM document_processing_runs WHERE id = '<extraction run id لدفعة a2abffb0-...>';
SELECT action, reason_code, created_at FROM document_governance_events
WHERE document_processing_run_id = '<نفس المعرّف>' ORDER BY created_at DESC LIMIT 5;
```
عمود `reason_code` في `document_governance_events` سيسمّي البوّابة الحقيقية بدقة (هذا الجدول لم يُفحص بعد من قِبل من قام بالتشخيص الميداني — فحصوا فقط `document_processing_run` و`document_provider_attempt`).

---

## 4. لماذا لم يظهر أي `run`/`attempt` جديد

لأن التصميم أصلاً **يعيد استخدام نفس صف الـ `run`** (لا ينشئ صفاً جديداً بتاتاً — هذا سلوك مقصود، لا خلل)، وبما أن الطلب رُفض عند بوّابة `CODE_LIMIT_REACHED` (الأرجح) **قبل** كتلة `->fill(['status'=>QUEUED,...])->save()`، فلا الـ `run` تغيّر ولا وصل التنفيذ إلى `claim()`/`process()` التي تُنشئ صفوف `document_provider_attempt` جديدة أصلاً.

---

## 5. هل يساهم وضع SYNC؟

**نعم — بشكل حاسم، وهو بالضبط جوهر المشكلة وليس عرَضاً جانبياً.** SYNC صحيح تماماً من ناحية "لا يحتاج عاملاً خلفياً" (ينفّذ داخل نفس الطلب، `executeSynchronously()` مضمّن في مسار الـ retry نفسه — لا queue بلا عامل). لكن قيد التصميم "محاولة واحدة فقط لكل دورة تنفيذ" (`process($run,$file,1)`) يعني أن **عداد `attempt_count` يُستهلك بمعدّل 1 لكل ضغطة إعادة محاولة فعلية**، لا لكل "محاولة مزوّد" — بينما حد `CODE_LIMIT_REACHED` يقارن هذا العداد بـ`configuration->maxAttempts` (2 افتراضياً) الذي صُمم أصلاً ليعني "عدد محاولات المزوّد ضمن تنفيذ واحد" (وهو المعنى الصحيح في مسار ASYNC). النتيجة: تحت SYNC، حد "محاولتَي مزوّد" الافتراضي يتحوّل عملياً إلى **"محاولة أصلية واحدة + إعادة محاولة واحدة فقط ثم قفل دائم"** — وهو تناقض دلالي بين معنى `maxAttempts` في الوضعين.

---

## 6. هل يساهم استثناء الفحص (scan-exception) / حالة PENDING؟

**لا — هذا الجزء يعمل بصورة صحيحة.** `DocumentRetryService` يستدعي `$this->scanAdmission->authorize($file)` (وليس `scan_status` الخام) — مطابق للمطلوب. وبقراءة `DocumentFileScanAdmissionService::authorize()` كاملةً: عند وجود إسناد سابق (`DocumentFileScanExceptionAdmission` مُنشأ فعلاً وقت المعالجة الأصلية الناجحة)، يعيد استخدامه بفحص تطابق (`tenant_id`/`batch_id`/`branch_id`) + تأكّد وجود `PlatformDocumentFileScanException` المانح **دون** إعادة تقييم `revoked_at`/`expires_at` على الاستثناء الأصلي نفسه — أي أن الإسناد **ثابت (immutable) فعلاً** بمجرد منحه، ولا يعيد فحص "الفاحص مُعطَّل حالياً" في كل مرة. لا يوجد CLEAN مزيّف، ولا حاجة له لأن مسار "الإسناد القائم" لا يمرّ بشرط CLEAN إطلاقاً. **هذا ليس المسبّب.**

---

## 7. مشكلة ثانوية مؤكَّدة في معالجة الأخطاء بالواجهة

**مؤكَّدة بالكود، ليست افتراضية:** الـ backend يُعيد `422` عند الرفض، وجسم الاستجابة `{data:{accepted:false, code, message, run}}`. لكن `web/src/lib/api.ts` يبني `ApiError.message` من `(body as {message?:string}).message ?? 'حدث خطأ'` — أي يقرأ مفتاحاً **جذرياً** `body.message` غير الموجود أصلاً (الرسالة الحقيقية متداخلة في `body.data.message`). بما أن `422` تعني `res.ok === false`، فإن `retry()` في `operations/page.tsx` يذهب مباشرة إلى `catch` ويعرض `ApiError.message` — أي **دائماً الرسالة العامة "حدث خطأ"** بدل السبب المحدَّد (كـ "تم بلوغ الحد الآمن لمحاولات الاستخراج"). هذا يفسّر جزئياً لماذا لم يكن السبب واضحاً من الواجهة نفسها، ودفع الفريق للاستعلام المباشر عن القاعدة.

---

## 8. أصغر إصلاح آمن (اقتراح فقط — غير منفَّذ)

اثنان مستقلّان، كل منهما بحد ذاته يحل جزءاً من المشكلة دون أي مساس بالبنية الأمنية:

- **(أ) توضيح الاستجابة للواجهة:** تصحيح استخراج الرسالة في `api.ts` ليقرأ `body?.data?.message ?? body?.message ?? fallback` — تغيير سطر واحد، بلا أثر أمني أو محاسبي، يكشف السبب الحقيقي فوراً لكل الحالات المستقبلية (بما فيها التحقق الميداني الحالي).
- **(ب) إعادة النظر في دلالة `maxAttempts` تحت SYNC تحديداً:** إما (1) تمرير سقف أعلى واقعي لـ `executeSynchronously()` بدل `1` الثابتة كي تتوافق دلالة العداد بين SYNC وASYNC، أو (2) فصل عدّاد "دورات retry اليدوية المسموحة" عن `configuration->maxAttempts` (الذي معناه الأصلي محاولات مزوّد داخل تنفيذ واحد) بحقل/سياسة منفصلة صريحة تحت `document_processing`. **هذا قرار سياسة تشغيلية** يستحق عرضه على المالك قبل أي تنفيذ (يطابق قاعدة "السياسة تُضبط ولا تُفرَض" في CLAUDE.md) — لا ينبغي افتراض الرقم الصحيح من طرف واحد.

---

## 9. الاختبارات المطلوبة (غير مكتوبة بعد)

فحص `tests/Feature/DocumentOperationsGovernanceTest.php` يُظهر أن اختبارات الـ retry الحالية تضبط `attempt_count => 0` صراحة — **لا يوجد اختبار يغطي سيناريو `attempt_count` عند/فوق `configuration->maxAttempts` لمرحلة `extraction` تحديداً** (فقط `processingPolicy['max_attempts']` لمرحلة الفحص الأمني مذكور). يلزم:
- اختبار `DocumentRetryService::retry()` مع `attempt_count = configuration->maxAttempts` لمرحلة extraction → يتوقع `CODE_LIMIT_REACHED` بلا تعديل على الـ `run`.
- اختبار end-to-end: معالجة SYNC أصلية (دورة واحدة) ثم retry واحد (دورة ثانية، لا يزال فاشلاً) ثم retry ثانٍ → يتأكد الرفض والسبب.
- اختبار للواجهة (`operations/page.tsx` أو `api.ts`) يتحقق أن رسالة الرفض المحدَّدة (وليس العامة) تصل وتُعرض عند 422.

---

## 10. تقييم الأمن وعزل المستأجر/الفرع

لا وجود لانتهاك في المسار المفحوص. `DocumentOperationsController::retry()` يستدعي `$this->branch($run)` (يمنع 404 عن `run` من فرع آخر). `DocumentProcessingRun::booted()` يفرض تطابق `tenant_id`/`branch_id` عند الإنشاء، ويمنع أي تعديل حقول خارج القائمة البيضاء (`static::updating`). `DocumentFileScanAdmissionService::authorize()` يتحقق صراحة من تطابق `tenant_id`/`branch_id`/`document_batch_id` قبل إعادة استخدام أي إسناد. الرفض بـ `CODE_LIMIT_REACHED` هو **سلوك أمني صحيح ومحافظ** (يمنع استنزاف مزوّد خارجي بمحاولات غير محدودة) — الخلل الفعلي هو دلالي/تشغيلي (تعارض معنى العدّاد بين SYNC/ASYNC وغياب الرسالة الواضحة)، وليس ثغرة.

---

## 11. الملفات المتوقَّع تغييرها (عند الموافقة على إصلاح لاحق)

- `web/src/lib/api.ts` (استخراج الرسالة المتداخلة) — إصلاح صِفري الأثر الأمني.
- عند اختيار تعديل السياسة: `app/Services/DocumentCenter/DocumentRetryService.php` و/أو `app/Services/DocumentCenter/DocumentExtractionService.php` (دلالة العداد تحت SYNC)، وربما `config/document_center.php` لإضافة حقل سياسة صريح.
- `tests/Feature/DocumentOperationsGovernanceTest.php` (تغطية السيناريو).

---

## 12. حدود PR المقترح (عند الموافقة على البناء)

**PR واحد صغير ومستقل، بحدين اختياريين منفصلين يمكن دمج أيّ منهما بمعزل عن الآخر:**
1. إصلاح عرض رسالة الرفض في الواجهة (بلا قرار سياسة، آمن للدمج فوراً).
2. قرار دلالة `maxAttempts` تحت SYNC — **يتطلب عرضاً على المالك أولاً** بصيغة: "هل يُقصد بـ`max_attempts` الافتراضي (2) عدد ضغطات retry اليدوية المسموحة الكلية، أم عدد محاولات المزوّد داخل تنفيذ واحد؟" قبل أي تنفيذ.

لا تنفيذ لأي مما سبق في هذه المهمة — تشخيص فقط كما طُلب.

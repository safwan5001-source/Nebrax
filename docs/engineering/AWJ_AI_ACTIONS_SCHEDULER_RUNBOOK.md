# Runbook — تشغيل تنظيف صور AI Actions المرحلية عبر Scheduler (Railway)

> **الحالة: تجهيز وتحقق — لا تفعيل.** هذا المستند يصف كيف يُفعَّل التنظيف الدوري بأمان. المهمة **مسجَّلة لكن مطفأة افتراضياً**
> (`AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED` غير مضبوط ⇒ `false`). لم يُعدَّل شيء على Railway.

## 1. الحالة الحالية المثبتة (قراءة فقط، 2026-10-21)

| البند | المُلاحَظ | المصدر |
|---|---|---|
| هل يوجد Scheduler فعّال؟ | **نعم**: خدمة Railway **`awj-scheduler`** (مشروع «أَوْج AWJ»، بيئة `production` الوحيدة) | `describe-service` |
| طريقة التشغيل | Cron Service: `cronSchedule = */5 * * * *`، `startCommand = php artisan schedule:run`، `restartPolicy = NEVER`، نسخة واحدة (`ams`) | `describe-service` |
| المصدر | `safwan5001-source/Nebrax` فرع `main`، `RAILPACK`، `checkSuites=false` (يُنشر دون انتظار CI) | `describe-service` |
| تنفيذ فعلي؟ | **نعم**: «Last run succeeded» `2026-10-21T10:00:44Z`؛ سجل الخدمة يعرض `Starting Container` كل 5 دقائق و`Running ['artisan' …]` للأوامر المستحقة | `environment-status`، `get-logs` |
| ما الذي يُنفَّذ | `webhooks:deliver`، `storefront-presentations:dispatch-due` كل تشغيلة؛ الفحوص كل ساعة؛ `documents:sweep-scans` كل 10 دقائق (**مخرجه ظاهر** لأنه `sendOutputTo('/proc/1/fd/1')`) | `get-logs` |
| سائر الأوامر | مخرجها `> '/dev/null'` فلا يُرى إلا سطر `Running … DONE/FAIL` | `get-logs` |
| متغيرات الخدمة (أسماء فقط) | `APP_*`، `DB_*`، `DOCUMENT_STORAGE_*`، `DOCUMENT_DURABLE_STORAGE_ENABLED`، `DOCUMENT_RETENTION_DAYS`. **لا** `AI_*`، لا `CACHE_STORE`، لا `LOG_CHANNEL` | `describe-service` |
| آخر نشر للخدمات | كل الخدمات على `be7a6c61b` (AI-06A #1584) بتاريخ 2026-10-20 22:50 UTC — **#1586 و#1589 غير منشورين بعد**، أي أن الأمر `ai-actions:purge-staged-images` غير موجود في الإنتاج الآن | `list-deployments` |
| الويب (`nibras-api`) | حاوية Apache فقط: لا scheduler ولا cron ولا worker (`QUEUE_CONNECTION=sync`) | `deploy/entrypoint.sh`، `Dockerfile` |
| ملاحظة خارج النطاق | `inventory:scan-alerts` ظهر `FAIL` في تشغيلة 10:00 UTC (كل ساعة). **لا علاقة له بهذا العمل** ولم يُمسّ؛ يُفتح له تتبّع منفصل | `get-logs` |

**الخلاصة:** الجدولة ليست «مسجَّلة فقط» — يوجد مُشغِّل فعلي يستدعي `schedule:run` كل 5 دقائق. لا حاجة لخدمة جديدة.

## 2. التصميم التشغيلي (أقل حل آمن)

استخدام `awj-scheduler` كما هو. مدخل `routes/console.php`:

```php
Schedule::command('ai-actions:purge-staged-images --max-seconds=240')
    ->dailyAt('03:50')->withoutOverlapping(30)->onOneServer()
    ->when(config('ai_actions.staging_purge_schedule_enabled'))
    ->sendOutputTo('/proc/1/fd/1');
```

| المتطلب | كيف يتحقق |
|---|---|
| عدم تشغيله من عدة نسخ API | الـAPI لا يشغّل scheduler إطلاقاً؛ المُشغِّل خدمة cron واحدة بنسخة واحدة. لا يُضاف `schedule:work` إلى حاوية الويب. |
| منع التداخل | `withoutOverlapping(30)` + `onOneServer()`. **حدّ معروف:** كل tick حاوية جديدة؛ إن كان مخزن الكاش محلياً (`file`) لا يرى القفل بين الحاويات. لذلك الأمر **آمن للتداخل بذاته**: قفل صفّ الإجراء (`lockForUpdate`) + إعادة القرار تحت القفل + حذف idempotent. |
| حماية العمليات الطويلة | `--max-seconds=240` (< 5 دقائق): لا يبدأ إجراءً جديداً بعد المهلة؛ ما تبقّى يظهر `remaining=N` ويُستكمل في اليوم التالي (`--limit=500` إجراء/تشغيلة). المهمة **آخر مدخل** في الجدول فلا تؤخّر غيرها داخل نفس الـtick. |
| قفل عالق | `withoutOverlapping(30)`: ينتهي القفل بعد 30 دقيقة (الافتراضي 24 ساعة كان سيُسقط المهمة يوماً بعد انهيار). |
| عدم تعطيل API/Workers | عملية منفصلة في حاوية cron؛ لا تمسّ الويب. |
| إعادة التشغيل والفشل | `restartPolicy NEVER` + الأمر idempotent (حذف الكائنات ثم وسم `purged_at`)؛ فشل جزئي لا يُفسد DB (الصف غير الموسوم يُعاد في التشغيلة التالية). |
| لا حذف لما يلزم تنفيذاً/إصلاحاً | سياسة الاحتفاظ وإعادة القرار تحت القفل (تقرير AI-07)؛ اعتماد حيّ أو تنفيذ جارٍ ⇒ لا حذف أبداً. |
| **حماية من تنظيف وهمي** | ملفات **القرص المحلي** (`platform`) لا تراها حاوية cron. الصف الذي يغيب كائنه عن هذا المضيف ولم يكن على التخزين الدائم (`platform-s3`) يُعدّ **`unverifiable`** ولا يُوسم (قاعدة البيانات لا تدّعي حذفاً لم يثبت). الإنتاج الموثَّق على R2 الدائم (`platform-s3`) لا يتأثر. |
| مفتاح إيقاف/تفعيل | `AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED` على `awj-scheduler`. الإيقاف = التراجع (بلا نشر كود). |

### مراقبة آخر تشغيل ونتيجته
سطر واحد ثابت المفاتيح في سجل `awj-scheduler` (بفضل `sendOutputTo('/proc/1/fd/1')`):

```
ai-actions:purge-staged-images status=ok actions=2 images=5 bytes=1048576 failed=0 unsafe=0 unverifiable=0 remaining=0 duration_ms=412
  skipped.within_retention=7
```

* `status=ok` وإلا `status=attention` (يعني `failed` أو `unsafe` أو `unverifiable` > 0، ويظهر `FAIL` في سطر `Running` لأن رمز الخروج ≠ 0).
* حالة cron في Railway (`environment-status` ⇒ `cronJob.lastExecutionStatus`): تعكس نجاح `schedule:run` كله.
* مؤشر الغياب: لا سطر `purge-staged-images` بين 03:50 و04:00 UTC بعد التفعيل ⇒ تحقيق.
* لا تُسجَّل معرّفات ولا مفاتيح كائنات ولا بيانات مستأجرين (أعداد فقط).

## 3. شروط ما قبل التفعيل (كلها)

1. **النشر:** تأكد أن `awj-scheduler` **و** `nibras-api` نُشرا على `main` يتضمن #1589 وهذا التغيير (`list-deployments` ⇒ `commitHash`).
2. **المخطط:** هجرة `purged_at` (`2026_11_20_010000`) نُفِّذت على القاعدة — تُنفَّذ عند إقلاع `nibras-api` (`entrypoint.sh`). الـscheduler لا يرحّل؛ لو سبق نشره الـAPI يفشل الأمر بعمود مفقود **دون حذف شيء** (يُغلق فاشلاً).
3. **Dry Run (قراءة فقط، يلزم موافقة المالك لتنفيذه على الإنتاج):** من مضيف مشغَّل على الإنتاج:
   ```bash
   php artisan ai-actions:purge-staged-images --dry-run
   ```
   المتوقع: `status=ok` و`unverifiable=0` و`unsafe=0`. أي `unverifiable>0` يعني أن الصفوف على قرص محلي لا يراه هذا المضيف ⇒ **لا تُفعِّل** قبل معالجته (التخزين الدائم أو التشغيل من المضيف الذي يملك القرص).
   لا يكتب الـdry-run ولا يأخذ قفلاً ولا يحذف.
4. **التحقق من الكاش/المنطقة الزمنية:** `php artisan config:show cache.default` و`app.timezone` على الـscheduler (الجدول `03:50` بتوقيت `app.timezone`). تُوثَّق القيم قبل التفعيل.
5. **اعتماد المالك** للتفعيل (خطوة منفصلة، ليست جزءاً من هذا PR).

## 4. التفعيل (يتطلب موافقة مستقلة — لا يُنفَّذ هنا)

1. على `awj-scheduler` فقط: اضبط `AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED=true`. (اختياري: `AI_ACTIONS_STAGING_*_DAYS` لتغيير نوافذ الاحتفاظ؛ الافتراضيات آمنة.)
2. أول تشغيلة: 03:50 UTC التالي. راقب السطر أعلاه. توقّع `remaining>0` إن كان المتراكم كبيراً (يُستكمل يومياً).
3. بعد 3 تشغيلات نظيفة: اعتبره مستقراً.

## 5. التراجع (Rollback)

| الحالة | الإجراء |
|---|---|
| إيقاف المهمة فوراً | احذف `AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED` (أو `false`) من `awj-scheduler`. تسري من تشغيلة cron التالية (≤ 5 دقائق)، بلا نشر كود. |
| مشكلة في الكود | Revert لـPR على `main` (يُنشر تلقائياً) — بعد الإيقاف بالعلم. |
| ما حُذف | **لا استرجاع** للكائنات المحذوفة (هذا مقصود). الصف يبقى (`purged_at`) كدليل؛ يُعاد رفع الـZIP. لذلك الـdry-run والاحتفاظ الافتراضي (30 يوماً للمسودة والإصلاح) هما خط الدفاع. |
| تعطيل كل المجدول | إيقاف خدمة `awj-scheduler` يوقف **كل** المهام (webhooks، كنّاس المستندات…) — لا يُستخدم لهذا الغرض. |

## 6. المخاطر التشغيلية والمتبقي

1. **النشر بلا انتظار CI** (`checkSuites=false`): أي merge على `main` يصل `awj-scheduler` فوراً. لذلك المهمة مطفأة بعلم.
2. **كاش محلي بين الحاويات** (غير مثبت من هنا؛ لا `CACHE_STORE` في متغيرات الخدمة): `onOneServer`/`withoutOverlapping` قد لا تعمل بين ticks متتالية؛ الأمر آمن للتداخل لكنه قد يكرّر العمل (بلا أثر ضار).
3. **Local disk:** أي صورة مرحلية كُتبت وقت إغلاق قفل التخزين الدائم (`platform` محلي) لا يمكن تنظيفها من cron؛ تظهر `unverifiable`.
4. **نافذة الاعتماد:** اعتماد حيّ (≤ ساعة افتراضياً) يؤجّل حذف تشغيلة مستهلَكة بمقدار TTL — متعمَّد.
5. **تأخر المتراكم:** `--limit=500` و`--max-seconds=240` ⇒ حدّ أقصى يومي؛ متراكم ضخم يُفرَّغ على أيام.
6. **`inventory:scan-alerts` يفشل** في الإنتاج (خارج النطاق) — يجب تتبعه منفصلاً.
7. سجلات المهام الأخرى تذهب إلى `/dev/null` (لا تُرى إلا حالة DONE/FAIL) — غير مُعدَّل هنا عمداً.
8. Remote Image Fetch و`AI_ACTIONS_EXECUTION_ENABLED` لا علاقة لهما بهذه المهمة وبقيا مطفأين.

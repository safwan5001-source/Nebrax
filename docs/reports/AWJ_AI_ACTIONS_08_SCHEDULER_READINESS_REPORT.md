# AWJ AI-ACTIONS-08 — Scheduler Readiness & Operational Verification

مرحلة تجهيز وتحقق. **لم يُفعَّل شيء في الإنتاج**: لا تعديل على Railway، لا Deploy/Merge، `AI_ACTIONS_EXECUTION_ENABLED` و Remote Image Fetch بقيا مطفأين،
لا تغيير في المحاسبة/المخزون. الأساس: `main` @ `2696f53751a80368b067847310efbbc41899d575` (دمج #1589).

## 1. حالة Scheduler المثبتة (قراءة فقط من Railway وقت الفحص 2026-10-21 ≈ 10:10 UTC)

| السؤال | الجواب المثبت | الدليل |
|---|---|---|
| هل يوجد Scheduler/Cron فعّال؟ | **نعم.** خدمة `awj-scheduler` (cron `*/5 * * * *`، `php artisan schedule:run`، نسخة واحدة، `restartPolicy NEVER`، `RAILPACK` من `main`، `checkSuites=false`) | `describe-service` |
| هل ينفَّذ فعلاً؟ | **نعم**: `lastExecutionStatus = succeeded` @ 10:00:44Z؛ السجل يُظهر `Starting Container` كل 5 دقائق و`Running ['artisan' …] DONE` | `environment-status`, `get-logs` |
| مخرجات الأوامر | `documents:sweep-scans` مخرجه ظاهر (`/proc/1/fd/1`)؛ البقية `> /dev/null` فلا تُرى إلا DONE/FAIL | `get-logs` |
| حاوية الويب | Apache فقط؛ بلا scheduler/cron/worker | `deploy/entrypoint.sh`, `Dockerfile` |
| هل الأوامر الثلاثة المطلوبة مسجّلة؟ | `ai:prune-records` (03:40)، `imports:prune` (02:15)، `ai-actions:purge-staged-images` (03:50) — أُكِّد بـ`schedule:list` وباختبار | `routes/console.php`, اختبار |
| هل الأمر الجديد في الإنتاج؟ | **لا بعد**: كل الخدمات على `be7a6c61b` (#1584، 2026-10-20 22:50). #1586/#1589 لم تُنشر | `list-deployments` |
| متغيرات `awj-scheduler` (أسماء فقط) | `APP_*`, `DB_*`, `DOCUMENT_STORAGE_*`, `DOCUMENT_DURABLE_STORAGE_ENABLED`, `DOCUMENT_RETENTION_DAYS`؛ لا `AI_*` ولا `CACHE_STORE` ولا `LOG_CHANNEL` | `describe-service` |
| ملاحظة منفصلة | `inventory:scan-alerts` = `FAIL` في تشغيلة 10:00 UTC. غير مرتبط؛ لم يُمسّ؛ يحتاج تتبعاً مستقلاً | `get-logs` |

**الخلاصة:** وجود `Schedule::command` لم يُفترض أنه يعني التشغيل — أُثبت وجود مُشغِّل فعلي. **لا حاجة لخدمة جديدة.**

## 2. الاكتشافات التي غيّرت التصميم (وسبب كل تعديل)

1. **تفعيل بالنشر:** الخدمة تنشر `main` فور الدمج بلا انتظار CI، والمهمة (من #1589) كانت ستبدأ حذفاً فعلياً أول 03:50 بعد النشر دون قرار. ⇒ المهمة صارت **مسجَّلة ومطفأة** بعلم `AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED` (افتراضي `false`)؛ العلم نفسه هو **مفتاح التراجع** بلا نشر كود.
2. **تنظيف وهمي محتمل:** حاوية cron تملك قرصاً مختلفاً عن `nibras-api`. صورة مرحلية كُتبت على القرص المحلي (`platform`) لا تراها cron؛ حذف كائن غير موجود يُعدّ no-op فكان الصف سيُوسَم `purged_at` والبايتات باقية. ⇒ كائن غائب عن هذا المضيف وغير دائم يُعدّ **`unverifiable`** ولا يُوسَم (الدائم `platform-s3` — R2 الموثَّق في الإنتاج — غير متأثر).
3. **المخرجات غير مرئية:** مخرج أوامر الجدولة يذهب إلى `/dev/null` (كما حدث لـ`ai:prune-records`) ⇒ `sendOutputTo('/proc/1/fd/1')` + سطر حالة ثابت المفاتيح.
4. **قفل 24 ساعة:** افتراضي `withoutOverlapping` يوقف المهمة يوماً بعد انهيار ⇒ `withoutOverlapping(30)`.
5. **حدّ زمني:** الـtick كل 5 دقائق والحاوية جديدة كل مرة (الكاش المحلي لا يربط القفل بين الحاويات) ⇒ `--max-seconds=240` (لا يبدأ إجراءً جديداً بعده) و`remaining` في المخرج؛ الأمر نفسه آمن للتداخل (قفل صفّ الإجراء + حذف idempotent).

سياسة الاحتفاظ **لم تتغير** (لم يُثبت خلل فيها).

## 3. التغييرات
| الملف | التغيير |
|---|---|
| `routes/console.php` | `--max-seconds=240`، `withoutOverlapping(30)`، `when(علم التفعيل)`، `sendOutputTo('/proc/1/fd/1')` |
| `config/ai_actions.php` | `staging_purge_schedule_enabled` (افتراضي `false`) |
| `app/Services/AiActionStagedImageRetention.php` | ميزانية زمن + `remaining`/`duration_ms`؛ `unverifiable` (فحص وجود للكائنات غير الدائمة، يشمل dry-run)؛ `purgeBeforeDeleting` يرفض `unverifiable` |
| `app/Console/Commands/PurgeAiActionStagedImages.php` | `--max-seconds`، سطر `status=ok\|attention` ثابت، خروج ≠ 0 عند `failed`/`unsafe`/`unverifiable` |
| `tests/Feature/AiActionStagingSchedulerTest.php` (6 جديدة) · `AiActionStagingCleanupTest.php` (تعديل تعبير واحد) | انظر §4 |
| `docs/engineering/AWJ_AI_ACTIONS_SCHEDULER_RUNBOOK.md` (جديد) | Runbook Railway كامل |
| `docs/engineering/AWJ_REMOTE_PRODUCT_IMAGES_RUNBOOK.md` | سطر مرجعي للعلم |
لا تغيير في الويب، المحاسبة، المخزون، مسار الاعتماد/التنفيذ، أو أي إعداد Railway.

## 4. التحقق من أمر التنظيف
| المتطلب | الإثبات |
|---|---|
| `--dry-run` لا يحذف | `a_dry_run_counts_candidates…` (07) + الاختبار الجديد (dry-run يُبلغ `unverifiable` دون كتابة) |
| الحذف محصور بالمؤهَّل / سياسة الاحتفاظ | اختبارات 07 (نوافذ، اعتماد حيّ، تنفيذ جارٍ، مسار شاذ `unsafe`) — دون تغيير ومازالت خضراء |
| لا حذف لصور المنتج النهائية | `final_product_images_are_never_reached…` |
| Tenant isolation | `the_cleanup_can_be_scoped_to_one_tenant…` |
| لا تعارض مع التنفيذ/الإصلاح | `a_decision_is_retaken_under_the_action_lock…` |
| إعادة التشغيل الآمنة | `running_the_cleanup_twice…` + `a_durable_object_that_is_already_gone…` (إعادة بلا أثر) |
| الجدولة/التسجيل/منع التداخل | `the_cleanup_is_scheduled_daily…` (تعبير cron، `--max-seconds`، `withoutOverlapping`+انتهاء 30، `onOneServer`، المخرج، الإطفاء الافتراضي، بقاء الأوامر الشقيقة) |
| الاستحقاق الزمني | `it_is_due_only_at_the_0350_tick…` (03:45/03:55/12:00 لا، 03:50 نعم) |
| الميزانية الزمنية | `a_run_stops_starting_new_work_after_its_time_budget…` |
| سطر الحالة الثابت | `a_clean_run_reports_one_stable_status_line…` |
| تنظيف وهمي | `a_local_disk_object_this_host_cannot_see_is_unverifiable…` |

## 5. نتائج الاختبارات
| الفحص | النتيجة |
|---|---|
| `AiAction*` + `DocumentScanSweepSchedule` + `AiAuditTest` (يشمل 25 اختباراً للتنظيف/الجدولة) | **129 passed على SQLite و129 على PostgreSQL** |
| + `ProductImportMediaSecurity` + `ProductReferenceClassificationGuard` + `BranchIsolationGuard` + `ImportJob*` + `PruneAiRecords` | **185 passed على PostgreSQL**، 181 passed (+4 skipped) على SQLite |
| `php artisan schedule:list` | الأمر ظاهر `50 3 * * *` |
| Web | لم يُلمس (لا يلزم) |
| CI على Head النهائي | **أخضر على `436b39d13`**: `php artisan test (L11, sqlite)` و`php artisan test (L11, pgsql)` و`CI Gate` — كلها success |

## 6. المخاطر والمتبقي (التفاصيل في الـRunbook §6)
1. الإنتاج لا يحوي الأمر بعد (لم يُنشر #1586/#1589)؛ النشر يحصل تلقائياً عند أي دمج لاحق. هجرة `purged_at` تُنفَّذ عند إقلاع `nibras-api`؛ لو سبقها نشر الـscheduler يفشل الأمر دون حذف.
2. مخزن الكاش وقيمة `app.timezone` على `awj-scheduler` **لم تُثبَّت** (لا متغيرات تحدّدها)؛ مطلوب فحصها قبل التفعيل (Runbook §3.4).
3. الـDry Run على الإنتاج لم يُنفَّذ (يتطلب موافقة): قد يُظهر `unverifiable` إن وُجدت صور مرحلية على قرص محلي.
4. `inventory:scan-alerts` يفشل في الإنتاج — خارج النطاق.

## 7. خطوات تتطلب موافقة مستقلة (لم تُنفَّذ)
1. دمج هذا PR (ونشر `main` — تلقائي في Railway).
2. تشغيل `--dry-run` على الإنتاج والتحقق من `unverifiable=0`.
3. ضبط `AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED=true` على `awj-scheduler` فقط.
4. (اختياري) تغيير نوافذ الاحتفاظ `AI_ACTIONS_STAGING_*_DAYS`.

## 8. Git / CI
| البند | القيمة |
|---|---|
| Branch | `ai-actions-08-scheduler-readiness` |
| PR | https://github.com/safwan5001-source/Nebrax/pull/1591 (Draft، base `main`) |
| Base SHA | `2696f53751a80368b067847310efbbc41899d575` (دمج #1589) |
| Head المتحقَّق منه بـCI | `436b39d1381d0429038932b058f4aefcc91ba3ae` |
| Head النهائي | الـcommit الحامل لهذا التحديث على الفرع (تحديث توثيق فقط؛ التقرير لا يحمل SHA نفسه) |

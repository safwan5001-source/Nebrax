# PAY-H1-02 — Implementation Report

STATUS: **MERGED** (PR #1609، `b6cf409`) — غير منشور (لا Deploy)
DATE: 2026-10-22

## Outcome

ضوابط تفعيل المدفوعات الإلكترونية لكل مستأجر + إيقاف طارئ للمنصة، بنمط ضوابط ZATCA نفسه (دون مسّها). **معطَّلة افتراضياً** (غياب الصف = مطفأ)، تغييرها بحدث تدقيق ثابت فقط، وكتابتها لمدير منصة نشط عبر `/api/platform/payments-rollout*`. **لا قارئ مالي بعد** (أول قارئ: PAY-H1-03). **لا أثر محاسبي ولا ضريبي ولا فواتير.**

## Design

| القرار | السبب |
|---|---|
| جدولان `payments_rollout_controls` / `payments_rollout_control_events` بمُشغّلات PostgreSQL وSQLite مطابقة لمنطق ZATCA | إعادة استعمال نمط مُثبَت: إنشاء بالحالة الأساسية فقط، تغيير بحدث مقابل (مقارنة-وتبديل بالنسخة)، لا حذف/تحديث/TRUNCATE |
| ميزة واحدة `online_payments` | اللحظة التي تُفعَّل فيها المدفوعات للمستأجر؛ ميزات فرعية (روابط/POS/متجر) تُضاف بمفتاح لاحقاً عند الحاجة |
| الحالة الفعّالة = تفعيل المستأجر **و** لا إيقاف منصة؛ القراءة بعبارة واحدة بلا قفل | يطابق عقد H1-03 (القارئ لا يحجب ولا يُحجب) |
| **بوابة D-25:** انتقال مستأجر إلى «مفعَّل» يُرفض (`scheduler_unproven` ⇒ 409) إن كانت نبضة `scheduler` أقدم من 10 دقائق (ضعف فاصل 5) أو غائبة | ADR-0004 §5؛ الإيقاف ورفع إيقاف المنصة غير مبوَّبين (إجراءات أمان) |
| نبضة المجدول: `platform:scheduler-heartbeat` كل 5 دقائق في `routes/console.php` ← `PlatformRuntimeHeartbeat(component=scheduler)` | يستعمل `awj-scheduler` القائمة (لا خدمة جديدة)؛ إثبات الاعتماد في بيئة الهدف يبقى EXT-08 |
| مسارات المنصة فقط، لا مسار مستأجر | التفعيل قرار تشغيلي للمنصة؛ `platform:read` للقراءة و`platform:manage` للتغيير |

## Changed files

- `database/migrations/2026_11_24_010000_create_payments_rollout_control_tables.php` — جدولان + مُشغّلات؛ `down()` يرفض متى وُجد أي صف.
- `app/Models/PaymentsRolloutControl.php`, `PaymentsRolloutControlEvent.php` — تشغيليان للمنصة، غير قابلين للتحديث/الحذف.
- `app/Services/PaymentsRolloutControlService.php` + `app/Support/PaymentsRolloutState|Change|ControlException.php`.
- `app/Support/SchedulerHeartbeat.php` + `app/Console/Commands/PlatformSchedulerHeartbeatCommand.php` + `routes/console.php`.
- `app/Http/Controllers/Api/PlatformPaymentsRolloutController.php` + 4 مسارات في `routes/api.php`.
- اختبارات: `PaymentsRolloutControlTest` (مصدرها ZATCA مكيَّفاً + بوابة D-25 + أمر النبضة)، `PaymentsRolloutControlPostgresTest` (تزامن `pcntl_fork` على PostgreSQL)، `PaymentsRolloutApiTest` (7).
- توثيق: تحديث تقرير H1-01 والطابور (بلا PR توثيقي منفصل).

## API

| الطريقة والمسار | القدرة | الوظيفة |
|---|---|---|
| `GET /api/platform/payments-rollout` | `platform:read` | حالة الإيقاف الطارئ + نبضة المجدول |
| `PUT /api/platform/payments-rollout` `{stopped, reason}` | `platform:manage` | إيقاف طارئ / رفعه |
| `GET /api/platform/tenants/{tenant}/payments-rollout` | `platform:read` | الحالة الفعّالة وآخر 20 حدثاً |
| `PUT /api/platform/tenants/{tenant}/payments-rollout` `{enabled, reason}` | `platform:manage` | تفعيل/تعطيل مستأجر (السبب 3–500 حرف) |

## Tests and exact results

- `PaymentsRolloutControlTest` + `ZatcaRolloutControlTest` (للتأكد أن ضوابط ZATCA لم تتأثر) + `PaymentsRolloutApiTest`: **كلها ناجحة** (SQLite، 54 ناجحاً + 7 API).
- `PaymentsRolloutControlPostgresTest`: متخطّى محلياً (لا خادم PostgreSQL)؛ **يغطيه جوب PostgreSQL في CI** (يفشل ولا يتخطّى إن غاب `pcntl`).
- الأمني/الوظيفي: غير مصادَق 401؛ توكن مستأجر 403 على المسارات الأربعة؛ توكن `platform:read` يقرأ ولا يغيّر؛ مدير معطَّل 403؛ مستأجر مجهول/معرّف فاسد 404؛ مدخلات غير صالحة 422؛ تفعيل أ لا يُفعّل ب ولا يظهر في قراءته؛ الإيقاف الطارئ يُلغي التفعيل ورفعه يعيده؛ تكرار الطلب idempotent بلا حدث؛ التفعيل لا يوسّع الصلاحيات (محاسب/موظف ما زالا 403 على إدارة الاتصالات) ولا يكسر العزل (مستأجر أ ⇒ 404 على بوابة ب).
- المجموعة الكاملة: `php artisan test` كاملاً (SQLite): **8253 ناجحاً، 173 متخطّى، 26 فاشلاً** — الـ26 كلها في `Fuel*` لغياب امتداد `bcmath` من بيئة التطوير المحلية (معلن في `setup.sh`، ويثبّته CI، وهي نفسها فشل H1-01 المحلي). لا فشل خارج `Fuel*`.

## CI

PR #1609 على Head `c3a6272`: SQLite وPostgreSQL ناجحان، CI Gate ناجح بعد إعادة تشغيل واحدة (أخفق أول مرة لأنه عمل قبل اكتمال SQLite). مراجعة Codex: ملاحظة P2 واحدة (إعادة طلب تفعيل قائم أثناء تعطل المجدول) أُصلحت في `c3a6272`.

## Pre-merge review

- PRE_MERGE_REVIEW: **PASS** — Head `c3a6272`

## Merge / Post-merge

- Merge: دمجه المالك — SHA `b6cf409b102f80ac06a2a5ab49105b8b3c792fa3`. لا Deploy.
- POST_MERGE_REVIEW: **PASS** — CI على `main` للـMerge SHA (تشغيل push `39819396640`): SQLite وPostgreSQL ناجحان. لا انحدار.

## Self-review

- **Implementer:** نسخة مكيَّفة من نمط مُثبَت؛ الإضافات الوحيدة بوابة D-25 والمتحكّم والنبضة.
- **Reviewer:** ترتيب الأقفال (مدير المنصة ← مِرساة المستأجر ← الضابط ← الحدث) كما في ZATCA؛ بوابة النبضة تُقيَّم بعد التحقق من الفاعل وقبل أي كتابة فلا يبقى أثر عند الرفض (مختبَر).
- **AWJ Guardian:** صفر قيود/سندات/فواتير؛ لا مسّ بضوابط ZATCA (اختبارها يمرّ بلا تعديل)؛ لا قراءة مالية للضوابط بعد (اختبار حارس يمنع أي ملف خارج الخدمة/النماذج/المتحكّم)؛ المسارات خارج `SetTenant` ومحميّة بمصادقة مدير المنصة.

## Accounting impact

لا يوجد. لا عملية مالية ⇒ لا قيود ناتجة.

## Tenant / branch isolation impact

الضوابط تشغيلية للمنصة (ليست نموذج مستأجر ولا فرعاً). التفعيل **شرط لازم لا كافٍ**: لا يغيّر RBAC ولا `TenantScope` ولا عزل الفروع لأي مسار قائم أو لاحق (مختبَر بحالة محاسب/موظف/مستأجر آخر).

## Risks / remaining work

- **الجدولة غير مُثبتة في الإنتاج من المستودع:** إن لم يعمل `schedule:run` فعلاً، ستظل بوابة D-25 ترفض التفعيل (فشل مغلق، المقصود). الإثبات التشغيلي EXT-08 (قراءة النبضة في بيئة الهدف).
- التنبيه عند تقادم النبضة **بعد** التفعيل (D-25) مؤجل لشريحة التنبيهات (H8)؛ هنا بوابة التفعيل فقط.
- حذف المستأجر النهائي (CASCADE) يزيل ضوابطه وأحداثه كبقية الجداول؛ سياسة الاحتفاظ D-20 لا تمسّ هذا الجدول.
- لا واجهة ويب بعد (PAY-H1-05).

## Recommended next dependency-ready task

PAY-H1-03 (نواة التنسيق: `payment_attempts`، `GatewayAdapter`، قراءة هذا الضابط) — H1-01 وH1-02 شرطاها.

## Git state

- Branch: `claude/awj-payments-h1-02-rollout`
- Base: `dbe3693825a27cf8a836883419d9e04a05555298`
- PR: #1609 · Head: `c3a6272` · Merge SHA: `b6cf409b102f80ac06a2a5ab49105b8b3c792fa3`

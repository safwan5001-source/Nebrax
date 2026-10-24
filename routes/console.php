<?php

use Illuminate\Support\Facades\Schedule;

// الفحص قراءة-فقط للمصدر المالي؛ لا يكتب إلا سجلات تنبيه للمستأجرين الذين فعّلوا الرقابة.
Schedule::command('finance:scan-controls')
    ->hourly()
    ->withoutOverlapping()
    ->onOneServer();

// فحص مخزون احتياطي — يلتقط ما كان منخفضاً/نافداً أصلاً قبل تفعيل الإعداد؛
// المسار الأساسي فوري عند كل حركة مخزون فعلية (InventoryService). لا يكتب إلا
// حالة تنبيه وإشعارات للمستأجرين الذين فعّلوا الإعداد.
Schedule::command('inventory:scan-alerts')
    ->hourly()
    ->withoutOverlapping()
    ->onOneServer();

// PR-NOTIF-5: الاستحقاقات تتغير باليوم فقط؛ الإسقاط قراءة-فقط على الفواتير.
Schedule::command('receivables:scan-notifications')
    ->dailyAt('08:00')
    ->withoutOverlapping()
    ->onOneServer();

// PR-NOTIF-5: فروق الصندوق والعهد المستلمة حالات تشغيلية قائمة؛ الفحص لا يغيّر POS.
Schedule::command('pos:scan-notifications')
    ->hourly()
    ->withoutOverlapping()
    ->onOneServer();

// الملخص الرقابي اليومي (Daily LP Digest) — قراءة/تجميع فقط, idempotent لكل (مستأجر، تاريخ).
// يوماً بعد يوم بتوقيت خادم واحد كي لا يتزاحم توليدان متزامنان لنفس اليوم.
Schedule::command('pos:generate-lp-digest')
    ->dailyAt('01:00')
    ->withoutOverlapping()
    ->onOneServer();

// ── Webhooks (PR-7) ────────────────────────────────────────────────────────
// تسليم الـ Webhooks المستحقّة: أمرٌ متزامن آمن للتكرار (مطالبة ذرّية بإيجار).
// ⚠ التفعيل التشغيليّ محجوب: النشر الحاليّ (Render، حاوية ويب واحدة عبر
// `php artisan serve`) لا يشغّل `schedule:run` ولا cron، فهذا التعريف خامل حتى
// يوصَل جدولٌ/كرون في النشر أو يُستدعى الأمر يدويًا. لا عامل خلفي (`QUEUE=sync`).
Schedule::command('webhooks:deliver')
    ->everyMinute()
    ->withoutOverlapping()
    ->onOneServer();

// تقليم سجلّات الـ Webhooks المُنجَزة/الفاشلة (احتفاظ حتميّ) — نفس ملاحظة التفعيل.
Schedule::command('webhooks:prune')
    ->dailyAt('02:00')
    ->withoutOverlapping()
    ->onOneServer();

// PR-DUR-1: تقليم تشغيلات الاستيراد الدائم الملغاة/الفاشلة — نفس ملاحظة التفعيل أعلاه.
Schedule::command('imports:prune')
    ->dailyAt('02:15')
    ->withoutOverlapping()
    ->onOneServer();

// S3: تقليم مفاتيح Idempotency المنتهية لطلبات الواجهة — نفس ملاحظة التفعيل أعلاه.
Schedule::command('request-idempotency:prune')
    ->dailyAt('02:30')
    ->withoutOverlapping()
    ->onOneServer();

// CUST-H1-4: نشر نسخ عروض المتاجر المجدولة المستحقّة. كل عنصر معزول ذرّياً
// (قفل صفّ + فحص جيل الجدولة) — فشل عنصرٍ واحد لا يوقف الدفعة، والقاعدة
// تبقى مصدر الحقيقة فيسترد المُرسِل ما فات تلقائياً بعد أي تعطّل.
// ⚠ التفعيل التشغيليّ محجوب بنفس قيد `webhooks:deliver` أعلاه: النشر
// الحاليّ (Render، حاوية ويب واحدة عبر Apache/mod_php، `QUEUE_CONNECTION=sync`)
// لا يشغّل `schedule:run` ولا cron — هذا التعريف خامل حتى يوصَل جدولٌ في
// النشر، أو يُستدعى الأمر يدوياً. واجهة الجدولة (Schedule UX) تبقى محجوبة
// من جهتها حتى CUST-H1-5 بصرف النظر عن حالة هذا التفعيل.
Schedule::command('storefront-presentations:dispatch-due')
    ->everyMinute()
    ->withoutOverlapping()
    ->onOneServer();

// مركز المستندات: ملفات عالقة في pending (فاحص أُعدّ بعد الاستقبال، أو مهمة ضاعت) تُعاد إلى
// مسار الفحص القائم؛ لا يُعلَّم أي ملف CLEAN هنا. رمز الخروج غير الصفري = تنبيه تشغيلي.
// ⚠ يعمل فقط حيث يوجد مجدول (schedule:work) أو يُستدعى يدوياً/بمهمة Railway cron.
// المخرجات (أعداد فقط، بلا معرّفات) تُكتب في stdout الحاوية (PID 1) ليظهر تقرير كل مرور في سجل الخدمة
// (Railway) بدل /dev/null الافتراضي — بلا ذلك يبقى سبب الفشل التشغيلي غير مرئي.
Schedule::command('documents:sweep-scans')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->onOneServer()
    ->when(static fn (): bool => (bool) config('ai_actions.staging_purge_schedule_enabled'))
    ->sendOutputTo('/proc/1/fd/1');

// AI-02A: سياسة احتفاظ سجلات المساعد الذكي (تدقيق + طلبات منتهية). حذف مجمّع بسيط، آمن للتكرار.
Schedule::command('ai:prune-records')
    ->dailyAt('03:40')
    ->withoutOverlapping()
    ->onOneServer();

// AI-ACTIONS-07/08: حذف الصور المرحلية الخاصة المنتهية حاجتها (احتفاظ حتميّ).
// يعمل عبر خدمة Railway القائمة `awj-scheduler` (cron `*/5 * * * *` ⇒ `schedule:run`) — لا خدمة جديدة.
// - `withoutOverlapping(30)`: قفلٌ ينتهي بعد 30 دقيقة (الافتراضي 24 ساعة كان سيوقف المهمة يوماً كاملاً بعد انهيار).
//   وهو لا يمنع تشغيلين من حاويتَي cron مختلفتين (مخزن الكاش محلي)؛ لذلك الأمر نفسه آمن للتداخل
//   (قفل صفّ الإجراء + حذف idempotent) ومحدود الزمن (`--max-seconds`).
// - مسجَّل لكن **مطفأ افتراضياً**: لا يعمل إلا مع `AI_ACTIONS_STAGING_PURGE_SCHEDULE_ENABLED=true` على الخدمة (حذف
//   مدمِّر لا يبدأ من تلقاء نشر `main`). الأمر نفسه يبقى قابلاً للتشغيل يدوياً بصرف النظر عن العلم.
// - المخرجات إلى stdout الحاوية (PID 1) فتظهر في سجل الخدمة بدل /dev/null (كما `documents:sweep-scans`).
Schedule::command('ai-actions:purge-staged-images --max-seconds=240')
    ->dailyAt('03:50')
    ->withoutOverlapping(30)
    ->onOneServer()
    ->when(static fn (): bool => (bool) config('ai_actions.staging_purge_schedule_enabled'))
    ->sendOutputTo('/proc/1/fd/1');

// PAY-H1-02 / ADR-0004 §5 (D-25): نبضة المجدول — دليل تشغيلي أن `schedule:run` يعمل فعلاً (خدمة `awj-scheduler`، cron `*/5 * * * *`).
// ضابط تفعيل المدفوعات يرفض تفعيل مستأجر إن كانت أقدم من ضعف الفاصل. لا أثر على أي بيانات مستأجر.
Schedule::command('platform:scheduler-heartbeat')
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->onOneServer();

// PAY-H1-04 / ADR-0004 §5 (D-25): مطابقة محاولات الدفع المتأخرة مع المزوّد (استعادة المتعثّر) — إيجار ذرّي لكل محاولة، لا ترحيل.
// يعمل عبر خدمة `awj-scheduler` نفسها؛ بلا محاولات قائمة لا يفعل شيئاً. الأمر آمن للتكرار والتزامن.
Schedule::command('payments:reconcile-attempts')
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->onOneServer();

// PAY-H3-01b / ADR-0007 §5-4: مطابقة استردادات البوابة غير المعروفة واستعادة الإرسال اليتيم — لا تأكيد آلي ولا إعادة إرسال أعمى ولا ترحيل.
Schedule::command('payments:reconcile-refunds')
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->onOneServer();

// PAY-H2-02c: شبكة أمان لترحيل التقاطات الدفع الإلكتروني المعلّقة (فشل المستمع/انهيار). idempotent: لا سند ثانٍ أبداً (UNIQUE + قفل).
Schedule::command('payments:post-captured')
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->onOneServer();

// PAY-H3-01c: شبكة أمان لترحيل A5 لاستردادات البوابة المؤكَّدة المعلّقة (فشل المستمع/انهيار). idempotent: لا قيد ثانٍ أبداً (قفل + مفتاح فريد).
Schedule::command('payments:post-refunds')
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->onOneServer();

// PAY-H2-02e: إغلاق طلبات دفع الفواتير التي لم تعد قابلة للدفع (سُدّدت/خُفّضت إلى صفر بإشعار دائن/انتهت) — لا أثر محاسبي.
Schedule::command('payments:close-stale-requests')
    ->everyTenMinutes()
    ->withoutOverlapping(10)
    ->onOneServer();

// PAY-H8-01 / D-20: تصفير أجسام أحداث المزوّد الأقدم من 180 يوماً (البصمة تبقى). **مغلق افتراضياً** (`payments.event_body_retention.enabled`) ويُفعَّل بقرار تشغيل بعد EXT-07.
Schedule::command('payments:purge-event-bodies')
    ->dailyAt('03:30')
    ->when(fn () => (bool) config('payments.event_body_retention.enabled'))
    ->withoutOverlapping(60)
    ->onOneServer();

// PAY-H6-02 — موافقات أجهزة الدفع اليتيمة: لا مرور بلا طلبات قائمة. آمن للتكرار والتزامن (إيجار ذرّي لكل طلب).
Schedule::command('pos:sweep-terminals')
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->onOneServer();

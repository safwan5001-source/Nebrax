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

<?php

use Illuminate\Support\Facades\Schedule;

// الفحص قراءة-فقط للمصدر المالي؛ لا يكتب إلا سجلات تنبيه للمستأجرين الذين فعّلوا الرقابة.
Schedule::command('finance:scan-controls')
    ->hourly()
    ->withoutOverlapping()
    ->onOneServer();

// الملخص الرقابي اليومي (Daily LP Digest) — قراءة/تجميع فقط، idempotent لكل (مستأجر، تاريخ).
// يوماً بعد يوم بتوقيت خادم واحد كي لا يتزاحم توليدان متزامنان لنفس اليوم.
Schedule::command('pos:generate-lp-digest')
    ->dailyAt('01:00')
    ->withoutOverlapping()
    ->onOneServer();

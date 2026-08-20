<?php

use Illuminate\Support\Facades\Schedule;

// الفحص قراءة-فقط للمصدر المالي؛ لا يكتب إلا سجلات تنبيه للمستأجرين الذين فعّلوا الرقابة.
Schedule::command('finance:scan-controls')
    ->hourly()
    ->withoutOverlapping()
    ->onOneServer();

<?php

namespace App\Console\Commands;

use App\Support\SchedulerHeartbeat;
use Illuminate\Console\Command;

/** يكتب نبضة المجدول (ADR-0004 §5). لا يمسّ بيانات مستأجر؛ آمن للتكرار. */
class PlatformSchedulerHeartbeatCommand extends Command
{
    protected $signature = 'platform:scheduler-heartbeat';

    protected $description = 'يسجّل نبضة المجدول لتُثبت أن schedule:run يعمل (شرط تفعيل المدفوعات)';

    public function handle(): int
    {
        SchedulerHeartbeat::record();

        return self::SUCCESS;
    }
}

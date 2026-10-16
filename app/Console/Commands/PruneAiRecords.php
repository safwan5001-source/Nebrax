<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * سياسة احتفاظ المساعد الذكي (AI-02A): يحذف أحداث التدقيق وسجلات الطلبات المنتهية الأقدم من
 * `ai_assistant.audit.retention_days` (الافتراضي 400). الحدّ الأدنى 30 يوماً مفروض في الكود لا بالإعداد:
 * قيمة أقل تُرفع إليه. سجلات `reserved` لا تُحذف أبداً (قد تكون قيد التنفيذ). يحذف عبر منشئ الاستعلام
 * عمداً — النموذج يمنع الحذف العرَضي من التطبيق، وهذا المسار الوحيد المشروع للإزالة.
 */
class PruneAiRecords extends Command
{
    public const MIN_DAYS = 30;

    protected $signature = 'ai:prune-records';

    protected $description = 'Delete AI audit events and finished request records past the retention window.';

    public function handle(): int
    {
        $days = max(self::MIN_DAYS, (int) config('ai_assistant.audit.retention_days', 400));
        $cutoff = now()->subDays($days);

        $events = DB::table('ai_audit_events')->where('occurred_at', '<', $cutoff)->delete();
        $requests = DB::table('ai_requests')->where('status', '!=', 'reserved')->where('created_at', '<', $cutoff)->delete();

        $this->info("Pruned {$events} audit events and {$requests} request records older than {$days} days.");

        return self::SUCCESS;
    }
}

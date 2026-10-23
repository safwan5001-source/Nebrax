<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Services\PaymentsRolloutControlService;
use App\Support\PaymentsRolloutControlException;
use App\Support\SchedulerHeartbeat;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * تشخيص `scheduler_unproven` المتقطع في إعداد اختبارات PostgreSQL المتزامنة (AWJ PostgreSQL CI Stabilization).
 *
 * الفشل يقع في `setUp` بعد `SchedulerHeartbeat::record()` مباشرةً ولم يُعاد إنتاجه محلياً على PostgreSQL 16 (فردياً ولا
 * بأربعة عمّال متوازين). هذا لا يخفّف شيئاً: الفشل يبقى فشلاً بالاستثناء نفسه سبباً، لكن رسالته تحمل لقطة الحالة الفعلية
 * (الصف الخام، ساعة القاعدة وPHP، المنطقة الزمنية للجلسة، رقم الجلسة، مستوى المعاملة، وهل تصحّ النبضة بعد إعادة كتابتها)
 * ليُحسم السبب من أول حدوث في CI بدل التخمين. لا يغيّر مسار نجاح ولا يلتقط استثناءً آخر.
 */
trait DiagnosesUnprovenScheduler
{
    protected function enableTenantPaymentsOrDiagnose(PlatformAdministrator $admin, string $tenantId, string $reason): void
    {
        try {
            app(PaymentsRolloutControlService::class)->setTenantState($admin, $tenantId, true, $reason);
        } catch (PaymentsRolloutControlException $e) {
            if ($e->reason !== 'scheduler_unproven') {
                throw $e;
            }

            throw new RuntimeException(
                'scheduler_unproven أثناء الإعداد — تشخيص: '.json_encode($this->schedulerDiagnostics(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                0,
                $e,
            );
        }
    }

    /** @return array<string, mixed> */
    private function schedulerDiagnostics(): array
    {
        $out = [
            'php_now_utc' => now('UTC')->toIso8601String(),
            'php_has_test_now' => Carbon::hasTestNow(),
            'php_pid' => getmypid(),
            'transaction_level' => DB::transactionLevel(),
            'connection_database' => DB::connection()->getDatabaseName(),
            'is_fresh_now' => SchedulerHeartbeat::isFresh(),
        ];

        try {
            $row = DB::selectOne(
                "select h.component, h.last_seen_at::text as last_seen_at_text, h.updated_at::text as updated_at_text,
                        now()::text as db_now, current_setting('TimeZone') as session_timezone, pg_backend_pid() as backend_pid,
                        (select count(*) from platform_runtime_heartbeats) as heartbeat_rows
                   from platform_runtime_heartbeats h where h.component = ?",
                [SchedulerHeartbeat::COMPONENT],
            );
            $out['row'] = $row === null ? null : (array) $row;
            $out['row_missing'] = $row === null;
        } catch (Throwable $t) {
            $out['row_query_error'] = $t->getMessage();
        }

        try {
            SchedulerHeartbeat::record();
            $out['is_fresh_after_rerecord'] = SchedulerHeartbeat::isFresh();
        } catch (Throwable $t) {
            $out['rerecord_error'] = $t->getMessage();
        }

        return $out;
    }
}

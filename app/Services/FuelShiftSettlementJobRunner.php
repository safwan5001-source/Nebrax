<?php

namespace App\Services;

use App\Models\FuelShiftSettlementJob;
use App\Support\SettlementJobHandler;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * عامل مهام تسوية الورديات (P1-3b-1، D-S2) — يعالج المهام المستحقة عبر المستأجرين بإيجار وحاجز. المُجدوِل (`fuel:settlement:run-jobs`) هو العامل الفعلي (الإنتاج بلا طوابير).
 *
 * كل مهمة: مطالبة ذرّية ← ضبط سياق المستأجر ← المعالج (`SettlementJobHandler`) ← تسجيل النتيجة بالحاجز. أي استثناء يُصنَّف برمز ثابت ويُسجَّل خطأ بتراجع أُسّي
 * (انقطاع الاتصال: إعادة اتصال ثم تسجيل؛ فشل التسجيل نفسه ⇒ تُترك المهمة `running` فينتهي إيجارها ويستردّها عامل آخر). لا أثر محاسبي هنا.
 */
class FuelShiftSettlementJobRunner
{
    private SettlementJobHandler $handler;

    /**
     * المعالج اختياري: غيابه ⇒ المعالج الخامل (فحوص مسبقة فقط). لا ربط للواجهة في مزوّد خدمة عمداً (`setup.sh`/CI لا ينسخان مزوّداً جديداً)؛ الاختبارات تربطه بـ`instance()`.
     */
    public function __construct(
        private FuelShiftSettlementJobService $jobs,
        private TenantContext $tenant,
        ?SettlementJobHandler $handler = null,
    ) {
        $this->handler = $handler ?? app(FuelShiftSettlementPrecheckHandler::class);
    }

    /** @return array<string,mixed> */
    public function run(?int $limit = null, ?string $workerToken = null): array
    {
        $summary = ['claimed' => 0, 'blocked' => 0, 'awaiting_engine' => 0, 'disabled' => 0, 'errors' => 0, 'failed' => 0, 'lost_lease' => 0];
        if (! FuelShiftSettlementReadiness::enabled()) {
            return $summary + ['skipped' => 'gate_closed'];
        }

        $limit ??= (int) config('fuel_stations.settlement_job.batch_limit', 20);
        $token = $workerToken ?? 'w-'.Str::uuid();
        $previous = $this->tenant->id();

        for ($i = 0; $i < $limit; $i++) {
            $job = $this->jobs->claimNext($token);
            if ($job === null) {
                break;
            }
            $summary['claimed']++;
            $this->tenant->set((string) $job->tenant_id);
            try {
                $this->process($job, $token, $summary);
            } finally {
                $previous === null ? $this->tenant->forget() : $this->tenant->set($previous);
            }
        }

        return $summary;
    }

    /** @param array<string,mixed> $summary */
    private function process(FuelShiftSettlementJob $job, string $token, array &$summary): void
    {
        try {
            $outcome = $this->handler->handle($job);
            if (! $this->jobs->record($job, $token, $outcome)) {
                $summary['lost_lease']++;

                return;
            }
            $summary[$outcome->outcome]++;
        } catch (Throwable $e) {
            report($e);
            $code = self::classify($e);
            try {
                $this->recordWithReconnect($job, $token, $code, $summary);
            } catch (Throwable $inner) {
                // لم نستطع تسجيل الخطأ (القاعدة غير متاحة): تبقى المهمة `running` بإيجارها فيستردّها عامل آخر بعد انتهائه (مسار «سقوط العامل»).
                report($inner);
                $summary['errors']++;
            }
        }
    }

    /** @param array<string,mixed> $summary */
    private function recordWithReconnect(FuelShiftSettlementJob $job, string $token, string $code, array &$summary): void
    {
        try {
            $recorded = $this->jobs->recordError($job, $token, $code);
        } catch (Throwable $first) {
            // اتصال مقطوع: نعيد الاتصال مرة واحدة ثم نحاول تسجيل الخطأ.
            DB::reconnect();
            $recorded = $this->jobs->recordError($job, $token, $code);
        }
        if (! $recorded) {
            $summary['lost_lease']++;

            return;
        }
        $summary['errors']++;
        if ($this->jobs->find($job->id)->status === FuelShiftSettlementJob::STATUS_FAILED) {
            $summary['failed']++;
        }
    }

    /** رمز خطأ ثابت لا يحمل نص الاستثناء (قد يتضمن قيماً). */
    public static function classify(Throwable $e): string
    {
        $state = $e instanceof QueryException ? (string) ($e->errorInfo[0] ?? '') : '';
        $text = $e->getMessage();
        if ($state === '40P01' || str_contains($text, '40P01') || stripos($text, 'deadlock') !== false) {
            return 'deadlock';
        }
        if ($state === '55P03' || str_contains($text, '55P03') || stripos($text, 'lock timeout') !== false || stripos($text, 'lock_timeout') !== false) {
            return 'lock_timeout';
        }
        if (str_starts_with($state, '08') || str_contains($text, 'SQLSTATE[08') || stripos($text, 'server has gone away') !== false
            || stripos($text, 'connection') !== false && ($e instanceof QueryException || $e instanceof \PDOException)) {
            return 'connection_lost';
        }

        return 'unexpected';
    }
}

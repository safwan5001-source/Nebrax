<?php

namespace App\Services;

use App\Models\PaymentRefund;
use App\Tenancy\TenantContext;
use Throwable;

/**
 * مطابِق استردادات البوابة المجدول (PAY-H3-01b، ADR-0007 §5-4): يعالج `unknown` (تصنيف الدليل: إعادة واحدة مبرَّرة / `probable_applied` / مراجعة بشرية)
 * ويستعيد `submitting` اليتيم (بلا سجل استدعاء) إلى `approved`. **لا يؤكّد أبداً وحده ولا يعيد إرسالاً أعمى ولا يكتب مالاً.** يعمل بلا سياق مستأجر ويثبّت سياق
 * كل استرداد أثناء معالجته ثم يمسحه. آمن للتكرار والتزامن (كل انتقال محروس بقفل الصف وحالته). لا يشترط ضابط التفعيل: ما أرسلناه فعلاً يجب أن يُحسم.
 */
final class PaymentRefundReconciler
{
    public function __construct(
        private readonly PaymentRefundService $refunds,
        private readonly TenantContext $tenant,
    ) {}

    /** @return array{unknown: int, orphans: int, retry_scheduled: int, probable_applied: int, needs_human: int, recovered: int, failed: int} */
    public function run(int $limit = 100, int $unknownGraceMinutes = PaymentRefundService::UNKNOWN_GRACE_MINUTES, int $orphanGraceMinutes = PaymentRefundService::ORPHAN_GRACE_MINUTES): array
    {
        $summary = ['unknown' => 0, 'orphans' => 0, 'retry_scheduled' => 0, 'probable_applied' => 0, 'needs_human' => 0, 'recovered' => 0, 'failed' => 0];

        $unknown = PaymentRefund::query()->withoutGlobalScopes()->where('status', PaymentRefund::UNKNOWN)->orderBy('updated_at')->limit($limit)->get(['id', 'tenant_id']);
        foreach ($unknown as $row) {
            $summary['unknown']++;
            $verdict = $this->within((string) $row->tenant_id, fn () => $this->refunds->reconcileUnknown(PaymentRefund::query()->findOrFail($row->id), $unknownGraceMinutes));
            if ($verdict === null) {
                $summary['failed']++;
            } elseif (isset($summary[$verdict])) {
                $summary[$verdict]++;
            }
        }

        $orphans = PaymentRefund::query()->withoutGlobalScopes()->where('status', PaymentRefund::SUBMITTING)->orderBy('updated_at')->limit($limit)->get(['id', 'tenant_id']);
        foreach ($orphans as $row) {
            $summary['orphans']++;
            $recovered = $this->within((string) $row->tenant_id, fn () => $this->refunds->recoverOrphanedSubmission(PaymentRefund::query()->findOrFail($row->id), $orphanGraceMinutes));
            if ($recovered === null) {
                $summary['failed']++;
            } elseif ($recovered === true) {
                $summary['recovered']++;
            }
        }

        return $summary;
    }

    /** @template T  @param  callable(): T  $work  @return T|null */
    private function within(string $tenantId, callable $work): mixed
    {
        $this->tenant->set($tenantId);
        try {
            return $work();
        } catch (Throwable) {
            return null;
        } finally {
            $this->tenant->forget();
        }
    }
}

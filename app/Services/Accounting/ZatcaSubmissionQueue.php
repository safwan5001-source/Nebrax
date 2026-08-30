<?php

namespace App\Services\Accounting;

use App\Jobs\Accounting\SendZatcaSubmission;
use App\Models\Invoice;
use App\Models\ZatcaSubmissionAttempt;
use App\Support\ZatcaSubmissionConflict;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** نقطة الصف الوحيدة: تدقق الجاهزية وتسجل كل صف/إعادة صف قبل التسليم للعامل. */
final class ZatcaSubmissionQueue
{
    public function __construct(private readonly ZatcaTransportReadiness $readiness) {}

    public function enqueue(ZatcaSubmissionAttempt $attempt): ZatcaSubmissionAttempt
    {
        $state = $this->readiness->inspect();
        if (! $state['ready']) {
            throw new RuntimeException('نقل ZATCA غير جاهز للتشغيل الآمن.');
        }

        return DB::transaction(function () use ($attempt, $state): ZatcaSubmissionAttempt {
            $locked = ZatcaSubmissionAttempt::query()->whereKey($attempt->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== 'pending') {
                throw new ZatcaSubmissionConflict('لا يمكن إعادة صف محاولة ZATCA منتهية.');
            }
            if ($locked->queue_count > 0
                && $locked->queued_at !== null
                && $locked->queued_at->isAfter(now()->subMinutes(5))) {
                throw new ZatcaSubmissionConflict('محاولة ZATCA صُفّت حديثاً وما زالت ضمن نافذة العامل.');
            }

            $invoice = Invoice::query()->whereKey($locked->invoice_id)->firstOrFail();
            if ($invoice->status !== 'posted' || ! is_string($invoice->zatca_xml) || $invoice->zatca_xml === '') {
                throw new RuntimeException('لقطة فاتورة ZATCA غير صالحة للصف.');
            }

            $locked->update([
                'queue_count' => $locked->queue_count + 1,
                'queued_at' => now(),
            ]);

            SendZatcaSubmission::dispatch(
                $locked->tenant_id,
                $locked->branch_id,
                $locked->id,
            )
                ->onConnection($state['queue_connection'])
                ->onQueue((string) config('zatca.transport.queue', 'zatca'))
                ->afterCommit();

            return $locked->refresh();
        }, 1);
    }
}

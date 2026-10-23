<?php

namespace App\Listeners;

use App\Events\PaymentRefundConfirmed;
use App\Models\PaymentRefund;
use App\Services\PaymentRefundPostingService;
use App\Tenancy\TenantContext;
use Throwable;

/**
 * يرحّل استرداداً مؤكَّداً فور التزامه (ADR-0007 A5). الإخفاق لا يُرمى للمُطلِق: يُبلَّغ عنه ويبقى الاسترداد `pending` فيلتقطه `payments:post-refunds` الدوري.
 */
final class PostConfirmedPaymentRefund
{
    public function __construct(
        private readonly PaymentRefundPostingService $posting,
        private readonly TenantContext $tenant,
    ) {}

    public function handle(PaymentRefundConfirmed $event): void
    {
        $owned = ! $this->tenant->has();
        if ($owned) {
            $this->tenant->set($event->tenantId);
        } elseif ((string) $this->tenant->id() !== $event->tenantId) {
            return; // سياق مستأجر مختلف: لا نخلطه، والمطابِق الدوري يتولى الأمر
        }

        try {
            $refund = PaymentRefund::query()->find($event->refundId);
            if ($refund !== null) {
                $this->posting->process($refund);
            }
        } catch (Throwable $e) {
            report($e);
        } finally {
            if ($owned) {
                $this->tenant->forget();
            }
        }
    }
}

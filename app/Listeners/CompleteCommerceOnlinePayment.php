<?php

namespace App\Listeners;

use App\Events\CommercePaymentAttemptCaptured;
use App\Models\PaymentAttempt;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Tenancy\TenantContext;
use Throwable;

/**
 * يثبّت نية طلب المتجر مدفوعةً فور التزام التقاط مؤكَّد (PAY-H4-04a). الإخفاق لا يُرمى للمُطلِق (قد يكون مسار webhook يجب أن يُقرّ): يُبلَّغ عنه
 * وتبقى النية `pending` فيلتقطه `payments:complete-commerce-captures` الدوري. idempotent.
 */
final class CompleteCommerceOnlinePayment
{
    public function __construct(
        private readonly CommerceOnlinePaymentService $online,
        private readonly TenantContext $tenant,
    ) {}

    public function handle(CommercePaymentAttemptCaptured $event): void
    {
        $owned = ! $this->tenant->has();
        if ($owned) {
            $this->tenant->set($event->tenantId);
        } elseif ((string) $this->tenant->id() !== $event->tenantId) {
            return; // سياق مستأجر مختلف: لا نخلطه، والأمر الدوري يتولى الأمر
        }

        try {
            $attempt = PaymentAttempt::query()->find($event->attemptId);
            if ($attempt !== null) {
                $this->online->completeCaptured($attempt);
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

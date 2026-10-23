<?php

namespace App\Listeners;

use App\Events\PaymentAttemptCaptured;
use App\Models\PaymentAttempt;
use App\Services\PaymentAttemptPostingService;
use App\Tenancy\TenantContext;
use Throwable;

/**
 * يرحّل التقاطاً مؤكَّداً فور التزامه (ADR-0006). الإخفاق لا يُرمى للمُطلِق (قد يكون مسار webhook يجب أن يُقرّ): يُبلَّغ عنه ويبقى الالتقاط
 * `pending` فيلتقطه `payments:post-captured` الدوري.
 */
final class PostCapturedPaymentAttempt
{
    public function __construct(
        private readonly PaymentAttemptPostingService $posting,
        private readonly TenantContext $tenant,
    ) {}

    public function handle(PaymentAttemptCaptured $event): void
    {
        $owned = ! $this->tenant->has();
        if ($owned) {
            $this->tenant->set($event->tenantId);
        } elseif ((string) $this->tenant->id() !== $event->tenantId) {
            return; // سياق مستأجر مختلف: لا نخلطه، والمطابِق الدوري يتولى الأمر
        }

        try {
            $attempt = PaymentAttempt::query()->find($event->attemptId);
            if ($attempt !== null) {
                $this->posting->process($attempt);
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

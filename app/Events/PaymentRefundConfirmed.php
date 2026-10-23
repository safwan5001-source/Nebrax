<?php

namespace App\Events;

/**
 * أكّد المزوّد استرداداً وثُبّتت حالته `confirmed` (يُطلق بعد التزام المعاملة، PAY-H3-01c). حدث إشعار فقط: لا يحمل مالاً؛ المستمع يستدعي خدمة الترحيل
 * (idempotent) وفشله لا يُفقد الإثبات لأن `payments:post-refunds` الدوري يعيد المحاولة.
 */
final class PaymentRefundConfirmed
{
    public function __construct(
        public readonly string $tenantId,
        public readonly string $refundId,
    ) {}
}

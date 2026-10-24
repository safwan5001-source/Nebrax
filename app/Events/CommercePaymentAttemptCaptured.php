<?php

namespace App\Events;

/**
 * التقط المزوّد محاولة دفع لنية طلب متجر وثُبّتت حالتها `captured` (يُطلق بعد التزام المعاملة، PAY-H4-04a). حدث إشعار فقط؛ المستمع يثبّت النية مدفوعة
 * (idempotent) وفشله لا يُفقد الالتقاط لأن `payments:complete-commerce-captures` الدوري يعيد المحاولة.
 */
final class CommercePaymentAttemptCaptured
{
    public function __construct(
        public readonly string $tenantId,
        public readonly string $attemptId,
    ) {}
}

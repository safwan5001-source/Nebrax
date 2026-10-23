<?php

namespace App\Events;

/**
 * التقط المزوّد محاولة دفع وثُبّتت حالتها `captured` (يُطلق بعد التزام المعاملة، PAY-H2-02c). حدث إشعار فقط: لا يحمل مالاً ولا يغيّر شيئاً؛
 * المستمع يستدعي خدمة الترحيل (idempotent) وفشله لا يُفقد الالتقاط لأن المطابِق الدوري يعيد المحاولة.
 */
final class PaymentAttemptCaptured
{
    public function __construct(
        public readonly string $tenantId,
        public readonly string $attemptId,
    ) {}
}

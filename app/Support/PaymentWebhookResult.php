<?php

namespace App\Support;

/** نتيجة استقبال webhook: رمز HTTP ومفتاح حالة ثابت (بلا قيم مزوّد). */
final class PaymentWebhookResult
{
    public function __construct(
        public readonly int $httpStatus,
        public readonly string $status,
    ) {}
}

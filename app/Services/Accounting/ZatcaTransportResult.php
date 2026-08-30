<?php

namespace App\Services\Accounting;

/** نتيجة نقل منقحة؛ لا تحتوي بيانات اعتماد ولا نسخة XML المرسلة. */
final class ZatcaTransportResult
{
    /** @param array<string, mixed> $auditPayload */
    public function __construct(
        public readonly string $status,
        public readonly ?int $httpStatus,
        public readonly string $responseCode,
        public readonly string $message,
        public readonly array $auditPayload,
        public readonly bool $retryable,
        public readonly ?string $clearedInvoice = null,
    ) {
    }
}

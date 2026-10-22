<?php

namespace App\Support;

/** نتيجة عملية محوّل جهاز دفع: الحالة لدى المزوّد + مراجع الموافقة (آخر 4 أرقام فقط — لا PAN ولا CVV). */
final class PosTerminalResult
{
    public const PENDING = 'pending';

    public const APPROVED = 'approved';

    public const DECLINED = 'declined';

    public const CANCELLED = 'cancelled';

    public const VOIDED = 'voided';

    public const ERROR = 'error';

    public function __construct(
        public readonly string $status,
        public readonly ?string $providerRef = null,
        public readonly ?string $approvalCode = null,
        public readonly ?string $rrn = null,
        public readonly ?string $last4 = null,
        public readonly ?int $amountMinor = null,
        public readonly ?string $failureCode = null,
    ) {}
}

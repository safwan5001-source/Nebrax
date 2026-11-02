<?php

namespace App\Services\Commerce;

use RuntimeException;

/** H6 Batch F — a refused channel-settings change, with a stable machine `reason` and the HTTP status to answer with. */
final class SalesChannelSettingsException extends RuntimeException
{
    /** @param array<string, mixed> $details حقول إضافية آمنة تُعاد في جسم الرد (مثل `current_version`)؛ فارغة افتراضياً فلا يتغيّر أي مستدعٍ قائم. */
    public function __construct(public readonly string $reason, string $message, public readonly int $status = 422, public readonly array $details = [])
    {
        parent::__construct($message);
    }
}

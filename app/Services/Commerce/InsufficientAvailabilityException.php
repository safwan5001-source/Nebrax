<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * رُفض الحجز: الكمية المتاحة للبيع (ATS) أقل من المطلوب. سلوك افتراضي مقصود
 * (ADR-02 §8) — لا حجز جزئي ولا بيع مؤجَّل ضمني عبر مخزون سالب.
 */
class InsufficientAvailabilityException extends RuntimeException
{
}

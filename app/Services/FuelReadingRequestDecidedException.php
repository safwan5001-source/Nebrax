<?php

namespace App\Services;

use RuntimeException;

/**
 * FUEL-B6: الطلب قُرِّر سابقاً بقرار مختلف (أو من مقرِّر آخر). استثناء مستقل ليُحوَّل إلى 409 لا 422 في `FuelReadingRequestController`
 * (HttpException/RuntimeException كان `domain()` يحوّله إلى 422).
 */
class FuelReadingRequestDecidedException extends RuntimeException
{
    public function __construct(string $message, public readonly string $currentStatus)
    {
        parent::__construct($message);
    }
}

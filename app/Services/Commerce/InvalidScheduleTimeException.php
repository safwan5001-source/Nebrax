<?php

namespace App\Services\Commerce;

use RuntimeException;

/** CUST-H1-4 — `scheduled_for` ليس في المستقبل عند لحظة الجدولة/إعادة الجدولة. */
final class InvalidScheduleTimeException extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('وقت الجدولة يجب أن يكون في المستقبل.');
    }
}

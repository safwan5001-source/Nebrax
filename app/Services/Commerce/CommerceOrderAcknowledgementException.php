<?php

namespace App\Services\Commerce;

use RuntimeException;

/** رفض إقرار تنبيه طلب (COPS-H3-4) برمز ثابت `reason` وحالة HTTP (409 للحالة، 422 لغير المؤكَّد). */
final class CommerceOrderAcknowledgementException extends RuntimeException
{
    public const NOT_CONFIRMED = 'not_confirmed';

    public const ALREADY_CANCELLED = 'already_cancelled';

    /** R-5: نية إلكترونية غير مدفوعة (أو بلا نية جاهزة) — لم يُنبَّه بها أصلاً فلا إقرار. */
    public const NOT_ALERTABLE = 'not_alertable';

    public function __construct(public readonly string $reason, string $message, public readonly int $status = 409)
    {
        parent::__construct($message);
    }
}

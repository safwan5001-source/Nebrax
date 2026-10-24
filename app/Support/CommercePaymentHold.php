<?php

namespace App\Support;

use Carbon\CarbonImmutable;

/**
 * H4-02 / D-14: مدة حجز مخزون الطلب الإلكتروني بانتظار الدفع. `sales.commerce_payment_hold_minutes` (الافتراضي 60، ضمن 15..1440).
 * الحجز **وعدٌ لا حركة مخزون**، ولا يُحرَّر عند بلوغ الموعد تلقائياً: المكنسة (`CommerceUnpaidOrderSweeper`) وحدها تحرّره بعد التحقق من
 * حالة الدفع لدى المزوّد، فلا يُباع مخزون طلب مدفوع فعلاً بسبب تأخر webhook أو انقطاع.
 */
final class CommercePaymentHold
{
    public const DEFAULT_MINUTES = 60;

    public const MIN_MINUTES = 15;

    public const MAX_MINUTES = 1440;

    public static function minutes(): int
    {
        $value = Settings::get('sales', 'commerce_payment_hold_minutes');

        return is_int($value) || (is_string($value) && ctype_digit($value))
            ? max(self::MIN_MINUTES, min(self::MAX_MINUTES, (int) $value))
            : self::DEFAULT_MINUTES;
    }

    public static function expiresAt(): CarbonImmutable
    {
        return CarbonImmutable::now('UTC')->addMinutes(self::minutes());
    }
}

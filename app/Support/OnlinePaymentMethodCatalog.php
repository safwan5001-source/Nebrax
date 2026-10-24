<?php

namespace App\Support;

/**
 * سجل وسائل الدفع **الإلكتروني** المعروضة للعميل (PAY-SETTINGS-UX). منفصل تماماً عن `PaymentMethod` (طرق التحصيل النقدي/البنكي/الشيك) وعن أجهزة POS.
 * المفتاح ثابت؛ الدعم يُعلنه المحوّل في `PaymentGatewayCapabilities` لا هذا السجل.
 */
final class OnlinePaymentMethodCatalog
{
    public const MADA = 'mada';

    public const VISA = 'visa';

    public const MASTERCARD = 'mastercard';

    public const APPLE_PAY = 'apple_pay';

    public const KEYS = [self::MADA, self::VISA, self::MASTERCARD, self::APPLE_PAY];

    public static function isKnown(string $key): bool
    {
        return in_array($key, self::KEYS, true);
    }
}

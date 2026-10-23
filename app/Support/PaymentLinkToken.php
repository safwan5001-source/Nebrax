<?php

namespace App\Support;

/**
 * رمز رابط الدفع العام (PAY-H2-02e): 32 بايتاً عشوائياً آمناً تشفيرياً بترميز base64url (43 حرفاً)، ويُخزَّن SHA-256 (hex، 64) وحده. الاستعلام بالهاش
 * عبر فهرس فريد، فلا مقارنة نصية بالرمز الخام. صيغة غير مطابقة ⇒ تُرفض قبل أي استعلام.
 */
final class PaymentLinkToken
{
    public const LENGTH = 43;

    public static function generate(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }

    public static function wellFormed(string $token): bool
    {
        return preg_match('/^[A-Za-z0-9_-]{'.self::LENGTH.'}$/', $token) === 1;
    }
}

<?php

namespace App\Support;

/**
 * سياسة رمز PIN لتطبيق المحطات (6 أرقام لاتينية 0–9). دوال نقية بلا حالة.
 *
 * - الشكل: ستة أرقام بالضبط (يُحوَّل العربي/الفارسي إلى لاتيني قبل التحقق).
 * - الضعيف يُرفض عند التعيين (كلها رقم واحد، تصاعدي/تنازلي متتالٍ): قرار أمني ثابت لا سياسة عمل.
 * - التوليد عشوائي مشفّر (random_int) ويتجنب الضعيف.
 */
final class StationPin
{
    public const LENGTH = 6;

    private const EASTERN_ARABIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

    private const PERSIAN = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

    /** أرقام عربية/فارسية ← لاتينية + حذف الفراغات. */
    public static function normalize(string $input): string
    {
        $digits = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
        $input = str_replace(self::EASTERN_ARABIC, $digits, $input);
        $input = str_replace(self::PERSIAN, $digits, $input);

        return preg_replace('/\s+/u', '', $input) ?? '';
    }

    public static function isWellFormed(string $pin): bool
    {
        return preg_match('/\A[0-9]{6}\z/D', $pin) === 1;
    }

    public static function isWeak(string $pin): bool
    {
        if (! self::isWellFormed($pin)) {
            return true;
        }
        if (count(array_unique(str_split($pin))) === 1) {
            return true; // 000000 … 999999
        }
        $steps = [];
        for ($i = 1; $i < self::LENGTH; $i++) {
            $steps[] = (int) $pin[$i] - (int) $pin[$i - 1];
        }
        $unique = array_unique($steps);

        return count($unique) === 1 && in_array($unique[0], [1, -1], true); // 123456 / 654321 …
    }

    public static function generate(): string
    {
        do {
            $pin = str_pad((string) random_int(0, 999999), self::LENGTH, '0', STR_PAD_LEFT);
        } while (self::isWeak($pin));

        return $pin;
    }
}

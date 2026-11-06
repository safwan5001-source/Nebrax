<?php

namespace App\Support;

/**
 * AIA-0.1 / D-12 (الخيار C) — العملات التي يضمن الغلاف المالي لها أُسّ الوحدة الصغرى.
 *
 * قائمة بيضاء **SAR فقط** (الأُسّ 2). أي رمز آخر — حتى لو كان ISO صحيحاً (KWD=3، JPY=0) — يعيد `null`:
 * القيم المخزّنة لمستأجر بعملة أخرى أُدخلت على افتراض ×100 (انظر `AIA-D12-CURRENCY-MONEY-CONTRACT-ASSESSMENT`)،
 * فتفسيرها بأُسّ آخر يعيد نوع «خطأ المقياس» الذي وُضع الغلاف لمنعه. التوسعة (الخيار B) شريحة مستقلة لاحقة.
 *
 * دالة نقية: لا قاعدة بيانات ولا حالة. لا تلمس `Money::toRiyal`.
 */
final class CurrencyMinorUnits
{
    /** @var array<string, int> */
    private const SUPPORTED = ['SAR' => 2];

    /** رمز العملة بصيغته القانونية (أحرف كبيرة بلا فراغات) أو `null` إن لم يكن نصاً. */
    public static function normalize(mixed $code): ?string
    {
        if (! is_string($code)) {
            return null;
        }
        $normalized = strtoupper(trim($code));

        return $normalized === '' ? null : $normalized;
    }

    /** أُسّ الوحدة الصغرى المضمون للعملة، أو `null` إن كانت غير مدعومة في هذا الإصدار. */
    public static function exponentFor(mixed $code): ?int
    {
        $normalized = self::normalize($code);

        return $normalized === null ? null : (self::SUPPORTED[$normalized] ?? null);
    }
}

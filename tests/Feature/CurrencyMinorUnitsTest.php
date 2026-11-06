<?php

namespace Tests\Feature;

use App\Support\CurrencyMinorUnits;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * AIA-0.1 / D-12 (الخيار C) — القائمة البيضاء SAR فقط. دالة نقية بلا قاعدة بيانات.
 */
class CurrencyMinorUnitsTest extends TestCase
{
    public static function supported(): array
    {
        return [['SAR'], ['sar'], [' SAR '], ["\tSar\n"]];
    }

    public static function unsupported(): array
    {
        // KWD (3 منازل) وJPY (0) رموز ISO صحيحة لكنها غير مدعومة عمداً؛ XYZ ليس رمزاً أصلاً.
        return [['KWD'], ['kwd'], ['JPY'], ['BHD'], ['OMR'], ['USD'], ['AED'], ['XYZ'], ['xyz'], [''], ['   '], [null], [123], [['SAR']], [false]];
    }

    #[Test]
    #[DataProvider('supported')]
    public function sar_is_supported_with_exponent_two_regardless_of_case_and_whitespace(mixed $code): void
    {
        $this->assertSame(2, CurrencyMinorUnits::exponentFor($code));
        $this->assertSame('SAR', CurrencyMinorUnits::normalize($code));
    }

    #[Test]
    #[DataProvider('unsupported')]
    public function every_other_value_is_unsupported(mixed $code): void
    {
        $this->assertNull(CurrencyMinorUnits::exponentFor($code));
    }
}

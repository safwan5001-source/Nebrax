<?php

namespace App\Support;

/**
 * تحويل النقود من الهللات (minor units) إلى نص عشري للعرض — بلا float.
 * 115000 → "1150.00"
 */
class Money
{
    public static function toRiyal(?int $minor): string
    {
        $minor = (int) $minor;
        $sign  = $minor < 0 ? '-' : '';
        $minor = abs($minor);

        return sprintf('%s%d.%02d', $sign, intdiv($minor, 100), $minor % 100);
    }
}

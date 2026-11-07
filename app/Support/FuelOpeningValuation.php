<?php

namespace App\Support;

use RuntimeException;

/**
 * FUEL-TANKS-V2 / PR-1 — تقييم الرصيد الافتتاحي للوقود (دالة نقية بأعداد صحيحة فقط، بلا float).
 *
 * التكلفة تُدخل **للمنتج** بالهللة للتر الواحد. قيمة الكمية (مللتر) = الكمية × تكلفة اللتر ÷ 1000 بتقريب
 * **نصف لأعلى** إلى أقرب هللة (قرار D2). ولأن مجمّع التكلفة واحد للمنتج، يُقرَّب **مجموع المنتج مرة واحدة**، ثم يُوزَّع على
 * خزاناته بطريقة المجموع التراكمي: قيمة السطر k = R(Σ₁..ₖ) − R(Σ₁..ₖ₋₁). فيتطابق مجموع قيم السطور مع قيمة المنتج
 * هللةً بهللة مهما تعدّدت الخزانات، ولا يتغير الناتج بتجزئة الكمية إلا بالترتيب الثابت (position).
 */
final class FuelOpeningValuation
{
    public const MILLILITERS_PER_LITER = 1000;

    /** نصف لأعلى لـ (مللتر × هللة/لتر ÷ 1000). */
    public static function value(int $milliliters, int $costPerLiterMinor): int
    {
        if ($milliliters < 0 || $costPerLiterMinor < 0) {
            throw new RuntimeException('كمية وتكلفة الرصيد الافتتاحي لا تكونان سالبتين.');
        }
        if ($milliliters === 0 || $costPerLiterMinor === 0) {
            return 0;
        }
        // 2×m×c + 1000 يجب أن يبقى ضمن int: وإلا لانقلب الحساب صامتاً إلى float.
        if ($milliliters > intdiv(PHP_INT_MAX - self::MILLILITERS_PER_LITER, 2 * $costPerLiterMinor)) {
            throw new RuntimeException('قيمة الرصيد الافتتاحي للوقود تتجاوز الحد المسموح به.');
        }

        return intdiv(2 * $milliliters * $costPerLiterMinor + self::MILLILITERS_PER_LITER, 2 * self::MILLILITERS_PER_LITER);
    }

    /**
     * توزيع قيمة المنتج على سطور خزاناته بالمجموع التراكمي.
     *
     * @param  list<int>  $lineMilliliters  كميات السطور بترتيب position
     * @return list<int>                   قيم السطور؛ مجموعها = value(Σ الكميات, التكلفة)
     */
    public static function split(array $lineMilliliters, int $costPerLiterMinor): array
    {
        $values = [];
        $cumulative = 0;
        $previous = 0;
        foreach ($lineMilliliters as $milliliters) {
            if (! is_int($milliliters) || $milliliters <= 0) {
                throw new RuntimeException('كمية سطر الرصيد الافتتاحي يجب أن تكون عدداً صحيحاً موجباً.');
            }
            if ($cumulative > PHP_INT_MAX - $milliliters) {
                throw new RuntimeException('كمية الرصيد الافتتاحي تتجاوز الحد المسموح به.');
            }
            $cumulative += $milliliters;
            $running = self::value($cumulative, $costPerLiterMinor);
            $values[] = $running - $previous;
            $previous = $running;
        }

        return $values;
    }
}

<?php

namespace App\Services\Accounting;

use RuntimeException;

/**
 * تسعير نسبي عام لسطر فاتورة. السطر التقليدي يظل quantity × unit_price؛ أما
 * المسار النسبي فيحتفظ بالبسط/المقام ويقرّب مرة واحدة إلى هللات عند حد السطر.
 */
final class InvoiceLinePrecision
{
    public const ROUNDING_HALF_UP = 'half_up';

    /** @param array<string,mixed> $item @return array<string,int|string>|null */
    public function fromItem(array $item, int $unitPriceMinor): ?array
    {
        $hasNumerator = array_key_exists('quantity_numerator', $item);
        $hasDenominator = array_key_exists('quantity_denominator', $item);
        if (! $hasNumerator && ! $hasDenominator) {
            return null;
        }
        if (! $hasNumerator || ! $hasDenominator) {
            throw new RuntimeException('الكمية النسبية تحتاج quantity_numerator وquantity_denominator معاً.');
        }

        $quantityNumerator = $this->positiveInteger($item['quantity_numerator'], 'quantity_numerator');
        $quantityDenominator = $this->positiveInteger($item['quantity_denominator'], 'quantity_denominator');
        if ($unitPriceMinor < 0) {
            throw new RuntimeException('سعر الوحدة النسبي لا يكون سالباً.');
        }
        if ($quantityNumerator > intdiv(PHP_INT_MAX, max(1, $unitPriceMinor))) {
            throw new RuntimeException('قيمة تسعير السطر النسبي تتجاوز الحد المسموح به.');
        }

        $pricingNumerator = $quantityNumerator * $unitPriceMinor;
        $whole = intdiv($pricingNumerator, $quantityDenominator);
        $remainder = $pricingNumerator % $quantityDenominator;
        if ($remainder > intdiv($quantityDenominator, 2)
            || ($quantityDenominator % 2 === 0 && $remainder === intdiv($quantityDenominator, 2))) {
            if ($whole === PHP_INT_MAX) {
                throw new RuntimeException('قيمة تسعير السطر النسبي تتجاوز الحد المسموح به.');
            }
            $whole++;
        }

        return [
            'quantity_numerator' => $quantityNumerator,
            'quantity_denominator' => $quantityDenominator,
            'pricing_numerator' => (string) $pricingNumerator,
            'pricing_denominator' => (string) $quantityDenominator,
            'rounded_gross_minor' => $whole,
            'rounding_remainder_numerator' => (string) $remainder,
            'rounding_remainder_denominator' => (string) $quantityDenominator,
            'rounding_policy' => self::ROUNDING_HALF_UP,
        ];
    }

    private function positiveInteger(mixed $value, string $key): int
    {
        if (! is_int($value) && !(is_string($value) && preg_match('/^[1-9][0-9]*$/', $value))) {
            throw new RuntimeException("{$key} يجب أن يكون عدداً صحيحاً موجباً.");
        }
        $integer = (int) $value;
        if ($integer <= 0 || (string) $integer !== (string) $value) {
            throw new RuntimeException("{$key} يتجاوز الحد المسموح به.");
        }

        return $integer;
    }
}

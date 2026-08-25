<?php

namespace App\Services\DocumentCenter;

use App\Services\Accounting\InvoiceLinePrecision;
use App\Support\Settings;
use RuntimeException;

final class DocumentFinancialValidator
{
    private const ROUNDING_TOLERANCE_MINOR = 1;

    public function __construct(private readonly InvoiceLinePrecision $precision)
    {
    }

    /** @param array<string, mixed> $payload
     *  @return list<array{subject_key:string,code:string,severity:string,safe_message:string,metadata:array<string,int|string|null>}>
     */
    public function validate(array $payload, string $documentType): array
    {
        $issues = [];
        $fields = is_array($payload['fields'] ?? null) ? $payload['fields'] : [];
        $lines = is_array($payload['lines'] ?? null) ? $payload['lines'] : [];
        $inclusive = $fields['price_includes_tax'] ?? null;
        $currency = $this->nullableText($fields['currency'] ?? null);
        if ($currency === null) {
            $issues[] = $this->issue('header.currency', 'currency_missing', 'blocking', 'عملة المستند غير متاحة للتحقق المالي.');
        }

        $normalizedType = mb_strtolower($documentType);
        $settingsGroup = str_contains($normalizedType, 'purchase') || str_contains($normalizedType, 'expense') ? 'purchases' : 'sales';
        $expectedRate = (int) Settings::get($settingsGroup, 'default_tax_rate');
        $lineTotals = 0;
        $lineTaxes = 0;
        $lineSubtotals = 0;
        foreach ($lines as $index => $line) {
            if (! is_array($line)) {
                continue;
            }
            $key = "lines.{$index}";
            $total = $this->minor($line['total_minor'] ?? null);
            $tax = $this->minor($line['tax_amount_minor'] ?? null);
            $discount = $this->minor($line['discount_minor'] ?? null) ?? 0;
            $price = $this->minor($line['unit_price_minor'] ?? null);
            $rate = $this->rate($line['tax_rate'] ?? null);
            if ($total === null || $tax === null || $price === null) {
                $issues[] = $this->issue($key, 'line_total_mismatch', 'blocking', 'قيم سعر الوحدة أو إجمالي السطر أو ضريبته غير مكتملة.');
                continue;
            }

            try {
                $gross = $this->grossFor($line['quantity'] ?? null, $price);
            } catch (RuntimeException) {
                $issues[] = $this->issue($key, 'financial_value_overflow', 'blocking', 'قيمة كمية السطر أو تسعيره تتجاوز الحدود الآمنة للتحقق.');
                continue;
            }
            if ($gross === null) {
                $issues[] = $this->issue($key, 'line_total_mismatch', 'blocking', 'كمية السطر يجب أن تكون موجبة وممثلة نصياً بصورة آمنة.');
                continue;
            }
            if ($discount > $gross) {
                $issues[] = $this->issue($key, 'discount_exceeds_line', 'blocking', 'خصم السطر يتجاوز إجماليه قبل الخصم.');
                continue;
            }
            $base = $gross - $discount;
            try {
                if ($rate === null || ! in_array($rate, [0, $expectedRate], true)) {
                $issues[] = $this->issue($key, 'tax_rate_unsupported', 'warning', 'معدل ضريبة السطر غير مدعوم أو يحتاج مراجعة.', ['tax_rate' => $rate]);
            } elseif ($inclusive === true) {
                $expectedTax = $this->extractTax($base, $rate);
                $expectedNet = $base - $expectedTax;
                if ($this->differenceExceeds($tax, $expectedTax) || $this->differenceExceeds($total, $base)) {
                    $issues[] = $this->issue($key, 'line_total_mismatch', 'blocking', 'إجمالي السطر الشامل للضريبة أو ضريبته لا يطابقان الحساب بالـminor units.', ['expected_minor' => $base, 'actual_minor' => $total]);
                }
                if (! $this->addTo($lineSubtotals, $expectedNet) || ! $this->addTo($lineTaxes, $tax) || ! $this->addTo($lineTotals, $total)) {
                    $issues[] = $this->issue($key, 'financial_value_overflow', 'blocking', 'تجميع قيم المستند يتجاوز الحدود الآمنة للتحقق.');
                }
                continue;
            } elseif ($inclusive === false) {
                $expectedTax = $this->calcTax($base, $rate);
                $expectedTotal = $this->safeAdd($base, $expectedTax);
                if ($this->differenceExceeds($tax, $expectedTax) || $this->differenceExceeds($total, $expectedTotal)) {
                    $issues[] = $this->issue($key, 'line_total_mismatch', 'blocking', 'إجمالي السطر أو ضريبته لا يطابقان الحساب بالـminor units.', ['expected_minor' => $expectedTotal, 'actual_minor' => $total]);
                }
                if (! $this->addTo($lineSubtotals, $base) || ! $this->addTo($lineTaxes, $tax) || ! $this->addTo($lineTotals, $total)) {
                    $issues[] = $this->issue($key, 'financial_value_overflow', 'blocking', 'تجميع قيم المستند يتجاوز الحدود الآمنة للتحقق.');
                }
                continue;
            }

                $issues[] = $this->issue($key, 'tax_rate_unsupported', 'warning', 'لا يمكن تحديد ما إذا كان السعر شاملاً للضريبة ويحتاج مراجعة.');
                if (! $this->addTo($lineTaxes, $tax) || ! $this->addTo($lineTotals, $total)) {
                    $issues[] = $this->issue($key, 'financial_value_overflow', 'blocking', 'تجميع قيم المستند يتجاوز الحدود الآمنة للتحقق.');
                }
            } catch (RuntimeException) {
                $issues[] = $this->issue($key, 'financial_value_overflow', 'blocking', 'قيمة السطر تتجاوز الحدود الآمنة للتحقق المالي.');
            }
        }

        $headerSubtotal = $this->minor($fields['subtotal_minor'] ?? null);
        $headerTax = $this->minor($fields['tax_amount_minor'] ?? null);
        $headerTotal = $this->minor($fields['total_amount_minor'] ?? null);
        if ($headerSubtotal !== null && $this->differenceExceeds($headerSubtotal, $lineSubtotals)) {
            $issues[] = $this->issue('header.subtotal_minor', 'line_total_mismatch', 'blocking', 'إجمالي ما قبل الضريبة في الرأس لا يطابق مجموع السطور.', ['expected_minor' => $lineSubtotals, 'actual_minor' => $headerSubtotal]);
        }
        if ($headerTax !== null && $this->differenceExceeds($headerTax, $lineTaxes)) {
            $issues[] = $this->issue('header.tax_amount_minor', 'tax_total_mismatch', 'blocking', 'إجمالي الضريبة في الرأس لا يطابق مجموع السطور.', ['expected_minor' => $lineTaxes, 'actual_minor' => $headerTax]);
        }
        if ($headerTotal !== null && $this->differenceExceeds($headerTotal, $lineTotals)) {
            $issues[] = $this->issue('header.total_amount_minor', 'document_total_mismatch', 'blocking', 'إجمالي الرأس لا يطابق مجموع إجماليات السطور.', ['expected_minor' => $lineTotals, 'actual_minor' => $headerTotal]);
        }

        return $issues;
    }

    private function grossFor(mixed $quantity, int $unitPriceMinor): ?int
    {
        $fraction = $this->quantityFraction($quantity);
        if ($fraction === null) {
            return null;
        }
        $evidence = $this->precision->fromItem([
            'quantity_numerator' => $fraction['numerator'],
            'quantity_denominator' => $fraction['denominator'],
        ], $unitPriceMinor);

        return $evidence['rounded_gross_minor'] ?? null;
    }

    /** @return array{numerator:int,denominator:int}|null */
    private function quantityFraction(mixed $value): ?array
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }
        $value = trim((string) $value);
        if (! preg_match('/^([0-9]+)(?:\.([0-9]{1,6}))?$/', $value, $matches)) {
            return null;
        }
        $fractionDigits = $matches[2] ?? '';
        $numeratorText = ltrim($matches[1].$fractionDigits, '0');
        if ($numeratorText === '') {
            return null;
        }
        $denominatorText = $fractionDigits === '' ? '1' : '1'.str_repeat('0', strlen($fractionDigits));
        $numerator = $this->safeInteger($numeratorText);
        $denominator = $this->safeInteger($denominatorText);
        if ($numerator === null || $denominator === null) {
            throw new RuntimeException('Quantity exceeds safe integer representation.');
        }

        return ['numerator' => $numerator, 'denominator' => $denominator];
    }

    private function calcTax(int $base, int $rate): int
    {
        if ($rate > 0 && $base > intdiv(PHP_INT_MAX - 50, $rate)) {
            throw new RuntimeException('Tax calculation exceeds safe integer representation.');
        }

        return intdiv($base * $rate + 50, 100);
    }

    private function extractTax(int $inclusive, int $rate): int
    {
        if ($inclusive <= 0 || $rate <= 0) {
            return 0;
        }
        $denominator = 100 + $rate;
        if ($inclusive > intdiv(PHP_INT_MAX - $denominator, 2 * $rate)) {
            throw new RuntimeException('Tax extraction exceeds safe integer representation.');
        }

        return intdiv((2 * $inclusive * $rate) + $denominator, 2 * $denominator);
    }

    private function safeAdd(int $left, int $right): int
    {
        if ($left > PHP_INT_MAX - $right) {
            throw new RuntimeException('Financial addition exceeds safe integer representation.');
        }

        return $left + $right;
    }

    private function addTo(int &$total, int $value): bool
    {
        if ($total > PHP_INT_MAX - $value) {
            return false;
        }
        $total += $value;

        return true;
    }

    private function differenceExceeds(int $left, int $right): bool
    {
        return $left >= $right
            ? $left - $right > self::ROUNDING_TOLERANCE_MINOR
            : $right - $left > self::ROUNDING_TOLERANCE_MINOR;
    }

    private function minor(mixed $value): ?int
    {
        if (is_int($value) && $value >= 0) {
            return $value;
        }
        if (is_string($value) && preg_match('/^\d+$/', $value)) {
            $integer = $this->safeInteger($value);

            return $integer;
        }

        return null;
    }

    private function safeInteger(string $value): ?int
    {
        $normalized = ltrim($value, '0');
        $normalized = $normalized === '' ? '0' : $normalized;
        $maximum = (string) PHP_INT_MAX;
        if (strlen($normalized) > strlen($maximum) || (strlen($normalized) === strlen($maximum) && strcmp($normalized, $maximum) > 0)) {
            return null;
        }

        return (int) $normalized;
    }

    private function rate(mixed $value): ?int
    {
        if (is_int($value) && $value >= 0) {
            return $value;
        }

        return is_string($value) && preg_match('/^\d+$/', $value) ? $this->safeInteger($value) : null;
    }

    private function nullableText(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /** @param array<string, int|string|null> $metadata */
    private function issue(string $subjectKey, string $code, string $severity, string $message, array $metadata = []): array
    {
        return ['subject_key' => $subjectKey, 'code' => $code, 'severity' => $severity, 'safe_message' => $message, 'metadata' => $metadata];
    }
}

<?php

namespace App\Services\DocumentCenter;

use App\Support\Settings;

final class DocumentFinancialValidator
{
    private const ROUNDING_TOLERANCE_MINOR = 1;

    /** @param array<string, mixed> $payload
     *  @return list<array{subject_key:string,code:string,severity:string,safe_message:string,metadata:array<string,int|string|null>}>
     */
    public function validate(array $payload): array
    {
        $issues = [];
        $fields = is_array($payload['fields'] ?? null) ? $payload['fields'] : [];
        $lines = is_array($payload['lines'] ?? null) ? $payload['lines'] : [];
        $inclusive = $fields['price_includes_tax'] ?? null;
        $currency = $this->nullableText($fields['currency'] ?? null);
        if ($currency === null) {
            $issues[] = $this->issue('header.currency', 'currency_missing', 'blocking', 'عملة المستند غير متاحة للتحقق المالي.');
        }

        $documentType = mb_strtolower(is_string($payload['document_type'] ?? null) ? $payload['document_type'] : '');
        $settingsGroup = str_contains($documentType, 'purchase') || str_contains($documentType, 'expense') ? 'purchases' : 'sales';
        $expectedRate = (int) Settings::get($settingsGroup, 'default_tax_rate');
        $lineTotals = 0;
        $lineTaxes = 0;
        foreach ($lines as $index => $line) {
            if (! is_array($line)) {
                continue;
            }
            $key = "lines.{$index}";
            $quantity = $this->quantity($line['quantity'] ?? null);
            if ($quantity === null || $quantity === '0') {
                $issues[] = $this->issue($key, 'line_total_mismatch', 'blocking', 'كمية السطر يجب أن تكون موجبة وممثلة نصياً بصورة آمنة.');
            }
            $total = $this->minor($line['total_minor'] ?? null);
            $tax = $this->minor($line['tax_amount_minor'] ?? null);
            $discount = $this->minor($line['discount_minor'] ?? null) ?? 0;
            $price = $this->minor($line['unit_price_minor'] ?? null);
            $rate = $this->rate($line['tax_rate'] ?? null);
            if ($total === null || $tax === null) {
                $issues[] = $this->issue($key, 'line_total_mismatch', 'blocking', 'قيم إجمالي السطر أو ضريبته غير مكتملة.');
                continue;
            }
            if ($discount < 0 || ($price !== null && $discount > $price)) {
                $issues[] = $this->issue($key, 'discount_exceeds_line', 'blocking', 'خصم السطر يتجاوز قيمة السطر المستخرجة.');
            }
            if ($rate === null || ! in_array($rate, [0, $expectedRate], true)) {
                $issues[] = $this->issue($key, 'tax_rate_unsupported', 'warning', 'معدل ضريبة السطر غير مدعوم أو يحتاج مراجعة.', ['tax_rate' => $rate]);
            } elseif ($inclusive === true) {
                $expectedTax = $this->extractTax($total, $rate);
                if (abs($tax - $expectedTax) > self::ROUNDING_TOLERANCE_MINOR) {
                    $issues[] = $this->issue($key, 'tax_total_mismatch', 'blocking', 'ضريبة السطر المتضمن لا تطابق المبلغ المستخرج.', ['expected_minor' => $expectedTax, 'actual_minor' => $tax]);
                }
            } elseif ($inclusive === false && $price !== null && $this->isIntegerQuantity($quantity)) {
                $gross = ((int) $quantity) * $price;
                $net = $gross - $discount;
                if ($net < 0) {
                    $issues[] = $this->issue($key, 'discount_exceeds_line', 'blocking', 'خصم السطر يجعل أساسه المالي سالباً.');
                } else {
                    $expectedTax = $this->calcTax($net, $rate);
                    $expectedTotal = $net + $expectedTax;
                    if (abs($tax - $expectedTax) > self::ROUNDING_TOLERANCE_MINOR || abs($total - $expectedTotal) > self::ROUNDING_TOLERANCE_MINOR) {
                        $issues[] = $this->issue($key, 'line_total_mismatch', 'blocking', 'إجمالي السطر أو ضريبته لا يطابقان الحساب بالـminor units.', ['expected_minor' => $expectedTotal, 'actual_minor' => $total]);
                    }
                }
            }
            $lineTotals += $total;
            $lineTaxes += $tax;
        }

        $headerTax = $this->minor($fields['tax_amount_minor'] ?? null);
        $headerTotal = $this->minor($fields['total_amount_minor'] ?? null);
        if ($headerTax !== null && abs($headerTax - $lineTaxes) > self::ROUNDING_TOLERANCE_MINOR) {
            $issues[] = $this->issue('header.tax_amount_minor', 'tax_total_mismatch', 'blocking', 'إجمالي الضريبة في الرأس لا يطابق مجموع السطور.', ['expected_minor' => $lineTaxes, 'actual_minor' => $headerTax]);
        }
        if ($headerTotal !== null && abs($headerTotal - $lineTotals) > self::ROUNDING_TOLERANCE_MINOR) {
            $issues[] = $this->issue('header.total_amount_minor', 'document_total_mismatch', 'blocking', 'إجمالي الرأس لا يطابق مجموع إجماليات السطور.', ['expected_minor' => $lineTotals, 'actual_minor' => $headerTotal]);
        }

        return $issues;
    }

    private function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    private function extractTax(int $inclusive, int $rate): int
    {
        if ($inclusive <= 0 || $rate <= 0) {
            return 0;
        }
        $denominator = 100 + $rate;
        return intdiv((2 * $inclusive * $rate) + $denominator, 2 * $denominator);
    }

    private function minor(mixed $value): ?int
    {
        if (is_int($value) && $value >= 0) {
            return $value;
        }
        if (is_string($value) && preg_match('/^\d+$/', $value)) {
            return (int) $value;
        }
        return null;
    }

    private function rate(mixed $value): ?int
    {
        if (is_int($value)) {
            return $value;
        }
        return is_string($value) && preg_match('/^\d+$/', $value) ? (int) $value : null;
    }

    private function quantity(mixed $value): ?string
    {
        if (! is_string($value) && ! is_int($value)) {
            return null;
        }
        $value = trim((string) $value);
        return preg_match('/^\d+(?:\.\d+)?$/', $value) ? $value : null;
    }

    private function isIntegerQuantity(?string $value): bool
    {
        return $value !== null && preg_match('/^\d+$/', $value) === 1;
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

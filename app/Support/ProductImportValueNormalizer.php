<?php

namespace App\Support;

/**
 * Strict, deterministic typing of one product-import cell for AI Actions.
 *
 * It mirrors the accepted forms of the traditional importer (Arabic digits,
 * thousands separators, `15%`, yes/no tokens, good/service aliases) but never
 * defaults an unusable value: a bad cell is reported, not repaired. Money is
 * returned as integer minor units — no float is used at any step.
 */
final class ProductImportValueNormalizer
{
    private const BOOLEAN_TRUE = ['1', 'true', 'yes', 'y', 'نعم', 'صح', 'نشط', 'مفعل', 'active'];
    private const BOOLEAN_FALSE = ['0', 'false', 'no', 'n', 'لا', 'خطأ', 'غير نشط', 'معطل', 'inactive'];
    private const TYPE_ALIASES = [
        'سلعة' => 'good', 'صنف' => 'good', 'منتج' => 'good', 'بضاعة' => 'good', 'product' => 'good', 'item' => 'good', 'goods' => 'good',
        'خدمة' => 'service', 'خدمه' => 'service', 'services' => 'service',
    ];

    /** @return array{0:mixed,1:?string} [typed value or null, error code or null]; a blank cell is [null, null]. */
    public static function normalize(string $field, mixed $raw): array
    {
        $definition = ProductImportFields::get($field);
        if ($definition === null) {
            return [null, 'unknown_field'];
        }
        if ($raw === null || (is_string($raw) && trim($raw) === '')) {
            return [null, null];
        }
        if (! is_string($raw) && ! is_int($raw) && ! is_float($raw) && ! is_bool($raw)) {
            return [null, 'invalid_format'];
        }
        $text = is_bool($raw) ? ($raw ? '1' : '0') : trim((string) $raw);

        return match ($definition['type']) {
            ProductImportFields::TYPE_MONEY => self::money($text),
            ProductImportFields::TYPE_PERCENT, ProductImportFields::TYPE_INTEGER => self::integer($text, (int) ($definition['min'] ?? 0), (int) ($definition['max'] ?? 2147483647)),
            ProductImportFields::TYPE_BOOLEAN => self::boolean($text),
            ProductImportFields::TYPE_ENUM => self::enum($text, (array) ($definition['values'] ?? [])),
            default => mb_strlen($text) > (int) ($definition['max'] ?? 255) ? [null, 'too_long'] : [$text, null],
        };
    }

    public static function digits(string $value): string
    {
        return strtr($value, [
            '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        ]);
    }

    /** @return array{0:?int,1:?string} */
    private static function money(string $text): array
    {
        $normalized = str_replace(['٫', '،'], ['.', ''], self::digits($text));
        $normalized = preg_replace('/[,\s\x{00A0}]/u', '', $normalized) ?? $normalized;
        if (preg_match('/^\d+(?:\.\d{1,2})?$/', $normalized) !== 1) {
            return [null, 'invalid_money'];
        }
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        if (strlen(ltrim($whole, '0')) > 13) {
            return [null, 'money_out_of_range'];
        }

        return [((int) $whole * 100) + (int) str_pad($fraction, 2, '0'), null];
    }

    /** @return array{0:?int,1:?string} */
    private static function integer(string $text, int $min, int $max): array
    {
        $normalized = rtrim(trim(preg_replace('/[,\s\x{00A0}]/u', '', self::digits($text)) ?? ''), '%');
        if (preg_match('/^(\d+)\.0+$/', $normalized, $matches) === 1) {
            $normalized = $matches[1];
        }
        if (preg_match('/^\d{1,12}$/', $normalized) !== 1) {
            return [null, 'invalid_integer'];
        }
        $number = (int) $normalized;

        return $number < $min || $number > $max ? [null, 'integer_out_of_range'] : [$number, null];
    }

    /** @return array{0:?bool,1:?string} */
    private static function boolean(string $text): array
    {
        $value = mb_strtolower(self::digits($text), 'UTF-8');
        if (in_array($value, self::BOOLEAN_TRUE, true)) {
            return [true, null];
        }

        return in_array($value, self::BOOLEAN_FALSE, true) ? [false, null] : [null, 'invalid_boolean'];
    }

    /** @param array<int,string> $values @return array{0:?string,1:?string} */
    private static function enum(string $text, array $values): array
    {
        $value = mb_strtolower($text, 'UTF-8');
        $value = self::TYPE_ALIASES[$value] ?? $value;

        return in_array($value, $values, true) ? [$value, null] : [null, 'invalid_enum'];
    }
}

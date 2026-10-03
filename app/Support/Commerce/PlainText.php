<?php

namespace App\Support\Commerce;

/**
 * FLOWERS-H4 — تطبيع نص عادي صادر من العميل (قيم التخصيص، ولاحقاً رسائل أخرى):
 * CRLF→LF، إزالة أحرف التحكم (عدا \n) وDEL وعناصر تحكّم الاتجاه (انتحال العرض)،
 * قصّ الأطراف. لا يفسّر HTML إطلاقاً — المستهلك مسؤول عن الهروب عند العرض.
 */
final class PlainText
{
    public static function normalize(?string $value, bool $multiline = false): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = str_replace(["\r\n", "\r"], "\n", $value);
        // C0 (عدا \n) + DEL + U+202A–202E + U+2066–2069
        $value = (string) preg_replace('/[\x00-\x09\x0B-\x1F\x7F\x{202A}-\x{202E}\x{2066}-\x{2069}]/u', '', $value);
        if (! $multiline) {
            $value = str_replace("\n", ' ', $value);
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }

    public static function length(string $value): int
    {
        return mb_strlen($value);
    }
}

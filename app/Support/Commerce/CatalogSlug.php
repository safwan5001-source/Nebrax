<?php

namespace App\Support\Commerce;

use Illuminate\Support\Str;

/**
 * FLOWERS-H2 — اشتقاق معرّف نصي (slug) آمن للكتالوج التجاري: ASCII صغير بشرطات،
 * يُلحَق بلاحقة رقمية عند التصادم. مصدر واحد لقيم الأبعاد والمجموعات.
 */
final class CatalogSlug
{
    public const PATTERN = '/^[a-z0-9]+(?:-[a-z0-9]+)*$/';

    /** @param callable(string): bool $taken */
    public static function derive(string $source, callable $taken, string $fallback = 'item'): string
    {
        $base = Str::limit(Str::slug($source), 56, '');
        $base = $base !== '' ? $base : $fallback;

        $slug = $base;
        for ($i = 2; $taken($slug); $i++) {
            $slug = $base.'-'.$i;
        }

        return $slug;
    }
}

<?php

namespace App\Tenancy;

/**
 * سياسة الأسماء المحجوزة لـ slug مستأجر ERP — مصدر مركزي واحد.
 * التسجيل يرفضها؛ حسم النطاق يعاملها كمضيف غير-مستأجر (www/api/app…).
 */
final class ReservedTenantSlugs
{
    /** @return list<string> */
    public static function all(): array
    {
        $slugs = config('tenancy.reserved_slugs', []);

        if (! is_array($slugs)) {
            return [];
        }

        return array_values(array_unique(array_map(
            static fn (mixed $slug): string => mb_strtolower(trim((string) $slug)),
            $slugs,
        )));
    }

    public static function contains(string $slug): bool
    {
        return in_array(mb_strtolower($slug), self::all(), true);
    }
}

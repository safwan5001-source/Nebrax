<?php

namespace App\Support;

/**
 * نطاق المخزن الفعّال (Effective Warehouse Scope) لتقارير المخزون التحليلية.
 *
 * نفس معادلة `ReportBranchScope` بالضبط، مطبَّقة على `User::allowedWarehouseIds()`
 * بدل `allowedBranchIds()`: requested warehouse scope ∩ user's allowed warehouses.
 * `warehouse_id` في مرشّحات المخزون قيمة مفردة لا مصفوفة — يُطبَّع هنا لمصفوفة
 * واحدة قبل التقاطع، فالنتيجة شكلها موحّد مع نطاق الفرع.
 *
 * @see \App\Support\ReportBranchScope
 */
class ReportWarehouseScope
{
    /**
     * @param  array<string,mixed>  $filters  يقرأ `warehouse_id` فقط (UUID مفرد أو مصفوفة أو غائب).
     * @return array<int,string>|null  null = بلا تصفية (مستخدم غير مقيَّد ولم يطلب شيئاً).
     */
    public static function resolve(array $filters): ?array
    {
        $raw = $filters['warehouse_id'] ?? null;
        $ids = $raw === null || $raw === '' || $raw === []
            ? []
            : array_values(array_filter(is_array($raw) ? $raw : [$raw]));

        $allowed = auth()->user()?->allowedWarehouseIds();

        if ($allowed !== null) {
            $ids = $ids === [] ? $allowed : array_values(array_intersect($ids, $allowed));

            return $ids === [] ? $allowed : $ids;
        }

        return $ids === [] ? null : $ids;
    }
}

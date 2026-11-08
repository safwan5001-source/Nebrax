<?php

namespace App\Support;

/**
 * مُنشئ جداول/أعمدة/ملخصات عقد حمولة التقارير. دوال نقية بلا حالة.
 *
 * أنواع الأعمدة: `text` · `int` · `liters` (مللتر صحيح) · `money` (هللات صحيحة) · `bp` (نقاط أساسية) · `date` (Y-m-d) · `datetime` (ISO-8601 UTC) · `status`.
 * `sensitivity`: `sales` (مبالغ المبيعات، `fuel.sale.view`) · `cost` (تكلفة/ربح، `products.view_cost`) · `credit` (ائتمان، `fuel.credit.view`).
 * العمود الحسّاس يُحذف **من الحمولة** لمن لا يملك سلطته. `total = sum` يجمعه المحرك مرة واحدة (مصدر الإجماليات الوحيد).
 */
final class FuelReportTable
{
    public const SALES = 'sales';
    public const COST = 'cost';
    public const CREDIT = 'credit';

    /**
     * @param  array{sensitivity?:?string,total?:?string,values?:array<string,array{ar:string,en:string}>}  $options
     * @return array<string,mixed>
     */
    public static function col(string $key, string $type, string $ar, string $en, array $options = []): array
    {
        return array_filter([
            'key' => $key,
            'type' => $type,
            'label' => ['ar' => $ar, 'en' => $en],
            'sensitivity' => $options['sensitivity'] ?? null,
            'total' => $options['total'] ?? null,
            'values' => $options['values'] ?? null,
        ], fn ($value) => $value !== null);
    }

    /**
     * @param  list<array<string,mixed>>  $columns
     * @param  list<array<string,mixed>>  $rows
     * @return array<string,mixed>
     */
    public static function table(string $key, string $ar, string $en, array $columns, array $rows, ?string $sensitivity = null): array
    {
        return array_filter([
            'key' => $key, 'title' => ['ar' => $ar, 'en' => $en], 'sensitivity' => $sensitivity,
            'columns' => $columns, 'rows' => array_values($rows), 'totals' => null,
        ], fn ($value, $k) => $k !== 'sensitivity' || $value !== null, ARRAY_FILTER_USE_BOTH);
    }

    /** @return array<string,mixed> */
    public static function item(string $key, string $ar, string $en, string $type, int|string|null $value, ?string $sensitivity = null): array
    {
        return array_filter([
            'key' => $key, 'label' => ['ar' => $ar, 'en' => $en], 'type' => $type, 'value' => $value, 'sensitivity' => $sensitivity,
        ], fn ($v, $k) => $k === 'value' || $v !== null, ARRAY_FILTER_USE_BOTH);
    }

    /** تسميات حالة الوردية الموحَّدة. @return array<string,array{ar:string,en:string}> */
    public static function shiftStatusValues(): array
    {
        return [
            'open' => ['ar' => 'مفتوحة', 'en' => 'Open'],
            'closed' => ['ar' => 'مغلقة', 'en' => 'Closed'],
            'approved' => ['ar' => 'معتمدة', 'en' => 'Approved'],
        ];
    }
}

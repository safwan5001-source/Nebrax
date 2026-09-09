<?php

namespace App\Support;

/**
 * مجالات الاستيراد الدائم المسموحة لتشغيلة (`ImportJob::domain`).
 *
 * قائمة نصّية على مستوى التطبيق لا نوع enum في قاعدة البيانات — إضافة مجال
 * تغيير كود لا هجرة. `product_catalog` وحده اليوم (PR-DUR-1): مجالان آخران
 * (`product_workbook`, `inventory_opening`) يُضافان مع PR الذي يربط معالجتهما
 * فعلياً (PR-DUR-3/PR-DUR-4) — قيمة غير مربوطة بمعالجة حقيقية مفردات ميتة.
 */
final class ImportJobDomain
{
    public const PRODUCT_CATALOG = 'product_catalog';

    /** @return list<string> */
    public static function values(): array
    {
        return [
            self::PRODUCT_CATALOG,
        ];
    }
}

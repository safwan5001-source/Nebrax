<?php

namespace App\Support;

/**
 * مجالات الاستيراد الدائم المسموحة لتشغيلة (`ImportJob::domain`).
 *
 * قائمة نصّية على مستوى التطبيق لا نوع enum في قاعدة البيانات — إضافة مجال
 * تغيير كود لا هجرة. `product_catalog` (PR-DUR-1/2) و`product_workbook`
 * (PR-DUR-3) مربوطان الآن بمعالجة فعلية في `ImportJobService::applyNextChunk()`.
 * `inventory_opening` يُضاف مع PR الذي يربط معالجته فعلياً (PR-DUR-4) —
 * قيمة غير مربوطة بمعالجة حقيقية مفردات ميتة.
 */
final class ImportJobDomain
{
    public const PRODUCT_CATALOG = 'product_catalog';

    public const PRODUCT_WORKBOOK = 'product_workbook';

    /** @return list<string> */
    public static function values(): array
    {
        return [
            self::PRODUCT_CATALOG,
            self::PRODUCT_WORKBOOK,
        ];
    }
}

<?php

namespace App\Support;

/**
 * مجالات الاستيراد الدائم المسموحة لتشغيلة (`ImportJob::domain`).
 *
 * قائمة نصّية على مستوى التطبيق لا نوع enum في قاعدة البيانات — إضافة مجال
 * تغيير كود لا هجرة. `product_catalog` (PR-DUR-1/2)، `product_workbook`
 * (PR-DUR-3)، و`inventory_opening` (PR-DUR-4) مربوطة الآن بمعالجة فعلية في
 * `ImportJobService::applyNextChunk()`. **`inventory_opening` مسودة فقط
 * (Draft) — لا ترحيل** (`InventoryOpeningService::post()` مسارٌ منفصل تماماً
 * لم يُربط ولن يُربط بهذا المحرك).
 */
final class ImportJobDomain
{
    public const PRODUCT_CATALOG = 'product_catalog';

    public const PRODUCT_WORKBOOK = 'product_workbook';

    public const INVENTORY_OPENING = 'inventory_opening';

    /** @return list<string> */
    public static function values(): array
    {
        return [
            self::PRODUCT_CATALOG,
            self::PRODUCT_WORKBOOK,
            self::INVENTORY_OPENING,
        ];
    }
}

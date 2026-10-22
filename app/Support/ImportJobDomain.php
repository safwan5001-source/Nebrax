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
    /**
     * بوابات كل مجال — **تطابق حرفياً** بوابات واجهة الإنشاء المباشرة لكيان المجال (IMP-H1-S1):
     * `view`/`manage` صلاحيتا RBAC، و`app` مفتاح القدرة في `ApplicationCatalog` (أو `null` إن لم تُبوَّب
     * الواجهة المباشرة بقدرة). مصدر واحد: كل مجال جديد **يجب** أن يعلن هنا بواباته قبل تسجيله في
     * `values()` — يحرس ذلك `ImportJobAuthorizationTest` (لا مجال بلا بوابات، فلا يرث مجالٌ صلاحيات المنتجات).
     *
     * @var array<string, array{view: string, manage: string, app: ?string}>
     */
    private const AUTHORIZATION = [
        self::PRODUCT_CATALOG => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => null],
        self::PRODUCT_WORKBOOK => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => null],
        // `inventory-openings/import/*` المباشرة محروسة بـ`inventory.core` (routes/api.php).
        self::INVENTORY_OPENING => ['view' => 'products.view', 'manage' => 'products.manage', 'app' => 'inventory.core'],
    ];

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

    /**
     * @return array{view: string, manage: string, app: ?string}
     *
     * @throws \InvalidArgumentException لمجال غير معلن — فشلٌ مغلق لا بوابة افتراضية.
     */
    public static function authorization(string $domain): array
    {
        return self::AUTHORIZATION[$domain]
            ?? throw new \InvalidArgumentException("لا بوابات معلنة لمجال الاستيراد: {$domain}");
    }
}

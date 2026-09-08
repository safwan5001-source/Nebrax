<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  كتالوج أعمدة ورقة «Unit Prices» في مصنّف PR-UOM2-4
 * ═══════════════════════════════════════════════════════════════
 *  **مستقلٌّ عمداً عن `ProductImportFields`** — نفس مبدأ `BarcodeImportFields`.
 *  الصف يمثّل سعراً صريحاً واحداً لمنتجٍ ووحدةٍ **داخل قائمة سعرٍ واحدة يحدّدها
 *  المستخدم قبل التشغيل** (القرار D-F في عقد PR-UOM2-4) — لا عمود قائمة سعر
 *  هنا، ولا قائمة افتراضية مفترَضة. الكتابة تمرّ حصراً عبر
 *  `PriceListService::upsertItem()` القائمة، فلا اشتقاق سعرٍ من `unit_factor`
 *  ولا سياسة تحقّقٍ جديدة تُخترَع هنا.
 */
class UnitPriceImportFields
{
    /** حقول تصلح لتعريف المنتج المستهدَف، بترتيب الأولوية. */
    public const PRODUCT_IDENTIFIERS = ['nebrax_id', 'sku'];

    /**
     * @return array<string, array{required: bool, label_ar: string, label_en: string, aliases: array<int, string>}>
     */
    public static function all(): array
    {
        return [
            'nebrax_id' => [
                'required' => false,
                'label_ar' => 'معرّف نبراكس', 'label_en' => 'Nebrax ID',
                'aliases' => ['id', 'productid', 'nebraxid', 'uuid', 'معرفنبراكس', 'المعرف', 'معرفالمنتج'],
            ],
            'sku' => [
                'required' => false,
                'label_ar' => 'رمز الصنف', 'label_en' => 'SKU',
                'aliases' => ['sku', 'code', 'itemcode', 'productcode', 'رمزالصنف', 'الرمز', 'كودالصنف', 'رقمالصنف'],
            ],
            'unit_name' => [
                'required' => false,
                'label_ar' => 'الوحدة', 'label_en' => 'Unit',
                'aliases' => ['unit', 'unitname', 'uom', 'الوحدة', 'اسمالوحدة'],
            ],
            'price' => [
                'required' => true,
                'label_ar' => 'السعر', 'label_en' => 'Price',
                'aliases' => ['price', 'unitprice', 'sellingprice', 'السعر', 'سعرالوحدة'],
            ],
        ];
    }

    /** @return array<int, string> */
    public static function keys(): array
    {
        return array_keys(self::all());
    }

    /** @return array<string, mixed>|null */
    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    /** @return array<int, string> */
    public static function templateHeaders(): array
    {
        return ['sku', 'unit_name', 'price'];
    }

    /** ترويسة round-trip: معرّف نبراكس أولاً كي يتّسق مع ورقة Products. @return array<int, string> */
    public static function roundTripHeaders(): array
    {
        return ['nebrax_id', 'sku', 'unit_name', 'price'];
    }

    /** @param array<int, string> $headers @return array<int, string|null> */
    public static function autoMap(array $headers): array
    {
        return ImportHeaderMatcher::autoMap($headers, self::aliasIndex());
    }

    public static function suggest(string $header): ?string
    {
        return ImportHeaderMatcher::suggest($header, self::aliasIndex());
    }

    /** @return array<string, array<int, string>> */
    private static function aliasIndex(): array
    {
        return array_map(static fn (array $field): array => $field['aliases'], self::all());
    }
}

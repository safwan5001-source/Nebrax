<?php

namespace App\Support;

/**
 * مصدر الحقيقة لحقول استيراد عناصر قائمة السعر — IMP-H4-S2. السعر الصريح لمنتجٍ ووحدةٍ داخل **قائمة واحدة يحدّدها المستخدم قبل التشغيل** (خيار
 * `price_list_id`، لا عمود في الملف ولا قائمة افتراضية مفترَضة) — نفس قرار D-F الذي يحكم ورقة «Unit Prices» في المصنّف، التي يستخرج منها هذا المسار منطقها
 * ليعمل مستقلاً بوحدة الصفّ.
 *
 * مستبعدٌ عمداً: متغيّرات المنتج (`product_variant_id`) — تسعير المتغيّر الفعلي مرحلةٌ لاحقة بعقدٍ صريح؛ وأي اشتقاق سعرٍ من معامل الوحدة.
 */
final class PriceListItemImportFields
{
    public const TYPE_IDENTIFIER = 'identifier';
    public const TYPE_TEXT = 'text';
    public const TYPE_MONEY = 'money';

    /** أقصى سعر بالهللات — نفس سقف `StorePriceListItemRequest`. */
    public const MAX_PRICE = 100000000000;

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        return self::$cache ??= [
            'nebrax_id' => [
                'type' => self::TYPE_IDENTIFIER, 'required' => false, 'writable' => false,
                'label_ar' => 'معرّف نبراكس', 'label_en' => 'Nebrax ID',
                'aliases' => ['nebraxid', 'productid', 'uuid', 'معرفنبراكس', 'المعرف', 'معرفالمنتج'],
            ],
            'sku' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'writable' => false, 'max' => 255,
                'label_ar' => 'رمز الصنف', 'label_en' => 'SKU',
                'aliases' => ['sku', 'code', 'itemcode', 'productcode', 'رمزالصنف', 'الرمز', 'كودالصنف', 'رقمالصنف'],
            ],
            'unit_name' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'writable' => false, 'max' => 255,
                'label_ar' => 'الوحدة', 'label_en' => 'Unit',
                'aliases' => ['unit', 'unitname', 'uom', 'الوحدة', 'اسمالوحدة'],
            ],
            'price' => [
                'type' => self::TYPE_MONEY, 'required' => true, 'writable' => true,
                'label_ar' => 'السعر', 'label_en' => 'Price',
                'aliases' => ['price', 'unitprice', 'sellingprice', 'السعر', 'سعرالوحدة'],
            ],
        ];
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::all());
    }

    /** @return array<string, mixed>|null */
    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    /** @return list<string> */
    public static function templateHeaders(): array
    {
        return array_values(array_map(static fn (array $field): string => (string) $field['label_ar'], self::all()));
    }

    /** @param list<string> $headers @return array<int, string|null> */
    public static function autoMap(array $headers): array
    {
        $aliasIndex = [];
        foreach (self::all() as $key => $field) {
            $aliasIndex[$key] = array_values(array_unique(array_merge(
                [ImportHeaderMatcher::normalize($key), ImportHeaderMatcher::normalize((string) $field['label_ar']), ImportHeaderMatcher::normalize((string) $field['label_en'])],
                array_map([ImportHeaderMatcher::class, 'normalize'], $field['aliases']),
            )));
        }

        return ImportHeaderMatcher::autoMap($headers, $aliasIndex);
    }
}

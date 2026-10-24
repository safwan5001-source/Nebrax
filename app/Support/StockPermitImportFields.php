<?php

namespace App\Support;

/**
 * مصدر الحقول لاستيراد بنود إذنٍ مخزني — IMP-H7-S3. **الملف كله إذنٌ واحد** (مسودة): رأسه (النوع · المخزن · مخزن الوجهة · التاريخ · السبب · الملاحظات) خيارات
 * التشغيلة المجمَّدة مع المعاينة لا أعمدة، وصفوفه سطور الإذن. مستبعدٌ عمداً:
 *  - **الترحيل** وأي حركة مخزون أو قيد: الاستيراد ينشئ مسودةً فقط؛ الترحيل فعلٌ منفصل (`StockPermitService::post`).
 *  - **تكلفة الصرف والتحويل**: تؤخذ بمتوسط التكلفة عند الترحيل لا من الملف؛ العمود يخص الإضافة وحدها.
 *  - **اشتقاق الوحدة**: الوحدة اسمٌ في قالب وحدات المنتج، تُحلّ بـ`UnitConversion` كما في الإنشاء المباشر؛ المجهولة تُرفض ولا يُفترَض لها معامل.
 * المنتج يُحلّ بمعرّف نبراكس أو الرمز أو الباركود (يتقاطع المذكور منها في منتج واحد)؛ **الاسم ليس معرّفاً**.
 */
final class StockPermitImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_INTEGER = 'integer';
    public const TYPE_MONEY = 'money';

    /** حدّا `StoreStockPermitRequest` نفسهما. */
    public const MAX_QUANTITY = 1000000;
    public const MAX_UNIT_COST = 100000000000;

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        return self::$cache ??= [
            'product_id' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 36, 'label_ar' => 'معرّف نبراكس للمنتج', 'label_en' => 'Nebrax product ID',
                'aliases' => ['productid', 'nebraxid', 'uuid', 'معرفنبراكس', 'معرفالمنتج'],
            ],
            'sku' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 100, 'label_ar' => 'رمز الصنف', 'label_en' => 'SKU',
                'aliases' => ['sku', 'itemcode', 'productcode', 'code', 'رمزالصنف', 'كودالصنف', 'رمزالمنتج', 'الرمز'],
            ],
            'barcode' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 100, 'label_ar' => 'الباركود', 'label_en' => 'Barcode',
                'aliases' => ['barcode', 'ean', 'الباركود', 'باركود'],
            ],
            'quantity' => [
                'type' => self::TYPE_INTEGER, 'required' => true, 'min' => 1, 'max' => self::MAX_QUANTITY, 'label_ar' => 'الكمية', 'label_en' => 'Quantity',
                'aliases' => ['quantity', 'qty', 'الكمية', 'كمية'],
            ],
            'unit' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 255, 'label_ar' => 'الوحدة', 'label_en' => 'Unit',
                'aliases' => ['unit', 'uom', 'unitname', 'الوحدة', 'اسمالوحدة'],
            ],
            'unit_cost' => [
                'type' => self::TYPE_MONEY, 'required' => false, 'label_ar' => 'تكلفة الوحدة', 'label_en' => 'Unit cost',
                'aliases' => ['unitcost', 'cost', 'price', 'تكلفةالوحدة', 'التكلفة', 'السعر'],
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

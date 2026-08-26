<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  كتالوج أعمدة ملف الأرصدة الافتتاحية للمخزون
 * ═══════════════════════════════════════════════════════════════
 *  **مستقلٌّ عمداً عن `ProductImportFields`.** المساران يستوردان شيئين
 *  مختلفين: ذاك يضبط الكتالوج (بلا أثر مخزني ولا محاسبي)، وهذا يفتتح
 *  الأرصدة (يحرّك المخزون ويولّد قيداً). دمجُهما في كتالوج واحد كان سيفتح
 *  الباب لتسرّب `opening_quantity` إلى ملف المنتجات — وهو ما تمنعه المهمة
 *  صراحةً. المشترك بينهما **كيفية** مطابقة الترويسة فقط (`ImportHeaderMatcher`).
 *
 *  `opening_date` ليس عموداً هنا: يُحدَّد مرّةً واحدة على مستوى المستند.
 *  تاريخٌ لكل صفّ كان يعني مستنداً واحداً بتواريخ متعددة — وهو ما يفسد معنى
 *  «نقطة الصفر» ويجعل القيد الواحد بلا تاريخ صحيح.
 */
class InventoryOpeningFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_QUANTITY = 'quantity';
    public const TYPE_MONEY = 'money';

    /** حقول تصلح لتعريف المنتج، بترتيب الأولوية. الاسم ليس منها ولن يكون. */
    public const PRODUCT_IDENTIFIERS = ['nebrax_id', 'sku', 'barcode'];

    /** حقول تصلح لتعريف المخزن، بترتيب الأولوية. */
    public const WAREHOUSE_IDENTIFIERS = ['warehouse_id', 'warehouse'];

    /**
     * @return array<string, array{type: string, required: bool, label_ar: string, label_en: string, aliases: array<int, string>}>
     */
    public static function all(): array
    {
        return [
            'nebrax_id' => [
                'type' => self::TYPE_TEXT, 'required' => false,
                'label_ar' => 'معرّف نبراكس', 'label_en' => 'Nebrax ID',
                'aliases' => ['id', 'productid', 'nebraxid', 'uuid', 'معرفنبراكس', 'المعرف', 'معرفالمنتج'],
            ],
            'sku' => [
                'type' => self::TYPE_TEXT, 'required' => false,
                'label_ar' => 'رمز الصنف', 'label_en' => 'SKU',
                'aliases' => ['sku', 'code', 'itemcode', 'productcode', 'رمزالصنف', 'الرمز', 'كودالصنف', 'رقمالصنف'],
            ],
            'barcode' => [
                'type' => self::TYPE_TEXT, 'required' => false,
                'label_ar' => 'الباركود', 'label_en' => 'Barcode',
                'aliases' => ['barcode', 'ean', 'upc', 'gtin', 'الباركود', 'رمزالباركود'],
            ],
            'product_name' => [
                'type' => self::TYPE_TEXT, 'required' => false,
                'label_ar' => 'اسم الصنف', 'label_en' => 'Product name',
                'aliases' => ['name', 'productname', 'itemname', 'اسمالصنف', 'الاسم', 'اسمالمنتج', 'الصنف'],
            ],
            'warehouse' => [
                'type' => self::TYPE_TEXT, 'required' => false,
                'label_ar' => 'المخزن', 'label_en' => 'Warehouse',
                'aliases' => ['warehouse', 'warehousename', 'warehousecode', 'store', 'location', 'المخزن', 'المستودع', 'اسمالمخزن', 'كودالمخزن'],
            ],
            'warehouse_id' => [
                'type' => self::TYPE_TEXT, 'required' => false,
                'label_ar' => 'معرّف المخزن', 'label_en' => 'Warehouse ID',
                'aliases' => ['warehouseid', 'storeid', 'معرفالمخزن', 'معرفالمستودع'],
            ],
            'opening_quantity' => [
                'type' => self::TYPE_QUANTITY, 'required' => true,
                'label_ar' => 'الكمية الافتتاحية', 'label_en' => 'Opening quantity',
                'aliases' => ['quantity', 'qty', 'openingqty', 'openingquantity', 'onhand', 'stock', 'الكمية', 'الكميةالافتتاحية', 'الرصيد', 'رصيداول'],
            ],
            'opening_unit_cost' => [
                'type' => self::TYPE_MONEY, 'required' => true,
                'label_ar' => 'تكلفة الوحدة', 'label_en' => 'Unit cost',
                'aliases' => ['unitcost', 'cost', 'openingunitcost', 'costprice', 'purchaseprice', 'avgcost', 'تكلفةالوحدة', 'التكلفة', 'سعرالتكلفة', 'سعرالشراء'],
            ],
            'notes' => [
                'type' => self::TYPE_TEXT, 'required' => false,
                'label_ar' => 'ملاحظات', 'label_en' => 'Notes',
                'aliases' => ['note', 'notes', 'remark', 'remarks', 'comment', 'ملاحظات', 'ملاحظة', 'بيان'],
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

    /**
     * ترويسات القالب البشري. `warehouse_id` مقصود عنه: المستخدم يكتب كود
     * المخزن أو اسمه، والمعرّف التقني يبقى مدعوماً لمن يصدّره من نظام آخر.
     *
     * @return array<int, string>
     */
    public static function templateHeaders(): array
    {
        return ['sku', 'barcode', 'product_name', 'warehouse', 'opening_quantity', 'opening_unit_cost', 'notes'];
    }

    /** @return array<int, string> */
    public static function labels(string $locale = 'ar'): array
    {
        $key = str_starts_with($locale, 'ar') ? 'label_ar' : 'label_en';

        return array_map(static fn (array $field): string => $field[$key], self::all());
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

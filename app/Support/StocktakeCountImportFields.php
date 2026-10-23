<?php

namespace App\Support;

/**
 * مصدر الحقيقة لأعمدة ورقة عدّ الجرد المستوردة — IMP-H7-S1. **العدّ فقط:** الملف يكتب `counted_quantity` في سطور جردٍ **مفتوح** قائم؛ لا يفتح جرداً،
 * ولا يضيف صنفاً إلى ورقته، ولا يرحّل فرقاً (الترحيل فعل منفصل في `StocktakeService::post`). الورقة تحدّد المخزن والأصناف، فلا عمود مخزن هنا.
 *
 * التعريف بالصنف: معرّف نبراكس ثم الرمز ثم الباركود — **الاسم ليس معرّفاً** (عمود اسم معلوماتي يُتجاهل). القالب لا يحمل رصيد النظام (عدّ أعمى).
 */
final class StocktakeCountImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_QUANTITY = 'quantity';

    /** حدّ `StocktakeController::count` نفسه. */
    public const MAX_QUANTITY = 100000000;

    /** @var list<string> بترتيب الأولوية */
    public const PRODUCT_IDENTIFIERS = ['nebrax_id', 'sku', 'barcode'];

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        return self::$cache ??= [
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
            'counted_quantity' => [
                'type' => self::TYPE_QUANTITY, 'required' => true,
                'label_ar' => 'الكمية المعدودة', 'label_en' => 'Counted quantity',
                'aliases' => ['counted', 'count', 'countedqty', 'countedquantity', 'quantity', 'qty', 'actual', 'physical', 'الكمية', 'الكميةالمعدودة', 'العدد', 'الجرد', 'الفعلي'],
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
        return ['nebrax_id', 'sku', 'barcode', 'product_name', 'counted_quantity'];
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

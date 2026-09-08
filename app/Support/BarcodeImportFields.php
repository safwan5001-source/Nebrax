<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  كتالوج أعمدة ورقة «Barcodes» في مصنّف PR-UOM2-4
 * ═══════════════════════════════════════════════════════════════
 *  **مستقلٌّ عمداً عن `ProductImportFields`.** كما يبقى `InventoryOpeningFields`
 *  كتالوجاً منفصلاً بمرادفاته الخاصة، هذا كتالوجٌ ثالثٌ لمصدر بياناتٍ مختلف
 *  تماماً — الباركودات البديلة (`ProductBarcode`) لا حقول المنتج نفسه. المشترك
 *  بين الثلاثة **كيفية** مطابقة الترويسة فقط (`ImportHeaderMatcher`).
 *
 *  الصف ينشئ باركوداً بديلاً واحداً فقط — لا وضع تحديث ولا حذف هنا؛ إنشاء
 *  باركود جديد هو المعنى الوحيد لصفٍّ في هذه الورقة، تماماً كما يفعل
 *  `POST /products/{id}/barcodes` اليوم. مطابقة المنتج بنفس أولوية ورقة
 *  Products: معرّف نبراكس ثم رمز الصنف — **الاسم ليس معرّفاً هنا أيضاً.**
 */
class BarcodeImportFields
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
                // «code» عمداً غائبٌ من هنا رغم أنه مرادفٌ شائعٌ لرمز الصنف في
                // ورقة Products: في هذه الورقة يتصادم مع مفتاح `code` (الباركود
                // نفسه)، وأولوية «أول مطابقةٍ تفوز» في `ImportHeaderMatcher`
                // كانت ستترك عمود الباركود بلا ربطٍ صامتاً.
                'aliases' => ['itemcode', 'productcode', 'productsku', 'رمزالصنف', 'الرمز', 'كودالصنف', 'رقمالصنف'],
            ],
            'code' => [
                'required' => true,
                'label_ar' => 'الباركود', 'label_en' => 'Barcode',
                'aliases' => ['barcode', 'barcodecode', 'ean', 'upc', 'gtin', 'الباركود', 'رمزالباركود'],
            ],
            'unit_name' => [
                'required' => false,
                'label_ar' => 'الوحدة', 'label_en' => 'Unit',
                'aliases' => ['unit', 'unitname', 'uom', 'الوحدة', 'اسمالوحدة'],
            ],
            'default_quantity' => [
                'required' => false,
                'label_ar' => 'كمية المسح', 'label_en' => 'Scan quantity',
                'aliases' => ['quantity', 'qty', 'defaultquantity', 'scanquantity', 'كميةالمسح', 'الكمية'],
            ],
            'label' => [
                'required' => false,
                'label_ar' => 'وصف اختياري', 'label_en' => 'Label',
                'aliases' => ['label', 'note', 'description', 'وصف', 'ملاحظة'],
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
        return ['sku', 'code', 'unit_name', 'default_quantity', 'label'];
    }

    /** ترويسة round-trip: معرّف نبراكس أولاً كي يتّسق مع ورقة Products. @return array<int, string> */
    public static function roundTripHeaders(): array
    {
        return ['nebrax_id', 'sku', 'code', 'unit_name', 'default_quantity', 'label'];
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

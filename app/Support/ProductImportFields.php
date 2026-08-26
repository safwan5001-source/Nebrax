<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  كتالوج حقول تبادل المنتجات — مصدر الحقيقة الوحيد للاستيراد والتصدير
 * ═══════════════════════════════════════════════════════════════
 *  يصف كل حقل يقبله الاستيراد ويكتبه التصدير: نوعه، إلزاميّته، هل يقبل
 *  المسح الصريح، وهل يُقفل عند التحديث. ومنه تُشتقّ أيضاً ترويسات القالب
 *  والمطابقة التلقائية للأعمدة.
 *
 *  **لماذا كتالوج واحد؟** لأن الاستيراد والتصدير عقدٌ واحد في اتجاهين: ملف
 *  round-trip لا يُعاد استيراده إلا إذا كانت ترويسة التصدير هي مفتاح الاستيراد
 *  نفسه. وحين كان لكلٍّ قائمته انحرفا بلا أن يشتكي أحد.
 *
 *  ═══ ما ليس هنا عمداً ═══
 *  `quantity_on_hand` و`avg_cost` و`initial_quantity` وحركات المخزون: حقائق
 *  مشتقّة من المستندات والقيود لا من ملف كتالوج. تُصدَّر للقراءة (قالب بشري)
 *  ولا تُستورَد أبداً. وكذلك حسابا المبيعات والتكلفة والمورّد: مراجع محاسبية
 *  تُضبط من بطاقة المنتج بعد تحقق `assertProductRefs`.
 */
class ProductImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_MONEY = 'money';
    public const TYPE_PERCENT = 'percent';
    public const TYPE_INTEGER = 'integer';
    public const TYPE_BOOLEAN = 'boolean';
    public const TYPE_ENUM = 'enum';
    public const TYPE_REFERENCE = 'reference';
    public const TYPE_IDENTIFIER = 'identifier';

    /**
     * ترتيب الحقول هو ترتيب أعمدة القالب والتصدير — من الهوية إلى التفاصيل.
     *
     * `required`      مطلوب لإنشاء منتج جديد.
     * `clearable`     تقبل قيمته المسح الصريح في وضع «مسح الحقول المطابَقة».
     * `update_locked` لا يغيّره الاستيراد على منتج قائم مهما ورد في الملف.
     * `writable`      يكتبه الاستيراد (المعرّف التقني للمطابقة فقط).
     *
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        return [
            'nebrax_id' => [
                'type' => self::TYPE_IDENTIFIER, 'required' => false, 'clearable' => false,
                'update_locked' => true, 'writable' => false,
                'label_ar' => 'معرّف نبراكس', 'label_en' => 'Nebrax ID',
                'aliases' => ['nebraxid', 'productid', 'id', 'uuid', 'معرفنبراكس', 'المعرف', 'معرفالمنتج'],
            ],
            'sku' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => false,
                'update_locked' => false, 'writable' => true, 'max' => 255,
                'label_ar' => 'رمز الصنف (SKU)', 'label_en' => 'SKU',
                'aliases' => ['sku', 'code', 'itemcode', 'productcode', 'itemno', 'itemnumber', 'رمزالصنف', 'الرمز', 'كود', 'كودالصنف', 'رقمالصنف'],
            ],
            'name' => [
                'type' => self::TYPE_TEXT, 'required' => true, 'clearable' => false,
                'update_locked' => false, 'writable' => true, 'max' => 255,
                'label_ar' => 'الاسم', 'label_en' => 'Name',
                'aliases' => ['name', 'productname', 'itemname', 'title', 'arabicname', 'الاسم', 'اسمالمنتج', 'اسمالصنف', 'الصنف', 'المنتج'],
            ],
            'name_en' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'max' => 255,
                'label_ar' => 'الاسم بالإنجليزية', 'label_en' => 'English name',
                'aliases' => ['nameen', 'englishname', 'nameenglish', 'الاسمبالانجليزية', 'الاسمالانجليزي'],
            ],
            'type' => [
                'type' => self::TYPE_ENUM, 'required' => true, 'clearable' => false,
                'update_locked' => true, 'writable' => true, 'values' => ['good', 'service'],
                'label_ar' => 'النوع', 'label_en' => 'Type',
                'aliases' => ['type', 'producttype', 'itemtype', 'kind', 'النوع', 'نوعالمنتج', 'نوعالصنف'],
            ],
            'unit' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => false,
                'update_locked' => false, 'writable' => true, 'max' => 255,
                'label_ar' => 'الوحدة', 'label_en' => 'Unit',
                'aliases' => ['unit', 'uom', 'baseunit', 'unitofmeasure', 'الوحدة', 'وحدةالقياس', 'وحدةالاساس'],
            ],
            'unit_template' => [
                'type' => self::TYPE_REFERENCE, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'reference' => 'unit_template',
                'label_ar' => 'قالب الوحدات', 'label_en' => 'Unit template',
                'aliases' => ['unittemplate', 'unittemplatename', 'unitstemplate', 'قالبالوحدات', 'قالبالوحدة'],
            ],
            'category' => [
                'type' => self::TYPE_REFERENCE, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'reference' => 'category',
                'label_ar' => 'التصنيف', 'label_en' => 'Category',
                'aliases' => ['category', 'categoryname', 'group', 'productcategory', 'التصنيف', 'الفئة', 'المجموعة', 'تصنيف'],
            ],
            'brand' => [
                'type' => self::TYPE_REFERENCE, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'reference' => 'brand',
                'label_ar' => 'العلامة التجارية', 'label_en' => 'Brand',
                'aliases' => ['brand', 'brandname', 'manufacturer', 'العلامةالتجارية', 'العلامة', 'الماركة'],
            ],
            'barcode' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'max' => 255,
                'label_ar' => 'الباركود', 'label_en' => 'Barcode',
                'aliases' => ['barcode', 'ean', 'upc', 'gtin', 'barcodeno', 'الباركود', 'رمزالباركود'],
            ],
            'sale_price' => [
                'type' => self::TYPE_MONEY, 'required' => true, 'clearable' => false,
                'update_locked' => false, 'writable' => true,
                'label_ar' => 'سعر البيع', 'label_en' => 'Sale price',
                'aliases' => ['saleprice', 'salepricesar', 'price', 'sellingprice', 'unitprice', 'retailprice', 'سعرالبيع', 'السعر', 'سعربيع'],
            ],
            'purchase_price' => [
                'type' => self::TYPE_MONEY, 'required' => false, 'clearable' => false,
                'update_locked' => false, 'writable' => true,
                'label_ar' => 'سعر الشراء', 'label_en' => 'Purchase price',
                'aliases' => ['purchaseprice', 'purchasepricesar', 'cost', 'costprice', 'buyprice', 'buyingprice', 'سعرالشراء', 'التكلفة', 'سعرشراء'],
            ],
            'min_sale_price' => [
                'type' => self::TYPE_MONEY, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true,
                'label_ar' => 'أقل سعر بيع', 'label_en' => 'Minimum sale price',
                'aliases' => ['minsaleprice', 'minimumprice', 'minprice', 'اقلسعربيع', 'الحدالادنىللسعر', 'اقلسعر'],
            ],
            'tax_rate' => [
                'type' => self::TYPE_PERCENT, 'required' => false, 'clearable' => false,
                'update_locked' => false, 'writable' => true, 'min' => 0, 'max' => 100,
                'label_ar' => 'نسبة الضريبة', 'label_en' => 'Tax rate',
                'aliases' => ['taxrate', 'tax', 'vat', 'vatrate', 'taxpercent', 'نسبةالضريبة', 'الضريبة', 'ضريبة'],
            ],
            'track_inventory' => [
                'type' => self::TYPE_BOOLEAN, 'required' => false, 'clearable' => false,
                'update_locked' => true, 'writable' => true, 'default' => false,
                'label_ar' => 'تتبع المخزون', 'label_en' => 'Track inventory',
                'aliases' => ['trackinventory', 'tracked', 'stocktracked', 'inventorytracked', 'تتبعالمخزون', 'يتتبعالمخزون', 'تتبعمخزون'],
            ],
            'reorder_level' => [
                'type' => self::TYPE_INTEGER, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'min' => 0,
                'label_ar' => 'حد إعادة الطلب', 'label_en' => 'Reorder level',
                'aliases' => ['reorderlevel', 'reorderpoint', 'minstock', 'minimumstock', 'حداعادةالطلب', 'حدالطلب', 'الحدالادنىللمخزون'],
            ],
            'tags' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'max' => 500,
                'label_ar' => 'الوسوم', 'label_en' => 'Tags',
                'aliases' => ['tags', 'labels', 'keywords', 'الوسوم', 'وسوم', 'الكلماتالمفتاحية'],
            ],
            'description' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'max' => 2000,
                'label_ar' => 'الوصف', 'label_en' => 'Description',
                'aliases' => ['description', 'details', 'notes', 'longdescription', 'الوصف', 'التفاصيل', 'وصف'],
            ],
            'internal_notes' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'clearable' => true,
                'update_locked' => false, 'writable' => true, 'max' => 2000,
                'label_ar' => 'ملاحظات داخلية', 'label_en' => 'Internal notes',
                'aliases' => ['internalnotes', 'privatenotes', 'ملاحظاتداخلية', 'ملاحظات'],
            ],
            'is_active' => [
                'type' => self::TYPE_BOOLEAN, 'required' => false, 'clearable' => false,
                'update_locked' => false, 'writable' => true, 'default' => true,
                'label_ar' => 'نشط', 'label_en' => 'Active',
                'aliases' => ['isactive', 'active', 'status', 'enabled', 'نشط', 'الحالة', 'مفعل'],
            ],
        ];
    }

    /** @return array<int, string> */
    public static function keys(): array
    {
        return array_keys(self::all());
    }

    /** الحقول التي يكتبها الاستيراد فعلاً (بلا المعرّف التقني). @return array<int, string> */
    public static function writableKeys(): array
    {
        return array_keys(array_filter(self::all(), static fn (array $field): bool => (bool) $field['writable']));
    }

    /** @return array<string, mixed>|null */
    public static function get(string $key): ?array
    {
        return self::all()[$key] ?? null;
    }

    /**
     * ترويسة القالب البشري: كل الحقول القابلة للكتابة بلا المعرّف التقني.
     *
     * @return array<int, string>
     */
    public static function templateHeaders(): array
    {
        return self::writableKeys();
    }

    /**
     * ترويسة ملف round-trip: المعرّف التقني أولاً ثم كل الحقول القابلة للكتابة.
     *
     * @return array<int, string>
     */
    public static function roundTripHeaders(): array
    {
        return array_merge(['nebrax_id'], self::writableKeys());
    }

    /**
     * يطبّع اسم عمود من ملف المستخدم إلى مفتاح مقارنة: حروف وأرقام فقط،
     * صغيرة، بلا مسافات ولا شرطات ولا «ال» التعريف ولا تشكيل.
     *
     * التنفيذ في `ImportHeaderMatcher` منذ أن احتاجه مسار استيراد ثانٍ؛ يبقى
     * هذا الاسم قائماً فلا يتغيّر أي مستدعٍ.
     */
    public static function normalizeHeader(string $header): string
    {
        return ImportHeaderMatcher::normalize($header);
    }

    /** مرادفات كل حقل بشكلٍ يفهمه المطابِق المشترك. @return array<string, array<int, string>> */
    private static function aliasIndex(): array
    {
        return array_map(static fn (array $field): array => $field['aliases'], self::all());
    }

    /**
     * يقترح حقل نبراكس المطابق لاسم عمود، أو `null` إذا لم يكن التطابق واضحاً.
     *
     * لا تخمين ضبابي: التطابق على الاسم المطبَّع أو على مرادف معلن فقط. عمودٌ
     * غامض يبقى بلا اقتراح ليقرّره المستخدم — اقتراحٌ خاطئ في ملف كتالوج أسوأ
     * من لا اقتراح.
     */
    public static function suggest(string $header): ?string
    {
        return ImportHeaderMatcher::suggest($header, self::aliasIndex());
    }

    /**
     * مطابقة تلقائية لكل أعمدة الملف. العمود الذي يكرّر حقلاً سبق ربطه يبقى
     * غير مربوط — عمودان على حقلٍ واحد غموضٌ يقرّره المستخدم لا التخمين.
     *
     * @param  array<int, string>  $headers
     * @return array<int, string|null>  فهرس العمود → مفتاح الحقل
     */
    public static function autoMap(array $headers): array
    {
        return ImportHeaderMatcher::autoMap($headers, self::aliasIndex());
    }
}

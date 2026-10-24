<?php

namespace App\Support;

/**
 * مصدر الحقيقة لحقول استيراد فواتير المشتريات — IMP-H5-S3b. كما `ExpenseImportFields`: منه تُشتقّ ترويسات القالب والمطابقة التلقائية وعقد الواجهة.
 *
 * **صفٌّ = سطر فاتورة؛ الوحدة فاتورة المورّد كلّها.** الصفوف تُجمَّع بـ(المورّد ‖ رقم فاتورته المطبَّع) في مسودة مشتريات واحدة بسطورها (`PurchaseService::create`).
 * مستبعدٌ عمداً:
 *  - **أي حقل مشتق**: `subtotal` و`tax_amount` و`total` تُشتقّ من السطور في الخدمة، ولا يقبلها الاستيراد. `invoice_total` عمودٌ **اختياري للمطابقة فقط**: يُقارَن بالإجمالي المشتق،
 *    ويكون اختلافه خطأً ظاهراً — لا يُكتب ولا يستبدل شيئاً أبداً.
 *  - **خصم/شحن/تسوية مستوى الفاتورة وخصم السطر**: خارج v1 (تُدخَل بتعديل المسودة). لا اختلاق قيمة افتراضية لها.
 *  - **الترحيل والاستلام والسداد**: الاستيراد ينشئ مسودات؛ لا قيد ولا حركة مخزون ولا سند صرف.
 *
 * `supplier_invoice_ref` **إلزامي** (هوية الفاتورة وأساس منع التكرار): صفٌّ بلا رقم لا يُجمَّع تحت `(مورّد, null)` أبداً — كان سيدمج فواتير مختلفة.
 * المنتج يُحلّ بمعرّف نبراكس أو الرمز أو الباركود (يتقاطع المذكور منها في منتج واحد)؛ **الاسم ليس معرّفاً**.
 * `unit_price` بالريال (يُحوَّل إلى هللات) قبل الضريبة أو شاملها حسب `tax_inclusive` للتشغيلة، كما `POST /purchases`.
 */
final class PurchaseImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_DATE = 'date';
    public const TYPE_MONEY = 'money';
    public const TYPE_INTEGER = 'integer';
    public const TYPE_ENUM = 'enum';

    public const PAYMENT_TYPES = ['cash', 'credit'];

    /** حقول رأس الفاتورة: تُؤخذ من أول صف يحملها في المجموعة، ويكون اختلاف صفٍّ لاحق عنها خطأً صريحاً (لا فوز صامت). */
    public const HEADER_FIELDS = ['purchase_date', 'due_date', 'payment_type', 'notes', 'invoice_total'];

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        return self::$cache ??= self::build();
    }

    /** @return array<string, array<string, mixed>> */
    private static function build(): array
    {
        $text = static fn (string $ar, string $en, array $aliases, int $max = 255, bool $required = false): array => [
            'type' => self::TYPE_TEXT, 'required' => $required, 'max' => $max, 'label_ar' => $ar, 'label_en' => $en, 'aliases' => $aliases,
        ];

        return [
            'supplier_code' => $text('كود المورّد', 'Supplier code', ['suppliercode', 'vendorcode', 'partnercode', 'supplier', 'كودالمورد', 'رقمالمورد', 'المورد'], 40),
            'supplier_invoice_ref' => $text('رقم فاتورة المورّد', 'Supplier invoice no.', ['supplierinvoiceno', 'supplierinvoice', 'invoiceno', 'invoicenumber', 'invoiceref', 'reference', 'ref', 'رقمفاتورةالمورد', 'رقمالفاتورة', 'المرجع', 'رقمالمرجع'], 255, true),
            'purchase_date' => [
                'type' => self::TYPE_DATE, 'required' => true, 'label_ar' => 'تاريخ الفاتورة', 'label_en' => 'Invoice date',
                'aliases' => ['purchasedate', 'invoicedate', 'date', 'تاريخالفاتورة', 'التاريخ', 'تاريخالشراء'],
            ],
            'due_date' => [
                'type' => self::TYPE_DATE, 'required' => false, 'label_ar' => 'تاريخ الاستحقاق', 'label_en' => 'Due date',
                'aliases' => ['duedate', 'paymentdue', 'تاريخالاستحقاق', 'الاستحقاق'],
            ],
            'payment_type' => [
                'type' => self::TYPE_ENUM, 'required' => false, 'values' => self::PAYMENT_TYPES, 'label_ar' => 'نوع الدفع', 'label_en' => 'Payment type',
                'aliases' => ['paymenttype', 'payment', 'terms', 'نوعالدفع', 'طريقةالدفع', 'الدفع'],
            ],
            'notes' => $text('ملاحظات', 'Notes', ['notes', 'memo', 'remarks', 'ملاحظات', 'البيان'], 1000),
            'product_id' => $text('معرّف نبراكس للمنتج', 'Nebrax product ID', ['productid', 'nebraxid', 'معرفنبراكس', 'معرفالمنتج'], 36),
            'sku' => $text('رمز الصنف', 'SKU', ['sku', 'itemcode', 'productcode', 'رمزالصنف', 'كودالصنف', 'رمزالمنتج'], 100),
            'barcode' => $text('الباركود', 'Barcode', ['barcode', 'ean', 'الباركود', 'باركود'], 100),
            'description' => $text('وصف السطر', 'Line description', ['description', 'itemdescription', 'linedescription', 'وصف', 'وصفالسطر', 'الوصف'], 1000),
            'quantity' => [
                'type' => self::TYPE_INTEGER, 'required' => true, 'min' => 1, 'max' => 1000000, 'label_ar' => 'الكمية', 'label_en' => 'Quantity',
                'aliases' => ['quantity', 'qty', 'الكمية', 'كمية'],
            ],
            'unit_price' => [
                'type' => self::TYPE_MONEY, 'required' => true, 'label_ar' => 'سعر الوحدة', 'label_en' => 'Unit price',
                'aliases' => ['unitprice', 'price', 'unitcost', 'cost', 'سعرالوحدة', 'السعر', 'التكلفة', 'تكلفةالوحدة'],
            ],
            'tax_rate' => [
                'type' => self::TYPE_INTEGER, 'required' => false, 'min' => 0, 'max' => 100, 'label_ar' => 'نسبة الضريبة %', 'label_en' => 'Tax rate %',
                'aliases' => ['taxrate', 'vatrate', 'vat', 'tax', 'نسبةالضريبة', 'الضريبة'],
            ],
            'invoice_total' => [
                'type' => self::TYPE_MONEY, 'required' => false, 'label_ar' => 'إجمالي الفاتورة (للمطابقة)', 'label_en' => 'Invoice total (check only)',
                'aliases' => ['invoicetotal', 'grandtotal', 'إجماليالفاتورة', 'اجماليالفاتورة'],   // «Total» وحدها غامضة (إجمالي السطر؟) فلا تُطابَق تلقائياً
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

    /** @return list<string> ترويسات القالب (عربية) بترتيب الحقول. */
    public static function templateHeaders(): array
    {
        return array_values(array_map(static fn (array $field): string => (string) $field['label_ar'], self::all()));
    }

    /** @param list<string> $headers @return array<int, string|null> فهرس العمود → مفتاح الحقل أو null */
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

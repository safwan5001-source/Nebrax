<?php

namespace App\Support;

/**
 * مصدر الحقيقة لحقول استيراد المصروفات — IMP-H5-S1c. كما `PartnerImportFields`: منه تُشتقّ ترويسات القالب والمطابقة التلقائية وعقد الواجهة.
 *
 * صفٌّ واحد = مسودة مصروف واحدة (`ExpenseService::create`). مستبعدٌ عمداً:
 *  - **أي حقل مشتق**: `tax_amount` و`total` يُشتقّان من `amount` و`tax_rate` في الخدمة، ولا يقبلهما الاستيراد أبداً.
 *  - **الترحيل**: الاستيراد ينشئ مسودات فقط؛ الترحيل فعلٌ منفصل عبر المحرك المحاسبي.
 *  - **المرفقات**: إثبات المستند الأصلي لا الصف.
 *
 * `amount` هو المبلغ **قبل الضريبة** بالريال (يُحوَّل إلى هللات)، كما في `POST /expenses`.
 * `reference` (رقم الفاتورة/الإيصال) لا عمود له على المصروف: يدخل مفتاح منع التكرار وحده.
 */
final class ExpenseImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_DATE = 'date';
    public const TYPE_MONEY = 'money';
    public const TYPE_INTEGER = 'integer';
    public const TYPE_ENUM = 'enum';

    public const PAYMENT_METHODS = ['cash', 'bank', 'credit'];

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
            'expense_date' => [
                'type' => self::TYPE_DATE, 'required' => true, 'label_ar' => 'التاريخ', 'label_en' => 'Date',
                'aliases' => ['date', 'expensedate', 'invoicedate', 'التاريخ', 'تاريخالمصروف', 'تاريخالفاتورة'],
            ],
            'amount' => [
                'type' => self::TYPE_MONEY, 'required' => true, 'label_ar' => 'المبلغ قبل الضريبة', 'label_en' => 'Amount (before tax)',
                'aliases' => ['amount', 'netamount', 'subtotal', 'beforetax', 'المبلغ', 'المبلغقبلالضريبة', 'صافيالمبلغ'],
            ],
            'account_code' => $text('كود حساب المصروف', 'Expense account code', ['accountcode', 'account', 'expenseaccount', 'كودالحساب', 'كودحسابالمصروف', 'الحساب', 'حسابالمصروف'], 20),
            'category' => $text('التصنيف', 'Category', ['category', 'expensecategory', 'التصنيف', 'تصنيفالمصروف', 'البند']),
            'supplier_code' => $text('كود المورّد', 'Supplier code', ['suppliercode', 'vendorcode', 'partnercode', 'كودالمورد', 'رقمالمورد'], 40),
            'vendor_name' => $text('اسم البائع', 'Vendor name', ['vendor', 'vendorname', 'payee', 'merchant', 'اسمالبائع', 'البائع', 'المستفيد', 'المورد'], 180),
            'cost_center_code' => $text('كود مركز التكلفة', 'Cost center code', ['costcenter', 'costcentercode', 'كودمركزالتكلفة', 'مركزالتكلفة'], 40),
            'payment_method' => [
                'type' => self::TYPE_ENUM, 'required' => false, 'values' => self::PAYMENT_METHODS, 'label_ar' => 'طريقة الدفع', 'label_en' => 'Payment method',
                'aliases' => ['paymentmethod', 'payment', 'paidby', 'طريقةالدفع', 'الدفع'],
            ],
            'tax_rate' => [
                'type' => self::TYPE_INTEGER, 'required' => false, 'min' => 0, 'max' => 100, 'label_ar' => 'نسبة الضريبة %', 'label_en' => 'Tax rate %',
                'aliases' => ['taxrate', 'vatrate', 'vat', 'tax', 'نسبةالضريبة', 'الضريبة'],
            ],
            'reference' => $text('رقم المرجع', 'Reference', ['reference', 'ref', 'invoiceno', 'invoicenumber', 'receiptno', 'رقمالمرجع', 'المرجع', 'رقمالفاتورة', 'رقمالايصال'], 100),
            'description' => $text('الوصف', 'Description', ['description', 'notes', 'memo', 'الوصف', 'البيان', 'ملاحظات'], 1000),
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

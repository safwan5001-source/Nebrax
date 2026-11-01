<?php

namespace App\Support;

/**
 * مصدر حقول استيراد كشف حساب طرف — IMP-PS-A1. **الملف كله كشفٌ واحد** لطرفٍ واحد؛ الطرف والدور والفترة والسياسات خيارات التشغيلة المجمَّدة مع المعاينة لا أعمدة.
 * السطور تُخزَّن **كما طُبعت عند الطرف الآخر** (مدين/دائن بالهللات)؛ ترجمتها إلى جهة دفاترنا شأن المطابقة (PS-A2) بحسب الدور — لا تُخمَّن هنا.
 * الاتجاه: عمودان `debit`+`credit` معاً، أو عمود `amount` واحد **مع إعلان اتجاهه إلزامياً** (D-PS-04/P-3: لا تخمين). عمود واحد من الاثنين وحده ملتبس فيُرفض.
 * مستبعدٌ عمداً: العملة غير الريال (D-PS-01)، وأي قيد أو مستند أو رصيد.
 */
final class PartnerStatementImportFields
{
    public const TYPE_TEXT = 'text';
    public const TYPE_DATE = 'date';
    public const TYPE_MONEY = 'money';
    public const TYPE_SIGNED_MONEY = 'signed_money';

    /** اتجاه عمود المبلغ الواحد: الموجب مدين/دائن **في كشف الطرف الآخر**، والسالب بالعكس. */
    public const DIRECTION_POSITIVE_DEBIT = 'positive_is_debit';
    public const DIRECTION_POSITIVE_CREDIT = 'positive_is_credit';
    public const DIRECTIONS = [self::DIRECTION_POSITIVE_DEBIT, self::DIRECTION_POSITIVE_CREDIT];

    /** أنواع الحركة المسموحة (تلميح للمطابقة لاحقاً). */
    public const KINDS = ['invoice', 'credit_note', 'payment', 'opening', 'other'];

    /** سقف مبلغ السطر بالهللات: 100 مليار ريال (13 خانة ريال كأقصى للمحلّل) — فوقه خطأ نطاق لا اقتطاع. */
    public const MAX_AMOUNT_MINOR = 100_000_000_000_00;

    /** @var array<string, array<string, mixed>>|null */
    private static ?array $cache = null;

    /** @return array<string, array<string, mixed>> */
    public static function all(): array
    {
        return self::$cache ??= [
            'line_date' => [
                'type' => self::TYPE_DATE, 'required' => true, 'label_ar' => 'التاريخ', 'label_en' => 'Date',
                'aliases' => ['date', 'linedate', 'transactiondate', 'postingdate', 'valuedate', 'التاريخ', 'تاريخالحركة', 'تاريخالمعاملة', 'تاريخالمستند'],
            ],
            'reference' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 100, 'label_ar' => 'رقم المستند', 'label_en' => 'Document number',
                'aliases' => ['reference', 'ref', 'documentno', 'documentnumber', 'invoiceno', 'invoicenumber', 'docno', 'رقمالمستند', 'رقمالفاتوره', 'المرجع', 'رقمالمرجع'],
            ],
            'our_reference' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 100, 'label_ar' => 'مرجعنا', 'label_en' => 'Our reference',
                'aliases' => ['ourreference', 'ourref', 'yourref', 'yourreference', 'مرجعنا', 'رقمنا', 'مرجعكم'],
            ],
            'description' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 500, 'label_ar' => 'البيان', 'label_en' => 'Description',
                'aliases' => ['description', 'details', 'narration', 'memo', 'particulars', 'البيان', 'الوصف', 'التفاصيل', 'ملاحظات'],
            ],
            'debit' => [
                'type' => self::TYPE_MONEY, 'required' => false, 'label_ar' => 'مدين', 'label_en' => 'Debit',
                'aliases' => ['debit', 'dr', 'debitamount', 'مدين', 'منه'],
            ],
            'credit' => [
                'type' => self::TYPE_MONEY, 'required' => false, 'label_ar' => 'دائن', 'label_en' => 'Credit',
                'aliases' => ['credit', 'cr', 'creditamount', 'دائن', 'له'],
            ],
            'amount' => [
                'type' => self::TYPE_SIGNED_MONEY, 'required' => false, 'label_ar' => 'المبلغ', 'label_en' => 'Amount',
                'aliases' => ['amount', 'value', 'المبلغ', 'القيمه', 'القيمة'],
            ],
            'balance' => [
                'type' => self::TYPE_SIGNED_MONEY, 'required' => false, 'label_ar' => 'الرصيد', 'label_en' => 'Balance',
                'aliases' => ['balance', 'runningbalance', 'الرصيد', 'الرصيدالجاري'],
            ],
            'currency' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 16, 'label_ar' => 'العملة', 'label_en' => 'Currency',
                'aliases' => ['currency', 'ccy', 'cur', 'العمله', 'العملة'],
            ],
            'kind' => [
                'type' => self::TYPE_TEXT, 'required' => false, 'max' => 24, 'label_ar' => 'نوع الحركة', 'label_en' => 'Entry type',
                'aliases' => ['type', 'kind', 'entrytype', 'doctype', 'documenttype', 'نوعالحركه', 'نوعالحركة', 'نوعالمستند', 'النوع'],
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

    /**
     * عناوين القالب: تخطيط «مدين/دائن» وحده، **بلا عمود «المبلغ»** — الجمع بينهما يرفضه التحقق (استعمال أحد التخطيطين لا كليهما)، فالقالب المنزَّل يجب أن يُرفع كما هو دون حذف عمود
     * (Codex #1877 P2). ملف العمود الواحد يُبنى بحذف عمودَي مدين/دائن وإضافة «المبلغ» مع إعلان الاتجاه.
     *
     * @return list<string>
     */
    public static function templateHeaders(): array
    {
        return array_values(array_map(
            static fn (array $field): string => (string) $field['label_ar'],
            array_diff_key(self::all(), ['amount' => true]),
        ));
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

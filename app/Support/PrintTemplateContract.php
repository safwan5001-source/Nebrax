<?php

namespace App\Support;

use App\Models\PrintTemplateAssignment;
use RuntimeException;

/**
 * قائمة بيضاء خلفية لعقود القوالب.
 *
 * الواجهة تملك سجلها المكتوب للمعاينة، أما هذا العقد فيحرس كل كتابة API أو
 * ترحيل مستقلّاً عن العميل. التطابق الاسمي مقصود بين الطبقتين، واختبارات
 * المرحلة التالية تحرس الأنواع التي تستخدمها الخدمة.
 */
class PrintTemplateContract
{
    public const DOCUMENT_TYPES = [
        'tax_invoice',
        'simplified_tax_invoice',
        'quotation',
        'proforma_invoice',
        'sales_order',
        'purchase_order',
        'purchase_invoice',
        'delivery_note',
        'packing_list',
        'receipt_voucher',
        'payment_voucher',
        'credit_note',
        'debit_note',
        'statement_of_account',
    ];

    public const USAGES = [
        PrintTemplateAssignment::USAGE_PRINT,
        PrintTemplateAssignment::USAGE_PDF,
        PrintTemplateAssignment::USAGE_THERMAL,
    ];

    /** يرفض قائمة فارغة ومكررة أو نوعاً غير قابل للإخراج. */
    public static function assertDocumentTypes(array $documentTypes): array
    {
        $normalized = array_values(array_unique(array_map(
            static fn (mixed $type): string => trim((string) $type),
            $documentTypes,
        )));

        if ($normalized === []) {
            throw new RuntimeException('اختر نوع مستند واحداً على الأقل للقالب.');
        }

        foreach ($normalized as $type) {
            if (! in_array($type, self::DOCUMENT_TYPES, true)) {
                throw new RuntimeException("نوع المستند «{$type}» غير مدعوم للقوالب.");
            }
        }

        sort($normalized);

        return $normalized;
    }

    public static function assertUsage(string $usage): string
    {
        if (! in_array($usage, self::USAGES, true)) {
            throw new RuntimeException('استعمال القالب غير مدعوم.');
        }

        return $usage;
    }

    /**
     * يتحقق من تعريف القالب قبل حفظ مسودة أو نشر مراجعة. التعريفات القديمة التي
     * لا تتضمن `layout` تبقى صالحة؛ أما التخطيط المصرح به فيخضع لعقد نوع المستند
     * حتى لا تحفظ الواجهة كتلة لا يستطيع محرك المستند رسمها لاحقاً.
     *
     * @param array<int, string> $documentTypes
     */
    public static function assertDefinition(array $definition, array $documentTypes): array
    {
        if (array_is_list($definition)) {
            throw new RuntimeException('تعريف القالب يجب أن يكون كائناً منظماً لا قائمة.');
        }

        if (array_key_exists('layout', $definition)) {
            self::assertLayout($definition['layout'], $documentTypes);
        }

        return self::canonicalize($definition);
    }

    /**
     * @param mixed $layout
     * @param array<int, string> $documentTypes
     */
    private static function assertLayout(mixed $layout, array $documentTypes): void
    {
        if (! is_array($layout) || ! array_is_list($layout)) {
            throw new RuntimeException('تخطيط الكتل يجب أن يكون قائمة مرتبة.');
        }

        $supported = null;
        $required = [];
        foreach ($documentTypes as $documentType) {
            $contract = self::layoutContract($documentType);
            $supported = $supported === null
                ? $contract['allowed']
                : array_values(array_intersect($supported, $contract['allowed']));
            $required = array_values(array_unique([...$required, ...$contract['required']]));
        }

        $seen = [];
        foreach ($layout as $item) {
            if (! is_array($item) || array_is_list($item) || ! isset($item['key']) || ! is_string($item['key'])) {
                throw new RuntimeException('كل كتلة في التخطيط تحتاج مفتاحاً منظماً.');
            }
            if (! array_key_exists('visible', $item) || ! is_bool($item['visible'])) {
                throw new RuntimeException('كل كتلة في التخطيط تحتاج حالة ظهور منطقية.');
            }

            $key = $item['key'];
            if (! in_array($key, $supported ?? [], true)) {
                throw new RuntimeException("الكتلة «{$key}» غير مدعومة لكل أنواع المستندات المختارة.");
            }
            if (isset($seen[$key])) {
                throw new RuntimeException("الكتلة «{$key}» مكررة في التخطيط.");
            }
            $seen[$key] = (bool) $item['visible'];
        }

        foreach ($required as $key) {
            if (($seen[$key] ?? false) !== true) {
                throw new RuntimeException("الكتلة الإلزامية «{$key}» يجب أن تبقى ظاهرة.");
            }
        }
    }

    /** @return array{allowed: array<int, string>, required: array<int, string>} */
    private static function layoutContract(string $documentType): array
    {
        $lineItems = [
            'header', 'barcode', 'parties', 'items', 'summary', 'amountWords',
            'notes', 'terms', 'bank', 'stamp', 'signature', 'footer',
        ];
        $vouchers = ['header', 'parties', 'voucher', 'amountWords', 'notes', 'bank', 'stamp', 'signature', 'footer'];
        $statement = ['header', 'parties', 'items', 'summary', 'notes', 'footer'];

        return match ($documentType) {
            'receipt_voucher', 'payment_voucher' => ['allowed' => $vouchers, 'required' => ['header', 'parties', 'voucher', 'footer']],
            'statement_of_account' => ['allowed' => $statement, 'required' => ['header', 'parties', 'items', 'footer']],
            'delivery_note', 'packing_list' => ['allowed' => $lineItems, 'required' => ['header', 'parties', 'items', 'footer']],
            default => ['allowed' => $lineItems, 'required' => ['header', 'parties', 'items', 'summary', 'footer']],
        };
    }

    /** ترتيب مفاتيح JSON عودياً يجعل بصمة الإصدار حتمية. */
    public static function canonicalize(array $value): array
    {
        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $value[$key] = self::canonicalize($item);
            }
        }

        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }

    public static function checksum(array $definition): string
    {
        return hash('sha256', json_encode(self::canonicalize($definition), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }
}

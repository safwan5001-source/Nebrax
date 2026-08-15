<?php

namespace App\Support;

use App\Models\PrintTemplateAssignment;
use InvalidArgumentException;

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
            throw new InvalidArgumentException('اختر نوع مستند واحداً على الأقل للقالب.');
        }

        foreach ($normalized as $type) {
            if (! in_array($type, self::DOCUMENT_TYPES, true)) {
                throw new InvalidArgumentException("نوع المستند «{$type}» غير مدعوم للقوالب.");
            }
        }

        sort($normalized);

        return $normalized;
    }

    public static function assertUsage(string $usage): string
    {
        if (! in_array($usage, self::USAGES, true)) {
            throw new InvalidArgumentException('استعمال القالب غير مدعوم.');
        }

        return $usage;
    }

    /**
     * يحمي المرحلة الحالية من حفظ تعريف غير منظم. التفصيل البنيوي للكتل
     * والأعمدة سيستخدم نفس العقد في مرحلة محرر القوالب؛ لكن لا نقبل نصاً أو
     * قائمة بدلاً من كائن JSON من الآن حتى لا يصعب ترحيل بيانات سيئة لاحقاً.
     */
    public static function assertDefinition(array $definition): array
    {
        if (array_is_list($definition)) {
            throw new InvalidArgumentException('تعريف القالب يجب أن يكون كائناً منظماً لا قائمة.');
        }

        return self::canonicalize($definition);
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

<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تصنيف مستندات مركز المستندات — مصدر حقيقة واحد
 * ═══════════════════════════════════════════════════════════════
 *  الأنواع المدعومة في مركز المستندات (الذكاء المستندي). كانت القائمة
 *  محصورة في `StoreDocumentBatchRequest::rules`؛ استُخرجت هنا كي لا تنشأ
 *  **تصنيفةٌ موازية** حين احتاجتها إعدادات المستأجر (الأنواع المسموح
 *  بمعالجتها ذكياً). الطلب وإعدادات المستأجر يقرآن من هذه القائمة معاً.
 *
 *  مركز المستندات ليس «فاتورة مشتريات فقط»: المستند قد يُنشئ مسودة سجل،
 *  أو يبقى أرشيفاً دون أثر، أو يُطابَق مسار عمل لاحقاً. توسيع التصنيف نوعاً
 *  جديداً يمرّ من هنا وحده.
 */
final class DocumentTypeCatalog
{
    /** @var list<string> */
    public const TYPES = [
        'purchase_invoice',
        'sales_invoice',
        'expense',
        'delivery_note',
        'receipt',
        'credit_note',
        'debit_note',
    ];

    /** @return list<string> */
    public static function all(): array
    {
        return self::TYPES;
    }

    public static function supports(string $type): bool
    {
        return in_array($type, self::TYPES, true);
    }
}

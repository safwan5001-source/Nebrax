<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * كتالوج أحداث الـ Webhooks — قائمة سماح مركزية وصريحة (PR-7). يبدأ صغيرًا عمدًا:
 * أحداث إنشاء المجالات القابلة للكشف بأمان اليوم. قابل للتوسّع لوحدات أَوْج لاحقًا
 * دون كسر العقد — القيمة النصّية جزء من العقد العام (لا تتغيّر بعد النشر).
 *
 * **دلالة الفاتورة صريحة:** `invoice.created` يمثّل إنشاء فاتورة، وحالتها الفعلية
 * (draft عادةً عبر الـ Public API) في الحمولة (`data.status`). لا نصدر `invoice.posted`
 * ولا `invoice.paid` ولا أحداث ZATCA — تلك تحوّلات مجال غير مشمولة في هذا الأساس.
 */
final class WebhookEventCatalog
{
    public const PARTNER_CREATED = 'partner.created';
    public const PRODUCT_CREATED = 'product.created';
    public const INVOICE_CREATED = 'invoice.created';

    /**
     * الأحداث المسموح بها ووصفها (للتوثيق ورسائل التحقّق).
     *
     * @var array<string, string>
     */
    private const CATALOG = [
        self::PARTNER_CREATED => 'A partner (customer or supplier) was created.',
        self::PRODUCT_CREATED => 'A catalog product was created.',
        self::INVOICE_CREATED => 'A sales invoice was created (see data.status; Public API creates drafts).',
    ];

    /** @return list<string> كل أنواع الأحداث المعروفة. */
    public static function all(): array
    {
        return array_keys(self::CATALOG);
    }

    /** @return array<string, string> النوع → وصف. */
    public static function withDescriptions(): array
    {
        return self::CATALOG;
    }

    public static function isKnown(string $type): bool
    {
        return array_key_exists($type, self::CATALOG);
    }

    /**
     * يتحقّق قائمة أنواع مطلوبة ويطبّعها: يرفض الفارغ والمجهول، ويزيل التكرار مع
     * حفظ الترتيب. يُستعمل عند إنشاء/تحديث الاشتراك فلا يُخزَّن نوعٌ غير معروف.
     *
     * @param  array<int, mixed>  $types
     * @return list<string>
     *
     * @throws InvalidArgumentException
     */
    public static function sanitize(array $types): array
    {
        if ($types === []) {
            throw new InvalidArgumentException('يجب اختيار نوع حدث واحد على الأقل.');
        }

        $clean = [];
        foreach ($types as $type) {
            $type = is_string($type) ? trim($type) : '';
            if (! self::isKnown($type)) {
                throw new InvalidArgumentException("نوع حدث غير معروف: «{$type}».");
            }
            $clean[$type] = $type;
        }

        return array_values($clean);
    }
}

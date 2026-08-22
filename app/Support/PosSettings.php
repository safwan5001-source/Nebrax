<?php

namespace App\Support;

use App\Models\Tenant;
use App\Tenancy\TenantContext;

/**
 * إعدادات نقطة البيع المخزنة في `tenants.settings['sales_config']['pos']`.
 *
 * لا تقرأ خدمة المرتجعات حمولة العميل أو متحكماً؛ هذه هي نقطة القراءة الخادمية
 * الموحدة للسياسات التي تؤثر في سلوك POS التشغيلي والمالي.
 */
final class PosSettings
{
    public const CASH_REFUND_ORIGINAL_CASH_ONLY = 'original_cash_only';
    public const CASH_REFUND_ALLOW_ANY_POS_SALE = 'allow_any_pos_sale';

    private const DEFAULTS = [
        'default_customer'   => 'عميل نقدي (POS)',
        'print_receipt'      => true,
        'allow_discount'     => true,
        'receipt_footer'     => '',
        // الافتراض الحامي: لا يخرج نقد من الدرج أكثر من النقد الذي دخل منه
        // بسبب فاتورة المصدر نفسها، ما لم يفعّل مالك الشركة الخيار الصريح الآخر.
        'cash_refund_policy' => self::CASH_REFUND_ORIGINAL_CASH_ONLY,
    ];

    /** جميع إعدادات POS، مدموجة فوق الافتراضات المعتمدة. */
    public static function group(?Tenant $tenant = null): array
    {
        $tenant ??= self::tenant();
        $stored = $tenant?->settings['sales_config']['pos'] ?? [];

        return array_merge(self::DEFAULTS, array_intersect_key($stored, self::DEFAULTS));
    }

    /** سياسة رد النقد الصالحة فقط؛ القيمة المخزنة غير المعروفة تعود للافتراض الحامي. */
    public static function cashRefundPolicy(?Tenant $tenant = null): string
    {
        $policy = self::group($tenant)['cash_refund_policy'];

        return in_array($policy, [self::CASH_REFUND_ORIGINAL_CASH_ONLY, self::CASH_REFUND_ALLOW_ANY_POS_SALE], true)
            ? $policy
            : self::CASH_REFUND_ORIGINAL_CASH_ONLY;
    }

    private static function tenant(): ?Tenant
    {
        $id = app(TenantContext::class)->id();

        return $id ? Tenant::find($id) : null;
    }
}

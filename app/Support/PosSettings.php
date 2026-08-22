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
    public const EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY = 'customer_credit_only';
    public const EXCHANGE_SURPLUS_ALLOW_CASH_REFUND = 'allow_cash_refund';

    private const DEFAULTS = [
        'default_customer'   => 'عميل نقدي (POS)',
        'print_receipt'      => true,
        'allow_discount'     => true,
        'receipt_footer'     => '',
        // الافتراض الحامي: لا يخرج نقد من الدرج أكثر من النقد الذي دخل منه
        // بسبب فاتورة المصدر نفسها، ما لم يفعّل مالك الشركة الخيار الصريح الآخر.
        'cash_refund_policy' => self::CASH_REFUND_ORIGINAL_CASH_ONLY,
        // الافتراض الحامي: فرق المرتجع الزائد يبقى رصيداً للعميل، فلا يخرج
        // نقد من الدرج في الاستبدال إلا بتفويض إداري صريح وسياسة نقد متحققة.
        'exchange_surplus_policy' => self::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY,
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

    /** سياسة تسوية فرق الاستبدال الصالحة فقط؛ القيمة غير المعروفة لا تسمح بالنقد. */
    public static function exchangeSurplusPolicy(?Tenant $tenant = null): string
    {
        $policy = self::group($tenant)['exchange_surplus_policy'];

        return in_array($policy, [self::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY, self::EXCHANGE_SURPLUS_ALLOW_CASH_REFUND], true)
            ? $policy
            : self::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY;
    }

    private static function tenant(): ?Tenant
    {
        $id = app(TenantContext::class)->id();

        return $id ? Tenant::find($id) : null;
    }
}

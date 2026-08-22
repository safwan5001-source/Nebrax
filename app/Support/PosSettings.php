<?php

namespace App\Support;

use App\Models\Tenant;
use App\Tenancy\TenantContext;

/**
 * إعدادات نقطة البيع المخزنة في `tenants.settings['sales_config']['pos']`.
 *
 * لا تقرأ خدمة المرتجعات أو البيع حمولة العميل أو متحكماً؛ هذه هي نقطة القراءة
 * الخادمية الموحدة للسياسات التي تؤثر في سلوك POS التشغيلي والمالي.
 */
final class PosSettings
{
    public const CASH_REFUND_ORIGINAL_CASH_ONLY = 'original_cash_only';
    public const CASH_REFUND_ALLOW_ANY_POS_SALE = 'allow_any_pos_sale';
    public const EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY = 'customer_credit_only';
    public const EXCHANGE_SURPLUS_ALLOW_CASH_REFUND = 'allow_cash_refund';
    public const HELD_SALE_DISCARD_ON_SESSION_CLOSE = 'discard_on_session_close';
    public const HELD_SALE_KEEP_FOR_NEXT_SESSION = 'keep_for_next_session';

    private const DEFAULTS = [
        'default_customer'   => 'عميل نقدي (POS)',
        'print_receipt'      => true,
        'allow_discount'     => true,
        'receipt_footer'     => '',
        // قائمة فارغة تعني «كل الوسائل النشطة»: لا تتغير شاشة POS للمستأجر
        // القائم عند ترقية المرحلة قبل أن يختار تقييداً صريحاً.
        'enabled_payment_method_ids' => [],
        // اختيار عرضي للواجهة؛ تظل صلاحية الطريقة وتفعيلها مفروضة في الخدمة.
        'default_payment_method_id' => null,
        // الافتراض يحفظ سلوك POS السابق الذي كان يسمح ببيع جزئي/آجل.
        'allow_deferred_payment' => true,
        // الافتراض الحامي: لا يخرج نقد من الدرج أكثر من النقد الذي دخل منه
        // بسبب فاتورة المصدر نفسها، ما لم يفعّل مالك الشركة الخيار الصريح الآخر.
        'cash_refund_policy' => self::CASH_REFUND_ORIGINAL_CASH_ONLY,
        // الافتراض الحامي: فرق المرتجع الزائد يبقى رصيداً للعميل، فلا يخرج
        // نقد من الدرج في الاستبدال إلا بتفويض إداري صريح وسياسة نقد متحققة.
        'exchange_surplus_policy' => self::EXCHANGE_SURPLUS_CUSTOMER_CREDIT_ONLY,
        // الافتراض الحامي: لا تظل مسودات السلة القديمة قابلة للاستئناف بعد إغلاق
        // ورديتها إلا إذا اختار المالك الاحتفاظ بها صراحةً ضمن نفس الكاشير والمخزن.
        'held_sale_close_policy' => self::HELD_SALE_DISCARD_ON_SESSION_CLOSE,
    ];

    /** جميع إعدادات POS، مدموجة فوق الافتراضات المعتمدة. */
    public static function group(?Tenant $tenant = null): array
    {
        $tenant ??= self::tenant();
        $stored = $tenant?->settings['sales_config']['pos'] ?? [];

        return array_merge(self::DEFAULTS, array_intersect_key($stored, self::DEFAULTS));
    }

    /** قائمة معرّفات الوسائل المقيدة صراحةً؛ الفارغة تعني جميع الوسائل النشطة. */
    public static function enabledPaymentMethodIds(?Tenant $tenant = null): array
    {
        $ids = self::group($tenant)['enabled_payment_method_ids'];
        if (! is_array($ids)) {
            return [];
        }

        return array_values(array_unique(array_filter($ids, fn (mixed $id) => is_string($id) && $id !== '')));
    }

    /** لا تتجاوز واجهة الكاشير الوسائل التي قيّدها المالك، مع توافق القائمة الفارغة. */
    public static function allowsPaymentMethod(string $paymentMethodId, ?Tenant $tenant = null): bool
    {
        $enabled = self::enabledPaymentMethodIds($tenant);

        return $enabled === [] || in_array($paymentMethodId, $enabled, true);
    }

    /** المعرّف الافتراضي المفضّل للعرض؛ قد يعود null إن لم يحدد المالك وسيلة. */
    public static function defaultPaymentMethodId(?Tenant $tenant = null): ?string
    {
        $id = self::group($tenant)['default_payment_method_id'];

        return is_string($id) && $id !== '' ? $id : null;
    }

    /** البيع المؤجل سياسة صريحة؛ القيمة غير المعروفة تورّث الإتاحة التاريخية. */
    public static function allowsDeferredPayment(?Tenant $tenant = null): bool
    {
        return self::group($tenant)['allow_deferred_payment'] !== false;
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

    /** سياسة السلال المعلّقة الصالحة فقط؛ القيمة غير المعروفة تلغي المسودة عند الإغلاق. */
    public static function heldSaleClosePolicy(?Tenant $tenant = null): string
    {
        $policy = self::group($tenant)['held_sale_close_policy'];

        return in_array($policy, [self::HELD_SALE_DISCARD_ON_SESSION_CLOSE, self::HELD_SALE_KEEP_FOR_NEXT_SESSION], true)
            ? $policy
            : self::HELD_SALE_DISCARD_ON_SESSION_CLOSE;
    }

    private static function tenant(): ?Tenant
    {
        $id = app(TenantContext::class)->id();

        return $id ? Tenant::find($id) : null;
    }
}

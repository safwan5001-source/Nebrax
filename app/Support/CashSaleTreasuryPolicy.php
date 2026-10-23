<?php

namespace App\Support;

/**
 * TREASURY-T4: سياسة الخزينة المدينة في البيع النقدي المباشر (`payment_type=cash`).
 *
 * سياسة عمل لا صحّة تقنية (CLAUDE.md قاعدة 6): تُضبط لكل مستأجر في `sales.cash_sale_treasury_policy`:
 *  - `legacy` (الافتراضي): السلوك القائم حرفياً — الصندوق 1110 دوماً و`invoices.cash_account_id` يُتجاهل.
 *  - `main`: الاختيار الصريح (`cash_account_id`) يتقدّم، وغيابه ⇒ الخزينة النقدية الرئيسية (MainOfType).
 *  - `explicit_required`: الاختيار الصريح إلزامي؛ غيابه يُرفض عند الترحيل.
 *
 * **الأثر الفعلي مشروط ببوابة النشر** `config('treasury.cash_sale_routing_enabled')`: ما دامت مغلقة تُعاد `legacy`
 * مهما خُزِّن، فلا يتغيّر الترحيل الإنتاجي بمجرد نشر الكود.
 */
final class CashSaleTreasuryPolicy
{
    public const LEGACY = 'legacy';
    public const MAIN = 'main';
    public const EXPLICIT_REQUIRED = 'explicit_required';

    public const VALUES = [self::LEGACY, self::MAIN, self::EXPLICIT_REQUIRED];

    /** هل فُتحت بوابة التفعيل المنسَّق؟ */
    public static function activationOpen(): bool
    {
        return (bool) config('treasury.cash_sale_routing_enabled', false);
    }

    /** القيمة المخزَّنة للمستأجر الحالي (أو الافتراضية)، كما هي، بصرف النظر عن البوابة. */
    public static function configured(): string
    {
        $value = Settings::get('sales', 'cash_sale_treasury_policy');

        return is_string($value) && in_array($value, self::VALUES, true) ? $value : self::LEGACY;
    }

    /** السياسة الساريّة فعلاً وقت الترحيل: `legacy` ما لم تُفتح البوابة. */
    public static function effective(): string
    {
        return self::activationOpen() ? self::configured() : self::LEGACY;
    }

    /** مقابل العقد الموحَّد (T3) لسياسة فعّالة غير `legacy`. */
    public static function selectionPolicy(string $effective): TreasurySelectionPolicy
    {
        return $effective === self::EXPLICIT_REQUIRED
            ? TreasurySelectionPolicy::ExplicitRequired
            : TreasurySelectionPolicy::MainOfType;
    }
}

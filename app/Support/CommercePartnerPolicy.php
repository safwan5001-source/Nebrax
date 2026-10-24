<?php

namespace App\Support;

/**
 * H4-01 / D-05: سياسة ربط مشتري المتجر الإلكتروني بطرف (Partner) محاسبي عند الدفع الإلكتروني. سياسة عمل لا صحّة تقنية (CLAUDE.md قاعدة 6):
 * تُضبط لكل مستأجر في `sales.commerce_partner_policy`:
 *  - `link_verified_else_create` (الافتراضي، التوصية المعتمدة): طرف مرتبط قائم (ربط موظف) ⇒ يُستعمل؛ وإلا طرف «ويب» يُنشأ ويُعاد استعماله بمفتاح
 *    خادمي حتمي (هاتف/بريد مطبَّع للضيف، أو معرّف الهوية) — **لا دمج في أي طرف قائم** ولا مطابقة مع أطراف أنشأها الموظفون.
 *  - `generic_cash_customer`: طرف واحد عام للمتجر الإلكتروني (يفقد كشف الحساب لكل عميل).
 *  - `manual_link`: لا طرف آلي؛ الطلب بلا طرف (لا ترحيل محاسبي حتى يربطه موظف).
 */
final class CommercePartnerPolicy
{
    public const LINK_VERIFIED_ELSE_CREATE = 'link_verified_else_create';

    public const GENERIC_CASH_CUSTOMER = 'generic_cash_customer';

    public const MANUAL_LINK = 'manual_link';

    public const VALUES = [self::LINK_VERIFIED_ELSE_CREATE, self::GENERIC_CASH_CUSTOMER, self::MANUAL_LINK];

    /** القيمة المخزَّنة للمستأجر الحالي، وإلا الافتراضية. قيمة غير معروفة تسقط إلى الافتراضي (فشل آمن). */
    public static function configured(): string
    {
        $value = Settings::get('sales', 'commerce_partner_policy');

        return is_string($value) && in_array($value, self::VALUES, true) ? $value : self::LINK_VERIFIED_ELSE_CREATE;
    }
}

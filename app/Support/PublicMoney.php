<?php

namespace App\Support;

use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Http\Request;

/**
 * تمثيل النقود في الـ Public API: **وحدات صغرى صحيحة (هللات) + رمز عملة**.
 *
 * قرار العقد (موثّق في التقرير): يعرض الـ Public API كل مبلغ عددًا صحيحًا بالوحدات
 * الصغرى (كما يُخزَّن `bigint`) مع حقل `currency` منفصل — لا سلاسل عشرية ولا `float`.
 * هذا أدقّ وأحتم لتكامل آلة-لآلة (M2M) من التنسيق العشري المعروض في الواجهة الداخلية.
 * لا يغيّر هذا دلالات النقود الداخلية؛ يكشف القيمة المخزّنة كما هي.
 *
 * العملة موحّدة على مستوى المستأجر (`tenants.currency`)، فتُحلّ مرّة واحدة للطلب
 * وتُخزَّن مؤقتًا على سماته لتفادي استعلام متكرّر.
 */
class PublicMoney
{
    private const REQUEST_CURRENCY = 'public_api_currency';

    /** رمز عملة المستأجر النشط (ISO-4217)، مع سقوط آمن على SAR. */
    public static function currency(Request $request): string
    {
        $cached = $request->attributes->get(self::REQUEST_CURRENCY);
        if (is_string($cached) && $cached !== '') {
            return $cached;
        }

        $tenant = Tenant::find(app(TenantContext::class)->id());
        $currency = $tenant?->currency ?: 'SAR';
        $request->attributes->set(self::REQUEST_CURRENCY, $currency);

        return $currency;
    }

    /** يحوّل قيمة مخزّنة إلى عدد صحيح بالوحدات الصغرى (بلا float). */
    public static function minor(int|string|null $stored): int
    {
        return (int) $stored;
    }
}

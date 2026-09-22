<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * COM-MOBILE-SHIPPING-1 (ADR-10) — منطقة شحن مُهيَّأة من التاجر: مطابقة
 * حرفية (مدينة أو منطقة) ⇐ رسم شحن ثابت. لا مزوّد، لا ناقل، لا مسافة، لا
 * وزن/أبعاد — الحد الأدنى الصحيح لاستبدال `delivery_amount_minor` الصفري
 * المُقفَل بنيوياً سابقاً في `CommerceCheckoutService`.
 *
 * **`CompanyWide`**: بيان تسعير واحد للمؤسسة، كـ`PaymentMethod`/
 * `FulfillmentPolicy` أنفسهما — قناة البيع (لا الفرع) هي حدود Commerce
 * (ADR-03 §1)، فلا `branch_id` هنا.
 *
 * **`match_value_normalized`**: مُشتقٌّ دائماً من `match_value` هنا (وحيداً
 * — لا في المتحكّم)، فلا يقبل الإدخال المباشر ولا يمكن أن ينحرف عنه. القيد
 * الفريد على القاعدة (`match_type`, `match_value_normalized`) هو ما يمنع
 * التكرار غير الحسّاس لحالة الأحرف فعلياً تحت التزامن — فحص التطبيق وحده
 * عرضة لسباقٍ بين قراءتين متزامنتين (TOCTOU).
 *
 * لا منطق حسمٍ آخر هنا — القراءة حصراً عبر `App\Services\Commerce\
 * ShippingRateService::resolveRateMinor()`، الذي يفضّل مطابقة المدينة على
 * المنطقة.
 */
class CommerceShippingZone extends BaseModel implements CompanyWide
{
    public const MATCH_TYPE_CITY = 'city';

    public const MATCH_TYPE_REGION = 'region';

    public const MATCH_TYPES = [self::MATCH_TYPE_CITY, self::MATCH_TYPE_REGION];

    protected $fillable = [
        'tenant_id', 'name', 'match_type', 'match_value', 'rate_amount_minor', 'is_active',
    ];

    protected $casts = [
        'rate_amount_minor' => 'integer',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $zone): void {
            $zone->match_value_normalized = mb_strtolower(trim((string) $zone->match_value));
        });
    }
}

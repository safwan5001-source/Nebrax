<?php

namespace App\Services\Commerce;

use App\Models\CommerceShippingZone;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Shipping Rate Resolution — COM-MOBILE-SHIPPING-1 (ADR-10)
 * ═══════════════════════════════════════════════════════════════
 *
 * سلطة الحسم الوحيدة لرسم الشحن — لا `CommerceCheckoutController`، لا
 * `CommerceCheckoutService` نفسه يحسب رسماً؛ كلاهما يستدعي هذا فقط. مطابق
 * لنمط `FulfillmentPolicyService`: خدمةٌ مشتركة واحدة تُستهلك حرفياً من
 * `/commerce/v1` و`/store/v1` ومستهلكي App Builder المستقبليين (ADR-10 §4)
 * — لا نسخة موازية لأيّ قناة.
 *
 * **مطابقة حرفية غير حسّاسة لحالة الأحرف فقط** — لا تطبيع عربي (لا حاجة؛
 * العربية بلا حالة أحرف)، لا مسافة، لا تقارب نصّي. المدينة تُفضَّل على
 * المنطقة (أدق مستوى مطابقة متاح أولاً)؛ لا مطابقة على أيّهما ⇐ صفر — نفس
 * القيمة الافتراضية التي كانت مقفلة بنيوياً قبل هذه المهمة، فمستأجرٌ لم يُهيّئ
 * أي منطقة بعد لا يرى أي تغيير سلوكي.
 *
 * **لا ثقة بمُدخل العميل**: `$city`/`$region` هنا قيمتا `CommerceCheckout`
 * المخزَّنتان فعلاً (`delivery_city`/`delivery_region`) لا شيءٌ من جسم طلبٍ
 * وارد مباشرة — الاستدعاء دوماً من `CommerceCheckoutService` بعد أن حُفظتا.
 */
final class ShippingRateService
{
    public function resolveRateMinor(?string $city, ?string $region): int
    {
        $rate = $this->matchZone(CommerceShippingZone::MATCH_TYPE_CITY, $city)
            ?? $this->matchZone(CommerceShippingZone::MATCH_TYPE_REGION, $region);

        return $rate ?? 0;
    }

    private function matchZone(string $matchType, ?string $value): ?int
    {
        $value = trim((string) $value);
        if ($value === '') {
            return null;
        }

        $zone = CommerceShippingZone::query()
            ->where('is_active', true)
            ->where('match_type', $matchType)
            ->whereRaw('LOWER(match_value) = LOWER(?)', [$value])
            ->first();

        return $zone?->rate_amount_minor;
    }
}

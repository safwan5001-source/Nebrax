<?php

namespace App\Services;

use App\Models\FuelStation;
use App\Models\PaymentMethod;
use Illuminate\Support\Collection;

/**
 * طرق التحصيل الفعّالة لمحطة وقود — المصدر الوحيد: إعداد المحطة `fuel_sales_allowed_payment_method_ids`
 * مصفّاة بالطرق **النشطة** من نوع نقد/بنك. يستعملها تحصيل البيع (`GET .../sale-payment-methods`) وإقرار تحصيل الوردية
 * معاً، فتعديل إعداد المحطة (تفعيل/تعطيل طريقة) ينعكس على الاثنين من القراءة التالية بلا قائمة موازية ولا إنشاء طرق أو حسابات.
 */
class FuelStationPaymentMethods
{
    public function __construct(private FuelStationSettingsService $settings) {}

    /** @return Collection<int, PaymentMethod> */
    public function allowedFor(FuelStation $station): Collection
    {
        $ids = $this->settings->forStation($station)['fuel_sales_allowed_payment_method_ids'] ?? [];

        return PaymentMethod::query()
            ->whereIn('id', is_array($ids) ? $ids : [])
            ->where('is_active', true)
            ->whereIn('settlement_type', ['cash', 'bank'])
            ->orderBy('name')
            ->get();
    }
}

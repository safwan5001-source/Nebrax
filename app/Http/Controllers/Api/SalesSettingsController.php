<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateSalesSettingsRequest;
use App\Support\CashSaleTreasuryPolicy;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات المبيعات (تفضيلات غير محاسبية) — تُخزَّن في `tenants.settings['sales']`.
 *
 * كل مفتاح هنا **يُقرأ فعلاً**: البادئة في ترقيم الفاتورة، والنسبة ونوع السداد
 * كقيم افتراضية عند غياب المُرسَل، ومدّة الصلاحية في عرض السعر. (قبل توصيلها
 * كانت تُحفظ ولا يقرؤها أحد — شاشةٌ تَعِد ولا تفعل.)
 */
class SalesSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->payload(Settings::group('sales'))]);
    }

    public function update(UpdateSalesSettingsRequest $request): JsonResponse
    {
        return response()->json(['data' => $this->payload(Settings::put('sales', $request->validated()))]);
    }

    /**
     * TREASURY-T4: حقلان مشتقّان للقراءة فقط — هل فُتحت بوابة التفعيل، وما السياسة الفعّالة وقت الترحيل.
     * (القيمة المخزَّنة تبقى كما هي؛ الفعّالة `legacy` ما دامت البوابة مغلقة.)
     */
    private function payload(array $sales): array
    {
        return $sales + [
            'cash_sale_treasury_routing_available' => CashSaleTreasuryPolicy::activationOpen(),
            'cash_sale_treasury_policy_effective'  => CashSaleTreasuryPolicy::effective(),
        ];
    }
}

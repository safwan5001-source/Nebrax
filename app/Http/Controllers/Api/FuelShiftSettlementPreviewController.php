<?php

namespace App\Http\Controllers\Api;

use App\Models\FuelShift;
use App\Services\FuelShiftSettlementPreviewService;
use App\Services\FuelShiftSettlementReadiness;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * معاينة تسوية الوردية (P1-3a) — قراءة فقط، لا تكتب فاتورة ولا سنداً ولا قيداً ولا حركة مخزون. مغلقة خلف بوابة النشر: 404 ما دامت
 * `fuel_stations.shift_settlement_enabled` مغلقة أو مرجع الرأي الضريبي فارغاً. نطاق المحطة (فرع + مخزن + محطات مسنَدة) على الخادم قبل أي قراءة، 404 موحَّد.
 * الصلاحية الأساسية `fuel.shift.close` (من يملك الإغلاق يملك البصمة)؛ طبقات المبالغ والتكلفة داخل الخدمة بـ`fuel.sale.view` و`products.view_cost`.
 */
class FuelShiftSettlementPreviewController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelShiftSettlementPreviewService $service) {}

    public function show(Request $request, string $id): JsonResponse
    {
        abort_unless(FuelShiftSettlementReadiness::enabled(), 404);
        $shift = $this->scopeToActiveBranch(FuelShift::query(), $request)->findOrFail($id);
        $this->accessibleStation($shift->fuel_station_id);

        $data = $this->domain(fn () => $this->service->preview($shift, $request->user()));

        // يحوي أرقاماً مالية: لا تخزين وسيط ولا متصفح.
        return response()->json(['data' => $data])->header('Cache-Control', 'no-store');
    }
}

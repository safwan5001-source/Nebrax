<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreFuelShiftCollectionRequest;
use App\Models\FuelShift;
use App\Services\FuelShiftCollectionConflictException;
use App\Services\FuelShiftCollectionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * إقرار تحصيل الوردية — تشغيلي فقط (لا سند ولا فاتورة ولا قيد). مغلق خلف بوابة نشر: 404 ما دامت
 * `fuel_stations.shift_collection_declaration_enabled` مغلقة. نطاق المحطة (فرع + مخزن) على الخادم قبل أي قراءة أو كتابة (#2014)،
 * 404 موحّد. القراءة `fuel.shift.view`، والحفظ `fuel.shift.cash_count`؛ وقيم المبيعات والفرق تتطلب `fuel.sale.view` (D8) داخل الخدمة.
 */
class FuelShiftCollectionController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelShiftCollectionService $service) {}

    public function show(Request $request, string $id): JsonResponse
    {
        abort_unless(FuelShiftCollectionService::enabled(), 404);
        $shift = $this->visibleShift($id, $request);

        return response()->json(['data' => $this->service->view($shift, $request->user())]);
    }

    public function store(StoreFuelShiftCollectionRequest $request, string $id): JsonResponse
    {
        abort_unless(FuelShiftCollectionService::enabled(), 404);
        $shift = $this->visibleShift($id, $request);

        try {
            $result = $this->domain(fn () => $this->service->declare($shift, $request->validated(), $request->user()));
        } catch (FuelShiftCollectionConflictException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason, 'current_revision' => $e->currentRevision], 409);
        }

        return response()->json(
            ['data' => $result['view'], 'meta' => ['replayed' => $result['replayed'], 'unchanged' => $result['unchanged']]],
            $result['replayed'] || $result['unchanged'] ? 200 : 201,
        );
    }

    /** الوردية في فروع المستخدم **و** محطتها ضمن فرعه/مخزنه — وإلا 404 قبل أي قراءة أو كتابة. */
    private function visibleShift(string $id, Request $request): FuelShift
    {
        $shift = $this->scopeToActiveBranch(FuelShift::query(), $request)->findOrFail($id);
        $this->accessibleStation($shift->fuel_station_id);

        return $shift;
    }
}

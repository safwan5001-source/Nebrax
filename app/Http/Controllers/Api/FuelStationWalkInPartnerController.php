<?php

namespace App\Http\Controllers\Api;

use App\Services\FuelShiftSettlementReadiness;
use App\Services\FuelStationWalkInPartnerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * العميل النقدي المخصّص للمحطة (P1-3a). تعيين صريح idempotent لا ينشأ عند الإغلاق؛ القراءة لمن يرى المحطات والتعيين لحوكمة الوقود.
 * مغلق خلف بوابة تسوية الورديات (404). نطاق المحطة على الخادم قبل أي قراءة أو كتابة. لا فك ولا استبدال في V1.
 */
class FuelStationWalkInPartnerController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelStationWalkInPartnerService $service) {}

    public function show(string $id): JsonResponse
    {
        abort_unless(FuelShiftSettlementReadiness::enabled(), 404);

        return response()->json(['data' => $this->service->view($this->accessibleStation($id))]);
    }

    public function assign(Request $request, string $id): JsonResponse
    {
        abort_unless(FuelShiftSettlementReadiness::enabled(), 404);
        $station = $this->accessibleStation($id);
        $result = $this->domain(fn () => $this->service->assign($station, $request->user()));

        return response()->json(['data' => $this->service->view($station), 'meta' => ['created' => $result['created']]], $result['created'] ? 201 : 200);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\DecideFuelReadingRequestRequest;
use App\Http\Requests\ListFuelReadingRequestsRequest;
use App\Http\Resources\FuelTankReadingRequestResource;
use App\Models\FuelTankReadingRequest;
use App\Services\FuelReadingRequestDecidedException;
use App\Services\FuelTankReadingRequestService;
use Illuminate\Http\JsonResponse;

/**
 * FUEL-B6 (تعديل) — طلبات القراءات المتأخرة. المشرف المخوَّل (`fuel.reading.late.approve`) يرى طلبات نطاقه ويقرّرها؛ غيره (مقدِّم الطلب بـ`fuel.reading.record`)
 * يرى **طلباته هو فقط**. نطاق المحطة/الفرع/المخزن/المحطات المسنَدة بـ404 موحّد، ولا اعتماد ذاتي (في الخدمة).
 */
class FuelReadingRequestController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelTankReadingRequestService $service) {}

    public function index(ListFuelReadingRequestsRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['station_id'])) {
            $this->accessibleStation($data['station_id']);
        }
        $user = $request->user();
        $query = $this->restrictToAccessibleWarehouseStations(FuelTankReadingRequest::query())
            ->with(['station', 'tank', 'requester', 'decider'])
            ->when($data['station_id'] ?? null, fn ($q, $id) => $q->where('fuel_station_id', $id))
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when(! $user->hasPermission(FuelTankReadingRequestService::APPROVE_PERMISSION), fn ($q) => $q->where('requested_by', $user->id))
            ->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")
            ->orderBy('created_at')->orderBy('id');

        return FuelTankReadingRequestResource::collection($query->paginate((int) ($data['per_page'] ?? 20)))->response();
    }

    public function approve(DecideFuelReadingRequestRequest $request, string $id): JsonResponse
    {
        return $this->decide($request, $id, 'approve');
    }

    public function reject(DecideFuelReadingRequestRequest $request, string $id): JsonResponse
    {
        return $this->decide($request, $id, 'reject');
    }

    private function decide(DecideFuelReadingRequestRequest $request, string $id, string $decision): JsonResponse
    {
        $target = FuelTankReadingRequest::query()->findOrFail($id);
        $this->accessibleStation($target->fuel_station_id); // 404 موحّد خارج نطاق المحطة/الفرع/المخزن
        return $this->domain(function () use ($request, $id, $decision) {
            try {
                $decided = $this->service->decide($id, $request->user(), $decision, $request->validated()['note'] ?? null);
            } catch (FuelReadingRequestDecidedException $e) {
                // استجابة داخل `domain()`: الاستثناء يرث RuntimeException فكان سيُحوَّل إلى 422.
                return response()->json(['message' => $e->getMessage(), 'reason' => 'request_already_decided', 'current_status' => $e->currentStatus], 409);
            }

            return (new FuelTankReadingRequestResource($decided->load(['station', 'tank', 'requester', 'decider'])))->response();
        });
    }
}

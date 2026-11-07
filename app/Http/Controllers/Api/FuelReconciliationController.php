<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ApproveFuelReconciliationRequest;
use App\Http\Requests\ListFuelReconciliationsRequest;
use App\Http\Requests\ListFuelTankReadingsRequest;
use App\Http\Requests\StoreFuelReconciliationRequest;
use App\Http\Requests\StoreFuelTankReadingRequest;
use App\Http\Resources\FuelReconciliationResource;
use App\Http\Resources\FuelTankReadingRequestResource;
use App\Http\Resources\FuelTankReadingResource;
use App\Models\FuelReconciliation;
use App\Models\FuelTankReading;
use App\Models\FuelTankReadingRequest;
use App\Services\FuelReconciliationService;
use Illuminate\Http\JsonResponse;

class FuelReconciliationController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelReconciliationService $service) {}

    public function readings(ListFuelTankReadingsRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['fuel_station_id'])) {
            $this->accessibleStation($data['fuel_station_id']); // 404 موحّد لمحطة خارج نطاق المستخدم
        }
        $query = $this->restrictToAccessibleWarehouseStations(FuelTankReading::query())
            ->with(['station', 'tank', 'recorder'])
            ->when($data['fuel_station_id'] ?? null, fn ($q, $id) => $q->where('fuel_station_id', $id))
            ->when($data['fuel_tank_id'] ?? null, fn ($q, $id) => $q->where('fuel_tank_id', $id))
            ->when($data['reading_type'] ?? null, fn ($q, $type) => $q->where('reading_type', $type))
            ->latest('measured_at')->latest('created_at')->orderByDesc('id');

        // بلا per_page: السلوك القديم حرفياً (قائمة كاملة). معها: سجل مرقَّم لشاشة القراءات.
        if (! empty($data['per_page'])) {
            return FuelTankReadingResource::collection($query->paginate((int) $data['per_page']))->response();
        }

        return FuelTankReadingResource::collection($query->get())->response();
    }

    public function storeReading(StoreFuelTankReadingRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->accessibleStation($data['fuel_station_id']);
        $data['recorded_by'] = $request->user()->id;
        $result = $this->domain(fn () => $this->service->recordReading($data));

        // طلب قراءة متأخرة بانتظار موافقة المشرف (لا قراءة تشغيلية): 202 للإنشاء، 200 لإعادة إرسال مطابقة.
        if ($result instanceof FuelTankReadingRequest) {
            return (new FuelTankReadingRequestResource($result->load(['station', 'tank', 'requester', 'decider'])))->response()->setStatusCode($result->wasRecentlyCreated ? 202 : 200);
        }

        // 201 للإنشاء، 200 لإعادة إرسال مطابقة (الأثر الأول نفسه بلا إنشاء).
        return (new FuelTankReadingResource($result->load(['station', 'tank', 'recorder'])))->response()->setStatusCode($result->wasRecentlyCreated ? 201 : 200);
    }

    public function index(ListFuelReconciliationsRequest $request): JsonResponse
    {
        $data = $request->validated();
        $reconciliations = $this->restrictToAccessibleStations($this->scopeToAccessibleWarehouses($this->scopeToActiveBranch(FuelReconciliation::query(), $request), ['warehouse_id']))
            ->with(['station', 'tank', 'fuelProduct', 'warehouse'])
            ->when($data['fuel_station_id'] ?? null, fn ($query, $id) => $query->where('fuel_station_id', $id))
            ->when($data['fuel_tank_id'] ?? null, fn ($query, $id) => $query->where('fuel_tank_id', $id))
            ->when($data['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->latest()
            ->get();

        return FuelReconciliationResource::collection($reconciliations)->response();
    }

    public function store(StoreFuelReconciliationRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->accessibleStation($data['fuel_station_id']);
        $data['created_by'] = $request->user()->id;
        $reconciliation = $this->domain(fn () => $this->service->createDraft($data));

        return (new FuelReconciliationResource($reconciliation->load(['station', 'tank', 'fuelProduct', 'warehouse'])))->response()->setStatusCode(201);
    }

    public function approve(ApproveFuelReconciliationRequest $request, string $id): JsonResponse
    {
        $data = $request->validated();
        $reconciliation = $this->restrictToAccessibleStations($this->scopeToAccessibleWarehouses($this->scopeToActiveBranch(FuelReconciliation::query(), $request), ['warehouse_id']))->findOrFail($id);
        $this->accessibleStation($reconciliation->fuel_station_id);
        $approved = $this->domain(fn () => $this->service->approve($reconciliation, $request->user()->id, $data['reason'] ?? null));

        return (new FuelReconciliationResource($approved->load(['station', 'tank', 'fuelProduct', 'warehouse'])))->response();
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\AuthorizesFuelStationScope;
use App\Http\Requests\ApproveFuelReconciliationRequest;
use App\Http\Requests\ListFuelReconciliationsRequest;
use App\Http\Requests\ListFuelTankReadingsRequest;
use App\Http\Requests\StoreFuelReconciliationRequest;
use App\Http\Requests\StoreFuelTankReadingRequest;
use App\Http\Resources\FuelReconciliationResource;
use App\Http\Resources\FuelTankReadingResource;
use App\Models\FuelReconciliation;
use App\Models\FuelTankReading;
use App\Services\FuelReconciliationService;
use Illuminate\Http\JsonResponse;

class FuelReconciliationController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelReconciliationService $service) {}

    public function readings(ListFuelTankReadingsRequest $request): JsonResponse
    {
        $data = $request->validated();
        $readings = $this->restrictToAccessibleWarehouseStations(FuelTankReading::query())
            ->with(['station', 'tank', 'recorder'])
            ->when($data['fuel_tank_id'] ?? null, fn ($query, $id) => $query->where('fuel_tank_id', $id))
            ->latest('measured_at')
            ->get();

        return FuelTankReadingResource::collection($readings)->response();
    }

    public function storeReading(StoreFuelTankReadingRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->accessibleStation($data['fuel_station_id']);
        $data['recorded_by'] = $request->user()->id;
        $reading = $this->domain(fn () => $this->service->recordReading($data));

        return (new FuelTankReadingResource($reading->load(['station', 'tank', 'recorder'])))->response()->setStatusCode(201);
    }

    public function index(ListFuelReconciliationsRequest $request): JsonResponse
    {
        $data = $request->validated();
        $reconciliations = $this->scopeToAccessibleWarehouses($this->scopeToActiveBranch(FuelReconciliation::query(), $request), ['warehouse_id'])
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
        $reconciliation = $this->scopeToAccessibleWarehouses($this->scopeToActiveBranch(FuelReconciliation::query(), $request), ['warehouse_id'])->findOrFail($id);
        $this->accessibleStation($reconciliation->fuel_station_id);
        $approved = $this->domain(fn () => $this->service->approve($reconciliation, $request->user()->id, $data['reason'] ?? null));

        return (new FuelReconciliationResource($approved->load(['station', 'tank', 'fuelProduct', 'warehouse'])))->response();
    }
}

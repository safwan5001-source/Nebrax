<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\FuelStationMasterDataRequest;
use App\Http\Resources\FuelNozzleResource;
use App\Http\Resources\FuelProductResource;
use App\Http\Resources\FuelPumpResource;
use App\Http\Resources\FuelStationResource;
use App\Http\Resources\FuelTankResource;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Services\FuelStationMasterDataService;
use Illuminate\Http\JsonResponse;

/**
 * API للبيانات المرجعية Cycle 1؛ لا يحمل حسابات أو تحققات ملكية متقاطعة داخله.
 */
class FuelStationMasterDataController extends ApiController
{
    public function __construct(private FuelStationMasterDataService $masterData) {}

    public function indexStations(): JsonResponse
    {
        return FuelStationResource::collection(FuelStation::with($this->stationRelations())->orderBy('code')->get())->response();
    }

    public function showStation(string $id): JsonResponse
    {
        return (new FuelStationResource(FuelStation::with($this->stationRelations())->findOrFail($id)))->response();
    }

    public function storeStation(FuelStationMasterDataRequest $request): JsonResponse
    {
        return (new FuelStationResource($this->domain(fn () => $this->masterData->createStation($request->validated()))->load($this->stationRelations())))->response()->setStatusCode(201);
    }

    public function updateStation(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        return (new FuelStationResource($this->domain(fn () => $this->masterData->updateStation(FuelStation::findOrFail($id), $request->validated()))))->response();
    }

    public function destroyStation(string $id): JsonResponse
    {
        $this->domain(fn () => $this->masterData->deleteStation(FuelStation::findOrFail($id)));

        return response()->json(['message' => 'deleted']);
    }

    public function indexFuelProducts(): JsonResponse
    {
        return FuelProductResource::collection(FuelProduct::with('product')->orderBy('code')->get())->response();
    }

    public function showFuelProduct(string $id): JsonResponse
    {
        return (new FuelProductResource(FuelProduct::with('product')->findOrFail($id)))->response();
    }

    public function storeFuelProduct(FuelStationMasterDataRequest $request): JsonResponse
    {
        return (new FuelProductResource($this->domain(fn () => $this->masterData->createFuelProduct($request->validated()))->load('product')))->response()->setStatusCode(201);
    }

    public function updateFuelProduct(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        return (new FuelProductResource($this->domain(fn () => $this->masterData->updateFuelProduct(FuelProduct::findOrFail($id), $request->validated()))))->response();
    }

    public function destroyFuelProduct(string $id): JsonResponse
    {
        $this->domain(fn () => $this->masterData->deleteFuelProduct(FuelProduct::findOrFail($id)));

        return response()->json(['message' => 'deleted']);
    }

    public function indexTanks(): JsonResponse
    {
        return FuelTankResource::collection(FuelTank::with(['station', 'fuelProduct', 'calibrationPoints'])->orderBy('code')->get())->response();
    }

    public function showTank(string $id): JsonResponse
    {
        return (new FuelTankResource(FuelTank::with(['station', 'fuelProduct', 'calibrationPoints'])->findOrFail($id)))->response();
    }

    public function storeTank(FuelStationMasterDataRequest $request): JsonResponse
    {
        return (new FuelTankResource($this->domain(fn () => $this->masterData->createTank($request->validated()))->load(['station', 'fuelProduct', 'calibrationPoints'])))->response()->setStatusCode(201);
    }

    public function updateTank(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        return (new FuelTankResource($this->domain(fn () => $this->masterData->updateTank(FuelTank::findOrFail($id), $request->validated()))->load(['station', 'fuelProduct', 'calibrationPoints'])))->response();
    }

    public function destroyTank(string $id): JsonResponse
    {
        $this->domain(fn () => $this->masterData->deleteTank(FuelTank::findOrFail($id)));

        return response()->json(['message' => 'deleted']);
    }

    public function indexPumps(): JsonResponse
    {
        return FuelPumpResource::collection(FuelPump::with('station')->withCount('nozzles')->orderBy('pump_number')->get())->response();
    }

    public function showPump(string $id): JsonResponse
    {
        return (new FuelPumpResource(FuelPump::with('station')->withCount('nozzles')->findOrFail($id)))->response();
    }

    public function storePump(FuelStationMasterDataRequest $request): JsonResponse
    {
        return (new FuelPumpResource($this->domain(fn () => $this->masterData->createPump($request->validated()))->load('station')->loadCount('nozzles')))->response()->setStatusCode(201);
    }

    public function updatePump(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        return (new FuelPumpResource($this->domain(fn () => $this->masterData->updatePump(FuelPump::findOrFail($id), $request->validated()))->load('station')->loadCount('nozzles')))->response();
    }

    public function destroyPump(string $id): JsonResponse
    {
        $this->domain(fn () => $this->masterData->deletePump(FuelPump::findOrFail($id)));

        return response()->json(['message' => 'deleted']);
    }

    public function indexNozzles(): JsonResponse
    {
        return FuelNozzleResource::collection(FuelNozzle::with(['pump', 'tank', 'fuelProduct'])->orderBy('nozzle_number')->get())->response();
    }

    public function showNozzle(string $id): JsonResponse
    {
        return (new FuelNozzleResource(FuelNozzle::with(['pump', 'tank', 'fuelProduct'])->findOrFail($id)))->response();
    }

    public function storeNozzle(FuelStationMasterDataRequest $request): JsonResponse
    {
        return (new FuelNozzleResource($this->domain(fn () => $this->masterData->createNozzle($request->validated()))->load(['pump', 'tank', 'fuelProduct'])))->response()->setStatusCode(201);
    }

    public function updateNozzle(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        return (new FuelNozzleResource($this->domain(fn () => $this->masterData->updateNozzle(FuelNozzle::findOrFail($id), $request->validated()))))->response();
    }

    public function destroyNozzle(string $id): JsonResponse
    {
        $this->domain(fn () => $this->masterData->deleteNozzle(FuelNozzle::findOrFail($id)));

        return response()->json(['message' => 'deleted']);
    }

    /** @return list<string> */
    private function stationRelations(): array
    {
        return ['branch', 'manager', 'defaultInventoryAccount', 'defaultRevenueAccount', 'defaultCogsAccount'];
    }
}

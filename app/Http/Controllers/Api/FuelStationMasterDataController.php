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
use Illuminate\Http\Request;

/**
 * API للبيانات المرجعية Cycle 1؛ لا يحمل حسابات أو تحققات ملكية متقاطعة داخله.
 */
class FuelStationMasterDataController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelStationMasterDataService $masterData) {}

    public function indexStations(): JsonResponse
    {
        return FuelStationResource::collection($this->restrictToAccessibleStations(FuelStation::with($this->stationRelations()), 'id')->orderBy('code')->get())->response();
    }

    public function showStation(string $id): JsonResponse
    {
        return (new FuelStationResource($this->restrictToAccessibleStations(FuelStation::with($this->stationRelations()), 'id')->findOrFail($id)))->response();
    }

    public function storeStation(FuelStationMasterDataRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertRecordAccessible($data['branch_id'], [$data['warehouse_id'] ?? null]);

        return (new FuelStationResource($this->domain(fn () => $this->masterData->createStation($request->validated(), $request->user()))->load($this->stationRelations())))->response()->setStatusCode(201);
    }

    public function updateStation(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        $station = $this->stationForUpdate($id, $request->validated());

        return (new FuelStationResource($this->domain(fn () => $this->masterData->updateStation($station, $request->validated(), $request->user()))->load($this->stationRelations())))->response();
    }

    public function destroyStation(Request $request, string $id): JsonResponse
    {
        $station = $this->accessibleStation($id);
        $this->domain(fn () => $this->masterData->deleteStation($station, $request->user()));

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
        return (new FuelProductResource($this->domain(fn () => $this->masterData->createFuelProduct($request->validated(), $request->user()))->load('product')))->response()->setStatusCode(201);
    }

    public function updateFuelProduct(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        return (new FuelProductResource($this->domain(fn () => $this->masterData->updateFuelProduct(FuelProduct::findOrFail($id), $request->validated(), $request->user()))))->response();
    }

    public function destroyFuelProduct(Request $request, string $id): JsonResponse
    {
        $this->domain(fn () => $this->masterData->deleteFuelProduct(FuelProduct::findOrFail($id), $request->user()));

        return response()->json(['message' => 'deleted']);
    }

    public function indexTanks(): JsonResponse
    {
        return FuelTankResource::collection($this->restrictToAccessibleStations(FuelTank::with(['station', 'fuelProduct', 'calibrationPoints']))->orderBy('code')->get())->response();
    }

    public function showTank(string $id): JsonResponse
    {
        return (new FuelTankResource($this->restrictToAccessibleStations(FuelTank::with(['station', 'fuelProduct', 'calibrationPoints']))->findOrFail($id)))->response();
    }

    public function storeTank(FuelStationMasterDataRequest $request): JsonResponse
    {
        $this->accessibleStation($request->validated()['fuel_station_id']);

        return (new FuelTankResource($this->domain(fn () => $this->masterData->createTank($request->validated(), $request->user()))->load(['station', 'fuelProduct', 'calibrationPoints'])))->response()->setStatusCode(201);
    }

    public function updateTank(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        $tank = $this->childForUpdate(FuelTank::class, $id, $request->validated());

        return (new FuelTankResource($this->domain(fn () => $this->masterData->updateTank($tank, $request->validated(), $request->user()))->load(['station', 'fuelProduct', 'calibrationPoints'])))->response();
    }

    public function destroyTank(Request $request, string $id): JsonResponse
    {
        $tank = $this->childForUpdate(FuelTank::class, $id, []);
        $this->domain(fn () => $this->masterData->deleteTank($tank, $request->user()));

        return response()->json(['message' => 'deleted']);
    }

    public function indexPumps(): JsonResponse
    {
        return FuelPumpResource::collection($this->restrictToAccessibleStations(FuelPump::with('station')->withCount('nozzles'))->orderBy('pump_number')->get())->response();
    }

    public function showPump(string $id): JsonResponse
    {
        return (new FuelPumpResource($this->restrictToAccessibleStations(FuelPump::with('station')->withCount('nozzles'))->findOrFail($id)))->response();
    }

    public function storePump(FuelStationMasterDataRequest $request): JsonResponse
    {
        $this->accessibleStation($request->validated()['fuel_station_id']);

        return (new FuelPumpResource($this->domain(fn () => $this->masterData->createPump($request->validated(), $request->user()))->load('station')->loadCount('nozzles')))->response()->setStatusCode(201);
    }

    public function updatePump(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        $pump = $this->childForUpdate(FuelPump::class, $id, $request->validated());

        return (new FuelPumpResource($this->domain(fn () => $this->masterData->updatePump($pump, $request->validated(), $request->user()))->load('station')->loadCount('nozzles')))->response();
    }

    public function destroyPump(Request $request, string $id): JsonResponse
    {
        $pump = $this->childForUpdate(FuelPump::class, $id, []);
        $this->domain(fn () => $this->masterData->deletePump($pump, $request->user()));

        return response()->json(['message' => 'deleted']);
    }

    public function indexNozzles(): JsonResponse
    {
        return FuelNozzleResource::collection($this->restrictToAccessibleStations(FuelNozzle::with(['pump', 'tank', 'fuelProduct']))->orderBy('nozzle_number')->get())->response();
    }

    public function showNozzle(string $id): JsonResponse
    {
        return (new FuelNozzleResource($this->restrictToAccessibleStations(FuelNozzle::with(['pump', 'tank', 'fuelProduct']))->findOrFail($id)))->response();
    }

    public function storeNozzle(FuelStationMasterDataRequest $request): JsonResponse
    {
        $this->accessibleStation(FuelPump::findOrFail($request->validated()['fuel_pump_id'])->fuel_station_id);

        return (new FuelNozzleResource($this->domain(fn () => $this->masterData->createNozzle($request->validated(), $request->user()))->load(['pump', 'tank', 'fuelProduct'])))->response()->setStatusCode(201);
    }

    public function updateNozzle(FuelStationMasterDataRequest $request, string $id): JsonResponse
    {
        $nozzle = $this->nozzleForUpdate($id, $request->validated());

        return (new FuelNozzleResource($this->domain(fn () => $this->masterData->updateNozzle($nozzle, $request->validated(), $request->user()))))->response();
    }

    public function destroyNozzle(Request $request, string $id): JsonResponse
    {
        $nozzle = $this->nozzleForUpdate($id, []);
        $this->domain(fn () => $this->masterData->deleteNozzle($nozzle, $request->user()));

        return response()->json(['message' => 'deleted']);
    }

    /** محطة مستهدفة بالتعديل: ضمن نطاق المستخدم، وأي فرع/مخزن جديد في الجسم ضمن نطاقه أيضاً. */
    private function stationForUpdate(string $id, array $data): FuelStation
    {
        $station = $this->accessibleStation($id);
        if (array_key_exists('branch_id', $data) || array_key_exists('warehouse_id', $data)) {
            $this->assertRecordAccessible($data['branch_id'] ?? $station->branch_id, [array_key_exists('warehouse_id', $data) ? $data['warehouse_id'] : $station->warehouse_id]);
        }

        return $station;
    }

    /**
     * خزان/مضخة مستهدف: محطته ضمن نطاق المستخدم، وإن نُقل إلى محطة أخرى فالوجهة ضمن نطاقه أيضاً.
     *
     * @template T of \Illuminate\Database\Eloquent\Model
     * @param  class-string<T>  $class
     * @return T
     */
    private function childForUpdate(string $class, string $id, array $data)
    {
        $record = $class::findOrFail($id);
        $this->accessibleStation($record->fuel_station_id);
        if (isset($data['fuel_station_id'])) {
            $this->accessibleStation($data['fuel_station_id']);
        }

        return $record;
    }

    /** فوهة مستهدفة: محطتها ضمن النطاق، وأي مضخة جديدة في الجسم تقع في محطة ضمن النطاق. */
    private function nozzleForUpdate(string $id, array $data): FuelNozzle
    {
        $nozzle = $this->childForUpdate(FuelNozzle::class, $id, []);
        if (isset($data['fuel_pump_id'])) {
            $this->accessibleStation(FuelPump::findOrFail($data['fuel_pump_id'])->fuel_station_id);
        }

        return $nozzle;
    }

    /** @return list<string> */
    private function stationRelations(): array
    {
        return ['branch', 'warehouse', 'manager', 'defaultInventoryAccount', 'defaultRevenueAccount', 'defaultCogsAccount'];
    }
}

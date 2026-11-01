<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreFuelCardRequest;
use App\Http\Requests\StoreFuelFleetDriverRequest;
use App\Http\Requests\StoreFuelFleetVehicleRequest;
use App\Http\Resources\FuelCardResource;
use App\Http\Resources\FuelFleetDriverResource;
use App\Http\Resources\FuelFleetVehicleResource;
use App\Models\FuelCard;
use App\Models\FuelFleetDriver;
use App\Models\FuelFleetVehicle;
use App\Services\FuelCardService;
use App\Services\FuelFleetService;
use Illuminate\Http\JsonResponse;

class FuelFleetController extends ApiController
{
    public function __construct(private FuelFleetService $fleet, private FuelCardService $cards) {}

    public function vehicles(): JsonResponse
    {
        // المقسَّم يُسلسَل بـ`data` مصفوفةً على مستوى الجذر (كبقية قوائم الوقود)؛ لفّه بـ{data: ...} كان يجعل `data.data` هي القائمة (FS-10).
        return FuelFleetVehicleResource::collection(FuelFleetVehicle::query()->with('allowedFuelProducts')->orderByDesc('created_at')->paginate(50))->response();
    }

    public function storeVehicle(StoreFuelFleetVehicleRequest $request): JsonResponse
    {
        $vehicle = $this->domain(fn () => $this->fleet->createVehicle($request->validated(), $request->user()));

        return (new FuelFleetVehicleResource($vehicle))->response()->setStatusCode(201);
    }

    public function drivers(): JsonResponse
    {
        return FuelFleetDriverResource::collection(FuelFleetDriver::query()->orderByDesc('created_at')->paginate(50))->response();
    }

    public function storeDriver(StoreFuelFleetDriverRequest $request): JsonResponse
    {
        $driver = $this->domain(fn () => $this->fleet->createDriver($request->validated(), $request->user()));

        return (new FuelFleetDriverResource($driver))->response()->setStatusCode(201);
    }

    public function cards(): JsonResponse
    {
        return FuelCardResource::collection(FuelCard::query()->with(['stations', 'fuelProducts'])->orderByDesc('created_at')->paginate(50))->response();
    }

    public function storeCard(StoreFuelCardRequest $request): JsonResponse
    {
        $card = $this->domain(fn () => $this->cards->create($request->validated(), $request->user()));

        return (new FuelCardResource($card))->response()->setStatusCode(201);
    }
}

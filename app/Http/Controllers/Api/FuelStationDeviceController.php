<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreFuelStationDeviceRequest;
use App\Http\Requests\StoreFuelStationSimulatedEventRequest;
use App\Http\Requests\UpdateFuelStationDeviceRequest;
use App\Http\Resources\FuelStationDeviceResource;
use App\Http\Resources\FuelStationIntegrationEventResource;
use App\Models\FuelStationDevice;
use App\Models\FuelStationIntegrationEvent;
use App\Services\FuelStationDeviceAdapterRegistry;
use App\Services\FuelStationDeviceIngressService;
use App\Services\FuelStationDeviceService;
use App\Services\FuelStationIntegrationEventService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FuelStationDeviceController extends ApiController
{
    public function __construct(
        private readonly FuelStationDeviceService $devices,
        private readonly FuelStationDeviceIngressService $ingress,
        private readonly FuelStationIntegrationEventService $events,
        private readonly FuelStationDeviceAdapterRegistry $adapters,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $query = FuelStationDevice::query()->with('station')->orderBy('name');
        foreach (['fuel_station_id', 'device_type', 'status', 'health', 'adapter_key'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }

        return FuelStationDeviceResource::collection($query->paginate(50))->response();
    }

    public function adapterContracts(): JsonResponse
    {
        return response()->json(['data' => $this->adapters->available()]);
    }

    public function store(StoreFuelStationDeviceRequest $request): JsonResponse
    {
        $device = $this->domain(fn () => $this->devices->create($request->validated(), $request->user()));

        return (new FuelStationDeviceResource($device))->response()->setStatusCode(201);
    }

    public function update(UpdateFuelStationDeviceRequest $request, string $id): JsonResponse
    {
        $device = FuelStationDevice::findOrFail($id);
        $updated = $this->domain(fn () => $this->devices->update($device, $request->validated(), $request->user()));

        return (new FuelStationDeviceResource($updated))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $device = FuelStationDevice::findOrFail($id);
        $this->domain(fn () => $this->devices->delete($device));

        return response()->json([], 204);
    }

    public function indexEvents(Request $request): JsonResponse
    {
        $query = FuelStationIntegrationEvent::query()->with(['device', 'attempts'])->orderByDesc('received_at');
        foreach (['fuel_station_id', 'fuel_station_device_id', 'status', 'event_type', 'source_id'] as $filter) {
            if ($request->filled($filter)) {
                $query->where($filter, $request->query($filter));
            }
        }

        return FuelStationIntegrationEventResource::collection($this->scopeToActiveBranch($query, $request)->paginate(50))->response();
    }

    public function simulate(StoreFuelStationSimulatedEventRequest $request, string $id): JsonResponse
    {
        $device = FuelStationDevice::findOrFail($id);
        $event = $this->domain(fn () => $this->ingress->simulate($device, $request->validated(), $request->user()));

        return (new FuelStationIntegrationEventResource($event->load(['device', 'attempts'])))->response()->setStatusCode(201);
    }

    public function retry(Request $request, string $id): JsonResponse
    {
        $event = FuelStationIntegrationEvent::findOrFail($id);
        $retried = $this->domain(fn () => $this->events->retry($event, $request->user()));

        return (new FuelStationIntegrationEventResource($retried->load(['device', 'attempts'])))->response();
    }
}

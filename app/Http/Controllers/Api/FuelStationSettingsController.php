<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateFuelStationSettingsRequest;
use App\Http\Requests\UpdateFuelTenantSettingsRequest;
use App\Models\FuelStation;
use App\Services\FuelStationSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;

class FuelStationSettingsController extends ApiController
{
    public function __construct(private FuelStationSettingsService $settings) {}

    public function showTenant(): JsonResponse
    {
        return response()->json(['data' => $this->settings->forTenant()]);
    }

    public function updateTenant(UpdateFuelTenantSettingsRequest $request): JsonResponse
    {
        $data = $request->validated();
        $settings = $this->domain(fn () => $this->settings->putTenant(
            Arr::except($data, ['reason']),
            $request->user(),
            $data['reason'] ?? null,
        ));

        return response()->json(['data' => $settings]);
    }

    public function showStation(UpdateFuelStationSettingsRequest $request, string $id): JsonResponse
    {
        $station = $this->scopeToActiveBranch(FuelStation::query(), $request)->findOrFail($id);

        return response()->json(['data' => $this->settings->forStation($station)]);
    }

    public function updateStation(UpdateFuelStationSettingsRequest $request, string $id): JsonResponse
    {
        $station = $this->scopeToActiveBranch(FuelStation::query(), $request)->findOrFail($id);
        $data = $request->validated();
        $settings = $this->domain(fn () => $this->settings->putStationValues(
            $station,
            Arr::except($data, ['reason']),
            $request->user(),
            $data['reason'] ?? null,
        ));

        return response()->json(['data' => $settings]);
    }
}

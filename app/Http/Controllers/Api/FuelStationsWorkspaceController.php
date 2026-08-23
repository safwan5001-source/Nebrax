<?php

namespace App\Http\Controllers\Api;

use App\Models\FuelStation;
use App\Services\FuelStationSettingsService;
use Illuminate\Http\JsonResponse;

/**
 * مدخل Workspace للدورة التأسيسية فقط.
 *
 * لا يفتح هذا المتحكم CRUD للمحطات ولا يمثل نقطة بيع أو عداداً أو جهازاً؛ يعرض
 * العقد المحمي الذي ستتفرع منه شاشات Cycle 1+ مع إبقاء كل تفويض في middleware.
 */
class FuelStationsWorkspaceController extends ApiController
{
    public function index(FuelStationSettingsService $settings): JsonResponse
    {
        $stations = FuelStation::query()
            ->orderBy('code')
            ->get(['id', 'branch_id', 'code', 'name', 'status', 'timezone', 'operating_day_starts_at']);

        return response()->json([
            'data' => [
                'application_key' => 'fuel_stations.core',
                'workspace_status' => 'foundation_ready',
                'settings' => $settings->forTenant(),
                'stations' => $stations,
                'deferred_capabilities' => [
                    'fuel_stations.inventory',
                    'fuel_stations.forecourt',
                    'fuel_stations.fleet',
                    'fuel_stations.avi',
                    'fuel_stations.maintenance',
                    'fuel_stations.integrations',
                ],
            ],
        ]);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Models\FuelTank;
use App\Services\FuelTankLevelMonitor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FUEL-B6 — مراقبة مستويات الخزانات (قراءة فقط). النطاق: المستأجر (آلياً) + فرع/مخزن/محطات المستخدم عبر الحارس المشترك.
 * محطة خارج النطاق ⇒ 404 موحّد؛ بلا أثر مخزني أو محاسبي.
 */
class FuelTankLevelController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelTankLevelMonitor $monitor) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate(['station_id' => ['nullable', 'uuid']]);
        if (! empty($data['station_id'])) {
            $this->accessibleStation($data['station_id']);
        }
        $tanks = $this->restrictToAccessibleStations(FuelTank::query())
            ->when($data['station_id'] ?? null, fn ($q, $id) => $q->where('fuel_station_id', $id));

        return response()->json([
            'data' => $this->monitor->snapshot($tanks, $request->user()),
            'meta' => ['generated_at' => now()->toIso8601String()],
        ]);
    }
}

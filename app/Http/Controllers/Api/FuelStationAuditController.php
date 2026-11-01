<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\FuelStationAuditEventResource;
use App\Models\FuelStationAuditEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FS-22: قراءة سجل التدقيق بالفاعل للبيانات الرئيسية والأجهزة. قراءة فقط؛ مقيَّدة بمحطات المستخدم المتاحة (فرع/مخزن)،
 * والأحداث غير المنسوبة لمحطة (منتج وقود) تظهر لغير المقيَّد فقط.
 */
class FuelStationAuditController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'fuel_station_id' => ['nullable', 'uuid'],
            'subject_type' => ['nullable', 'string', 'in:FuelStation,FuelProduct,FuelTank,FuelPump,FuelNozzle,FuelStationDevice'],
            'subject_id' => ['nullable', 'uuid'],
            'actor_id' => ['nullable', 'uuid'],
            'action' => ['nullable', 'string', 'max:80'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        if (! empty($filters['fuel_station_id'])) {
            $this->accessibleStation($filters['fuel_station_id']);
        }

        $query = FuelStationAuditEvent::query()->with('actor:id,name')->orderByDesc('occurred_at')->orderByDesc('id');
        $accessible = $this->accessibleStationIds();
        if ($accessible !== null) {
            $query->whereIn('fuel_station_id', $accessible);
        }
        if (! empty($filters['fuel_station_id'])) {
            $query->where('fuel_station_id', $filters['fuel_station_id']);
        }
        if (! empty($filters['subject_type'])) {
            $query->where('subject_type', 'App\\Models\\'.$filters['subject_type']);
        }
        foreach (['subject_id', 'actor_id', 'action'] as $key) {
            if (! empty($filters[$key])) {
                $query->where($key, $filters[$key]);
            }
        }
        if (! empty($filters['from'])) {
            $query->where('occurred_at', '>=', $filters['from']);
        }
        if (! empty($filters['to'])) {
            $query->where('occurred_at', '<=', $filters['to'].' 23:59:59');
        }

        return FuelStationAuditEventResource::collection($query->paginate((int) ($filters['per_page'] ?? 50)))->response();
    }
}

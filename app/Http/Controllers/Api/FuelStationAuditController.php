<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\FuelStationAuditEventResource;
use App\Models\FuelStationAuditEvent;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FS-22: قراءة سجل التدقيق بالفاعل للبيانات الرئيسية والأجهزة. قراءة فقط؛ مقيَّدة بمحطات المستخدم المتاحة (فرع/مخزن)،
 * والأحداث غير المنسوبة لمحطة (منتج وقود) تظهر لغير المقيَّد فقط.
 */
class FuelStationAuditController extends ApiController
{

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

        $query = FuelStationAuditEvent::query()->with('actor:id,name')->orderByDesc('occurred_at')->orderByDesc('id');
        $this->restrictEventsToUserScope($query, $request);
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
            $query->where('occurred_at', '>=', Carbon::parse($filters['from']));
        }
        if (! empty($filters['to'])) {
            // تاريخ فقط ⇒ نهاية اليوم؛ طابع زمني كامل ⇒ كما هو (لا لصق نص على طابع موجود).
            $to = Carbon::parse($filters['to']);
            $query->where('occurred_at', '<=', preg_match('/^\d{4}-\d{2}-\d{2}$/', trim($filters['to'])) ? $to->endOfDay() : $to);
        }

        return FuelStationAuditEventResource::collection($query->paginate((int) ($filters['per_page'] ?? 50)))->response();
    }

    /**
     * نطاق الفرع/المخزن على مستوى **الحدث** (لقطة وقت الحدث) لا على وجود المحطة اليوم: حذف محطة لا يُخفي تاريخها عن
     * مدير نطاقها. نفس قاعدة `accessibleStationsQuery`: الفرع/المخزن الفارغان يبقيان مرئيين؛ وأحداث بلا محطة (منتج وقود)
     * لغير المقيَّد فقط.
     */
    private function restrictEventsToUserScope(Builder $query, Request $request): void
    {
        $branches = $request->user()?->allowedBranchIds();
        $warehouses = $request->user()?->allowedWarehouseIds();
        if ($branches === null && $warehouses === null) {
            return;
        }

        $query->whereNotNull('fuel_station_id');
        if ($branches !== null) {
            $query->where(fn (Builder $q) => $q->whereIn('branch_id', $branches)->orWhereNull('branch_id'));
        }
        if ($warehouses !== null) {
            $query->where(fn (Builder $q) => $q->whereNull('warehouse_id')->orWhereIn('warehouse_id', $warehouses));
        }
    }
}

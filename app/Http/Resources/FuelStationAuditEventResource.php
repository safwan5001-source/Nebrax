<?php

namespace App\Http\Resources;

use App\Models\FuelOpeningBalance;
use App\Support\FuelCostVisibility;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** FS-22: حدث تدقيق بالفاعل — الفاعل id واسم فقط، و`subject_type` اسم قصير لا مسار الصنف. */
class FuelStationAuditEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        // FUEL-OPEN-AUDIT-SEC (#2114): التدقيق لا يتجاوز صلاحية التكلفة في مستند الرصيد الافتتاحي.
        // تُنقَّح نسخة الاستجابة فقط؛ تظل لقطات before/after المحفوظة غير معدَّلة.
        $hideOpeningCosts = $this->subject_type === FuelOpeningBalance::class
            && ! FuelCostVisibility::canSeeCost($request->user());
        $before = $hideOpeningCosts ? $this->withoutOpeningCosts($this->before) : $this->before;
        $after = $hideOpeningCosts ? $this->withoutOpeningCosts($this->after) : $this->after;

        return [
            'id' => $this->id,
            'action' => $this->action,
            'subject_type' => class_basename((string) $this->subject_type),
            'subject_id' => $this->subject_id,
            'fuel_station_id' => $this->fuel_station_id,
            'actor' => $this->whenLoaded('actor', fn () => $this->actor === null ? null : ['id' => $this->actor->id, 'name' => $this->actor->name]),
            'actor_id' => $this->actor_id,
            'before' => $before,
            'after' => $after,
            'reason' => $this->reason,
            'occurred_at' => $this->occurred_at?->toIso8601String(),
        ];
    }

    /**
     * إزالة قيم التكلفة من أي عمق في اللقطة، بما يشمل سطوراً قد تُضاف لاحقاً.
     * لا نحجب الكمية أو هوية المستند ولا نعيد كتابة السجل التدقيقي.
     *
     * @param array<mixed>|null $snapshot
     * @return array<mixed>|null
     */
    private function withoutOpeningCosts(?array $snapshot): ?array
    {
        if ($snapshot === null) {
            return null;
        }

        foreach ($snapshot as $key => $value) {
            if (is_string($key) && in_array($key, ['total_value_minor', 'unit_cost_per_liter_minor', 'value_minor'], true)) {
                unset($snapshot[$key]);
            } elseif (is_array($value)) {
                $snapshot[$key] = $this->withoutOpeningCosts($value);
            }
        }

        return $snapshot;
    }
}

<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelTankReadingRequest */
class FuelTankReadingRequestResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // `request_kind` يميّز استجابة «طلب بانتظار الموافقة» عن قراءة مسجَّلة في POST fuel-stations/readings (202).
            'request_kind' => 'late_reading',
            'status' => $this->status,
            'fuel_station_id' => $this->fuel_station_id,
            'station' => $this->whenLoaded('station', fn () => ['id' => $this->station?->id, 'code' => $this->station?->code, 'name' => $this->station?->name]),
            'fuel_tank_id' => $this->fuel_tank_id,
            'tank' => $this->whenLoaded('tank', fn () => ['id' => $this->tank?->id, 'code' => $this->tank?->code, 'name' => $this->tank?->name]),
            'reading_type' => $this->reading_type,
            'quantity_milliliters' => $this->quantity_milliliters,
            'quantity_liters' => app(FuelQuantity::class)->millilitersToLiters((int) $this->quantity_milliliters),
            'evidence_key' => $this->evidence_key,
            'evidence' => $this->evidence,
            'reason' => $this->reason,
            'measured_at' => $this->measured_at?->toIso8601String(),
            'requested_at' => $this->created_at?->toIso8601String(),
            'late_by_seconds' => $this->created_at && $this->measured_at ? max($this->created_at->getTimestamp() - $this->measured_at->getTimestamp(), 0) : null,
            'requested_by' => $this->requested_by,
            'requester' => $this->whenLoaded('requester', fn () => ['id' => $this->requester?->id, 'name' => $this->requester?->name]),
            'decided_by' => $this->decided_by,
            'decider' => $this->whenLoaded('decider', fn () => $this->decider ? ['id' => $this->decider->id, 'name' => $this->decider->name] : null),
            'decided_at' => $this->decided_at?->toIso8601String(),
            'decision_note' => $this->decision_note,
            'fuel_tank_reading_id' => $this->fuel_tank_reading_id,
        ];
    }
}

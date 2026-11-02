<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** FS-22: حدث تدقيق بالفاعل — الفاعل id واسم فقط، و`subject_type` اسم قصير لا مسار الصنف. */
class FuelStationAuditEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'action' => $this->action,
            'subject_type' => class_basename((string) $this->subject_type),
            'subject_id' => $this->subject_id,
            'fuel_station_id' => $this->fuel_station_id,
            'actor' => $this->whenLoaded('actor', fn () => $this->actor === null ? null : ['id' => $this->actor->id, 'name' => $this->actor->name]),
            'actor_id' => $this->actor_id,
            'before' => $this->before,
            'after' => $this->after,
            'reason' => $this->reason,
            'occurred_at' => $this->occurred_at?->toIso8601String(),
        ];
    }
}

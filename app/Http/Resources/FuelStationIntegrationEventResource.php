<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelStationIntegrationEventResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'fuel_station_id' => $this->fuel_station_id,
            'fuel_station_device_id' => $this->fuel_station_device_id,
            'source_id' => $this->source_id,
            'event_id' => $this->event_id,
            'sequence' => $this->sequence,
            'event_type' => $this->event_type,
            'occurred_at' => $this->occurred_at?->toIso8601String(),
            'correlation_id' => $this->correlation_id,
            'payload' => $this->payload,
            'status' => $this->status,
            'retry_count' => (int) $this->retry_count,
            'received_at' => $this->received_at?->toIso8601String(),
            'processed_at' => $this->processed_at?->toIso8601String(),
            'failure_reason' => $this->failure_reason,
            'device' => $this->whenLoaded('device', fn () => [
                'id' => $this->device?->id,
                'device_key' => $this->device?->device_key,
                'name' => $this->device?->name,
                'device_type' => $this->device?->device_type,
                'health' => $this->device?->health,
            ]),
            'attempts' => $this->whenLoaded('attempts', fn () => $this->attempts->map(fn ($attempt) => [
                'id' => $attempt->id,
                'action' => $attempt->action,
                'status' => $attempt->status,
                'attempt_number' => $attempt->attempt_number,
                'reason' => $attempt->reason,
                'attempted_at' => $attempt->attempted_at?->toIso8601String(),
            ])->values()),
        ];
    }
}

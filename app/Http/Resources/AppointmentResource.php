<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AppointmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'partner_id'       => $this->partner_id,
            'title'            => $this->title,
            'appointment_at'   => optional($this->appointment_at)->toIso8601String(),
            'duration_minutes' => $this->duration_minutes,
            'status'           => $this->status,
            'location'         => $this->location,
            'notes'            => $this->notes,
        ];
    }
}

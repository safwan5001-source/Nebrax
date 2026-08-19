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
            'invoice_id'       => $this->invoice_id,
            'invoice'          => $this->whenLoaded('invoice', fn () => $this->invoice ? [
                'id'     => $this->invoice->id,
                'number' => $this->invoice->number,
            ] : null),
            'title'            => $this->title,
            'appointment_at'   => optional($this->appointment_at)->toIso8601String(),
            'duration_minutes' => $this->duration_minutes,
            'status'           => $this->status,
            'location'         => $this->location,
            'notes'            => $this->notes,
        ];
    }
}

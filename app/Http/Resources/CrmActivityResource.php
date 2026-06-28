<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CrmActivityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'          => $this->id,
            'partner_id'  => $this->partner_id,
            'type'        => $this->type,
            'subject'     => $this->subject,
            'activity_at' => optional($this->activity_at)->toIso8601String(),
            'status'      => $this->status,
            'notes'       => $this->notes,
        ];
    }
}

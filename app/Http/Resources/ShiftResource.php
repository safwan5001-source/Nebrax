<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ShiftResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'            => $this->id,
            'branch_id'     => $this->branch_id,
            'name'          => $this->name,
            'start_time'    => substr((string) $this->start_time, 0, 5), // HH:MM
            'end_time'      => substr((string) $this->end_time, 0, 5),
            'break_minutes' => (int) $this->break_minutes,
            'work_days'     => array_map('intval', $this->work_days ?? []),
            'net_minutes'   => $this->netMinutes(), // صافي مشتقّ لا مخزَّن
            'is_active'     => (bool) $this->is_active,
        ];
    }
}

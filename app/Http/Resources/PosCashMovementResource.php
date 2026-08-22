<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosCashMovementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'pos_session_id' => $this->pos_session_id,
            'branch_id' => $this->branch_id,
            'type' => $this->type,
            'amount' => Money::toRiyal($this->amount),
            'reason' => $this->reason,
            'recorded_by' => $this->recorded_by,
            'recorded_at' => $this->created_at?->toIso8601String(),
            'recorded_by_user' => $this->whenLoaded('recordedBy', fn () => $this->recordedBy ? [
                'id' => $this->recordedBy->id,
                'name' => $this->recordedBy->name,
            ] : null),
        ];
    }
}

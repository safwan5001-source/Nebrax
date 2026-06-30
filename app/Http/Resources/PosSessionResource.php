<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosSessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'number'           => $this->number,
            'status'           => $this->status,
            'opening_balance'  => Money::toRiyal($this->opening_balance),
            'closing_balance'  => $this->closing_balance !== null ? Money::toRiyal($this->closing_balance) : null,
            'expected_balance' => $this->expected_balance !== null ? Money::toRiyal($this->expected_balance) : null,
            'difference'       => $this->difference !== null ? Money::toRiyal($this->difference) : null,
            'opened_at'        => optional($this->opened_at)->toIso8601String(),
            'closed_at'        => optional($this->closed_at)->toIso8601String(),
            'notes'            => $this->notes,
        ];
    }
}

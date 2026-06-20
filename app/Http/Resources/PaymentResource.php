<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PaymentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'number'       => $this->number,
            'partner_id'   => $this->partner_id,
            'direction'    => $this->direction,
            'method'       => $this->method,
            'status'       => $this->status,
            'payment_date' => optional($this->payment_date)->toDateString(),
            'amount'       => Money::toRiyal($this->amount),
        ];
    }
}

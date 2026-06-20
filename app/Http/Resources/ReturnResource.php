<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ReturnResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'number'       => $this->number,
            'type'         => $this->type,
            'partner_id'   => $this->partner_id,
            'payment_type' => $this->payment_type,
            'status'       => $this->status,
            'return_date'  => optional($this->return_date)->toDateString(),
            'subtotal'     => Money::toRiyal($this->subtotal),
            'tax_amount'   => Money::toRiyal($this->tax_amount),
            'total'        => Money::toRiyal($this->total),
            'lines'        => InvoiceLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}

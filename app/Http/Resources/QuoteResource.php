<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class QuoteResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                   => $this->id,
            'number'               => $this->number,
            'partner_id'           => $this->partner_id,
            'status'               => $this->status,
            'quote_date'           => optional($this->quote_date)->toDateString(),
            'valid_until'          => optional($this->valid_until)->toDateString(),
            'subtotal'             => Money::toRiyal($this->subtotal),
            'tax_amount'           => Money::toRiyal($this->tax_amount),
            'total'                => Money::toRiyal($this->total),
            'notes'                => $this->notes,
            'converted_invoice_id' => $this->converted_invoice_id,
            'lines'                => QuoteLineResource::collection($this->whenLoaded('lines')),
        ];
    }
}

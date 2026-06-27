<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CreditNoteLineResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'            => $this->id,
            'product_id'    => $this->product_id,
            'description'   => $this->description,
            'quantity'      => $this->quantity,
            'unit_price'    => Money::toRiyal($this->unit_price),
            'tax_rate'      => $this->tax_rate,
            'line_subtotal' => Money::toRiyal($this->line_subtotal),
            'line_tax'      => Money::toRiyal($this->line_tax),
            'line_total'    => Money::toRiyal($this->line_total),
        ];
    }
}

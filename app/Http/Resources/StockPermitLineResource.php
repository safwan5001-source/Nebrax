<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StockPermitLineResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'product_id'   => $this->product_id,
            'product_name' => $this->whenLoaded('product', fn () => $this->product?->name),
            'quantity'      => $this->quantity,
            'unit_name'     => $this->unit_name,
            'unit_factor'   => (int) $this->unit_factor,
            'base_quantity' => (int) $this->base_quantity,
            'unit_cost'    => Money::toRiyal($this->unit_cost),
            'line_cost'    => Money::toRiyal($this->line_cost),
        ];
    }
}

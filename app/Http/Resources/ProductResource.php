<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'sku'              => $this->sku,
            'name'             => $this->name,
            'name_en'          => $this->name_en,
            'type'             => $this->type,
            'unit'             => $this->unit,
            'sale_price'       => Money::toRiyal($this->sale_price),
            'purchase_price'   => Money::toRiyal($this->purchase_price),
            'tax_rate'         => $this->tax_rate,
            'track_inventory'  => $this->track_inventory,
            'quantity_on_hand' => $this->quantity_on_hand,
            'avg_cost'         => Money::toRiyal($this->avg_cost),
            'is_active'        => $this->is_active,
        ];
    }
}

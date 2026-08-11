<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class StocktakeLineResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'               => $this->id,
            'product_id'       => $this->product_id,
            'product_name'     => $this->whenLoaded('product', fn () => $this->product?->name),
            'system_quantity'  => $this->system_quantity,
            // null = لم يُعدّ بعد، وهو غير الصفر الذي يعني «عُدَّ فلم يوجد».
            'counted_quantity' => $this->counted_quantity,
            'difference'       => $this->quantityDifference(),
            'unit_cost'        => Money::toRiyal($this->unit_cost),
            'difference_value' => Money::toRiyal($this->difference_value),
        ];
    }
}

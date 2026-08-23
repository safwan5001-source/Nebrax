<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelProduct */
class FuelProductResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'product_id' => $this->product_id,
            'product' => $this->whenLoaded('product', fn () => [
                'id' => $this->product?->id,
                'name' => $this->product?->name,
                'unit' => $this->product?->unit,
                'tax_rate' => $this->product?->tax_rate,
                'track_inventory' => $this->product?->track_inventory,
            ]),
            'code' => $this->code,
            'name' => $this->name,
            'density_kg_per_m3' => $this->density_kg_per_m3,
            'tax_category' => $this->tax_category,
            'is_active' => $this->is_active,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}

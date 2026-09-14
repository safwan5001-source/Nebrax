<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductOptionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'product_id' => $this->product_id,
            'name' => $this->name,
            'name_en' => $this->name_en,
            'sort_order' => $this->sort_order,
            'is_active' => $this->is_active,
            'values' => ProductOptionValueResource::collection($this->whenLoaded('values')),
        ];
    }
}

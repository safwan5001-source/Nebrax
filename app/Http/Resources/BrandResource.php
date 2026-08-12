<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BrandResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'name'           => $this->name,
            'is_active'      => (bool) $this->is_active,
            'products_count' => $this->whenNotNull($this->products_count),
        ];
    }
}

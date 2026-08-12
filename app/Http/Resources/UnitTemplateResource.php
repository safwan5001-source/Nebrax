<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UnitTemplateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'name'           => $this->name,
            'base_unit'      => $this->base_unit,
            'is_active'      => (bool) $this->is_active,
            'units'          => $this->units->map(fn ($u) => [
                'id'     => $u->id,
                'name'   => $u->name,
                'factor' => (int) $u->factor,
            ])->values(),
            'products_count' => $this->whenNotNull($this->products_count),
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class WarehouseResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'code'       => $this->code,
            'name'       => $this->name,
            'branch_id'  => $this->branch_id,
            'city'       => $this->city,
            'address'    => $this->address,
            'notes'      => $this->notes,
            'is_default' => (bool) $this->is_default,
            'is_active'  => (bool) $this->is_active,
        ];
    }
}

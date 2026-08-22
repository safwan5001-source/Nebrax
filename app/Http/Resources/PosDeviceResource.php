<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosDeviceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'           => $this->id,
            'branch_id'    => $this->branch_id,
            'warehouse_id' => $this->warehouse_id,
            'warehouse'    => $this->whenLoaded('warehouse', fn () => [
                'id'   => $this->warehouse?->id,
                'code' => $this->warehouse?->code,
                'name' => $this->warehouse?->name,
            ]),
            'name'         => $this->name,
            'code'         => $this->code,
            'notes'        => $this->notes,
            'is_active'    => (bool) $this->is_active,
        ];
    }
}

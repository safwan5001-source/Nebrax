<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProductBarcodeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'code' => $this->code,
            'unit_name' => $this->unit_name,
            'label' => $this->label,
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}

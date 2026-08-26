<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InventoryOpeningLineResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'position'       => $this->position,
            'product_id'     => $this->product_id,
            'product_name'   => $this->whenLoaded('product', fn () => $this->product?->name),
            'product_sku'    => $this->whenLoaded('product', fn () => $this->product?->sku),
            'warehouse_id'   => $this->warehouse_id,
            'warehouse_name' => $this->whenLoaded('warehouse', fn () => $this->warehouse?->name),
            // فرع المخزن — بُعد السطر المحاسبي، ويُعرض كي يراجعه المستخدم قبل الترحيل.
            'branch_id'      => $this->whenLoaded('warehouse', fn () => $this->warehouse?->branch_id),
            'quantity'       => $this->quantity,
            'unit_cost'      => Money::toRiyal($this->unit_cost),
            'total_cost'     => Money::toRiyal($this->total_cost),
            'notes'          => $this->notes,
        ];
    }
}

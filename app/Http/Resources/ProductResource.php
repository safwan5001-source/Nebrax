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
            'barcode'          => $this->barcode,
            'name'             => $this->name,
            'name_en'          => $this->name_en,
            'description'      => $this->description,
            'category'         => $this->category,
            'brand'            => $this->brand,
            'reorder_level'    => $this->reorder_level,
            'supplier_id'      => $this->supplier_id,
            'sales_account_id' => $this->sales_account_id,
            'cogs_account_id'  => $this->cogs_account_id,
            'min_sale_price'   => $this->min_sale_price !== null ? Money::toRiyal($this->min_sale_price) : null,
            'discount'         => $this->discount,
            'discount_type'    => $this->discount_type,
            'profit_margin'    => $this->profit_margin,
            'tags'             => $this->tags,
            'internal_notes'   => $this->internal_notes,
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

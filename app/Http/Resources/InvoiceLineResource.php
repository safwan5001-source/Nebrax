<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class InvoiceLineResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'            => $this->id,
            'product_id'    => $this->product_id,
            // اللقطة أولاً لحفظ المستند التاريخي؛ المرجع الحالي احتياط للسطور السابقة للترحيل.
            'product_name'  => $this->product_name_snapshot ?? $this->product?->name ?? $this->description,
            'product_code'  => $this->product_sku_snapshot ?? $this->product?->sku,
            'barcode'       => $this->product_barcode_snapshot ?? $this->product?->barcode,
            'description'   => $this->description,
            'quantity'      => $this->quantity,
            'unit_name'     => $this->unit_name,
            'unit_factor'   => (int) $this->unit_factor,
            'unit_price'            => Money::toRiyal($this->unit_price),
            'unit_price_before_tax' => Money::toRiyal($this->getAttribute('unit_price_before_tax') ?? $this->unit_price),
            'tax_rate'              => $this->tax_rate,
            'line_subtotal' => Money::toRiyal($this->line_subtotal),
            'line_discount' => Money::toRiyal($this->line_discount),
            'line_tax'      => Money::toRiyal($this->line_tax),
            'line_total'    => Money::toRiyal($this->line_total),
        ];
    }
}

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
            'min_sale_price' => $this->min_sale_price_snapshot !== null
                ? Money::toRiyal($this->min_sale_price_snapshot)
                : null,
            'minimum_price_override' => $this->min_sale_price_override_reason !== null ? [
                'reason' => $this->min_sale_price_override_reason,
                'approved_by_user_id' => $this->min_sale_price_overridden_by,
            ] : null,
            'tax_rate'              => $this->tax_rate,
            'line_subtotal' => Money::toRiyal($this->line_subtotal),
            'line_discount' => Money::toRiyal($this->line_discount),
            'line_tax'      => Money::toRiyal($this->line_tax),
            'line_total'    => Money::toRiyal($this->line_total),
            'cost_center_allocations' => $this->whenLoaded('costCenterAllocations', fn () => $this->costCenterAllocations
                ->sortBy('position')
                ->map(fn ($allocation) => [
                    'id'             => $allocation->id,
                    'cost_center_id' => $allocation->cost_center_id,
                    'mode'           => $allocation->mode,
                    'position'       => $allocation->position,
                    'basis_points'   => $allocation->basis_points,
                    'amount'         => Money::toRiyal($allocation->amount),
                    'cost_center'    => $allocation->relationLoaded('costCenter') && $allocation->costCenter ? [
                        'id'   => $allocation->costCenter->id,
                        'code' => $allocation->costCenter->code,
                        'name' => $allocation->costCenter->name,
                    ] : null,
                ])->values()),
        ];
    }
}

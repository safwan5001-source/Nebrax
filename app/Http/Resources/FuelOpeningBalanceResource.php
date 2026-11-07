<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use App\Support\FuelCostVisibility;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** تكلفة اللتر وقيم السطور والإجمالي تتبع `products.view_cost` (المفتاح محذوف لا مخفي القيمة) — نمط استلام الوقود. */
class FuelOpeningBalanceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);
        $canSeeCost = FuelCostVisibility::canSeeCost($request->user());

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status,
            'station_id' => $this->fuel_station_id,
            'warehouse_id' => $this->warehouse_id,
            'opening_date' => $this->opening_date?->toDateString(),
            'notes' => $this->notes,
            'allow_zero_cost' => (bool) $this->allow_zero_cost,
            'total_milliliters' => (int) $this->total_milliliters,
            'total_liters' => $quantity->millilitersToLiters((int) $this->total_milliliters),
            'cost_recorded' => $this->relationLoaded('lines') ? $this->lines->isNotEmpty() && $this->lines->every(fn ($l) => $l->unit_cost_per_liter_minor !== null) : null,
            'total_value_minor' => $this->when($canSeeCost, fn () => $this->total_value_minor === null ? null : (int) $this->total_value_minor),
            'journal_entry_id' => $this->journal_entry_id,
            'created_by' => $this->created_by,
            'posted_by' => $this->posted_by,
            'posted_at' => $this->posted_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
            'station' => $this->whenLoaded('station', fn () => $this->station ? ['id' => $this->station->id, 'code' => $this->station->code, 'name' => $this->station->name] : null),
            'lines' => $this->whenLoaded('lines', fn () => $this->lines->map(fn ($l) => [
                'id' => $l->id,
                'position' => (int) $l->position,
                'tank_id' => $l->fuel_tank_id,
                'tank_name' => $l->relationLoaded('tank') ? $l->tank?->name : null,
                'fuel_product_id' => $l->fuel_product_id,
                'quantity_milliliters' => (int) $l->quantity_milliliters,
                'quantity_liters' => $quantity->millilitersToLiters((int) $l->quantity_milliliters),
                'unit_cost_per_liter_minor' => $canSeeCost ? ($l->unit_cost_per_liter_minor === null ? null : (int) $l->unit_cost_per_liter_minor) : null,
                'value_minor' => $canSeeCost ? ($l->value_minor === null ? null : (int) $l->value_minor) : null,
                'stock_movement_id' => $l->stock_movement_id,
                'operational_ledger_id' => $l->fuel_operational_ledger_id,
            ])->values()->all()),
        ];
    }
}

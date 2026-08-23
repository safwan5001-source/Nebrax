<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\FuelReconciliation */
class FuelReconciliationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);
        $liters = static fn (?int $milliliters): ?string => $milliliters === null ? null : $quantity->millilitersToLiters($milliliters);

        return [
            'id' => $this->id,
            'branch_id' => $this->branch_id,
            'fuel_station_id' => $this->fuel_station_id,
            'station' => $this->whenLoaded('station', fn () => ['id' => $this->station?->id, 'code' => $this->station?->code, 'name' => $this->station?->name]),
            'fuel_tank_id' => $this->fuel_tank_id,
            'tank' => $this->whenLoaded('tank', fn () => ['id' => $this->tank?->id, 'code' => $this->tank?->code, 'name' => $this->tank?->name]),
            'fuel_product_id' => $this->fuel_product_id,
            'fuel_product' => $this->whenLoaded('fuelProduct', fn () => ['id' => $this->fuelProduct?->id, 'code' => $this->fuelProduct?->code, 'name' => $this->fuelProduct?->name]),
            'warehouse_id' => $this->warehouse_id,
            'warehouse' => $this->whenLoaded('warehouse', fn () => ['id' => $this->warehouse?->id, 'code' => $this->warehouse?->code, 'name' => $this->warehouse?->name]),
            'status' => $this->status,
            'book' => [
                'opening_milliliters' => $this->opening_book_milliliters,
                'opening_liters' => $liters($this->opening_book_milliliters),
                'deliveries_milliliters' => $this->deliveries_milliliters,
                'deliveries_liters' => $liters($this->deliveries_milliliters),
                'sales_milliliters' => $this->sales_milliliters,
                'sales_liters' => $liters($this->sales_milliliters),
                'transfers_milliliters' => $this->transfers_milliliters,
                'transfers_liters' => $this->signedLiters($this->transfers_milliliters),
                'prior_adjustments_milliliters' => $this->prior_adjustments_milliliters,
                'prior_adjustments_liters' => $this->signedLiters($this->prior_adjustments_milliliters),
                'expected_closing_milliliters' => $this->expected_closing_milliliters,
                'expected_closing_liters' => $liters($this->expected_closing_milliliters),
            ],
            'physical' => [
                'closing_milliliters' => $this->physical_closing_milliliters,
                'closing_liters' => $liters($this->physical_closing_milliliters),
                'reading_id' => $this->physical_reading_id,
            ],
            'atg' => [
                'closing_milliliters' => $this->atg_closing_milliliters,
                'closing_liters' => $liters($this->atg_closing_milliliters),
                'reading_id' => $this->atg_reading_id,
            ],
            'variance' => [
                'milliliters' => $this->variance_milliliters,
                'liters' => $this->signedLiters($this->variance_milliliters),
                'basis_points' => $this->variance_basis_points,
                'tolerance_absolute_milliliters' => $this->tolerance_absolute_milliliters,
                'tolerance_absolute_liters' => $liters($this->tolerance_absolute_milliliters),
                'tolerance_basis_points' => $this->tolerance_basis_points,
                'requires_approval' => $this->requires_approval,
            ],
            'settlement' => [
                'unit_cost_minor' => $this->unit_cost_minor,
                'financial_variance_minor' => $this->financial_variance_minor,
                'stock_movement_id' => $this->stock_movement_id,
                'journal_entry_id' => $this->journal_entry_id,
                'approved_by' => $this->approved_by,
                'approved_at' => $this->approved_at?->toIso8601String(),
                'reason' => $this->reason,
            ],
            'created_by' => $this->created_by,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    private function signedLiters(?int $milliliters): ?string
    {
        if ($milliliters === null) {
            return null;
        }

        $quantity = app(FuelQuantity::class);

        return $milliliters < 0
            ? '-' . $quantity->millilitersToLiters(abs($milliliters))
            : $quantity->millilitersToLiters($milliliters);
    }
}

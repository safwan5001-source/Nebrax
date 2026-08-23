<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelDeliveryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);

        return [
            'id' => $this->id,
            'status' => $this->status,
            'station_id' => $this->fuel_station_id,
            'tank_id' => $this->fuel_tank_id,
            'fuel_product_id' => $this->fuel_product_id,
            'warehouse_id' => $this->warehouse_id,
            'supplier_id' => $this->supplier_id,
            'procurement_order_id' => $this->procurement_order_id,
            'purchase_reference' => $this->purchase_reference,
            'delivery_note_number' => $this->delivery_note_number,
            'dispatched_milliliters' => (int) $this->dispatched_milliliters,
            'dispatched_liters' => $quantity->millilitersToLiters((int) $this->dispatched_milliliters),
            'received_milliliters' => (int) $this->received_milliliters,
            'received_liters' => $quantity->millilitersToLiters((int) $this->received_milliliters),
            'transit_variance_milliliters' => (int) $this->transit_variance_milliliters,
            'received_total_cost_minor' => (int) $this->received_total_cost_minor,
            'grni_account_id' => $this->grni_account_id,
            'stock_movement_id' => $this->stock_movement_id,
            'journal_entry_id' => $this->journal_entry_id,
            'operational_ledger_id' => $this->fuel_operational_ledger_id,
            'received_at' => $this->received_at?->toISOString(),
            'approved_at' => $this->approved_at?->toISOString(),
            'approved_by' => $this->approved_by,
            'evidence' => $this->evidence,
            'notes' => $this->notes,
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}

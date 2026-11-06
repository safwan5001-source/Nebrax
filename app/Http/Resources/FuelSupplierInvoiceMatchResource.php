<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use App\Support\FuelCostVisibility;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelSupplierInvoiceMatchResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);
        $canSeeCost = FuelCostVisibility::canSeeCost($request->user());

        return [
            'id' => $this->id,
            'status' => $this->status,
            'invoice_id' => $this->fuel_supplier_invoice_id,
            'invoice_line_id' => $this->fuel_supplier_invoice_line_id,
            'delivery_id' => $this->fuel_delivery_id,
            'supplier_id' => $this->supplier_id,
            'station_id' => $this->fuel_station_id,
            'tank_id' => $this->fuel_tank_id,
            'fuel_product_id' => $this->fuel_product_id,
            'warehouse_id' => $this->warehouse_id,
            'grni_account_id' => $this->grni_account_id,
            'matched_quantity_milliliters' => (int) $this->matched_quantity_milliliters,
            'matched_quantity_liters' => $quantity->millilitersToLiters((int) $this->matched_quantity_milliliters),
            'matched_receipt_value_minor' => $this->when($canSeeCost, fn () => (int) $this->matched_receipt_value_minor),
            'matched_invoice_value_minor' => $this->when($canSeeCost, fn () => (int) $this->matched_invoice_value_minor),
            'cleared_value_minor' => $this->when($canSeeCost, fn () => (int) $this->cleared_value_minor),
            'value_variance_minor' => $this->when($canSeeCost, fn () => (int) $this->value_variance_minor),
            'quantity_variance_milliliters' => (int) $this->quantity_variance_milliliters,
            'variance_direction' => $this->when($canSeeCost, fn () => $this->variance_direction),
            'currency' => $this->currency,
            'journal_entry_id' => $this->journal_entry_id,
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}

<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FuelSupplierInvoiceResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);

        return [
            'id' => $this->id,
            'supplier_id' => $this->supplier_id,
            'procurement_order_id' => $this->procurement_order_id,
            'purchase_id' => $this->purchase_id,
            'invoice_number' => $this->invoice_number,
            'invoice_date' => $this->invoice_date?->toDateString(),
            'currency' => $this->currency,
            'status' => $this->status,
            'total_quantity_milliliters' => (int) $this->total_quantity_milliliters,
            'total_quantity_liters' => $quantity->millilitersToLiters((int) $this->total_quantity_milliliters),
            'total_value_minor' => (int) $this->total_value_minor,
            'matched_quantity_milliliters' => (int) $this->matched_quantity_milliliters,
            'matched_quantity_liters' => $quantity->millilitersToLiters((int) $this->matched_quantity_milliliters),
            'matched_value_minor' => (int) $this->matched_value_minor,
            'evidence' => $this->evidence,
            'notes' => $this->notes,
            'lines' => $this->whenLoaded('lines', function () use ($quantity) {
                return $this->lines->map(fn ($line) => [
                    'id' => $line->id,
                    'line_number' => $line->line_number,
                    'fuel_product_id' => $line->fuel_product_id,
                    'quantity_milliliters' => (int) $line->quantity_milliliters,
                    'quantity_liters' => $quantity->millilitersToLiters((int) $line->quantity_milliliters),
                    'value_minor' => (int) $line->value_minor,
                    'matched_quantity_milliliters' => (int) $line->matched_quantity_milliliters,
                    'matched_value_minor' => (int) $line->matched_value_minor,
                ])->values();
            }),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}

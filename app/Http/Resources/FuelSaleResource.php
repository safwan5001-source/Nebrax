<?php

namespace App\Http\Resources;

use App\Services\FuelQuantity;
use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** لقطة API رسمية لبيع الوقود والفاتورة والقبض المنفصلين. */
class FuelSaleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $quantity = app(FuelQuantity::class);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status,
            'branch_id' => $this->branch_id,
            'fuel_station_id' => $this->fuel_station_id,
            'warehouse_id' => $this->warehouse_id,
            'fuel_shift_id' => $this->fuel_shift_id,
            'fuel_pump_id' => $this->fuel_pump_id,
            'fuel_nozzle_id' => $this->fuel_nozzle_id,
            'fuel_tank_id' => $this->fuel_tank_id,
            'fuel_product_id' => $this->fuel_product_id,
            'product_id' => $this->product_id,
            'partner_id' => $this->partner_id,
            'quantity_milliliters' => (int) $this->quantity_milliliters,
            'quantity_liters' => $quantity->millilitersToLiters((int) $this->quantity_milliliters),
            'price_per_liter_minor' => $this->price_per_liter_minor === null ? null : (int) $this->price_per_liter_minor,
            'price_per_liter' => $this->price_per_liter_minor === null ? null : Money::toRiyal((int) $this->price_per_liter_minor),
            'fuel_price_tax_mode' => $this->fuel_price_tax_mode,
            'gross_minor' => $this->gross_minor === null ? null : (int) $this->gross_minor,
            'gross' => $this->gross_minor === null ? null : Money::toRiyal((int) $this->gross_minor),
            'pricing' => $this->when($this->pricing_numerator !== null, fn () => [
                'numerator' => $this->pricing_numerator,
                'denominator' => $this->pricing_denominator,
                'rounding_remainder_numerator' => $this->rounding_remainder_numerator,
                'rounding_remainder_denominator' => $this->rounding_remainder_denominator,
                'rounding_policy' => $this->rounding_policy,
            ]),
            'invoice_id' => $this->invoice_id,
            'invoice_number' => $this->whenLoaded('invoice', fn () => $this->invoice?->number),
            'invoice_tax_inclusive' => $this->whenLoaded('invoice', fn () => $this->invoice?->tax_inclusive),
            'invoice_total_minor' => $this->whenLoaded('invoice', fn () => $this->invoice === null ? null : (int) $this->invoice->total),
            'invoice_remaining_minor' => $this->whenLoaded('invoice', fn () => $this->invoice === null ? null : max(0, (int) $this->invoice->total - (int) $this->invoice->paid_amount)),
            'stock_movement_id' => $this->stock_movement_id,
            'cogs_journal_entry_id' => $this->cogs_journal_entry_id,
            'cogs_minor' => $this->cogs_minor === null ? null : (int) $this->cogs_minor,
            'cogs' => $this->cogs_minor === null ? null : Money::toRiyal((int) $this->cogs_minor),
            'payment_status' => $this->payment_status,
            'paid_minor' => (int) $this->paid_minor,
            'paid' => Money::toRiyal((int) $this->paid_minor),
            'meter_start_milliliters' => $this->meter_start_milliliters,
            'meter_end_milliliters' => $this->meter_end_milliliters,
            'meter_source_reference' => $this->meter_source_reference,
            'source_references' => $this->source_references,
            'finalized_at' => $this->finalized_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'payment_receipts' => $this->whenLoaded('paymentReceipts', fn () => $this->paymentReceipts->map(fn ($receipt) => [
                'id' => $receipt->id,
                'payment_id' => $receipt->payment_id,
                'number' => $receipt->payment?->number,
                'amount_minor' => $receipt->payment?->amount,
                'amount' => $receipt->payment ? Money::toRiyal((int) $receipt->payment->amount) : null,
                'status' => $receipt->payment?->status,
                'recorded_at' => $receipt->recorded_at?->toIso8601String(),
            ])->values()),
        ];
    }
}

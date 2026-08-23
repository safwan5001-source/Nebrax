<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class CorporateFuelContractResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'number' => $this->number,
            'partner_id' => $this->partner_id,
            'status' => $this->status,
            'effective_from' => $this->effective_from?->toIso8601String(),
            'effective_until' => $this->effective_until?->toIso8601String(),
            'credit_limit_minor' => (int) $this->credit_limit_minor,
            'payment_terms_days' => (int) $this->payment_terms_days,
            'station_restriction_mode' => $this->station_restriction_mode,
            'fuel_restriction_mode' => $this->fuel_restriction_mode,
            'billing_mode' => $this->billing_mode,
            'odometer_policy' => $this->odometer_policy,
            'driver_required' => $this->driver_required,
            'vehicle_required' => $this->vehicle_required,
            'fuel_card_required' => $this->fuel_card_required,
            'stations' => $this->whenLoaded('stations', fn () => $this->stations->pluck('fuel_station_id')->values()),
            'fuel_product_ids' => $this->whenLoaded('fuelProducts', fn () => $this->fuelProducts->pluck('fuel_product_id')->values()),
            'prices' => $this->whenLoaded('prices', fn () => $this->prices->map(fn ($price) => [
                'id' => $price->id,
                'fuel_product_id' => $price->fuel_product_id,
                'price_per_liter_minor' => (int) $price->price_per_liter_minor,
                'tax_mode' => $price->tax_mode,
                'effective_from' => $price->effective_from?->toIso8601String(),
                'effective_until' => $price->effective_until?->toIso8601String(),
                'status' => $price->status,
            ])->values()),
            'activated_at' => $this->activated_at?->toIso8601String(),
            'suspended_at' => $this->suspended_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}

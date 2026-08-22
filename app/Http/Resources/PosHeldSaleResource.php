<?php

namespace App\Http\Resources;

use App\Support\Money;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PosHeldSaleResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $payload = $this->payload ?? [];

        return [
            'id' => $this->id,
            'pos_session_id' => $this->pos_session_id,
            'resumed_pos_session_id' => $this->resumed_pos_session_id,
            'warehouse_id' => $this->warehouse_id,
            'customer_id' => $this->customer_id,
            'status' => $this->status,
            'tax_inclusive' => (bool) ($payload['tax_inclusive'] ?? false),
            'items' => collect($payload['items'] ?? [])->map(static fn (array $item): array => [
                'product_id' => $item['product_id'] ?? null,
                'description' => $item['description'] ?? null,
                'sku' => $item['sku'] ?? null,
                'quantity' => (int) ($item['quantity'] ?? 0),
                'unit' => $item['unit'] ?? null,
                'unit_price' => Money::toRiyal((int) ($item['unit_price'] ?? 0)),
                'tax_rate' => (int) ($item['tax_rate'] ?? 0),
                'discount' => Money::toRiyal((int) ($item['discount'] ?? 0)),
            ])->values(),
            'customer' => $this->whenLoaded('customer', fn () => $this->customer ? [
                'id' => $this->customer->id,
                'name' => $this->customer->name,
            ] : null),
            'created_at' => optional($this->created_at)->toISOString(),
            'resumed_at' => optional($this->resumed_at)->toISOString(),
            'discarded_at' => optional($this->discarded_at)->toISOString(),
        ];
    }
}

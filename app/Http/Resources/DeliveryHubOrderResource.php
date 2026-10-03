<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** إسقاط تشغيلي. بلا فاتورة أو سند أو ضريبة أو مخزون. */
class DeliveryHubOrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'state' => $this->state,
            'branch_id' => $this->branch_id,
            'delivery_platform_profile_id' => $this->delivery_platform_profile_id,
            'provider_order_id' => $this->provider_order_id,
            'external_order_reference' => $this->external_order_reference,
            'idempotency_key' => $this->idempotency_key,
            'provider_status' => $this->provider_status,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}

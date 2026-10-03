<?php

namespace App\Http\Resources;

use App\Support\DeliveryPlatformCatalog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** إسقاط تشغيلي. بلا فاتورة أو سند أو ضريبة أو مخزون. */
class DeliveryHubOrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $platformKey = $this->profile?->platform_key;
        $platform = is_string($platformKey) ? DeliveryPlatformCatalog::get($platformKey) : null;

        return [
            'id' => $this->id,
            'state' => $this->state,
            'branch_id' => $this->branch_id,
            'branch_name' => $this->branch?->name,
            'delivery_platform_profile_id' => $this->delivery_platform_profile_id,
            'platform_key' => $platformKey,
            'platform_name' => $platform['name'] ?? null,
            'platform_name_en' => $platform['name_en'] ?? null,
            'provider_order_id' => $this->provider_order_id,
            'external_order_reference' => $this->external_order_reference,
            'idempotency_key' => $this->idempotency_key,
            'provider_status' => $this->provider_status,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}

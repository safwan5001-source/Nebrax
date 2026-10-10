<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** إعداد ربط تشغيلي. لا يعيد السر ولا حالة اتصال مزوّد. */
class DeliveryConnectorAccountResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'delivery_platform_profile_id' => $this->delivery_platform_profile_id,
            'platform_key' => $this->platform_key,
            'external_store_id' => $this->external_store_id,
            'branch_id' => $this->branch_id,
            'status' => $this->status,
            'secret_prefix' => $this->secret_prefix,
            'secret_version' => $this->secret_version,
            'disabled_at' => $this->disabled_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}

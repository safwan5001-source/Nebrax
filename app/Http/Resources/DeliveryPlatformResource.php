<?php

namespace App\Http\Resources;

use App\Support\DeliveryPlatformCatalog;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** ملف منصة توصيل مع نسخته الحالية. لا حسابات دفترية ولا أسرار. */
class DeliveryPlatformResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $catalog = DeliveryPlatformCatalog::get($this->platform_key);
        $current = $this->relationLoaded('currentVersion') ? $this->currentVersion : null;

        return [
            'id' => $this->id,
            'platform_key' => $this->platform_key,
            'platform_name' => $catalog['name'] ?? null,
            'platform_name_en' => $catalog['name_en'] ?? null,
            'is_active' => $this->is_active,
            'sales_channel' => $this->whenLoaded('salesChannel', fn () => [
                'id' => $this->salesChannel->id,
                'slug' => $this->salesChannel->slug,
                'name' => $this->salesChannel->name,
                'type' => $this->salesChannel->type,
            ]),
            'current_version' => $current === null ? null : new DeliveryPlatformVersionResource($current),
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}

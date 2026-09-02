<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * تمثيل عميل Public API لسطح إدارة المطوّرين الداخلي (PR-7.5) — بيانات وصفية آمنة
 * فقط. مفاتيحه (`keys`) بيانات آمنة عبر `DeveloperApiKeyResource` (بلا تجزئة/سرّ).
 */
class DeveloperApiClientResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            'name'       => $this->name,
            'is_active'  => (bool) $this->is_active,
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'keys'       => DeveloperApiKeyResource::collection($this->whenLoaded('tokens')),
        ];
    }
}

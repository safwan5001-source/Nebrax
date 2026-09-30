<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** بيانات جلسة معاينة وصفية فقط — **لا يحمل هذا المورد التوكن الخام أبداً**. */
class PreviewSessionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'builder_app_id' => $this->builder_app_id,
            'source' => $this->source,
            'channel' => $this->channel,
            'device_label' => $this->device_label,
            'draft_revision' => $this->draft_revision,
            'created_by' => $this->created_by,
            'expires_at' => $this->expires_at?->toIso8601String(),
            'revoked_at' => $this->revoked_at?->toIso8601String(),
            'last_used_at' => $this->last_used_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}

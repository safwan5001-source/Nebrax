<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** مرجع كاميرا — بيانات وصفية فقط، لا فيديو. */
class PosCctvBookmarkResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'case_id' => $this->case_id,
            'pos_session_id' => $this->pos_session_id,
            'cart_id' => $this->cart_id,
            'correlation_id' => $this->correlation_id,
            'camera_label' => $this->camera_label,
            'timestamp_start' => $this->timestamp_start?->toIso8601String(),
            'timestamp_end' => $this->timestamp_end?->toIso8601String(),
            'source_timezone' => $this->source_timezone,
            'external_reference' => $this->external_reference,
            'note' => $this->note,
            'created_by' => $this->created_by,
            'created_by_name' => $this->whenLoaded('createdByUser', fn () => $this->createdByUser?->name),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}

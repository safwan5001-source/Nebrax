<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** نسخة تكوين منصة توصيل. تجاوزات الفروع المعروضة محصورة بفروع المستخدم المسموحة. */
class DeliveryPlatformVersionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $allowed = $request->user()?->allowedBranchIds();

        return [
            'id' => $this->id,
            'version_number' => $this->version_number,
            'collection_mode' => $this->collection_mode,
            'external_reference_policy' => $this->external_reference_policy,
            'display_name' => $this->display_name,
            'display_name_en' => $this->display_name_en,
            'logo_asset_key' => $this->logo_asset_key,
            'is_active' => $this->is_active,
            'change_reason' => $this->change_reason,
            'created_by' => $this->created_by,
            'effective_from' => $this->effective_from?->toIso8601String(),
            'branch_overrides' => $this->overrides
                ->filter(fn ($row) => $allowed === null || in_array($row->branch_id, $allowed, true))
                ->map(fn ($row) => [
                    'branch_id' => $row->branch_id,
                    'collection_mode' => $row->collection_mode,
                    'external_reference_policy' => $row->external_reference_policy,
                ])
                ->sortBy('branch_id')
                ->values(),
        ];
    }
}

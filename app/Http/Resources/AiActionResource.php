<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AiActionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $latest = $this->whenLoaded('versions', fn () => $this->versions->sortByDesc('version')->first());

        return [
            'id' => $this->id,
            'type' => $this->type,
            'schema_version' => (int) $this->schema_version,
            'status' => $this->status,
            'version' => (int) $this->version,
            'branch_id' => $this->branch_id,
            'created_by' => $this->created_by,
            'cancelled_by' => $this->cancelled_by,
            'cancelled_at' => optional($this->cancelled_at)->toIso8601String(),
            'expires_at' => optional($this->expires_at)->toIso8601String(),
            'latest_version' => $latest instanceof \App\Models\AiActionVersion ? [
                'id' => $latest->id,
                'version' => (int) $latest->version,
                'proposal' => $latest->proposal,
                'proposal_hash' => $latest->proposal_hash,
                'validation_summary' => $latest->validation_summary,
                'created_by' => $latest->created_by,
                'created_at' => optional($latest->created_at)->toIso8601String(),
            ] : null,
            'created_at' => optional($this->created_at)->toIso8601String(),
            'updated_at' => optional($this->updated_at)->toIso8601String(),
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AiActionExtractionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'file_id' => $this->ai_action_file_id,
            'action_id' => $this->ai_action_id,
            'action_version' => (int) $this->action_version,
            'schema_version' => (int) $this->schema_version,
            'manifest' => $this->manifest,
            'manifest_hash' => $this->manifest_hash,
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}

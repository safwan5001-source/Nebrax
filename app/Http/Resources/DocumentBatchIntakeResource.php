<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentBatchIntakeResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            'source_type' => $this->source_type,
            'status' => $this->status->value,
            'schema_version' => (int) $this->schema_version,
            'version' => (int) $this->version,
            'files' => DocumentFileResource::collection($this->whenLoaded('files')),
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}

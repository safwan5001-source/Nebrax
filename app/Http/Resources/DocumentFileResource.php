<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentFileResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'batch_id' => $this->document_batch_id,
            'original_name' => $this->original_name,
            'mime_type' => $this->detected_mime,
            'size_bytes' => (int) $this->size_bytes,
            'page_count' => $this->page_count === null ? null : (int) $this->page_count,
            'scan_status' => $this->scan_status->value,
            'retention_until' => optional($this->retention_until)->toIso8601String(),
            'created_at' => optional($this->created_at)->toIso8601String(),
        ];
    }
}

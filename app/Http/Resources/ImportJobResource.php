<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ImportJobResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'domain' => $this->domain,
            'status' => $this->status,
            'original_filename' => $this->original_filename,
            'extension' => $this->extension,
            'byte_size' => (int) $this->byte_size,
            'content_sha256' => $this->content_sha256,
            'row_count' => $this->row_count === null ? null : (int) $this->row_count,
            'column_count' => $this->column_count === null ? null : (int) $this->column_count,
            'processed_rows' => (int) $this->processed_rows,
            'apply_result' => $this->apply_result,
            'error_message' => $this->error_message,
            'created_by' => $this->created_by,
            'cancelled_by' => $this->cancelled_by,
            'cancelled_at' => optional($this->cancelled_at)->toIso8601String(),
            'purge_after' => optional($this->purge_after)->toIso8601String(),
            'created_at' => optional($this->created_at)->toIso8601String(),
            'updated_at' => optional($this->updated_at)->toIso8601String(),
        ];
    }
}

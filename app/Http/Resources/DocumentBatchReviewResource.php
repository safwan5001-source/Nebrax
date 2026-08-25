<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentBatchReviewResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            'source_type' => $this->source_type,
            'status' => $this->status->value,
            'version' => $this->version,
            'files_count' => (int) ($this->files_count ?? 0),
            'blocking_issues_count' => (int) ($this->blocking_issues_count ?? 0),
            'warning_issues_count' => (int) ($this->warning_issues_count ?? 0),
            'reviewer' => $this->reviewer
                ? ['id' => $this->reviewer->id, 'name' => $this->reviewer->name]
                : null,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}

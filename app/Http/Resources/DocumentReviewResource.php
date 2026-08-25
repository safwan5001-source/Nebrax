<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentReviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $batch = $this['batch'];

        return [
            'batch' => [
                'id' => $batch->id,
                'document_type' => $batch->document_type,
                'source_type' => $batch->source_type,
                'status' => $batch->status->value,
                'version' => $batch->version,
                'reviewer' => $batch->reviewer
                    ? ['id' => $batch->reviewer->id, 'name' => $batch->reviewer->name]
                    : null,
            ],
            'fields' => $this['fields'],
            'files' => $this['files'],
            'matches' => $this['matches'],
            'issues' => $this['issues'],
            'history' => $this['history'],
            'linked_transaction' => $this['linked_transaction'],
            'linked_purchase' => $this['linked_purchase'],
            'capabilities' => $this['capabilities'],
        ];
    }
}

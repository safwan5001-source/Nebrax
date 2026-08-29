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
                'source' => $batch->relationLoaded('sourceReceipt') && $batch->sourceReceipt !== null ? [
                    'channel' => $batch->sourceReceipt->channel,
                    'identity_name' => $batch->sourceReceipt->identity?->display_name,
                    'identity_reference' => $batch->sourceReceipt->identity?->external_identity_masked,
                    'external_reference' => $batch->sourceReceipt->external_reference_masked,
                    'received_at' => $batch->sourceReceipt->received_at?->toIso8601String(),
                ] : null,
                'status' => $batch->status->value,
                'version' => $batch->version,
                'reviewer' => $batch->reviewer
                    ? ['id' => $batch->reviewer->id, 'name' => $batch->reviewer->name]
                    : null,
            ],
            'fields' => $this['fields'],
            'lines' => $this['lines'] ?? [],
            'warnings' => $this['warnings'] ?? [],
            'files' => $this['files'],
            'matches' => $this['matches'],
            'issues' => $this['issues'],
            'history' => $this['history'],
            'processing_summary' => $this['processing_summary'] ?? null,
            'linked_transaction' => $this['linked_transaction'],
            'linked_purchase' => $this['linked_purchase'],
            'capabilities' => $this['capabilities'],
            'review_mode' => $this['review_mode'] ?? 'full',
        ];
    }
}

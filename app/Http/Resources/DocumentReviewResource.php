<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DocumentReviewResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'batch' => [
                'id' => $this['batch']->id,
                'document_type' => $this['batch']->document_type,
                'source_type' => $this['batch']->source_type,
                'status' => $this['batch']->status->value,
                'version' => $this['batch']->version,
                'review_assigned_to' => $this['batch']->review_assigned_to,
            ],
            'reviewed' => $this['reviewed'],
            'matches' => $this['matches'],
            'issues' => $this['issues'],
            'history' => $this['history'],
        ];
    }
}

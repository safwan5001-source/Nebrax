<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PrintTemplateResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                    => $this->id,
            'name'                  => $this->name,
            'source'                => $this->source,
            'status'                => $this->status,
            'document_types'        => $this->document_types,
            'published_revision_id' => $this->published_revision_id,
            'published_revision'    => new PrintTemplateRevisionResource($this->whenLoaded('publishedRevision')),
            'draft_revision'        => new PrintTemplateRevisionResource($this->whenLoaded('draftRevision')),
            'revisions'              => PrintTemplateRevisionResource::collection($this->whenLoaded('revisions')),
            'created_at'            => $this->created_at?->toISOString(),
            'updated_at'            => $this->updated_at?->toISOString(),
        ];
    }
}

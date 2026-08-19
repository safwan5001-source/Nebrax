<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PrintTemplateAssignmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'                         => $this->id,
            'branch_id'                  => $this->branch_id,
            'scope'                      => $this->branch_id === null ? 'company' : 'branch',
            'document_type'              => $this->document_type,
            'usage'                      => $this->usage,
            'print_template_revision_id' => $this->print_template_revision_id,
            'revision'                   => new PrintTemplateRevisionResource($this->whenLoaded('revision')),
            'created_at'                 => $this->created_at?->toISOString(),
            'updated_at'                 => $this->updated_at?->toISOString(),
        ];
    }
}

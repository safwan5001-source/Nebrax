<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PrintTemplateRevisionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'             => $this->id,
            'version'        => $this->version,
            'status'         => $this->status,
            'schema_version' => $this->schema_version,
            'document_types' => $this->document_types,
            'definition'     => $this->definition,
            'checksum'       => $this->checksum,
            'published_at'   => $this->published_at?->toISOString(),
            'created_at'     => $this->created_at?->toISOString(),
        ];
    }
}

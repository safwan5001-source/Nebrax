<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BuilderPublishedExperienceVersionResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'builder_app_id' => $this->builder_app_id,
            'version' => $this->version,
            'schema_version' => $this->schema_version,
            'note' => $this->note,
            'schema' => $this->schema,
            'published_by' => $this->published_by,
            'published_by_name' => $this->publisher?->name,
            'published_at' => $this->published_at?->toIso8601String(),
        ];
    }
}

<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BuilderDraftExperienceResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'builder_app_id' => $this->builder_app_id,
            'schema' => $this->schema,
            'revision' => $this->revision,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}

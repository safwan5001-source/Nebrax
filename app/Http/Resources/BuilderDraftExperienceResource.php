<?php

namespace App\Http\Resources;

use App\Services\AppBuilder\EditorMeta;
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
            'schema' => $this->schemaForJson(),
            'editor_meta' => EditorMeta::forJson($this->editor_meta),
            'revision' => $this->revision,
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    /**
     * `JsonResource` يعيد فهرسة المصفوفات ذات المفاتيح الرقمية كلها؛ `pages` خريطة بمعرّفات الصفحات (قد تكون رقمية «7»)،
     * فتُعاد كائن JSON حتى لا تُفسَد المعرّفات. غير ذلك من المخطط كما هو.
     *
     * @return array<string, mixed>
     */
    private function schemaForJson(): array
    {
        $schema = (array) $this->schema;
        if (isset($schema['pages']) && is_array($schema['pages'])) {
            $schema['pages'] = (object) $schema['pages'];
        }

        return $schema;
    }
}

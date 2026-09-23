<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class BuilderAppResource extends JsonResource
{
    public static $wrap = null;

    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'name_en' => $this->name_en,
            'creation_source' => $this->creation_source,
            // يقرأ من المجموعة المحمَّلة مسبقاً مباشرة (لا `latestPublishedVersion()`،
            // التي تفتح استعلاماً جديداً في كل صفّ فتُبطل فائدة `->with()` أعلاه —
            // العلاقة معرَّفة بترتيب `orderByDesc('version')` فالعنصر الأول مضموناً الأحدث.
            'latest_published_version' => $this->when(
                $this->relationLoaded('publishedVersions'),
                fn () => $this->publishedVersions->first()?->version,
            ),
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}

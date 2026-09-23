<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderDraftExperience;

/**
 * سلطة حفظ `BuilderDraftExperience` الوحيدة — APP-BUILDER-1/2. يتحقق بنيوياً
 * قبل الحفظ (`AppSchemaParser`، Authoring validation فقط — لا
 * `CompatibilityResolver` هنا، ذاك حصراً عند النشر) ويزيد `revision` تفاؤلياً.
 */
final class BuilderDraftExperienceService
{
    public function __construct(
        private readonly AppSchemaParser $parser,
    ) {}

    /**
     * @param  array<string, mixed>  $schema
     */
    public function save(BuilderDraftExperience $draft, array $schema, ?string $userId): BuilderDraftExperience
    {
        $this->parser->validate($schema);

        $draft->update([
            'schema' => $schema,
            'revision' => $draft->revision + 1,
            'updated_by' => $userId,
        ]);

        return $draft->fresh();
    }
}

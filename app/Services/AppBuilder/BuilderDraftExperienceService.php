<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderDraftExperience;

/**
 * سلطة حفظ `BuilderDraftExperience` الوحيدة — APP-BUILDER-1. يتحقق بنيوياً
 * قبل الحفظ (`AppSchemaStructuralValidator`) ويزيد `revision` تفاؤلياً.
 */
final class BuilderDraftExperienceService
{
    public function __construct(
        private readonly AppSchemaStructuralValidator $validator,
    ) {}

    /**
     * @param  array<string, mixed>  $schema
     */
    public function save(BuilderDraftExperience $draft, array $schema, ?string $userId): BuilderDraftExperience
    {
        $this->validator->validate($schema);

        $draft->update([
            'schema' => $schema,
            'revision' => $draft->revision + 1,
            'updated_by' => $userId,
        ]);

        return $draft->fresh();
    }
}

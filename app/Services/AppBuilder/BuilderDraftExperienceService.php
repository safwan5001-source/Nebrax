<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderDraftExperience;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * سلطة حفظ `BuilderDraftExperience` الوحيدة — APP-BUILDER-1/2. يتحقق بنيوياً
 * قبل الحفظ (`AppSchemaParser`، Authoring validation فقط — لا
 * `CompatibilityResolver` هنا، ذاك حصراً عند النشر).
 *
 * **القفل التفاؤلي (AD-01 — S01a):** الحفظ داخل معاملة بقفل صفّ المسودة
 * (`FOR UPDATE` على PostgreSQL). إن أرسل العميل `base_revision` فيجب أن يطابق
 * `revision` الحالي داخل القفل وإلا `DraftRevisionConflictException` (409) بلا أي
 * كتابة. **`base_revision` اختياري انتقالياً** لحماية العملاء البرمجيين الحاليين:
 * غيابه يعمل كما كان (آخر كتابة تفوز) لكنه يُسجَّل بمقياس
 * `app_builder.draft_save_without_base_revision` لحصر المسارات قبل أي فرض (S01-INV).
 * وبما أن الزيادة صارت تُحسب من الصفّ المقفول لا من نموذج قديم في الذاكرة، فلا
 * يضيع تزايد `revision` حتى بين كتّاب بلا `base_revision`.
 */
final class BuilderDraftExperienceService
{
    public function __construct(
        private readonly AppSchemaParser $parser,
    ) {}

    /**
     * @param  array<string, mixed>  $schema
     * @param  int|null  $baseRevision  `revision` كما قرأه العميل؛ `null` = مسار قديم بلا قفل تفاؤلي.
     *
     * @throws DraftRevisionConflictException
     */
    public function save(BuilderDraftExperience $draft, array $schema, ?string $userId, ?int $baseRevision = null): BuilderDraftExperience
    {
        $this->parser->validate($schema);

        $saved = DB::transaction(function () use ($draft, $schema, $userId, $baseRevision): BuilderDraftExperience {
            // إعادة قراءة الصفّ داخل القفل (يطبّق نطاق المستأجر نفسه): `$draft` قد يكون قديماً.
            $locked = BuilderDraftExperience::query()
                ->whereKey($draft->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            if ($baseRevision !== null && (int) $locked->revision !== $baseRevision) {
                throw new DraftRevisionConflictException(
                    currentRevision: (int) $locked->revision,
                    baseRevision: $baseRevision,
                    updatedBy: $locked->updated_by,
                    updatedAt: $locked->updated_at?->toIso8601String(),
                );
            }

            $locked->update([
                'schema' => $schema,
                'revision' => $locked->revision + 1,
                'updated_by' => $userId,
            ]);

            return $locked->fresh();
        });

        if ($baseRevision === null) {
            // مقياس حصر المسارات القديمة (شرط AD-01 قبل فرض 428): بلا محتوى المخطط.
            Log::info('app_builder.draft_save_without_base_revision', [
                'tenant_id' => $saved->tenant_id,
                'builder_app_id' => $saved->builder_app_id,
                'user_id' => $userId,
                'revision' => (int) $saved->revision,
            ]);
        }

        return $saved;
    }
}

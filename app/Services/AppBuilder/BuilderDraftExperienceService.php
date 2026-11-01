<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use Illuminate\Support\Facades\DB;

/**
 * سلطة حفظ `BuilderDraftExperience` الوحيدة — APP-BUILDER-1/2. يتحقق بنيوياً
 * قبل الحفظ (`AppSchemaParser`، Authoring validation فقط — لا
 * `CompatibilityResolver` هنا، ذاك حصراً عند النشر).
 *
 * **القفل التفاؤلي (AD-01 — S01a/S01c):** الحفظ داخل معاملة بقفل صفّ المسودة
 * (`FOR UPDATE` على PostgreSQL). `base_revision` **إلزامي** (الخدمة تطلبه نوعاً):
 * يجب أن يطابق `revision` الحالي داخل القفل وإلا `DraftRevisionConflictException`
 * (409) بلا أي كتابة. غيابه يُرفض قبل الوصول إلى هنا بـ428 في المتحكّم
 * (`base_revision_required`) — لا مسار «آخر كتابة تفوز» بعد S01c. الزيادة تُحسب من
 * الصفّ المقفول لا من نموذج قديم في الذاكرة.
 *
 * **AD-12 (S02):** بعد التحقق البنيوي تُطبَّق الحدود الصارمة (`AppSchemaContractChecker::assertHardLimits`) ثم يُحفظ؛
 * مخالفات العقد الأخرى تُحسب للعرض فقط (`issues[]` في المتحكّم) ولا تمنع الحفظ.
 */
final class BuilderDraftExperienceService
{
    public function __construct(
        private readonly AppSchemaParser $parser,
        private readonly AppSchemaContractChecker $contractChecker,
        private readonly EditorMeta $editorMeta,
    ) {}

    /**
     * @param  array<string, mixed>  $schema
     * @param  int  $baseRevision  `revision` كما قرأه العميل (إلزامي).
     * @param  bool  $replaceEditorMeta  true = استبدال `editor_meta` كاملاً بـ`$editorMeta` (null يمسح)؛ false = يبقى ما هو (يُنظَّف مقابل المخطط الجديد).
     * @param  array<string, mixed>|null  $editorMeta
     *
     * @throws DraftRevisionConflictException
     */
    public function save(BuilderDraftExperience $draft, array $schema, ?string $userId, int $baseRevision, bool $replaceEditorMeta = false, ?array $editorMeta = null): BuilderDraftExperience
    {
        $this->parser->validate($schema);
        // AD-12 (S02): حدود صارمة آمنة عند الحفظ — فرادة المعرّف داخل الصفحة وسقف البايتات. بقية مخالفات العقد
        // تحذيرات تُعاد في `issues[]` ولا تمنع الحفظ (فرض مرحلي لحماية المسودات القائمة).
        $this->contractChecker->assertHardLimits($schema);
        // AD-05: التحقق من بيانات المحرر المرسَلة قبل القفل (422 بلا كتابة)؛ المخزَّن يُنظَّف داخل القفل مقابل المخطط الجديد.
        $newMeta = $replaceEditorMeta ? $this->editorMeta->normalize($editorMeta, $schema) : null;

        return DB::transaction(function () use ($draft, $schema, $userId, $baseRevision, $replaceEditorMeta, $newMeta): BuilderDraftExperience {
            // إعادة قراءة الصفّ داخل القفل (يطبّق نطاق المستأجر نفسه): `$draft` قد يكون قديماً.
            $locked = BuilderDraftExperience::query()
                ->whereKey($draft->getKey())
                ->lockForUpdate()
                ->firstOrFail();

            // S05d: تطبيق مؤرشف لا يُحرَّر (القراءة مسموحة). قراءة بلا قفل؛ لا يقفل أي مسار آخر المسودة ثم التطبيق.
            if (BuilderApp::query()->whereKey($locked->builder_app_id)->whereNotNull('archived_at')->exists()) {
                throw new \RuntimeException('التطبيق مؤرشف؛ أعد تفعيله قبل التعديل.');
            }

            if ((int) $locked->revision !== $baseRevision) {
                throw new DraftRevisionConflictException(
                    currentRevision: (int) $locked->revision,
                    baseRevision: $baseRevision,
                    updatedBy: $locked->updated_by,
                    updatedAt: $locked->updated_at?->toIso8601String(),
                );
            }

            $locked->update([
                'schema' => $schema,
                'editor_meta' => $replaceEditorMeta ? $newMeta : $this->editorMeta->normalize($locked->editor_meta, $schema),
                'revision' => $locked->revision + 1,
                'updated_by' => $userId,
            ]);

            return $locked->fresh();
        });
    }
}

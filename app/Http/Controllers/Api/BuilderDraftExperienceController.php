<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateBuilderDraftExperienceRequest;
use App\Http\Resources\BuilderDraftExperienceResource;
use App\Models\BuilderApp;
use App\Services\AppBuilder\AppSchemaContractChecker;
use App\Services\AppBuilder\BuilderDraftExperienceService;
use App\Services\AppBuilder\DraftRevisionConflictException;
use Illuminate\Http\JsonResponse;

/** APP-BUILDER-1 — قراءة/تحديث مسودة تجربة تطبيق واحد. */
class BuilderDraftExperienceController extends ApiController
{
    public function __construct(
        private readonly BuilderDraftExperienceService $service,
        private readonly AppSchemaContractChecker $contractChecker,
    ) {}

    public function show(string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        $draft = $app->draft()->firstOrFail();

        return response()->json([
            'data' => new BuilderDraftExperienceResource($draft),
            'issues' => $this->issuesOf($draft->schema),
        ]);
    }

    public function update(UpdateBuilderDraftExperienceRequest $request, string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        $draft = $app->draft()->firstOrFail();

        $baseRevision = $request->validated('base_revision');

        if ($baseRevision === null) {
            // AD-01 / S01c: لا كتابة بلا أساس. `current_revision` من مسودة المستأجر نفسه (محمّلة بنطاقه) يكفي العميل ليعيد القراءة.
            return response()->json([
                'message' => 'يلزم إرسال base_revision (رقم نسخة المسودة كما قرأتها) مع كل حفظ.',
                'reason' => 'base_revision_required',
                'current_revision' => (int) $draft->revision,
            ], 428);
        }

        try {
            $updated = $this->domain(fn () => $this->service->save(
                $draft,
                $request->validated('schema'),
                $request->user()?->id,
                (int) $baseRevision,
            ));
        } catch (DraftRevisionConflictException $e) {
            // AD-01: تعارض حفظ — 409 بجسم منظَّم يكفي العميل لعرض حوار الحل وإعادة الأساس.
            // `updated_by` معرّف مستخدم من المستأجر نفسه (المسودة معزولة بالنطاق) ولا محتوى مخطط.
            return response()->json([
                'message' => 'تغيّرت المسودة منذ آخر قراءة لك. أعد التحميل أو راجع التعارض قبل الحفظ.',
                'reason' => 'draft_conflict',
                'current_revision' => $e->currentRevision,
                'base_revision' => $e->baseRevision,
                'updated_by' => $e->updatedBy,
                'updated_at' => $e->updatedAt,
            ], 409);
        }

        return response()->json([
            'data' => new BuilderDraftExperienceResource($updated),
            'issues' => $this->issuesOf($updated->schema),
        ]);
    }

    /**
     * AD-12 (S02): مخالفات العقد للعرض (`error` = تمنع النشر، `warning` = لا تمنعه). لا تمنع الحفظ أبداً.
     *
     * @param  array<string, mixed>  $schema
     * @return list<array<string, mixed>>
     */
    private function issuesOf(array $schema): array
    {
        return array_map(fn ($issue) => $issue->toArray(), $this->contractChecker->check($schema));
    }
}

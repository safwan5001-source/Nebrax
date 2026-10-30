<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateBuilderDraftExperienceRequest;
use App\Http\Resources\BuilderDraftExperienceResource;
use App\Models\BuilderApp;
use App\Services\AppBuilder\BuilderDraftExperienceService;
use App\Services\AppBuilder\DraftRevisionConflictException;
use Illuminate\Http\JsonResponse;

/** APP-BUILDER-1 — قراءة/تحديث مسودة تجربة تطبيق واحد. */
class BuilderDraftExperienceController extends ApiController
{
    public function __construct(private readonly BuilderDraftExperienceService $service) {}

    public function show(string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        $draft = $app->draft()->firstOrFail();

        return response()->json(['data' => new BuilderDraftExperienceResource($draft)]);
    }

    public function update(UpdateBuilderDraftExperienceRequest $request, string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        $draft = $app->draft()->firstOrFail();

        $baseRevision = $request->validated('base_revision');

        try {
            $updated = $this->domain(fn () => $this->service->save(
                $draft,
                $request->validated('schema'),
                $request->user()?->id,
                $baseRevision === null ? null : (int) $baseRevision,
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

        return response()->json(['data' => new BuilderDraftExperienceResource($updated)]);
    }
}

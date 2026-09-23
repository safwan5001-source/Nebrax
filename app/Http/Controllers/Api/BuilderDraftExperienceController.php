<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateBuilderDraftExperienceRequest;
use App\Http\Resources\BuilderDraftExperienceResource;
use App\Models\BuilderApp;
use App\Services\AppBuilder\BuilderDraftExperienceService;
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

        $updated = $this->domain(fn () => $this->service->save(
            $draft,
            $request->validated('schema'),
            $request->user()?->id,
        ));

        return response()->json(['data' => new BuilderDraftExperienceResource($updated)]);
    }
}

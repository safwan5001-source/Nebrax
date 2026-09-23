<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreBuilderAppRequest;
use App\Http\Requests\UpdateBuilderAppRequest;
use App\Http\Resources\BuilderAppResource;
use App\Models\BuilderApp;
use App\Services\AppBuilder\BuilderAppService;
use Illuminate\Http\JsonResponse;

/**
 * APP-BUILDER-1 — إدارة هوية تطبيقات AWJ App Builder (App Manager الخلفي).
 * لا محتوى تجربة هنا (انظر `BuilderDraftExperienceController`/
 * `BuilderPublishedExperienceVersionController`).
 */
class BuilderAppController extends ApiController
{
    public function __construct(private readonly BuilderAppService $service) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => BuilderAppResource::collection(
                BuilderApp::query()->with('publishedVersions')->latest()->get()
            ),
        ]);
    }

    public function store(StoreBuilderAppRequest $request): JsonResponse
    {
        $data = $request->validated();

        $app = $this->domain(fn () => $this->service->create(
            $data['name'],
            $data['name_en'] ?? null,
            $data['creation_source'],
            $request->user()?->id,
        ));

        return response()->json(['data' => new BuilderAppResource($app)], 201);
    }

    public function show(string $id): JsonResponse
    {
        $app = BuilderApp::query()->with('publishedVersions')->findOrFail($id);

        return response()->json(['data' => new BuilderAppResource($app)]);
    }

    public function update(UpdateBuilderAppRequest $request, string $id): JsonResponse
    {
        $app = BuilderApp::findOrFail($id);
        $data = $request->validated();

        $updated = $this->service->rename($app, $data['name'], $data['name_en'] ?? null);

        return response()->json(['data' => new BuilderAppResource($updated)]);
    }
}

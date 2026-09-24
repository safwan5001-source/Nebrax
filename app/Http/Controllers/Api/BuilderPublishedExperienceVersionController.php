<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreBuilderPublishedExperienceVersionRequest;
use App\Http\Resources\BuilderPublishedExperienceVersionResource;
use App\Models\BuilderApp;
use App\Services\AppBuilder\BuilderPublishedExperienceVersionService;
use Illuminate\Http\JsonResponse;

/**
 * APP-BUILDER-1 (AB-03) — نشر/استعراض نسخ التجربة المنشورة. `store()` هي
 * فعل النشر (يترجم إلى صلاحية `apps_builder.publish` المستقلة عن
 * `apps_builder.manage` في `routes/api.php` — نشرٌ لا يمكن التراجع عنه
 * يستحق حدّاً أضيق من تحرير المسودة اليومي).
 */
class BuilderPublishedExperienceVersionController extends ApiController
{
    public function __construct(private readonly BuilderPublishedExperienceVersionService $service) {}

    public function index(string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);

        return response()->json([
            'data' => BuilderPublishedExperienceVersionResource::collection($app->publishedVersions()->with('publisher')->get()),
        ]);
    }

    public function store(StoreBuilderPublishedExperienceVersionRequest $request, string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);

        $version = $this->domain(fn () => $this->service->publish(
            $app,
            $request->validated('note'),
            $request->user()?->id,
        ));

        return response()->json(['data' => new BuilderPublishedExperienceVersionResource($version)], 201);
    }

    public function show(string $appId, string $version): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        // بث صريح لعدد صحيح: مقارنة نصّ الرابط مباشرة بعمود `unsignedInteger`
        // على PostgreSQL قد ترفض الالتقاط الضمني، بخلاف SQLite المتساهل —
        // التحويل هنا يطابق السلوك على المحركين معاً.
        $row = $app->publishedVersions()->with('publisher')->where('version', (int) $version)->firstOrFail();

        return response()->json(['data' => new BuilderPublishedExperienceVersionResource($row)]);
    }

    /** فحصٌ صريح لا فعل — انظر توثيق `BuilderPublishedExperienceVersionService::validate()`. */
    public function validateDraft(string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);

        $this->domain(fn () => $this->service->validate($app));

        return response()->json(['data' => ['valid' => true]]);
    }
}

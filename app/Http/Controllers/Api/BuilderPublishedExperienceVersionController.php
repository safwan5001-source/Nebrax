<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreBuilderPublishedExperienceVersionRequest;
use App\Http\Resources\BuilderPublishedExperienceVersionResource;
use App\Models\BuilderApp;
use App\Services\AppBuilder\BuilderPublishedExperienceVersionService;
use App\Services\AppBuilder\DraftChangedSinceReviewException;
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

        $expected = $request->validated('expected_draft_revision');

        try {
            $version = $this->domain(fn () => $this->service->publish(
                $app,
                $request->validated('note'),
                $request->user()?->id,
                $expected === null ? null : (int) $expected,
            ));
        } catch (DraftChangedSinceReviewException $e) {
            // AD-01 / S01d: المسودة تغيّرت بعد مراجعة الناشر — لا نسخة تُنشأ.
            return response()->json([
                'message' => 'تغيّرت المسودة منذ آخر مراجعة لك. أعد التحميل وراجع التغييرات قبل النشر.',
                'reason' => 'draft_changed_since_review',
                'current_revision' => $e->currentRevision,
                'expected_revision' => $e->expectedRevision,
            ], 409);
        }

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

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreBuilderPublishedExperienceVersionRequest;
use App\Http\Resources\BuilderPublishedExperienceVersionResource;
use App\Models\BuilderApp;
use App\Services\AppBuilder\BuilderLivePointerService;
use App\Services\AppBuilder\BuilderPublishedExperienceVersionService;
use App\Services\AppBuilder\CompatibilityReport;
use App\Services\AppBuilder\DraftChangedSinceReviewException;
use App\Services\AppBuilder\LivePointerConflictException;
use App\Services\AppBuilder\SchemaContractViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * APP-BUILDER-1 (AB-03) — نشر/استعراض نسخ التجربة المنشورة. `store()` هي
 * فعل النشر (يترجم إلى صلاحية `apps_builder.publish` المستقلة عن
 * `apps_builder.manage` في `routes/api.php` — نشرٌ لا يمكن التراجع عنه
 * يستحق حدّاً أضيق من تحرير المسودة اليومي).
 */
class BuilderPublishedExperienceVersionController extends ApiController
{
    public function __construct(
        private readonly BuilderPublishedExperienceVersionService $service,
        private readonly CompatibilityReport $compatibility,
        private readonly BuilderLivePointerService $livePointer,
    ) {}

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

        // AD-06 / S05c: «نشر وتفعيل» — خلف بوابة المؤشر الحي (مغلقة ⇒ 422 صريح لا تجاهل صامت).
        $promote = (bool) $request->validated('promote');
        if ($promote && ! BuilderLivePointerService::enabled()) {
            abort(422, 'تفعيل النسخة عند النشر غير متاح حالياً.');
        }

        try {
            $version = $this->domain(fn () => DB::transaction(function () use ($app, $request, $expected, $promote) {
                $published = $this->service->publish(
                    $app,
                    $request->validated('note'),
                    $request->user()?->id,
                    $expected === null ? null : (int) $expected,
                );
                // ذرّي: فشل التفعيل يتراجع معه النشر كله (لا نسخة يتيمة تظن أنها حيّة).
                if ($promote) {
                    $this->livePointer->promote($published, $request->user()?->id);
                }

                return $published;
            }));
        } catch (LivePointerConflictException $e) {
            return response()->json(['message' => $e->getMessage(), 'reason' => $e->reason], 409);
        } catch (SchemaContractViolationException $e) {
            return $this->contractViolationResponse($e);
        } catch (DraftChangedSinceReviewException $e) {
            // AD-01 / S01d: المسودة تغيّرت بعد مراجعة الناشر — لا نسخة تُنشأ.
            return response()->json([
                'message' => 'تغيّرت المسودة منذ آخر مراجعة لك. أعد التحميل وراجع التغييرات قبل النشر.',
                'reason' => 'draft_changed_since_review',
                'current_revision' => $e->currentRevision,
                'expected_revision' => $e->expectedRevision,
            ], 409);
        }

        // S03b: ما سيُحذف من النسخة المنشورة على كل جيل Runtime معلَنٌ لا صامت (استشاري؛ يطابق ما رآه المحرّر في validate).
        return response()->json([
            'data' => new BuilderPublishedExperienceVersionResource($version),
            'compat' => $this->compatibility->forSchema((array) $version->schema),
        ], 201);
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

        try {
            $this->domain(fn () => $this->service->validate($app));
        } catch (SchemaContractViolationException $e) {
            return $this->contractViolationResponse($e);
        }

        $draft = $app->draft()->first();

        return response()->json([
            'data' => ['valid' => true],
            'compat' => $draft === null ? null : $this->compatibility->forSchema($draft->publishableSchema()),
        ]);
    }

    /** AD-12 (S02): 422 بجسم منظَّم قابل للإصلاح — المخالفات الحاجبة بمعرّفات الصفحة/العقدة. */
    private function contractViolationResponse(SchemaContractViolationException $e): JsonResponse
    {
        return response()->json([
            'message' => $e->getMessage(),
            'reason' => 'contract_violations',
            'issues' => array_map(fn ($issue) => $issue->toArray(), $e->issues),
        ], 422);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PreviewSessionResource;
use App\Models\BuilderApp;
use App\Models\PreviewSession;
use App\Services\AppBuilder\PreviewSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * إصدار/سرد/إبطال جلسات معاينة App Builder — لوحة التاجر (MOBILE-PREVIEW-6).
 *
 * ═══════════════════════════════════════════════════════════════
 *  قرار RBAC (إلزامي قبل أي كود — انظر مهمة MP-6 §"Mandatory first decision")
 * ═══════════════════════════════════════════════════════════════
 * الصلاحية: `apps_builder.view` + `EnsureApplicationActive:commerce.app_builder`
 * — **نفس بوابة** `BuilderDraftExperienceController::show()` حرفياً كما هي في
 * `routes/api.php` اليوم (لا `EnsureCommercialApplicationAccess` رغم أن وثيقة
 * معمارية MP-5 §5.1 تصفها بذلك الاسم — تحقّق مباشر من `routes/api.php` وقت
 * التنفيذ أظهر أن `app-builder/apps/{id}/draft` يستعمل `EnsureApplicationActive`
 * فعلياً، فطابق هذا القرار الكود القائم لا نصّ الوثيقة)، لا صلاحية جديدة.
 *
 * لماذا لا صلاحية جديدة: «قد ينشئ جلسة معاينة» يعادل دلالياً «قد يرى محتوى
 * المسودة» — إصدار الجلسة لا يكتب حرفاً واحداً في `BuilderDraftExperience`
 * ولا `BuilderPublishedExperienceVersion` (ينسخ لقطة قراءة فقط)، فهو فعلٌ
 * قرائي بامتياز، لا فعل تحرير يستحق `apps_builder.manage`. إبطال/سرد الجلسات
 * نفس المنطق: كلاهما إدارة لأثر جانبي لفعل القراءة (تعقّب من رأى ماذا)، لا
 * تعديل على محتوى التطبيق نفسه.
 *
 * لماذا ليست `apps_builder.manage`: تلك تخصّ **تحرير** محتوى المسودة
 * (`PUT .../draft`) — منحها لمجرّد المعاينة كان سيوسّع صلاحية القراءة لتشمل
 * تعديل تجربة لا علاقة له بها.
 *
 * التوافق الرجعي محفوظ: لا تعديل على `Rbac::MATRIX`/`Rbac::PERMISSIONS` —
 * owner/admin يملكانها عبر `*` كما كانا؛ لا تُضاف لـaccountant/staff تلقائياً
 * (لا يملكان `apps_builder.view` أصلاً اليوم)؛ دورٌ مخصَّص يملك `apps_builder.view`
 * صراحةً يكتسب هذه القدرة معه تلقائياً — وهذا صحيح دلالياً، لا توسيعاً ضمنياً.
 */
class PreviewSessionController extends ApiController
{
    public function __construct(private readonly PreviewSessionService $service) {}

    public function index(string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        $sessions = PreviewSession::where('builder_app_id', $app->id)
            ->orderByDesc('created_at')
            ->get();

        return PreviewSessionResource::collection($sessions)->response();
    }

    /** يصدر جلسة معاينة عن **المسودة الحالية** فقط (نطاق MP-6). النصّ الخام يُعاد مرّة واحدة. */
    public function store(Request $request, string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);

        $channel = $request->string('channel')->toString() ?: PreviewSession::CHANNEL_DEVICE;
        $deviceLabel = $request->string('device_label')->toString() ?: null;

        $result = $this->domain(fn () => $this->service->issueForDraft(
            $app,
            $request->user(),
            $channel,
            $deviceLabel,
        ));

        return response()->json([
            // النصّ الصريح لمرّة واحدة — لا يُخزَّن ولا يُسجَّل ولا يُعاد لاحقاً.
            'token' => $result['token']->plainTextToken,
            'session' => (new PreviewSessionResource($result['session']))->resolve($request),
        ], 201);
    }

    /** يُبطل جلسة تخصّ هذا التطبيق حصراً (تحقّق ملكية قبل الإبطال). */
    public function destroy(Request $request, string $appId, string $sessionId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        $session = PreviewSession::where('builder_app_id', $app->id)->findOrFail($sessionId);

        $this->service->revoke($session, $request->user());

        return response()->json(['message' => 'تم إبطال جلسة المعاينة.']);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Models\BuilderApp;
use App\Services\AppBuilder\PreviewExchangeService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * إصدار مرجع تبادل QR/الرابط العميق لمرّة واحدة — لوحة التاجر
 * (MOBILE-PREVIEW-7). نفس بوابة RBAC وإصدار جلسة المعاينة المباشرة حرفياً
 * (`PreviewSessionController` — `apps_builder.view` +
 * `EnsureApplicationActive:commerce.app_builder`، **لا صلاحية جديدة**):
 * نطاق القدرة الصادرة هنا **أضيق** من جلسة المعاينة نفسها، لا أوسع —
 * فالمرجع وحده لا يحمل أي قدرة قراءة إطلاقاً حتى يُستهلَك (`PreviewExchangeService`
 * الدوكبلوك). لا Decision Gate هنا للسبب نفسه المسجَّل هناك.
 *
 * **لا يُعاد أبداً توكن جلسة معاينة عامل من هذه النقطة** — العقد الأمني
 * المعتمد (MP-5 §5.10، ومهمة MP-7 §"Approved security contract") يمنع صراحةً
 * إعادة بصمة عمل قابلة للاستخدام من نقطة إصدار المرجع؛ يُعاد المرجع الخام
 * فقط (لمرّة واحدة)، ورابط عميق جاهز للعرض كـQR.
 */
class PreviewExchangeReferenceController extends ApiController
{
    public function __construct(private readonly PreviewExchangeService $service) {}

    public function store(Request $request, string $appId): JsonResponse
    {
        $app = BuilderApp::findOrFail($appId);
        $deviceLabel = $request->string('device_label')->toString() ?: null;

        $result = $this->domain(fn () => $this->service->issueForDraft($app, $request->user(), $deviceLabel));

        $reference = $result['reference'];
        $deepLinkHost = (string) config('preview.deep_link_host');

        return response()->json([
            // النصّ الخام لمرّة واحدة فقط — لا يُخزَّن ولا يُسجَّل ولا يُعاد لاحقاً.
            'reference' => $result['plain'],
            'deep_link' => "https://{$deepLinkHost}/preview/{$result['plain']}",
            'expires_at' => $result['expires_at']->toIso8601String(),
            'exchange_reference_id' => $reference->id,
        ], 201);
    }
}

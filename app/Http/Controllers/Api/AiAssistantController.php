<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\AiAssistantMessageRequest;
use App\Http\Requests\AiAssistantSettingsRequest;
use App\Http\Requests\AiAssistantToolRunRequest;
use App\Services\AiAssistantConsentService;
use App\Services\AiAssistantGateway;
use App\Services\AiAssistantStatusService;
use App\Support\AiAssistantDenied;
use App\Support\Rbac;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * AWJ Intelligence — AI-01. نقطة دخول واحدة ضيّقة؛ كل القرار في `AiAssistantGateway`.
 * عقد الاستجابة: نجاح `{data:{…}}` — فشل `{error:{code,message}, request_id}`.
 */
class AiAssistantController extends ApiController
{
    public function store(AiAssistantMessageRequest $request, AiAssistantGateway $gateway): JsonResponse
    {
        try {
            $data = $gateway->handle($request->user(), $request->validated(), $request->header('Idempotency-Key'));
        } catch (AiAssistantDenied $denied) {
            return response()->json([
                'error' => ['code' => $denied->reason, 'message' => $denied->getMessage()],
                'request_id' => $denied->requestId,
            ], $denied->status, ['X-AI-Request-Id' => (string) $denied->requestId]);
        }

        return response()->json(['data' => $data], 200, ['X-AI-Request-Id' => $data['request_id']]);
    }

    /**
     * حالة المساعد للمستخدم الحالي (AI-03): ما يُعرض وما يُخفى. قراءة فقط، لا مالية ولا محادثة.
     * تُفتح لمن يملك أيّاً من صلاحيات المساعد الثلاث (استعمال / إدارة الموافقة / قراءة التدقيق)؛ لغيرهم 403.
     */
    public function status(Request $request, AiAssistantStatusService $status): JsonResponse
    {
        $user = $request->user();
        abort_unless(
            Rbac::allows((string) $user->role, 'ai.assistant.use')
                || Rbac::allows((string) $user->role, 'ai.consent.manage')
                || Rbac::allows((string) $user->role, 'ai.audit.view'),
            403,
            'ليس لديك صلاحية لهذا الإجراء.',
        );

        return response()->json(['data' => $status->for($user)]);
    }

    /** تحديث موافقة المؤسسة (AI-03). الصلاحية `ai.consent.manage` على المسار؛ والمنطق ذرّي ومدقَّق في الخدمة. */
    public function updateSettings(AiAssistantSettingsRequest $request, AiAssistantConsentService $consent): JsonResponse
    {
        try {
            $data = $consent->update(
                $request->user(),
                $request->boolean('enabled'),
                (array) $request->input('consented_categories', []),
                $request->boolean('acknowledge_privacy'),
                $request->has('acknowledge_external_provider') ? $request->boolean('acknowledge_external_provider') : null,
                $request->has('acknowledge_external_documents') ? $request->boolean('acknowledge_external_documents') : null,
            );
        } catch (AiAssistantDenied $denied) {
            return response()->json([
                'error' => ['code' => $denied->reason, 'message' => $denied->getMessage()],
                'request_id' => $denied->requestId,
            ], $denied->status);
        }

        return response()->json(['data' => $data]);
    }

    /** تشغيل صريح لأداة مالية للقراءة فقط (AI-03) عبر المسار الأمني نفسه لاستدعاءات المساعد. */
    public function runTool(AiAssistantToolRunRequest $request, AiAssistantGateway $gateway): JsonResponse
    {
        try {
            $data = $gateway->runTool(
                $request->user(),
                (string) $request->input('tool'),
                (array) $request->input('arguments', []),
                ['scope' => (array) $request->input('scope', [])],
            );
        } catch (AiAssistantDenied $denied) {
            return response()->json([
                'error' => ['code' => $denied->reason, 'message' => $denied->getMessage()],
                'request_id' => $denied->requestId,
            ], $denied->status, ['X-AI-Request-Id' => (string) $denied->requestId]);
        }

        return response()->json(['data' => $data], 200, ['X-AI-Request-Id' => $data['request_id']]);
    }
}

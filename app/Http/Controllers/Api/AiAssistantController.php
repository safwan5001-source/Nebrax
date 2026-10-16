<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\AiAssistantMessageRequest;
use App\Services\AiAssistantGateway;
use App\Support\AiAssistantDenied;
use Illuminate\Http\JsonResponse;

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
}

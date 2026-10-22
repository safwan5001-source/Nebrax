<?php

namespace App\Http\Controllers\Api;

use App\Models\PaymentAttempt;
use App\Services\PaymentOrchestrator;
use App\Support\PaymentOrchestrationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * مطابقة يدوية لمحاولة دفع عالقة (PAY-H1-04، ADR-0004 §5): المسار اليدوي المكافئ للمطابِق المجدول — يستعلم المزوّد ويطبّق رتيباً، بلا ترحيل.
 * `payments.manage` ومعزول بالمستأجر (محاولة مستأجر آخر ⇒ 404).
 */
class PaymentAttemptController extends ApiController
{
    public function sync(Request $request, string $id, PaymentOrchestrator $orchestrator): JsonResponse
    {
        $attempt = PaymentAttempt::query()->findOrFail($id);

        try {
            $result = $orchestrator->sync($attempt, $request->user());
        } catch (PaymentOrchestrationException $e) {
            $status = match ($e->reason) {
                'forbidden' => 403,
                'provider_unavailable' => 503,
                'not_started', 'gateway_unavailable' => 409,
                default => 422,
            };

            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], $status);
        }

        return response()->json(['data' => [
            'id' => $result->attempt->id,
            'capture_status' => $result->attempt->capture_status,
            'captured_minor' => (int) $result->attempt->captured_minor,
            'review_reasons' => $result->attempt->review_reasons,
            'applied' => $result->applied,
            'ignored_reason' => $result->ignoredReason,
        ]]);
    }
}

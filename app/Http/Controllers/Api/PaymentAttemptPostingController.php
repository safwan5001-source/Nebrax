<?php

namespace App\Http\Controllers\Api;

use App\Models\InvoicePaymentRequest;
use App\Models\PaymentAttempt;
use App\Services\PaymentAttemptPostingService;
use App\Support\PaymentOrchestrationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * الدفعات الإلكترونية المحجوبة بفترة/سنة مقفلة وإعادة ترحيلها (PAY-H2-02d، ADR-0006 M5-R1). الصلاحية `payments.resolve_blocked` (owner/admin)
 * لكل مسار. لا إعادة ترحيل تلقائية: القرار صريح بفاعل وسبب. معزول بالمستأجر (معرّف مستأجر آخر ⇒ 404).
 */
class PaymentAttemptPostingController extends ApiController
{
    public function __construct(private PaymentAttemptPostingService $posting) {}

    public function blocked(): JsonResponse
    {
        $rows = PaymentAttempt::query()
            ->where('posting_status', PaymentAttempt::POSTING_BLOCKED_PERIOD)
            ->where('payable_key', 'like', InvoicePaymentRequest::PAYABLE_TYPE.':%')
            ->orderBy('captured_at')->limit(200)->get();

        return response()->json([
            'data' => $rows->map(fn (PaymentAttempt $a) => [
                'id' => $a->id,
                'payable_key' => $a->payable_key,
                'amount_minor' => (int) $a->captured_minor,
                'currency' => $a->currency,
                'captured_at' => $a->captured_at?->toISOString(),
                'accounting_date' => $a->accounting_date?->toDateString(),
                'blocked_reason' => $a->posting_blocked_reason,
            ])->values(),
            'meta' => ['count' => $rows->count()],
        ]);
    }

    public function repost(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $attempt = PaymentAttempt::query()->findOrFail($id);

        try {
            $outcome = $this->posting->repost($attempt, $request->user(), $data['reason']);
        } catch (PaymentOrchestrationException $e) {
            $status = match ($e->reason) {
                'forbidden' => 403,
                'not_blocked', 'not_postable' => 409,
                default => 422,
            };

            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], $status);
        }

        return response()->json(['data' => ['id' => $attempt->id, 'outcome' => $outcome, 'posting_status' => $attempt->fresh()->posting_status]]);
    }
}

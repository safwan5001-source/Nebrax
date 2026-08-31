<?php

namespace App\Http\Controllers\Api;

use App\Support\ZatcaSubmissionConflict;
use App\Models\Invoice;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\ZatcaSubmissionService;
use App\Services\Accounting\ZatcaSubmissionQueue;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PDOException;
use RuntimeException;

class ZatcaSubmissionController extends ApiController
{
    public function __construct(
        protected ZatcaSubmissionService $submissions,
        protected ZatcaSubmissionQueue $queue,
    ) {}

    public function index(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);
        $attempts = ZatcaSubmissionAttempt::where('invoice_id', $invoice->id)
            ->orderByDesc('attempt_number')
            ->get()
            ->map(fn (ZatcaSubmissionAttempt $attempt) => $this->payload($attempt));

        return response()->json(['data' => $attempts]);
    }

    /** يسجل طلباً دائماً ويصفّه فقط عند تفعيل النقل صراحةً في إعداد الخادم. */
    public function store(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);
        $validated = validator([
            'idempotency_key' => $request->header('Idempotency-Key'),
        ], [
            'idempotency_key' => ['required', 'string', 'max:128'],
        ])->validate();

        try {
            $result = $this->submissions->requestManual(
                $invoice,
                $validated['idempotency_key'],
                $request->user()?->id,
            );
        } catch (ZatcaSubmissionConflict $exception) {
            abort(409, $exception->getMessage());
        } catch (PDOException $exception) {
            throw $exception;
        } catch (RuntimeException $exception) {
            abort(422, $exception->getMessage());
        }

        $queueDispatched = false;
        $queueError = null;
        if ($result['created'] && config('zatca.transport.dispatch_enabled') === true) {
            try {
                $result['attempt'] = $this->queue->enqueue($result['attempt']);
                $queueDispatched = true;
            } catch (RuntimeException) {
                // تبقى المحاولة pending قابلة لإعادة الصف بعد إصلاح الجاهزية.
                $queueError = 'queue_not_ready';
            }
        }

        return response()->json([
            'data' => $this->payload($result['attempt']),
            'meta' => [
                'created' => $result['created'],
                'dispatch_status' => $result['attempt']->status,
                'network_submission_performed' => false,
                'queue_dispatch_performed' => $queueDispatched,
                'queue_dispatch_error' => $queueError,
            ],
        ], $result['created'] ? 202 : 200);
    }

    public function dispatch(Request $request, string $id, string $attemptId): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);
        $attempt = ZatcaSubmissionAttempt::query()
            ->where('invoice_id', $invoice->id)
            ->findOrFail($attemptId);

        try {
            $queued = $this->queue->enqueue($attempt);
        } catch (ZatcaSubmissionConflict $exception) {
            abort(409, $exception->getMessage());
        } catch (RuntimeException $exception) {
            abort(422, $exception->getMessage());
        }

        return response()->json([
            'data' => $this->payload($queued),
            'meta' => ['queue_dispatch_performed' => true],
        ], 202);
    }

    private function visibleInvoice(Request $request, string $id): Invoice
    {
        return $this->scopeToActiveBranch(Invoice::query(), $request)->findOrFail($id);
    }

    /** @return array<string, mixed> */
    private function payload(ZatcaSubmissionAttempt $attempt): array
    {
        return [
            'id' => $attempt->id,
            'invoice_id' => $attempt->invoice_id,
            'attempt_number' => $attempt->attempt_number,
            'submission_type' => $attempt->submission_type,
            'source' => $attempt->source,
            'status' => $attempt->status,
            'request_hash' => $attempt->request_hash,
            'requested_by' => $attempt->requested_by,
            'requested_at' => $attempt->requested_at?->toISOString(),
            'queue_count' => $attempt->queue_count,
            'queued_at' => $attempt->queued_at?->toISOString(),
            'completed_at' => $attempt->completed_at?->toISOString(),
            'response_http_status' => $attempt->response_http_status,
            'response_code' => $attempt->response_code,
            'response_message' => $attempt->response_message,
            'response_payload' => $attempt->response_payload,
        ];
    }
}

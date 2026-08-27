<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\ZatcaSubmissionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ZatcaSubmissionController extends ApiController
{
    public function __construct(
        protected ZatcaSubmissionService $submissions,
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

    /**
     * يسجل طلب إرسال/إعادة إرسال يدوياً. لا ينفذ HTTP إلى ZATCA في هذا PR؛
     * سيستهلك الـJob اللاحق المحاولة pending وفق نفس العقد الدائم.
     */
    public function store(Request $request, string $id): JsonResponse
    {
        $invoice = $this->visibleInvoice($request, $id);
        $validated = validator([
            'idempotency_key' => $request->header('Idempotency-Key'),
        ], [
            'idempotency_key' => ['required', 'string', 'max:128'],
        ])->validate();

        $result = $this->domain(fn () => $this->submissions->requestManual(
            $invoice,
            $validated['idempotency_key'],
            $request->user()?->id,
        ));

        return response()->json([
            'data' => $this->payload($result['attempt']),
            'meta' => [
                'created' => $result['created'],
                'dispatch_status' => 'pending',
                'network_submission_performed' => false,
            ],
        ], $result['created'] ? 202 : 200);
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
            'completed_at' => $attempt->completed_at?->toISOString(),
            'response_http_status' => $attempt->response_http_status,
            'response_code' => $attempt->response_code,
            'response_message' => $attempt->response_message,
            'response_payload' => $attempt->response_payload,
        ];
    }
}

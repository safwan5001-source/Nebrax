<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StartInvoicePaymentAttemptRequest;
use App\Http\Requests\StoreInvoicePaymentRequestRequest;
use App\Http\Resources\InvoicePaymentRequestResource;
use App\Models\Invoice;
use App\Models\PaymentGateway;
use App\Services\InvoicePaymentRequestService;
use App\Support\PaymentOrchestrationException;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * طلبات دفع الفواتير (PAY-H2-02b). القراءة `payments.view`، الإنشاء/الإلغاء/بدء المحاولة `payments.manage`.
 * معزولة بالمستأجر (معرّف مستأجر آخر ⇒ 404). لا أثر محاسبي: الترحيل شريحة H2-02c.
 */
class InvoicePaymentRequestController extends ApiController
{
    public function __construct(private InvoicePaymentRequestService $requests) {}

    public function index(string $invoiceId): JsonResponse
    {
        $invoice = Invoice::query()->findOrFail($invoiceId);

        return InvoicePaymentRequestResource::collection($this->requests->listForInvoice($invoice))->response();
    }

    public function store(StoreInvoicePaymentRequestRequest $request, string $invoiceId): JsonResponse
    {
        $invoice = Invoice::query()->findOrFail($invoiceId);
        $gateway = PaymentGateway::query()->findOrFail($request->validated('payment_gateway_id'));
        $minutes = $request->validated('expires_in_minutes');

        return $this->guarded(fn () => (new InvoicePaymentRequestResource($this->requests->create(
            $invoice,
            $gateway,
            $request->user(),
            (bool) $request->validated('allow_partial'),
            $minutes === null ? null : now()->addMinutes((int) $minutes),
        )))->response()->setStatusCode(201));
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $paymentRequest = $this->requests->find($id);

        return $this->guarded(fn () => (new InvoicePaymentRequestResource($this->requests->cancel($paymentRequest, $request->user())))->response());
    }

    public function startAttempt(StartInvoicePaymentAttemptRequest $request, string $id): JsonResponse
    {
        $paymentRequest = $this->requests->find($id);
        $key = (string) $request->header('Idempotency-Key', '');
        $amount = $request->validated('amount_minor');

        return $this->guarded(function () use ($paymentRequest, $key, $amount, $request) {
            $attempt = $this->requests->startAttempt($paymentRequest, $key, $amount === null ? null : (int) $amount, $request->user());

            return response()->json(['data' => [
                'id' => $attempt->id,
                'capture_status' => $attempt->capture_status,
                'amount_minor' => (int) $attempt->amount_minor,
                'currency' => $attempt->currency,
                'checkout_url' => $attempt->isActive() ? $attempt->checkout_url : null,
                'expires_at' => $attempt->expires_at?->toISOString(),
            ]], 201);
        });
    }

    /** أخطاء المنسّق بصيغة موحّدة `{error:{code,message}}` (الواجهة تترجم بالرمز). */
    private function guarded(Closure $fn): JsonResponse
    {
        try {
            return $fn();
        } catch (PaymentOrchestrationException $e) {
            $status = match ($e->reason) {
                'forbidden' => 403,
                'provider_unavailable' => 503,
                'open_request_exists', 'request_not_open', 'request_expired', 'active_attempt_exists', 'idempotency_conflict',
                'payable_changed', 'payment_captured', 'gateway_unavailable' => 409,
                default => 422,
            };

            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], $status);
        }
    }
}

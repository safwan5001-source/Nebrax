<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\PaymentAttempt;
use App\Models\Tenant;
use App\Services\InvoicePaymentRequestService;
use App\Support\PaymentOrchestrationException;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * واجهة الدفاع العامة لرابط الدفع (PAY-H2-02e): `GET /pay/v1/{token}` · `POST /pay/v1/{token}/attempts` (Idempotency-Key) · `GET /pay/v1/{token}/status`.
 * بلا مصادقة (الرمز هو القدرة، يحسمه `ResolvePaymentLink`). أقل بيانات ممكنة: اسم المنشأة ورقم الفاتورة والمبلغ المستحق فقط، ولا طرف ولا
 * معرّفات داخلية ولا حالة ترحيل محاسبي ولا أسرار. الأخطاء الداخلية للبوابة تُخفى خلف رمز عام. لا أثر محاسبي هنا.
 */
class PublicPaymentLinkController extends ApiController
{
    public function __construct(private InvoicePaymentRequestService $requests, private TenantContext $tenant) {}

    public function show(Request $request): JsonResponse
    {
        $paymentRequest = $this->resolved($request);
        $invoice = Invoice::query()->find($paymentRequest->invoice_id);
        $payable = $this->isPayable($paymentRequest, $invoice);

        $data = ['status' => $payable ? 'open' : $this->closedStatus($paymentRequest, $invoice)];
        if ($payable) {
            $data += [
                'merchant' => Tenant::query()->whereKey($this->tenant->id())->value('name'),
                'invoice_number' => $invoice->number,
                'currency' => $paymentRequest->currency,
                'amount_due_minor' => $invoice->remaining(),
                'allow_partial' => (bool) $paymentRequest->allow_partial,
                'expires_at' => $paymentRequest->expires_at?->toISOString(),
            ];
        }

        return response()->json(['data' => $data]);
    }

    public function startAttempt(Request $request): JsonResponse
    {
        $paymentRequest = $this->resolved($request);
        $data = $request->validate(['amount_minor' => ['nullable', 'integer', 'min:1']]);

        try {
            $attempt = $this->requests->startAttempt($paymentRequest, (string) $request->header('Idempotency-Key', ''), isset($data['amount_minor']) ? (int) $data['amount_minor'] : null, null);
        } catch (PaymentOrchestrationException $e) {
            [$status, $code] = match ($e->reason) {
                'request_not_open', 'request_expired', 'invoice_not_payable', 'active_attempt_exists', 'payable_changed', 'nothing_due', 'idempotency_conflict' => [409, $e->reason],
                'partial_not_allowed', 'amount_exceeds_remaining', 'invalid_amount', 'invalid_idempotency_key', 'amount_below_minimum' => [422, $e->reason],
                default => [503, 'payment_unavailable'],   // التفعيل/البوابة/المزوّد: لا نكشف سبباً داخلياً للدافع
            };

            return response()->json(['error' => ['code' => $code, 'message' => $status === 503 ? 'الدفع الإلكتروني غير متاح حالياً.' : $e->getMessage()]], $status);
        }

        return response()->json(['data' => [
            'capture_status' => $attempt->capture_status,
            'amount_minor' => (int) $attempt->amount_minor,
            'currency' => $attempt->currency,
            'checkout_url' => $attempt->isActive() ? $attempt->checkout_url : null,
            'expires_at' => $attempt->expires_at?->toISOString(),
        ]], 201);
    }

    public function status(Request $request): JsonResponse
    {
        $paymentRequest = $this->resolved($request);
        $attempt = PaymentAttempt::query()->where('payable_key', $paymentRequest->payableKey())->latest('created_at')->first();

        return response()->json(['data' => [
            'request_status' => $paymentRequest->status,
            'payment' => match (true) {
                $attempt === null => 'none',
                $attempt->capture_status === PaymentAttempt::STATUS_CAPTURED => 'paid',
                $attempt->isActive() => 'pending',
                default => 'not_completed',
            },
        ]]);
    }

    private function resolved(Request $request): InvoicePaymentRequest
    {
        return InvoicePaymentRequest::query()->findOrFail((string) $request->attributes->get('payment_link_request_id'));
    }

    private function isPayable(InvoicePaymentRequest $paymentRequest, ?Invoice $invoice): bool
    {
        return $paymentRequest->status === InvoicePaymentRequest::STATUS_OPEN
            && ($paymentRequest->expires_at === null || $paymentRequest->expires_at->isFuture())
            && $invoice !== null && $invoice->isPosted() && $invoice->remaining() > 0;
    }

    private function closedStatus(InvoicePaymentRequest $paymentRequest, ?Invoice $invoice): string
    {
        if ($paymentRequest->status !== InvoicePaymentRequest::STATUS_OPEN) {
            return $paymentRequest->status;
        }

        return $paymentRequest->expires_at !== null && $paymentRequest->expires_at->isPast() ? 'expired' : 'unavailable';
    }
}

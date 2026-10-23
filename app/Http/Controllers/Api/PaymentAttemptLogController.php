<?php

namespace App\Http\Controllers\Api;

use App\Models\Invoice;
use App\Models\InvoicePaymentRequest;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentAttemptPosting;
use App\Models\PaymentAttemptPostingEvent;
use App\Models\PaymentGateway;
use App\Models\PaymentProviderEvent;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * سجل الدفعات الإلكترونية للفواتير (PAY-H2-03c): قراءة فقط بصلاحية `payments.view`، معزول بالمستأجر (معرّف مستأجر آخر ⇒ 404).
 * لا يكتب شيئاً ولا يكشف الرمز العام ولا `body` أحداث المزوّد ولا أسرار البوابة — حالات وأرقام وتواريخ فقط.
 * محاولات طلبات دفع الفواتير فقط (`payable_key` بادئته `invoice_payment_request:`)؛ غيرها خارج نطاق هذا السجل.
 */
class PaymentAttemptLogController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'capture_status' => ['nullable', 'string', 'in:'.implode(',', PaymentAttempt::STATUSES)],
            'posting_status' => ['nullable', 'string', 'in:'.implode(',', PaymentAttempt::POSTING_STATUSES)],
            'needs_review' => ['nullable', 'boolean'],
            'invoice_id' => ['nullable', 'uuid'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = PaymentAttempt::query()->where('payable_key', 'like', InvoicePaymentRequest::PAYABLE_TYPE.':%');
        if (! empty($data['capture_status'])) {
            $query->where('capture_status', $data['capture_status']);
        }
        if (! empty($data['posting_status'])) {
            $query->where('posting_status', $data['posting_status']);
        }
        if ($request->boolean('needs_review')) {
            $query->whereNotNull('review_reasons')->where('review_reasons', '!=', '[]');
        }
        if (! empty($data['invoice_id'])) {
            $requestIds = InvoicePaymentRequest::query()->where('invoice_id', $data['invoice_id'])->pluck('id');
            $query->whereIn('payable_key', $requestIds->map(fn ($id) => InvoicePaymentRequest::PAYABLE_TYPE.':'.$id)->all() ?: ['-']);
        }

        $page = $query->orderByDesc('created_at')->orderByDesc('id')->paginate((int) ($data['per_page'] ?? 25));
        $context = $this->context($page->getCollection());

        return response()->json([
            'data' => $page->getCollection()->map(fn (PaymentAttempt $a) => $this->row($a, $context))->values(),
            'meta' => [
                'total' => $page->total(),
                'page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'last_page' => $page->lastPage(),
            ],
        ]);
    }

    public function show(string $id): JsonResponse
    {
        $attempt = PaymentAttempt::query()->where('payable_key', 'like', InvoicePaymentRequest::PAYABLE_TYPE.':%')->findOrFail($id);
        $context = $this->context(collect([$attempt]));

        $postings = PaymentAttemptPosting::query()->where('payment_attempt_id', $attempt->id)->orderBy('created_at')->get();
        $payments = Payment::query()->whereIn('id', $postings->pluck('payment_id'))->get(['id', 'number'])->keyBy('id');
        $events = PaymentAttemptPostingEvent::query()->where('payment_attempt_id', $attempt->id)->orderBy('created_at')->get();
        // الفاعل المحذوف ناعماً يبقى في سجل التدقيق (الحدث ثابت)؛ `User` بلا نطاق مستأجر تلقائي فيُقيَّد صراحةً.
        $actors = User::withTrashed()->where('tenant_id', app(TenantContext::class)->id())
            ->whereIn('id', $events->pluck('actor_id')->filter())->get(['id', 'name'])->keyBy('id');
        $providerEvents = PaymentProviderEvent::query()->where('payment_attempt_id', $attempt->id)
            ->orderBy('received_at')->get(['id', 'event_type', 'status', 'outcome', 'received_at']);

        $timeline = collect([['type' => 'created', 'at' => $attempt->created_at?->toISOString()]])
            ->merge($providerEvents->map(fn ($e) => [
                'type' => 'provider_event', 'at' => $e->received_at?->toISOString(),
                'event_type' => $e->event_type, 'outcome' => $e->outcome,
            ]))
            ->merge($attempt->captured_at === null ? [] : [['type' => 'captured', 'at' => $attempt->captured_at->toISOString()]])
            ->merge($attempt->posted_at === null ? [] : [['type' => 'posted', 'at' => $attempt->posted_at->toISOString()]])
            ->merge($events->map(fn ($e) => [
                'type' => 'repost', 'at' => $e->created_at?->toISOString(), 'outcome' => $e->outcome,
                'actor' => $actors[$e->actor_id]->name ?? null, 'reason' => $e->reason,
            ]))
            ->sortBy('at')->values();

        return response()->json(['data' => $this->row($attempt, $context) + [
            'failure_code' => $attempt->failure_code,
            'refunded_minor' => (int) $attempt->refunded_minor,
            'unrecognized_refund_at' => $attempt->unrecognized_refund_at?->toISOString(),
            'unrecognized_refund_minor' => $attempt->unrecognized_refund_minor === null ? null : (int) $attempt->unrecognized_refund_minor,
            'postings' => $postings->map(fn ($p) => [
                'role' => $p->role,
                'amount_minor' => (int) $p->amount_minor,
                'payment_id' => $p->payment_id,
                'payment_number' => $payments[$p->payment_id]->number ?? null,
            ])->values(),
            'timeline' => $timeline,
        ]]);
    }

    /** @return array{requests: Collection, invoices: Collection, gateways: Collection} */
    private function context(Collection $attempts): array
    {
        $requestIds = $attempts->map(fn (PaymentAttempt $a) => substr($a->payable_key, strlen(InvoicePaymentRequest::PAYABLE_TYPE) + 1))->unique()->values();
        $requests = InvoicePaymentRequest::query()->whereIn('id', $requestIds)->get(['id', 'invoice_id'])->keyBy('id');
        $invoices = Invoice::query()->whereIn('id', $requests->pluck('invoice_id')->unique())->get(['id', 'number'])->keyBy('id');
        $gateways = PaymentGateway::query()->whereIn('id', $attempts->pluck('payment_gateway_id')->unique())->get(['id', 'name', 'provider', 'environment'])->keyBy('id');

        return compact('requests', 'invoices', 'gateways');
    }

    private function row(PaymentAttempt $a, array $context): array
    {
        $requestId = substr($a->payable_key, strlen(InvoicePaymentRequest::PAYABLE_TYPE) + 1);
        $invoiceId = $context['requests'][$requestId]->invoice_id ?? null;
        $gateway = $context['gateways'][$a->payment_gateway_id] ?? null;

        return [
            'id' => $a->id,
            'request_id' => $requestId,
            'invoice' => $invoiceId === null ? null : ['id' => $invoiceId, 'number' => $context['invoices'][$invoiceId]->number ?? null],
            'gateway' => $gateway === null ? null : ['id' => $gateway->id, 'name' => $gateway->name, 'provider' => $gateway->provider, 'environment' => $gateway->environment],
            'capture_status' => $a->capture_status,
            'posting_status' => $a->posting_status,
            'amount_minor' => (int) $a->amount_minor,
            'captured_minor' => (int) $a->captured_minor,
            'currency' => $a->currency,
            'review_reasons' => $a->review_reasons ?? [],
            'unrecognized_refund' => $a->unrecognized_refund_at !== null,
            'blocked_reason' => $a->posting_blocked_reason,
            'accounting_date' => $a->accounting_date?->toDateString(),
            'captured_at' => $a->captured_at?->toISOString(),
            'posted_at' => $a->posted_at?->toISOString(),
            'created_at' => $a->created_at?->toISOString(),
        ];
    }
}

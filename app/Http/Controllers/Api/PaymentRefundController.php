<?php

namespace App\Http\Controllers\Api;

use App\Models\CreditNote;
use App\Models\PaymentAttempt;
use App\Models\PaymentRefund;
use App\Models\PaymentRefundAttempt;
use App\Models\PaymentRefundEvent;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Services\Accounting\CustomerRefundService;
use App\Services\PaymentRefundPostingService;
use App\Services\PaymentRefundService;
use App\Support\PaymentRefundException;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * استردادات بوابة الدفع (PAY-H3-01d، ADR-0007): عرض وطلب واعتماد مستقل وإرسال وحسم. الصلاحيات المستقلة:
 * `payment_refunds.view/request/approve/resolve_unknown` (+ `payments.resolve_blocked` لإعادة الترحيل). **لا منطق هنا**: كل شيء في `PaymentRefundService` /
 * `PaymentRefundPostingService`؛ والمتحكّم يحقّق المدخلات ويترجم الرفض إلى 4xx برمز ثابت `{error:{code,message}}` ويعرض الحالة بلا أسرار.
 * معزول بالمستأجر (معرّف مستأجر آخر ⇒ 404). المبالغ بالهللات. الاعتماد والطلب بفاعلَين مختلفَين دائماً (يفرضه الخادم والقاعدة).
 */
class PaymentRefundController extends ApiController
{
    public function __construct(
        private readonly PaymentRefundService $refunds,
        private readonly PaymentRefundPostingService $posting,
        private readonly CustomerRefundService $sources,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['nullable', 'string', 'in:'.implode(',', PaymentRefund::STATUSES)],
            'posting_status' => ['nullable', 'string', 'in:pending,posted,blocked_period'],
            'payment_attempt_id' => ['nullable', 'uuid'],
            'partner_id' => ['nullable', 'uuid'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $query = PaymentRefund::query();
        foreach (['status', 'posting_status', 'payment_attempt_id', 'partner_id'] as $filter) {
            if (! empty($data[$filter])) {
                $query->where($filter, $data[$filter]);
            }
        }
        $page = $query->orderByDesc('created_at')->orderByDesc('id')->paginate((int) ($data['per_page'] ?? 25));
        $actors = $this->actors($page->getCollection());

        return response()->json([
            'data' => $page->getCollection()->map(fn (PaymentRefund $r) => $this->row($r, $actors))->values(),
            'meta' => ['total' => $page->total(), 'page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(string $id): JsonResponse
    {
        $refund = PaymentRefund::query()->with('allocations')->findOrFail($id);
        $events = PaymentRefundEvent::query()->where('payment_refund_id', $refund->id)->orderBy('created_at')->get();
        $invocations = PaymentRefundAttempt::query()->where('payment_refund_id', $refund->id)->orderBy('seq')->get();
        $actors = $this->actors(collect([$refund]), $events);
        $numbers = $this->sourceNumbers($refund);

        return response()->json(['data' => $this->row($refund, $actors) + [
            'allocations' => $refund->allocations->map(fn ($a) => [
                'source_type' => $a->source_type === CreditNote::class ? CustomerRefundService::SOURCE_CREDIT_NOTE : CustomerRefundService::SOURCE_SALES_RETURN,
                'source_id' => $a->source_id,
                'source_number' => $numbers[$a->source_id] ?? null,
                'amount_minor' => (int) $a->amount_minor,
            ])->values(),
            'invocations' => $invocations->map(fn ($i) => [
                'seq' => (int) $i->seq, 'baseline_refunded_minor' => (int) $i->baseline_refunded_minor, 'amount_minor' => (int) $i->amount_minor,
                'at' => $i->created_at?->toISOString(),
            ])->values(),
            'timeline' => $events->map(fn (PaymentRefundEvent $e) => [
                'action' => $e->action, 'from' => $e->from_status, 'to' => $e->to_status, 'reason' => $e->reason,
                'actor' => $e->actor_id === null ? null : ($actors[$e->actor_id] ?? null), 'at' => $e->created_at?->toISOString(),
            ])->values(),
        ]]);
    }

    /** سياق الاسترداد لدفعة: السعة والمانع (إن وُجد) والمصادر المؤهَّلة لعميلها وعلم الاسترداد الخارجي. قراءة فقط. */
    public function context(string $attemptId): JsonResponse
    {
        $attempt = PaymentAttempt::query()->findOrFail($attemptId);
        $blocker = $this->refunds->attemptBlocker($attempt);
        $partnerId = $this->refunds->partnerIdOf($attempt);
        $sources = [];
        if ($blocker === null && $partnerId !== null) {
            $sources = collect($this->sources->eligibleSources($partnerId))
                ->filter(function (array $row) use ($attempt) {
                    $model = $row['source_type'] === CustomerRefundService::SOURCE_CREDIT_NOTE ? CreditNote::class : ReturnDocument::class;

                    return $model::query()->whereKey($row['id'])->value('branch_id') === $attempt->branch_id;
                })->values()->all();
        }

        return response()->json(['data' => [
            'payment_attempt_id' => $attempt->id,
            'currency' => $attempt->currency,
            'captured_minor' => (int) $attempt->captured_minor,
            'refunded_minor' => (int) $attempt->refunded_minor,
            'refundable_minor' => max(0, $this->refunds->refundablePayment($attempt)),
            'eligible' => $blocker === null,
            'blocker' => $blocker === null ? null : ['code' => $blocker->reason, 'message' => $blocker->getMessage()],
            'unrecognized_refund_at' => $attempt->unrecognized_refund_at?->toISOString(),
            'unrecognized_refund_minor' => $attempt->unrecognized_refund_minor === null ? null : (int) $attempt->unrecognized_refund_minor,
            'sources' => $sources,
        ]]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'payment_attempt_id' => ['required', 'uuid'],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'idempotency_key' => ['required', 'string', 'min:8', 'max:128'],
            'allocations' => ['required', 'array', 'min:1', 'max:20'],
            'allocations.*.source_type' => ['required', 'string', 'in:credit_note,sales_return'],
            'allocations.*.source_id' => ['required', 'uuid'],
            'allocations.*.amount_minor' => ['required', 'integer', 'min:1'],
        ]);
        $attempt = PaymentAttempt::query()->findOrFail($data['payment_attempt_id']);
        $allocations = array_map(fn (array $a) => ['source_type' => $a['source_type'], 'source_id' => $a['source_id'], 'amount' => (int) $a['amount_minor']], $data['allocations']);

        return $this->guard(function () use ($attempt, $data, $allocations, $request) {
            $refund = $this->refunds->request($attempt, (int) $data['amount_minor'], $allocations, $data['idempotency_key'], $request->user());

            return response()->json(['data' => $this->detail($refund)], 201);
        });
    }

    /** اعتماد (وإرسال فوري اختيارياً بـ`submit=true`): الإرسال خطوة منفصلة في الخدمة، ونتيجتها تُعاد كما هي ولو فشل الإرسال بقي الاعتماد. */
    public function approve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['submit' => ['nullable', 'boolean']]);
        $refund = PaymentRefund::query()->findOrFail($id);

        return $this->guard(function () use ($refund, $request, $data) {
            $approved = $this->refunds->approve($refund, $request->user());
            $submitError = null;
            if (! empty($data['submit'])) {
                try {
                    $approved = $this->refunds->submit($approved, $request->user());
                } catch (PaymentRefundException $e) {
                    $submitError = ['code' => $e->reason, 'message' => $e->getMessage()];
                    $approved = $approved->fresh();
                }
            }

            return response()->json(['data' => $this->detail($approved), 'meta' => ['submit_error' => $submitError]]);
        });
    }

    public function submit(Request $request, string $id): JsonResponse
    {
        $refund = PaymentRefund::query()->findOrFail($id);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->refunds->submit($refund, $request->user()))]));
    }

    public function reject(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $refund = PaymentRefund::query()->findOrFail($id);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->refunds->reject($refund, $request->user(), $data['reason']))]));
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $refund = PaymentRefund::query()->findOrFail($id);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->refunds->cancel($refund, $request->user(), $data['reason']))]));
    }

    public function resolve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['decision' => ['required', 'string', 'in:confirm,not_applied'], 'reason' => ['required', 'string', 'min:5', 'max:500']]);
        $refund = PaymentRefund::query()->findOrFail($id);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->refunds->resolveUnknown($refund, $request->user(), $data['decision'], $data['reason']))]));
    }

    public function repost(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $refund = PaymentRefund::query()->findOrFail($id);

        return $this->guard(function () use ($refund, $request, $data) {
            $outcome = $this->posting->repost($refund, $request->user(), $data['reason']);

            return response()->json(['data' => $this->detail($refund->fresh()) + ['outcome' => $outcome]]);
        });
    }

    public function resolveExternal(Request $request, string $attemptId): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $attempt = PaymentAttempt::query()->findOrFail($attemptId);

        return $this->guard(function () use ($attempt, $request, $data) {
            $resolved = $this->refunds->resolveExternalRefund($attempt, $request->user(), $data['reason']);

            return response()->json(['data' => ['payment_attempt_id' => $resolved->id, 'refunded_minor' => (int) $resolved->refunded_minor, 'unrecognized_refund_at' => null]]);
        });
    }

    // ───────────────────────── الداخل ─────────────────────────

    private function guard(callable $operation): JsonResponse
    {
        try {
            return $operation();
        } catch (PaymentRefundException $e) {
            $status = match ($e->reason) {
                'forbidden' => 403,
                'refund_not_found', 'attempt_not_found' => 404,
                'invalid_state', 'busy', 'self_approval', 'not_blocked', 'not_postable', 'idempotency_conflict', 'platform_stop', 'rollout_disabled',
                'unrecognized_refund_open', 'no_unrecognized_refund', 'provider_unavailable' => 409,
                default => 422,
            };

            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], $status);
        }
    }

    private function detail(PaymentRefund $refund): array
    {
        return $this->row($refund->fresh(), $this->actors(collect([$refund])));
    }

    /**
     * @param  Collection<int, PaymentRefund>  $refunds
     * @param  Collection<int, PaymentRefundEvent>|null  $events
     * @return Collection<string, string>
     */
    private function actors(Collection $refunds, ?Collection $events = null): Collection
    {
        $ids = $refunds->flatMap(fn (PaymentRefund $r) => [$r->requested_by, $r->approved_by, $r->rejected_by, $r->cancelled_by])
            ->merge($events?->pluck('actor_id') ?? [])->filter()->unique()->values();

        // الفاعل المحذوف ناعماً يبقى في السجل؛ `User` بلا نطاق مستأجر تلقائي فيُقيَّد صراحةً.
        return User::withTrashed()->where('tenant_id', app(TenantContext::class)->id())->whereIn('id', $ids)->pluck('name', 'id');
    }

    /** @return array<string, string> */
    private function sourceNumbers(PaymentRefund $refund): array
    {
        $notes = CreditNote::query()->whereIn('id', $refund->allocations->where('source_type', CreditNote::class)->pluck('source_id'))->pluck('number', 'id');
        $returns = ReturnDocument::query()->whereIn('id', $refund->allocations->where('source_type', ReturnDocument::class)->pluck('source_id'))->pluck('number', 'id');

        return $notes->all() + $returns->all();
    }

    /** @param  Collection<string, string>  $actors */
    private function row(PaymentRefund $r, Collection $actors): array
    {
        return [
            'id' => $r->id,
            'number' => $r->number,
            'status' => $r->status,
            'amount_minor' => (int) $r->amount_minor,
            'currency' => $r->currency,
            'partner_id' => $r->partner_id,
            'partner_name' => $r->partner()->value('name'),
            'payment_attempt_id' => $r->payment_attempt_id,
            'requested_by' => ['id' => $r->requested_by, 'name' => $actors[$r->requested_by] ?? null],
            'requested_at' => $r->requested_at?->toISOString(),
            'approved_by' => $r->approved_by === null ? null : ['id' => $r->approved_by, 'name' => $actors[$r->approved_by] ?? null],
            'approved_at' => $r->approved_at?->toISOString(),
            'reject_reason' => $r->reject_reason,
            'cancel_reason' => $r->cancel_reason,
            'confirmed_at' => $r->confirmed_at?->toISOString(),
            'provider_refunded_at' => $r->provider_refunded_at?->toISOString(),
            'provider_refund_ref' => $r->provider_refund_ref,
            'failure_code' => $r->failure_code,
            'retry_count' => (int) $r->retry_count,
            'excess_minor' => (int) $r->excess_minor,
            'posting_status' => $r->posting_status,
            'accounting_date' => $r->accounting_date?->toDateString(),
            'posted_at' => $r->posted_at?->toISOString(),
            'journal_entry_id' => $r->journal_entry_id,
            'blocked_reason' => $r->posting_blocked_reason,
        ];
    }
}

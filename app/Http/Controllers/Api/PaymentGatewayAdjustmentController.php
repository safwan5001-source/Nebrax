<?php

namespace App\Http\Controllers\Api;

use App\Models\PaymentGateway;
use App\Models\PaymentGatewayAdjustment;
use App\Models\User;
use App\Services\PaymentGatewayAdjustmentService;
use App\Support\GatewayAdjustmentException;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;

/**
 * تعديلات المزوّد غير العمولة (PAY-H3-02c، ADR-0008 D-22): القراءة بـ`payments.view`، والطلب بـ`payment_settlements.adjust`، والاعتماد/الرفض
 * بـ`payment_settlements.approve_adjustment` (المعتمِد ≠ الطالب). لا قيد هنا؛ يُستهلك التعديل المعتمد بتسوية مرحَّلة. الفاعل من المصادقة دائماً.
 * رموز الرفض الثابتة `{error:{code,message}}` (403/404/409/422)، معزول بالمستأجر (معرّف مستأجر آخر ⇒ 404).
 */
class PaymentGatewayAdjustmentController extends ApiController
{
    public function __construct(private readonly PaymentGatewayAdjustmentService $adjustments)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'payment_gateway_id' => ['nullable', 'uuid'],
            'status' => ['nullable', 'string', 'in:'.implode(',', PaymentGatewayAdjustment::STATUSES)],
            'kind' => ['nullable', 'string', 'in:'.implode(',', PaymentGatewayAdjustment::KINDS)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $query = PaymentGatewayAdjustment::query();
        foreach (['payment_gateway_id', 'status', 'kind'] as $filter) {
            if (! empty($data[$filter])) {
                $query->where($filter, $data[$filter]);
            }
        }
        $page = $query->orderByDesc('created_at')->orderByDesc('id')->paginate((int) ($data['per_page'] ?? 25));
        $actors = $this->actors($page->getCollection());

        return response()->json([
            'data' => $page->getCollection()->map(fn (PaymentGatewayAdjustment $a) => $this->row($a, $actors))->values(),
            'meta' => ['total' => $page->total(), 'page' => $page->currentPage(), 'per_page' => $page->perPage(), 'last_page' => $page->lastPage()],
        ]);
    }

    public function show(string $id): JsonResponse
    {
        return response()->json(['data' => $this->detail(PaymentGatewayAdjustment::query()->findOrFail($id))]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'payment_gateway_id' => ['required', 'uuid'],
            'kind' => ['required', 'string', 'in:'.implode(',', PaymentGatewayAdjustment::KINDS)],
            'amount_minor' => ['required', 'integer', 'min:1', 'max:999999999999'],
            'reason' => ['required', 'string', 'min:5', 'max:500'],
            'evidence_ref' => ['required', 'string', 'min:3', 'max:191'],
            'provider_event_ref' => ['nullable', 'string', 'max:191'],
        ]);
        $gateway = PaymentGateway::query()->findOrFail($data['payment_gateway_id']);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->adjustments->request(
            $gateway, $data['kind'], (int) $data['amount_minor'], $data['reason'], $data['evidence_ref'], $data['provider_event_ref'] ?? null, $request->user(),
        ))], 201));
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $adjustment = PaymentGatewayAdjustment::query()->findOrFail($id);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->adjustments->approve($adjustment, $request->user()))]));
    }

    public function reject(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $adjustment = PaymentGatewayAdjustment::query()->findOrFail($id);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->adjustments->reject($adjustment, $request->user(), $data['reason']))]));
    }

    public function cancel(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:5', 'max:500']]);
        $adjustment = PaymentGatewayAdjustment::query()->findOrFail($id);

        return $this->guard(fn () => response()->json(['data' => $this->detail($this->adjustments->cancel($adjustment, $request->user(), $data['reason']))]));
    }

    /** الاحتياطي المحتجز لدى البوابة والمتاح للإفراج (بنود تسويات مرحَّلة فقط). */
    public function reserve(string $gatewayId): JsonResponse
    {
        PaymentGateway::query()->findOrFail($gatewayId);

        return response()->json(['data' => [
            'held_minor' => $this->adjustments->reserveBalance($gatewayId),
            'releasable_minor' => $this->adjustments->releasable($gatewayId),
        ]]);
    }

    // ───────────────────────── الداخل ─────────────────────────

    private function guard(callable $operation): JsonResponse
    {
        try {
            return $operation();
        } catch (GatewayAdjustmentException $e) {
            $status = match ($e->reason) {
                'forbidden' => 403,
                'adjustment_not_found', 'gateway_not_found' => 404,
                'invalid_state', 'self_approval', 'rollout_disabled', 'duplicate_event', 'reserve_insufficient' => 409,
                default => 422,
            };

            return response()->json(['error' => ['code' => $e->reason, 'message' => $e->getMessage()]], $status);
        }
    }

    /** @return array<string, mixed> */
    private function detail(PaymentGatewayAdjustment $adjustment): array
    {
        $adjustment = $adjustment->fresh();
        $events = $adjustment->events()->orderBy('created_at')->orderBy('id')->get();
        $actors = $this->actors(collect([$adjustment]), $events->pluck('actor_id'));

        return $this->row($adjustment, $actors) + [
            'timeline' => $events->map(fn ($e) => [
                'action' => $e->action, 'from_status' => $e->from_status, 'to_status' => $e->to_status,
                'actor' => $e->actor_id === null ? null : ($actors[$e->actor_id] ?? null), 'reason' => $e->reason, 'at' => $e->created_at?->toISOString(),
            ])->values(),
        ];
    }

    /**
     * @param  Collection<int, PaymentGatewayAdjustment>  $adjustments
     * @return Collection<string, string>
     */
    private function actors(Collection $adjustments, ?Collection $extra = null): Collection
    {
        $ids = $adjustments->flatMap(fn (PaymentGatewayAdjustment $a) => [$a->requested_by, $a->approved_by, $a->rejected_by, $a->cancelled_by])
            ->merge($extra ?? [])->filter()->unique()->values();

        return User::withTrashed()->where('tenant_id', app(TenantContext::class)->id())->whereIn('id', $ids)->pluck('name', 'id');
    }

    /** @param  Collection<string, string>  $actors */
    private function row(PaymentGatewayAdjustment $a, Collection $actors): array
    {
        $who = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $actors[$id] ?? null];

        return [
            'id' => $a->id,
            'payment_gateway_id' => $a->payment_gateway_id,
            'kind' => $a->kind,
            'amount_minor' => (int) $a->amount_minor,
            'currency' => $a->currency,
            'status' => $a->status,
            'reason' => $a->reason,
            'evidence_ref' => $a->evidence_ref,
            'provider_event_ref' => $a->provider_event_ref,
            'requested_by' => $who($a->requested_by),
            'requested_at' => $a->requested_at?->toISOString(),
            'approved_by' => $who($a->approved_by),
            'approved_at' => $a->approved_at?->toISOString(),
            'rejected_by' => $who($a->rejected_by),
            'reject_reason' => $a->reject_reason,
            'cancelled_by' => $who($a->cancelled_by),
            'cancel_reason' => $a->cancel_reason,
            'settlement_id' => $a->settlement_id,
        ];
    }
}

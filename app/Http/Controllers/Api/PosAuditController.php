<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\PosSessionEventResource;
use App\Models\PosOverrideApproval;
use App\Models\PosReasonCode;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Services\Pos\PosAuditService;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * مساحة قراءة وتحكم موحّدة لرقابة POS. لا تقرأ الفواتير أو المدفوعات مباشرةً
 * كمصدر تدقيق؛ تعيد تجميع مراجع PosSessionEvent التي سجلتها المحركات الحالية.
 */
class PosAuditController extends ApiController
{
    public function __construct(private readonly PosAuditService $audit) {}

    public function overview(Request $request): JsonResponse
    {
        $events = $this->visibleEvents($request);
        $from = now()->subDay();
        $recent = (clone $events)->where('created_at', '>=', $from);
        $pending = $this->visibleApprovals($request)->where('status', PosOverrideApproval::STATUS_PENDING)->count();

        return response()->json(['data' => [
            'review_activity_count' => (clone $recent)->whereIn('category', ['cart', 'price', 'discount', 'payment', 'drawer', 'cash_movement', 'cash_count', 'approval'])->count(),
            'cart_cancellations_count' => (clone $recent)->whereIn('type', [PosSessionEvent::TYPE_CART_CANCELLED, PosSessionEvent::TYPE_CART_DISCARDED])->count(),
            'cash_variance_count' => (clone $recent)->where('type', PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT)->count(),
            'pending_approvals_count' => $pending,
            'range_started_at' => $from->toIso8601String(),
        ]]);
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $this->filters($request);
        $result = $this->audit->readEvents($this->visibleEvents($request), $filters);

        return response()->json([
            'data' => PosSessionEventResource::collection($result['events']),
            'meta' => ['total' => $result['total'], 'per_page' => min(max((int) ($filters['per_page'] ?? 50), 1), 200)],
        ]);
    }

    public function export(Request $request): StreamedResponse
    {
        $filters = $this->filters($request);
        $query = $this->visibleEvents($request)->orderByDesc('created_at')->limit(10000);
        if (! empty($filters['from'])) $query->where('created_at', '>=', $filters['from']);
        if (! empty($filters['to'])) $query->where('created_at', '<=', $filters['to']);
        if (! empty($filters['pos_session_id'])) $query->where('pos_session_id', $filters['pos_session_id']);
        if (! empty($filters['cart_id'])) $query->where('cart_id', $filters['cart_id']);
        if (! empty($filters['type'])) $query->whereIn('type', (array) $filters['type']);
        if (! empty($filters['reason_code'])) $query->where('reason_code', $filters['reason_code']);
        if (isset($filters['amount_min'])) $query->where('amount', '>=', (int) $filters['amount_min']);
        if (isset($filters['amount_max'])) $query->where('amount', '<=', (int) $filters['amount_max']);

        return response()->streamDownload(function () use ($query): void {
            $out = fopen('php://output', 'w');
            fputcsv($out, ['event_id', 'occurred_at', 'event_type', 'category', 'cart_id', 'session_id', 'amount_minor', 'reason_code', 'performed_by', 'approved_by']);
            $query->select(['id', 'created_at', 'type', 'category', 'cart_id', 'pos_session_id', 'amount', 'reason_code', 'performed_by', 'approved_by'])
                ->chunkById(500, function ($events) use ($out): void {
                    foreach ($events as $event) {
                        fputcsv($out, [$event->id, optional($event->created_at)->toIso8601String(), $event->type, $event->category, $event->cart_id, $event->pos_session_id, $event->amount, $event->reason_code, $event->performed_by, $event->approved_by]);
                    }
                });
            fclose($out);
        }, 'pos-audit-events.csv', ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    public function carts(Request $request): JsonResponse
    {
        $filters = $this->filters($request);
        $events = $this->visibleEvents($request)
            ->whereNotNull('cart_id')
            ->orderByDesc('created_at')
            ->get(['id', 'cart_id', 'pos_session_id', 'branch_id', 'type', 'reason_code', 'created_at']);
        $perPage = min(max((int) ($filters['per_page'] ?? 50), 1), 200);
        $carts = $events->groupBy('cart_id')->map(function ($events, string $cartId): array {
            $first = $events->last();
            $latest = $events->first();

            return [
                'cart_id' => $cartId,
                'pos_session_id' => $latest->pos_session_id,
                'branch_id' => $latest->branch_id,
                'created_at' => $first->created_at?->toIso8601String(),
                'last_event_at' => $latest->created_at?->toIso8601String(),
                'last_event_type' => $latest->type,
                'event_count' => $events->count(),
                'reason_code' => $latest->reason_code,
            ];
        })->values()->take($perPage);

        return response()->json(['data' => $carts, 'meta' => ['total' => $carts->count(), 'per_page' => $perPage]]);
    }

    public function cart(Request $request, string $cartId): JsonResponse
    {
        $this->validateCartId($cartId);
        $events = $this->visibleEvents($request)
            ->where('cart_id', $cartId)
            ->with([
                'actor:id,name', 'performedBy:id,name', 'approvedBy:id,name',
                'session:id,number,pos_device_id,shift_id,opened_by,closed_by', 'session.posDevice:id,name,code',
            ])
            ->orderBy('created_at')->orderBy('id')
            ->get();
        abort_if($events->isEmpty(), 404, 'سجل السلة غير موجود أو خارج نطاقك.');

        return response()->json(['data' => [
            'cart_id' => $cartId,
            'pos_session_id' => $events->first()->pos_session_id,
            'timeline' => PosSessionEventResource::collection($events),
        ]]);
    }

    public function users(Request $request): JsonResponse
    {
        $rows = $this->visibleEvents($request)
            ->whereNotNull('performed_by')
            ->selectRaw('performed_by, COUNT(*) as events_count, MAX(created_at) as last_event_at')
            ->groupBy('performed_by')
            ->orderByDesc('last_event_at')
            ->limit(100)
            ->get();
        $users = \App\Models\User::query()->whereIn('id', $rows->pluck('performed_by'))->get(['id', 'name'])->keyBy('id');

        return response()->json(['data' => $rows->map(fn ($row) => [
            'user_id' => $row->performed_by,
            'name' => $users->get($row->performed_by)?->name ?? '—',
            'events_count' => (int) $row->events_count,
            'last_event_at' => $row->last_event_at,
        ])->values()]);
    }

    public function approvals(Request $request): JsonResponse
    {
        $approvals = $this->visibleApprovals($request)
            ->with(['performedBy:id,name', 'approvedBy:id,name'])
            ->orderByDesc('created_at')->limit(200)->get();

        return response()->json(['data' => $approvals->map(fn (PosOverrideApproval $approval) => $this->approvalData($approval))->values()]);
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $approval = $this->visibleApprovals($request)->findOrFail($id);
        $approved = $this->domain(fn () => $this->audit->approve($approval, $request->user()));

        return response()->json(['data' => $this->approvalData($approved)]);
    }

    public function reasonCodes(Request $request): JsonResponse
    {
        $codes = $this->audit->reasonCodes($request->boolean('include_inactive'));

        return response()->json(['data' => array_map(fn (PosReasonCode $code) => $this->reasonData($code), $codes)]);
    }

    public function storeReasonCode(Request $request): JsonResponse
    {
        $data = $request->validate([
            'code' => ['required', 'string', 'alpha_dash', 'max:80', Rule::unique('pos_reason_codes', 'code')->where('tenant_id', app(\App\Tenancy\TenantContext::class)->id())],
            'name_ar' => ['required', 'string', 'max:160'],
            'name_en' => ['required', 'string', 'max:160'],
            'requires_note' => ['required', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $code = PosReasonCode::create($data + ['is_active' => $data['is_active'] ?? true]);

        return response()->json(['data' => $this->reasonData($code)], 201);
    }

    public function updateReasonCode(Request $request, string $id): JsonResponse
    {
        $code = PosReasonCode::query()->findOrFail($id);
        abort_if($code->code === PosReasonCode::OTHER && $request->has('requires_note') && ! $request->boolean('requires_note'), 422, 'سبب «أخرى» يحتاج توضيحاً دائماً.');
        $data = $request->validate([
            'name_ar' => ['sometimes', 'string', 'max:160'],
            'name_en' => ['sometimes', 'string', 'max:160'],
            'requires_note' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
        $code->update($data);

        return response()->json(['data' => $this->reasonData($code->fresh())]);
    }

    public function createCart(Request $request): JsonResponse
    {
        $data = $request->validate([
            'pos_session_id' => ['required', 'uuid'],
            'snapshot' => ['nullable', 'array', 'max:30'],
            'snapshot.items' => ['nullable', 'array', 'max:500'],
            'snapshot.customer' => ['nullable', 'array', 'max:20'],
            'snapshot.note' => ['nullable', 'string', 'max:2000'],
            'snapshot.tax_inclusive' => ['nullable', 'boolean'],
        ]);
        $session = $this->activeSession($data['pos_session_id'], $request);
        $event = $this->domain(fn () => $this->audit->createCart($session, $request->user(), $data['snapshot'] ?? []));

        return response()->json(['data' => ['cart_id' => $event->cart_id, 'correlation_id' => $event->correlation_id, 'event_id' => $event->id]], 201);
    }

    public function recordCartEvent(Request $request, string $cartId): JsonResponse
    {
        $this->validateCartId($cartId);
        $data = $request->validate([
            'pos_session_id' => ['required', 'uuid'],
            'type' => ['required', Rule::in($this->cartEventTypes())],
            'reason_code' => ['nullable', 'string', 'max:80'],
            'reason_note' => ['nullable', 'string', 'max:2000'],
            'approval_id' => ['nullable', 'uuid'],
            'correlation_id' => ['nullable', 'uuid'],
            // before/after العميلية telemetry فقط؛ لا تقبل قيمة أو حالة نهائية
            // لأنها لا تشكل دليلاً خادمياً ولا تستخدم قراراً مالياً أو أمنياً.
            'before' => ['nullable', 'array', 'max:40'],
            'after' => ['nullable', 'array', 'max:40'],
            'item' => ['nullable', 'array', 'max:30'],
            'items' => ['nullable', 'array', 'max:200'],
            'customer' => ['nullable', 'array', 'max:20'],
            'tenders' => ['nullable', 'array', 'max:20'],
        ]);
        $session = $this->activeSession($data['pos_session_id'], $request);
        $event = $this->domain(fn () => $this->audit->recordClientObservedCartEvent($session, $request->user(), $cartId, $data['type'], $data));

        return (new PosSessionEventResource($event->load(['actor', 'performedBy', 'approvedBy'])))->response()->setStatusCode(201);
    }

    public function requestApproval(Request $request): JsonResponse
    {
        $data = $request->validate([
            'pos_session_id' => ['required', 'uuid'],
            'operation' => ['required', 'string', 'max:80'],
            'cart_id' => ['nullable', 'uuid'],
            'reason_code' => ['nullable', 'string', 'max:80'],
            'reason_note' => ['nullable', 'string', 'max:2000'],
            'context' => ['nullable', 'array', 'max:40'],
        ]);
        $session = $this->activeSession($data['pos_session_id'], $request);
        $approval = $this->domain(fn () => $this->audit->requestApproval(
            $session, $request->user(), $data['operation'], $data['cart_id'] ?? null,
            $data['reason_code'] ?? null, $data['reason_note'] ?? null, $data['context'] ?? [],
        ));

        return response()->json(['data' => $this->approvalData($approval)], 201);
    }

    private function activeSession(string $id, Request $request): PosSession
    {
        return $this->scopeToActiveBranch(PosSession::query(), $request)->findOrFail($id);
    }

    /** @return \Illuminate\Database\Eloquent\Builder<PosSessionEvent> */
    private function visibleEvents(Request $request): \Illuminate\Database\Eloquent\Builder
    {
        return $this->scopeToActiveBranch(PosSessionEvent::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return \Illuminate\Database\Eloquent\Builder<PosOverrideApproval> */
    private function visibleApprovals(Request $request): \Illuminate\Database\Eloquent\Builder
    {
        return $this->scopeToActiveBranch(PosOverrideApproval::query()->withoutGlobalScope(BranchScope::class), $request);
    }

    /** @return array<string,mixed> */
    private function filters(Request $request): array
    {
        return $request->validate([
            'from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'],
            'device_id' => ['nullable', 'uuid'], 'pos_session_id' => ['nullable', 'uuid'],
            'user_id' => ['nullable', 'uuid'], 'cart_id' => ['nullable', 'uuid'],
            'type' => ['nullable', 'array', 'max:50'], 'type.*' => ['string', 'max:80'],
            'category' => ['nullable', 'array', 'max:20'], 'category.*' => ['string', 'max:40'],
            'reason_code' => ['nullable', 'string', 'max:80'],
            'amount_min' => ['nullable', 'integer'], 'amount_max' => ['nullable', 'integer', 'gte:amount_min'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);
    }

    /** @return list<string> */
    private function cartEventTypes(): array
    {
        return [
            PosSessionEvent::TYPE_ITEM_ADDED, PosSessionEvent::TYPE_ITEM_REMOVED,
            PosSessionEvent::TYPE_ITEM_QUANTITY_CHANGED, PosSessionEvent::TYPE_PRICE_OVERRIDDEN,
            PosSessionEvent::TYPE_DISCOUNT_APPLIED, PosSessionEvent::TYPE_DISCOUNT_CHANGED,
            PosSessionEvent::TYPE_DISCOUNT_REMOVED, PosSessionEvent::TYPE_CUSTOMER_CHANGED,
            PosSessionEvent::TYPE_PAYMENT_CANCELLED, PosSessionEvent::TYPE_CART_CANCELLED,
        ];
    }

    private function validateCartId(string $cartId): void
    {
        abort_unless(preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/', $cartId) === 1, 404, 'معرّف السلة غير صالح.');
    }

    /** @return array<string,mixed> */
    private function reasonData(PosReasonCode $code): array
    {
        return [
            'id' => $code->id, 'code' => $code->code, 'name_ar' => $code->name_ar,
            'name_en' => $code->name_en, 'requires_note' => $code->requires_note,
            'is_active' => $code->is_active,
        ];
    }

    /** @return array<string,mixed> */
    private function approvalData(PosOverrideApproval $approval): array
    {
        return [
            'id' => $approval->id, 'pos_session_id' => $approval->pos_session_id,
            'cart_id' => $approval->cart_id, 'correlation_id' => $approval->correlation_id,
            'operation' => $approval->operation, 'policy' => $approval->policy,
            'status' => $approval->status, 'reason_code' => $approval->reason_code,
            'reason_note' => $approval->reason_note, 'performed_by' => $approval->performed_by,
            'approved_by' => $approval->approved_by, 'performed_by_user' => $approval->performedBy ? ['id' => $approval->performedBy->id, 'name' => $approval->performedBy->name] : null,
            'approved_by_user' => $approval->approvedBy ? ['id' => $approval->approvedBy->id, 'name' => $approval->approvedBy->name] : null,
            'context' => $approval->context, 'approved_at' => $approval->approved_at?->toIso8601String(),
            'expires_at' => $approval->expires_at?->toIso8601String(), 'created_at' => $approval->created_at?->toIso8601String(),
        ];
    }
}

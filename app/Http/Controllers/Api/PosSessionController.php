<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\AcknowledgePosSessionDifferenceRequest;
use App\Http\Requests\ClosePosSessionRequest;
use App\Http\Requests\ConfirmPosSessionHandoverRequest;
use App\Http\Requests\OpenPosSessionRequest;
use App\Http\Requests\StorePosCashMovementRequest;
use App\Http\Resources\PosCashMovementResource;
use App\Http\Resources\PosSessionEventResource;
use App\Http\Resources\PosSessionResource;
use App\Models\PosSession;
use App\Models\Shift;
use App\Services\Accounting\PosSessionService;
use App\Services\Pos\CashDrawerService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use RuntimeException;

class PosSessionController extends ApiController
{
    public function __construct(
        protected PosSessionService $sessions,
        protected CashDrawerService $cashDrawer,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(['open', 'closed'])],
            'pos_device_id' => ['sometimes', 'nullable', 'uuid'],
            'pos_shift_id' => ['sometimes', 'nullable', 'uuid'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date', 'after_or_equal:date_from'],
        ]);
        $query = PosSession::with(['posDevice.warehouse', 'warehouse', 'posShift', 'shift', 'reconciliations', 'handoverConfirmedBy'])->orderByDesc('opened_at');
        if ($request->boolean('mine')) {
            $query->where('opened_by', $request->user()?->id);
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['pos_device_id'])) {
            $query->where('pos_device_id', $filters['pos_device_id']);
        }
        if (! empty($filters['pos_shift_id'])) {
            $query->where('pos_shift_id', $filters['pos_shift_id']);
        }
        if (! empty($filters['date_from'])) {
            $query->whereDate('opened_at', '>=', $filters['date_from']);
        }
        if (! empty($filters['date_to'])) {
            $query->whereDate('opened_at', '<=', $filters['date_to']);
        }

        return PosSessionResource::collection($this->scopeToActiveBranch($query, $request)->get())->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request)->load([
            'posDevice.warehouse',
            'warehouse',
            'posShift',
            'shift',
            'reconciliations',
            'handoverConfirmedBy',
        ]);

        return (new PosSessionResource($session))->response();
    }

    public function open(OpenPosSessionRequest $request): JsonResponse
    {
        $data = $request->validated();
        $posShiftId = $data['pos_shift_id'] ?? null;
        $legacyShiftId = $posShiftId === null ? ($data['shift_id'] ?? null) : null;

        $session = $this->domain(fn () => DB::transaction(function () use ($data, $request, $posShiftId, $legacyShiftId): PosSession {
            // توافق ترحيل محدود: العملاء القدماء قد يرسلون HR shift_id. نتحقق منه
            // كما كان سابقاً، بينما أي عميل جديد يرسل pos_shift_id ولا يكتب shift_id.
            if ($legacyShiftId !== null) {
                $legacyShift = Shift::query()->whereKey($legacyShiftId)->where('is_active', true)->first();
                if (! $legacyShift) {
                    throw new RuntimeException('وردية العمل القديمة غير موجودة أو معطّلة أو لا تخص الفرع النشط.');
                }
            }

            $session = $this->sessions->open(
                (int) $data['opening_balance'],
                $data['pos_device_id'],
                $posShiftId,
                $request->user()?->id,
                $request->user(),
            );

            if ($legacyShiftId !== null) {
                $session->forceFill(['shift_id' => $legacyShiftId])->save();
            }

            return $session->refresh();
        }));

        return (new PosSessionResource($session->load(['posDevice.warehouse', 'warehouse', 'posShift', 'shift'])))
            ->response()->setStatusCode(201);
    }

    public function closingPreview(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $preview = $this->domain(fn () => $this->sessions->closingPreview($session, $request->user()));
        if (\App\Support\PosSettings::blindCashCountEnabled()) {
            $preview['cash_drawer']['expected_amount'] = null;
            foreach ($preview['payment_methods'] as &$method) {
                $method['expected_amount'] = null;
            }
            unset($method);
        } else {
            $preview['cash_drawer']['expected_amount'] = Money::toRiyal($preview['cash_drawer']['expected_amount']);
            foreach ($preview['payment_methods'] as &$method) {
                $method['expected_amount'] = Money::toRiyal($method['expected_amount']);
            }
            unset($method);
        }

        return response()->json(['data' => $preview]);
    }

    public function close(ClosePosSessionRequest $request, string $id): JsonResponse
    {
        $data = $request->validated();
        $session = $this->visibleSession($id, $request);
        $closed = $this->domain(fn () => $this->sessions->close(
            $session,
            (int) $data['closing_balance'],
            $request->user()?->id,
            $data['payment_counts'] ?? [],
            $data['handover_note'] ?? null,
        ));

        return (new PosSessionResource($closed->load(['posDevice.warehouse', 'warehouse', 'posShift', 'shift', 'reconciliations', 'handoverConfirmedBy'])))->response();
    }

    public function confirmHandover(ConfirmPosSessionHandoverRequest $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $confirmed = $this->domain(fn () => $this->sessions->confirmHandover(
            $session,
            $request->user(),
            $request->validated('note'),
        ));

        return (new PosSessionResource($confirmed->load(['posDevice.warehouse', 'warehouse', 'posShift', 'shift', 'reconciliations', 'handoverConfirmedBy'])))->response();
    }

    /** يعيد العد بعد كشف النتيجة فقط، باعتماد منفصل محفوظ في سجل الأدلة. */
    public function recount(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'closing_balance' => ['required', 'integer', 'min:0'],
            'approval_id' => ['required', 'uuid'],
        ]);
        $session = $this->visibleSession($id, $request);
        $recounted = $this->domain(fn () => $this->sessions->recount(
            $session,
            (int) $data['closing_balance'],
            $request->user(),
            $data['approval_id'],
        ));

        return (new PosSessionResource($recounted->load(['posDevice.warehouse', 'warehouse', 'posShift', 'shift'])))->response();
    }

    public function cashMovements(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);

        return PosCashMovementResource::collection(
            $session->cashMovements()->with('recordedBy')->orderBy('created_at')->get()
        )->response();
    }

    public function recordCashMovement(StorePosCashMovementRequest $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $data = $request->validated();
        $movement = $this->domain(fn () => $this->sessions->recordCashMovement(
            $session,
            $data['type'],
            (int) $data['amount'],
            $data['reason'],
            $request->user(),
            $data['approval_id'] ?? null,
        ));

        return (new PosCashMovementResource($movement))->response()->setStatusCode(201);
    }

    /** يحاول الموصل المحلي فقط بعد تحقق RBAC والجلسة؛ لا ينشئ أثراً مالياً. */
    public function openCashDrawer(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:1000'],
            'approval_id' => ['nullable', 'uuid'],
        ]);
        $session = $this->visibleSession($id, $request);
        $result = $this->domain(fn () => $this->cashDrawer->openManually(
            $session,
            $request->user(),
            $data['reason'] ?? null,
            $data['approval_id'] ?? null,
        ));
        $status = $result['status'] === 'opened' ? 200 : ($result['status'] === 'pending' ? 202 : 409);

        return response()->json(['data' => $result], $status);
    }

    public function completeCashDrawer(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'action_id' => ['required', 'uuid'],
            'result' => ['required', 'array', 'max:12'],
        ]);
        $session = $this->visibleSession($id, $request);
        $result = $this->domain(fn () => $this->cashDrawer->complete($session, $request->user(), $data['action_id'], $data['result']));

        return response()->json(['data' => $result], $result['status'] === 'opened' ? 200 : 409);
    }

    public function cashDrawerBridgeUnavailable(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['action_id' => ['required', 'uuid']]);
        $session = $this->visibleSession($id, $request);
        $result = $this->domain(fn () => $this->cashDrawer->markBridgeUnavailable($session, $request->user(), $data['action_id']));

        return response()->json(['data' => $result], 409);
    }

    public function events(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);

        return PosSessionEventResource::collection(
            $session->events()->with('actor')->orderBy('created_at')->get()
        )->response();
    }

    public function acknowledgeDifference(AcknowledgePosSessionDifferenceRequest $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $acknowledged = $this->domain(fn () => $this->sessions->acknowledgeDifference(
            $session,
            $request->validated('note'),
            $request->user(),
        ));

        return (new PosSessionResource($acknowledged->load(['posDevice.warehouse', 'warehouse', 'posShift', 'shift'])))->response();
    }

    public function settleVariance(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $settled = $this->domain(fn () => $this->sessions->settleVariance($session, $request->user()));

        return (new PosSessionResource($settled->load(['posDevice.warehouse', 'warehouse', 'posShift', 'shift'])))->response();
    }

    public function report(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $report = $this->sessions->report($session);

        return response()->json([
            'session' => new PosSessionResource($session->load(['posDevice.warehouse', 'warehouse', 'posShift', 'shift'])),
            'report' => [
                'cash_sales' => Money::toRiyal($report['cash_sales']),
                'cash_refunds' => Money::toRiyal($report['cash_refunds']),
                'cash_in' => Money::toRiyal($report['cash_in']),
                'cash_out' => Money::toRiyal($report['cash_out']),
                'sales_count' => $report['sales_count'],
                'returns_count' => $report['returns_count'],
                'returns_total' => Money::toRiyal($report['returns_total']),
                'net_sales' => Money::toRiyal($report['net_sales']),
                'average' => Money::toRiyal($report['average']),
                'expected' => Money::toRiyal($report['expected']),
            ],
        ]);
    }

    private function visibleSession(string $id, Request $request): PosSession
    {
        return $this->scopeToActiveBranch(PosSession::query(), $request)->findOrFail($id);
    }
}

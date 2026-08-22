<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\AcknowledgePosSessionDifferenceRequest;
use App\Http\Requests\OpenPosSessionRequest;
use App\Http\Requests\StorePosCashMovementRequest;
use App\Http\Resources\PosCashMovementResource;
use App\Http\Resources\PosSessionEventResource;
use App\Http\Resources\PosSessionResource;
use App\Models\PosSession;
use App\Services\Accounting\PosSessionService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PosSessionController extends ApiController
{
    public function __construct(protected PosSessionService $sessions) {}

    public function index(Request $request): JsonResponse
    {
        $query = PosSession::with(['posDevice.warehouse', 'warehouse', 'shift'])->orderByDesc('opened_at');
        if ($request->boolean('mine')) {
            $query->where('opened_by', $request->user()?->id);
        }

        return PosSessionResource::collection($this->scopeToActiveBranch($query, $request)->get())->response();
    }

    public function open(OpenPosSessionRequest $request): JsonResponse
    {
        $data = $request->validated();
        $session = $this->domain(fn () => $this->sessions->open(
            (int) $data['opening_balance'],
            $data['pos_device_id'],
            $data['shift_id'] ?? null,
            $request->user()?->id,
            $request->user(),
        ));

        return (new PosSessionResource($session->load(['posDevice.warehouse', 'warehouse', 'shift'])))
            ->response()->setStatusCode(201);
    }

    public function close(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['closing_balance' => ['required', 'integer', 'min:0']]); // هللات
        $session = $this->visibleSession($id, $request);
        $closed = $this->domain(fn () => $this->sessions->close($session, (int) $data['closing_balance'], $request->user()?->id));

        return (new PosSessionResource($closed->load(['posDevice.warehouse', 'warehouse', 'shift'])))->response();
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
        ));

        return (new PosCashMovementResource($movement))->response()->setStatusCode(201);
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

        return (new PosSessionResource($acknowledged->load(['posDevice.warehouse', 'warehouse', 'shift'])))->response();
    }

    /** تقرير الوردية (X/Z): نقد البيع + حركات الدرج + المتوقّع + المطابقة. */
    public function report(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $report = $this->sessions->report($session);

        return response()->json([
            'session' => new PosSessionResource($session->load(['posDevice.warehouse', 'warehouse', 'shift'])),
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

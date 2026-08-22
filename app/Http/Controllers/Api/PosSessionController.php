<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\OpenPosSessionRequest;
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

        $sessions = $this->scopeToActiveBranch($query, $request)->get();

        return PosSessionResource::collection($sessions)->response();
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
        $data = $request->validate([
            'closing_balance' => ['required', 'integer', 'min:0'], // هللات
        ]);

        $session = $this->visibleSession($id, $request);
        $closed = $this->domain(fn () => $this->sessions->close(
            $session,
            (int) $data['closing_balance'],
            $request->user()?->id,
        ));

        return (new PosSessionResource($closed->load(['posDevice.warehouse', 'warehouse', 'shift'])))->response();
    }

    /** تقرير الوردية (X/Z): مبيعات نقدية + متوقّع + مطابقة. */
    public function report(Request $request, string $id): JsonResponse
    {
        $session = $this->visibleSession($id, $request);
        $r = $this->sessions->report($session);

        return response()->json([
            'session' => new PosSessionResource($session->load(['posDevice.warehouse', 'warehouse', 'shift'])),
            'report'  => [
                'cash_sales'  => Money::toRiyal($r['cash_sales']),
                'sales_count' => $r['sales_count'],
                'average'     => Money::toRiyal($r['average']),
                'expected'    => Money::toRiyal($r['expected']),
            ],
        ]);
    }

    private function visibleSession(string $id, Request $request): PosSession
    {
        return $this->scopeToActiveBranch(PosSession::query(), $request)->findOrFail($id);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ApproveFuelShiftRequest;
use App\Http\Requests\AssignFuelShiftStaffRequest;
use App\Http\Requests\CloseFuelShiftRequest;
use App\Http\Requests\OpenFuelShiftRequest;
use App\Http\Requests\RequestFuelShiftCorrectionRequest;
use App\Http\Requests\ReviewFuelShiftCashVarianceRequest;
use App\Http\Requests\StoreFuelShiftCashMovementRequest;
use App\Http\Requests\StoreFuelShiftMeterReadingRequest;
use App\Http\Requests\StoreFuelShiftTankReadingRequest;
use App\Http\Resources\FuelShiftResource;
use App\Models\FuelShift;
use App\Services\FuelShiftService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FuelShiftController extends ApiController
{
    public function __construct(private FuelShiftService $service) {}

    public function index(Request $request): JsonResponse
    {
        $query = FuelShift::query()->with('cashVariance')->orderByDesc('opened_at');
        if ($request->filled('station_id')) {
            $query->where('fuel_station_id', $request->query('station_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }
        if ($request->boolean('mine')) {
            $query->where('opened_by', $request->user()?->id);
        }

        return FuelShiftResource::collection($this->scopeToActiveBranch($query, $request)->paginate(50))->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new FuelShiftResource($this->present($this->visibleShift($id, $request))))->response();
    }

    public function open(OpenFuelShiftRequest $request): JsonResponse
    {
        $shift = $this->domain(fn () => $this->service->open($request->validated(), $request->user()));

        return (new FuelShiftResource($this->present($shift)))->response()->setStatusCode(201);
    }

    public function assignStaff(AssignFuelShiftStaffRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $data = $request->validated();
        $this->domain(fn () => $this->service->assignStaff($shift, $data['user_id'], $data['role'], $request->user()));

        return (new FuelShiftResource($this->present($shift->fresh())))->response()->setStatusCode(201);
    }

    public function recordMeter(StoreFuelShiftMeterReadingRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $this->domain(fn () => $this->service->recordMeter($shift, $request->validated(), $request->user()));

        return (new FuelShiftResource($this->present($shift->fresh())))->response()->setStatusCode(201);
    }

    public function recordTank(StoreFuelShiftTankReadingRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $this->domain(fn () => $this->service->recordTank($shift, $request->validated(), $request->user()));

        return (new FuelShiftResource($this->present($shift->fresh())))->response()->setStatusCode(201);
    }

    public function recordCashMovement(StoreFuelShiftCashMovementRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $this->domain(fn () => $this->service->recordCashMovement($shift, $request->validated(), $request->user()));

        return (new FuelShiftResource($this->present($shift->fresh())))->response()->setStatusCode(201);
    }

    public function close(CloseFuelShiftRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $data = $request->validated();
        $closed = $this->domain(fn () => $this->service->close(
            $shift,
            (int) $data['counted_cash_minor'],
            $data['closing_note'] ?? null,
            $request->user(),
        ));

        return (new FuelShiftResource($this->present($closed)))->response();
    }

    public function approve(ApproveFuelShiftRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $approved = $this->domain(fn () => $this->service->approve($shift, $request->validated('note'), $request->user()));

        return (new FuelShiftResource($this->present($approved)))->response();
    }

    public function reviewCashVariance(ReviewFuelShiftCashVarianceRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $this->domain(fn () => $this->service->reviewCashVariance($shift, $request->validated('note'), $request->user()));

        return (new FuelShiftResource($this->present($shift->fresh())))->response();
    }

    public function requestCorrection(RequestFuelShiftCorrectionRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        $this->domain(fn () => $this->service->requestCorrection($shift, $request->validated(), $request->user()));

        return (new FuelShiftResource($this->present($shift->fresh())))->response()->setStatusCode(201);
    }

    private function visibleShift(string $id, Request $request): FuelShift
    {
        return $this->scopeToActiveBranch(FuelShift::query(), $request)->findOrFail($id);
    }

    private function present(FuelShift $shift): FuelShift
    {
        return $shift->load([
            'cashVariance', 'staffAssignments', 'meterReadings', 'tankReadings', 'cashMovements', 'events', 'corrections',
        ]);
    }
}

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

/**
 * #2014 — كل مسار وردية يمرّ بحارس نطاق المحطة (فرع + مخزن) على الخادم قبل أي أثر جانبي:
 * `FuelShift` BranchScoped (فرع فقط) و`FuelStation` CompanyWide، فبلا `AuthorizesFuelStationScope` كان
 * مستخدم مقيَّد بمخزن/محطة يفتح ويقرأ ويكتب على وردية محطة أخرى من الفرع نفسه بمجرد معرفة المعرّف.
 * الرفض 404 موحّد (لا يُميَّز «ممنوع» عن «غير موجود»)، وغير المقيَّد لا يتأثر إطلاقاً.
 */
class FuelShiftController extends ApiController
{
    use AuthorizesFuelStationScope;

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

        $this->restrictToAccessibleStations($query);

        return FuelShiftResource::collection($this->scopeToActiveBranch($query, $request)->paginate(50))->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new FuelShiftResource($this->present($this->visibleShift($id, $request))))->response();
    }

    public function open(OpenFuelShiftRequest $request): JsonResponse
    {
        // قبل الخدمة: محطة خارج فرع/مخزن المستخدم = 404 (حتى لو مرّر معرّفاً صحيحاً أو X-Branch-Id).
        $this->accessibleStation($request->validated()['fuel_station_id']);
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

    /** الوردية في فروع المستخدم **و** محطتها ضمن فرعه/مخزنه — وإلا 404 قبل أي قراءة أو كتابة. */
    private function visibleShift(string $id, Request $request): FuelShift
    {
        $shift = $this->scopeToActiveBranch(FuelShift::query(), $request)->findOrFail($id);
        $this->accessibleStation($shift->fuel_station_id);

        return $shift;
    }

    private function present(FuelShift $shift): FuelShift
    {
        return $shift->load([
            'cashVariance', 'staffAssignments', 'meterReadings', 'tankReadings', 'cashMovements', 'events', 'corrections',
        ]);
    }
}

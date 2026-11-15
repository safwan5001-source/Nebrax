<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ReviewFuelShiftMeterVarianceRequest;
use App\Models\FuelShift;
use App\Services\FuelShiftMeterReconciliationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * مطابقة قراءات الفوهات عند إغلاق الوردية ومراجعة فروقها (TANKER-PR8) — **تشغيلية بحتة (لا قيد ولا مخزون ولا فاتورة ولا تحصيل)**.
 * **الإتاحة (TANKER-PR8-S):** تُتاح المسارات لوردية لها لقطات مجمَّدة (قراءة ومراجعة) **حتى بعد تعطيل الإعداد أو إغلاق بوابة النشر** — مسار إكمال المراجعة؛ ولوردية بلا لقطات
 * فقط إن كانت المطابقة فعّالة الآن (بوابة النشر **و**الإعداد). غير ذلك ⇒ 404. نطاق المحطة (فرع + مخزن) على الخادم قبل أي قراءة أو كتابة، 404 موحَّد.
 * القراءة `fuel.shift.view`، المراجعة `fuel.shift.meter_variance_review` (مستقلة عن `cash_variance_review`).
 */
class FuelShiftMeterReconciliationController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelShiftMeterReconciliationService $service) {}

    public function show(Request $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        abort_unless($this->service->accessibleFor($shift), 404);

        return response()->json(['data' => $this->service->view($shift, $request->user())]);
    }

    public function review(ReviewFuelShiftMeterVarianceRequest $request, string $id): JsonResponse
    {
        $shift = $this->visibleShift($id, $request);
        abort_unless($this->service->accessibleFor($shift), 404);
        $data = $request->validated();
        $this->domain(fn () => $this->service->review($shift, $data['nozzle_id'], $data['classification'], $data['note'] ?? null, $request->user()));

        return response()->json(['data' => $this->service->view($shift->fresh(), $request->user())]);
    }

    /** الوردية في فروع المستخدم **و** محطتها ضمن فرعه/مخزنه — وإلا 404 قبل أي قراءة أو كتابة. */
    private function visibleShift(string $id, Request $request): FuelShift
    {
        $shift = $this->scopeToActiveBranch(FuelShift::query(), $request)->findOrFail($id);
        $this->accessibleStation($shift->fuel_station_id);

        return $shift;
    }
}

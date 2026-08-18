<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreShiftRequest;
use App\Http\Resources\ShiftResource;
use App\Models\Branch;
use App\Models\Shift;
use Illuminate\Http\JsonResponse;

/**
 * ورديات العمل — CRUD تحت صلاحيات الموارد البشرية.
 * Shift مشترَكة على مستوى المؤسسة (CompanyWide)، فلا تصفية فرعٍ على القائمة.
 */
class ShiftController extends ApiController
{
    public function index(): JsonResponse
    {
        return ShiftResource::collection(Shift::orderBy('name')->get())->response();
    }

    public function store(StoreShiftRequest $request): JsonResponse
    {
        $data = $request->validated();
        // الفرع وسمٌ وصفي، لكن يجب أن يخصّ المستأجر (تصدّ حقن معرّف فرعٍ آخر).
        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');

        $shift = Shift::create($this->payload($data));

        return (new ShiftResource($shift))->response()->setStatusCode(201);
    }

    public function update(StoreShiftRequest $request, string $id): JsonResponse
    {
        $shift = Shift::findOrFail($id);
        $data = $request->validated();
        $this->assertTenantOwned(Branch::class, $data['branch_id'] ?? null, 'الفرع');

        $shift->update($this->payload($data));

        return (new ShiftResource($shift))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Shift::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /** جسم مطبَّع: أيام العمل فريدة ومرتَّبة، والفرع صريح (يُبقى null إن غاب). */
    private function payload(array $data): array
    {
        $days = array_values(array_unique(array_map('intval', $data['work_days'])));
        sort($days);

        return [
            'branch_id'     => $data['branch_id'] ?? null,
            'name'          => $data['name'],
            'start_time'    => $data['start_time'],
            'end_time'      => $data['end_time'],
            'break_minutes' => (int) ($data['break_minutes'] ?? 0),
            'work_days'     => $days,
            'is_active'     => $data['is_active'] ?? true,
        ];
    }
}

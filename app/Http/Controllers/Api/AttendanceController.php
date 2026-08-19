<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreAttendanceRequest;
use App\Http\Resources\AttendanceResource;
use App\Models\Attendance;
use App\Models\Employee;
use App\Models\Shift;
use App\Tenancy\BranchContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * الحضور والانصراف — CRUD تحت صلاحيات الموارد البشرية.
 * Attendance مصنَّفة BranchScoped: القائمة تُعزل بالفرع النشط تلقائياً.
 */
class AttendanceController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $query = Attendance::with(['employee', 'shift'])->latest('attendance_date');

        // تصفية اختيارية بالتاريخ والموظف — للوحة الحضور اليومية.
        if ($date = $request->query('date')) {
            $query->whereDate('attendance_date', $date);
        }
        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return AttendanceResource::collection($query->get())->response();
    }

    public function store(StoreAttendanceRequest $request): JsonResponse
    {
        $data = $this->validatedRefs($request);
        $this->assertNoDuplicate($data['employee_id'], $data['attendance_date']);

        $attendance = Attendance::create($data);

        return (new AttendanceResource($attendance->load(['employee', 'shift'])))
            ->response()->setStatusCode(201);
    }

    public function update(StoreAttendanceRequest $request, string $id): JsonResponse
    {
        $attendance = Attendance::findOrFail($id);
        $data = $this->validatedRefs($request);
        $this->assertNoDuplicate($data['employee_id'], $data['attendance_date'], $id);

        $attendance->update($data);

        return (new AttendanceResource($attendance->load(['employee', 'shift'])))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Attendance::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    /**
     * تحقّق ملكية المراجع داخل المستأجر (الموظف مركزي، والوردية معزولة بالفرع
     * فتُتحقَّق بلا Scope) وإعادة الحمولة النظيفة.
     */
    private function validatedRefs(StoreAttendanceRequest $request): array
    {
        $data = $request->validated();
        $this->assertTenantOwned(Employee::class, $data['employee_id'], 'الموظف');
        // الوردية BranchScoped: نتحقّق من ملكيتها للمستأجر خارج عزل الفرع، فسجلٌّ
        // من فرعٍ آخر يخصّ المستأجر يبقى مرجعاً صحيحاً.
        if (! empty($data['shift_id']) && ! Shift::withoutGlobalScope(\App\Tenancy\BranchScope::class)->whereKey($data['shift_id'])->exists()) {
            abort(422, 'الوردية غير موجودة.');
        }

        return $data;
    }

    /**
     * سجلٌّ واحد لكل موظفٍ في اليوم ضمن الفرع النشط — يُرجع 422 واضحاً بدل أن
     * ينفجر القيد الفريد بخطأ قاعدة خام.
     */
    private function assertNoDuplicate(string $employeeId, string $date, ?string $exceptId = null): void
    {
        $exists = Attendance::where('employee_id', $employeeId)
            ->whereDate('attendance_date', $date)
            ->when($exceptId, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();

        if ($exists) {
            abort(422, 'يوجد سجلّ حضورٍ لهذا الموظف في هذا التاريخ.');
        }
    }
}

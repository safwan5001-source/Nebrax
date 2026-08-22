<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\AttendanceResource;
use App\Http\Resources\ContractResource;
use App\Http\Resources\EmployeeResource;
use App\Http\Resources\PayrollItemResource;
use App\Models\Attendance;
use App\Models\Employee;
use App\Models\PayrollItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * بوابة الخدمة الذاتية للموظف (`/me/*`) — تصميمٌ نبراكسي أصيل: دورٌ مقيَّد
 * ضمن RBAC القائم (`self_service.access`)، لا مسار دخولٍ منفصل بلا حساب.
 *
 * **الضمان البنيوي الوحيد الذي تقوم عليه هذه البوابة كلها:** كل استعلامٍ هنا
 * يُقيَّد بـ `employee_id` المشتقّ حصراً من `$request->user()->employee_id`
 * — لا من أي معرّفٍ يصل عبر الرابط أو الجسم. فتسريب بيانات موظفٍ آخر يستلزم
 * تعديل هذا الملف نفسه، لا خطأ إدخال من العميل.
 *
 * لا تُستخدم صلاحيات `hr.*` هنا: تلك تفتح كل سجلّات المؤسسة (بلا عزل صفّي)،
 * فمنحها لدورٍ ذاتيٍّ يُسرّب بيانات كل الموظفين. انظر
 * design-system/foundations/hr-users-architecture.md.
 */
class SelfServiceController extends ApiController
{
    /** سجلّ الموظف المرتبط بالحساب الحالي، أو 403 إن لم يوجد ربط. */
    private function employee(Request $request): Employee
    {
        $employeeId = $request->user()->employee_id;

        if (! $employeeId) {
            abort(403, 'هذا الحساب غير مرتبط بسجلّ موظف.');
        }

        return Employee::with(['jobTitle', 'department', 'jobLevel', 'employmentType', 'manager'])
            ->findOrFail($employeeId);
    }

    public function profile(Request $request): JsonResponse
    {
        return (new EmployeeResource($this->employee($request)))->response();
    }

    /** العقد النشط اليوم — مصدر الحقيقة لراتب الموظف (لا حقول Employee الثابتة). */
    public function contract(Request $request): JsonResponse
    {
        $employee = $this->employee($request);
        $contract = $employee->activeContract();

        if (! $contract) {
            return response()->json(['data' => null]);
        }

        return (new ContractResource($contract->load('items')))->response();
    }

    /** بنود مسيّرات الرواتب المُرحَّلة أو المصروفة لهذا الموظف فقط — لا المسوّدات. */
    public function payrollItems(Request $request): JsonResponse
    {
        $employee = $this->employee($request);

        $items = PayrollItem::with('run')
            ->where('employee_id', $employee->id)
            ->whereHas('run', fn ($q) => $q->whereIn('status', ['posted', 'paid']))
            ->get()
            ->sortByDesc(fn (PayrollItem $item) => $item->run?->period_start)
            ->values();

        // معلومات المسيّر مضمَّنة مباشرةً في كل بند — لا مصفوفة منفصلة يُربَط
        // معها بالترتيب (هشّ)، فكل بندٍ يحمل مسيّره صراحةً.
        $data = $items->map(fn (PayrollItem $item) => array_merge(
            (new PayrollItemResource($item))->toArray($request),
            ['run' => $item->run ? [
                'id' => $item->run->id, 'period' => $item->run->period,
                'period_start' => optional($item->run->period_start)->toDateString(),
                'period_end' => optional($item->run->period_end)->toDateString(),
                'status' => $item->run->status,
                'paid_at' => optional($item->run->paid_at)->toIso8601String(),
            ] : null]
        ));

        return response()->json(['data' => $data]);
    }

    /** سجلّات حضور هذا الموظف، اختيارياً مصفّاة بشهر (`?month=YYYY-MM`). */
    public function attendances(Request $request): JsonResponse
    {
        $employee = $this->employee($request);

        $query = Attendance::withoutGlobalScope(\App\Tenancy\BranchScope::class)
            ->with('shift')
            ->where('employee_id', $employee->id)
            ->latest('attendance_date');

        if ($month = $request->query('month')) {
            $query->where('attendance_date', 'like', $month . '%');
        }

        return AttendanceResource::collection($query->limit(93)->get())->response();
    }

    /** تسجيل حضور اليوم — وسمٌ تلقائي بفرع الموظف (مكان عمله)، لا اختيار العميل. */
    public function checkIn(Request $request): JsonResponse
    {
        $employee = $this->employee($request);
        $today = now()->toDateString();

        $attendance = Attendance::withoutGlobalScope(\App\Tenancy\BranchScope::class)
            ->where('employee_id', $employee->id)
            ->whereDate('attendance_date', $today)
            ->first();

        if ($attendance && $attendance->check_in) {
            abort(422, 'سُجِّل حضورك اليوم بالفعل.');
        }

        if (! $attendance) {
            $attendance = new Attendance([
                'employee_id'      => $employee->id,
                'branch_id'        => $employee->branch_id,
                'shift_id'         => $employee->shift_id,
                'attendance_date'  => $today,
            ]);
        }

        $attendance->check_in = now()->toTimeString();
        $attendance->status = 'present';
        $attendance->save();

        return (new AttendanceResource($attendance->load('shift')))->response();
    }

    /** تسجيل انصراف اليوم — يتطلّب تسجيل حضورٍ سابق في نفس اليوم. */
    public function checkOut(Request $request): JsonResponse
    {
        $employee = $this->employee($request);
        $today = now()->toDateString();

        $attendance = Attendance::withoutGlobalScope(\App\Tenancy\BranchScope::class)
            ->where('employee_id', $employee->id)
            ->whereDate('attendance_date', $today)
            ->first();

        if (! $attendance || ! $attendance->check_in) {
            abort(422, 'لم تُسجِّل حضورك اليوم بعد.');
        }

        if ($attendance->check_out) {
            abort(422, 'سُجِّل انصرافك اليوم بالفعل.');
        }

        $attendance->check_out = now()->toTimeString();
        $attendance->save();

        return (new AttendanceResource($attendance->load('shift')))->response();
    }
}

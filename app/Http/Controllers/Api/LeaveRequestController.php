<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\RejectLeaveRequestRequest;
use App\Http\Resources\LeaveRequestResource;
use App\Models\LeaveRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * قائمة طلبات الإجازة عبر كل الموظفين (طابور الموافقة) + إجراءات
 * الموافقة/الرفض. الإنشاء والفهرسة لموظفٍ واحد في `EmployeeController`
 * (نفس نمط `contracts`/`attachments` المتداخل تحت الموظف).
 */
class LeaveRequestController extends ApiController
{
    /** تصفية اختيارية بالحالة (`?status=pending`) و/أو موظفٍ واحد (`?employee_id=`). */
    public function index(Request $request): JsonResponse
    {
        $query = LeaveRequest::with(['employee', 'leaveType', 'approver'])->latest('start_date');

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return LeaveRequestResource::collection($query->get())->response();
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $leaveRequest = LeaveRequest::findOrFail($id);
        if (! $leaveRequest->isPending()) {
            abort(422, 'لا يمكن الموافقة إلا على طلبٍ قيد الانتظار.');
        }

        $leaveRequest->update([
            'status'      => 'approved',
            'approved_by' => $request->user()?->id,
            'approved_at' => now(),
        ]);

        return (new LeaveRequestResource($leaveRequest->load(['employee', 'leaveType', 'approver'])))->response();
    }

    public function reject(RejectLeaveRequestRequest $request, string $id): JsonResponse
    {
        $leaveRequest = LeaveRequest::findOrFail($id);
        if (! $leaveRequest->isPending()) {
            abort(422, 'لا يمكن الرفض إلا لطلبٍ قيد الانتظار.');
        }

        $leaveRequest->update([
            'status'            => 'rejected',
            'rejection_reason'  => $request->validated('rejection_reason'),
            'approved_by'       => $request->user()?->id,
            'approved_at'       => now(),
        ]);

        return (new LeaveRequestResource($leaveRequest->load(['employee', 'leaveType', 'approver'])))->response();
    }

    /** إلغاء طلبٍ قيد الانتظار فقط — طلبٌ اتُّخذ قراره لا يُحذف، يبقى للأثر الرجعي. */
    public function destroy(string $id): JsonResponse
    {
        $leaveRequest = LeaveRequest::findOrFail($id);
        if (! $leaveRequest->isPending()) {
            abort(422, 'لا يمكن إلغاء إلا طلبٍ قيد الانتظار.');
        }

        $leaveRequest->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}

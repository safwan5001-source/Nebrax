<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\RejectEmployeeRequestRequest;
use App\Http\Resources\EmployeeRequestResource;
use App\Models\EmployeeRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * قائمة الطلبات العامة عبر كل الموظفين (طابور الموافقة) + إجراءات
 * الموافقة/الرفض. الإنشاء والفهرسة لموظفٍ واحد في `EmployeeController`
 * (نفس نمط `leave-requests`/`contracts` المتداخل تحت الموظف).
 */
class EmployeeRequestController extends ApiController
{
    /** تصفية اختيارية بالحالة (`?status=pending`) و/أو موظفٍ واحد (`?employee_id=`). */
    public function index(Request $request): JsonResponse
    {
        $query = EmployeeRequest::with(['employee', 'requestType', 'approver'])->latest();

        if ($status = $request->query('status')) {
            $query->where('status', $status);
        }
        if ($employeeId = $request->query('employee_id')) {
            $query->where('employee_id', $employeeId);
        }

        return EmployeeRequestResource::collection($query->get())->response();
    }

    public function approve(Request $request, string $id): JsonResponse
    {
        $employeeRequest = EmployeeRequest::findOrFail($id);
        if (! $employeeRequest->isPending()) {
            abort(422, 'لا يمكن الموافقة إلا على طلبٍ قيد الانتظار.');
        }

        $employeeRequest->update([
            'status'      => 'approved',
            'approved_by' => $request->user()?->id,
            'approved_at' => now(),
        ]);

        return (new EmployeeRequestResource($employeeRequest->load(['employee', 'requestType', 'approver'])))->response();
    }

    public function reject(RejectEmployeeRequestRequest $request, string $id): JsonResponse
    {
        $employeeRequest = EmployeeRequest::findOrFail($id);
        if (! $employeeRequest->isPending()) {
            abort(422, 'لا يمكن الرفض إلا لطلبٍ قيد الانتظار.');
        }

        $employeeRequest->update([
            'status'           => 'rejected',
            'rejection_reason' => $request->validated('rejection_reason'),
            'approved_by'      => $request->user()?->id,
            'approved_at'      => now(),
        ]);

        return (new EmployeeRequestResource($employeeRequest->load(['employee', 'requestType', 'approver'])))->response();
    }

    /** إلغاء طلبٍ قيد الانتظار فقط — طلبٌ اتُّخذ قراره لا يُحذف، يبقى للأثر الرجعي. */
    public function destroy(string $id): JsonResponse
    {
        $employeeRequest = EmployeeRequest::findOrFail($id);
        if (! $employeeRequest->isPending()) {
            abort(422, 'لا يمكن إلغاء إلا طلبٍ قيد الانتظار.');
        }

        $employeeRequest->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}

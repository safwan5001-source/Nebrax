<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreLeaveTypeRequest;
use App\Http\Resources\LeaveTypeResource;
use App\Models\LeaveType;
use Illuminate\Http\JsonResponse;

/**
 * أنواع الإجازات — كيانٌ مُدار لكل مؤسسة، بلا أثرٍ محاسبي مباشر.
 */
class LeaveTypeController extends ApiController
{
    public function index(): JsonResponse
    {
        return LeaveTypeResource::collection(
            LeaveType::withCount('leaveRequests')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreLeaveTypeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $leaveType = LeaveType::create($data);

        return (new LeaveTypeResource($leaveType))->response()->setStatusCode(201);
    }

    public function update(StoreLeaveTypeRequest $request, string $id): JsonResponse
    {
        $leaveType = LeaveType::findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $leaveType->id);

        $leaveType->update($data);

        return (new LeaveTypeResource($leaveType))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $leaveType = LeaveType::withCount('leaveRequests')->findOrFail($id);

        if ($leaveType->leave_requests_count > 0) {
            abort(422, "لا يمكن حذف نوع الإجازة: مرتبطٌ بـ {$leaveType->leave_requests_count} طلباً.");
        }

        $leaveType->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = LeaveType::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد نوع إجازة بهذا الاسم.');
        }
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreDepartmentRequest;
use App\Http\Resources\DepartmentResource;
use App\Models\Department;
use Illuminate\Http\JsonResponse;

/**
 * الأقسام — جزءٌ من الهيكل التنظيمي، بلا أثرٍ محاسبي مباشر.
 */
class DepartmentController extends ApiController
{
    public function index(): JsonResponse
    {
        return DepartmentResource::collection(
            Department::withCount('employees')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreDepartmentRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $department = Department::create([
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new DepartmentResource($department))->response()->setStatusCode(201);
    }

    public function update(StoreDepartmentRequest $request, string $id): JsonResponse
    {
        $department = Department::findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $department->id);

        $department->update([
            'name'      => $data['name'],
            'is_active' => array_key_exists('is_active', $data) ? $data['is_active'] : $department->is_active,
        ]);

        return (new DepartmentResource($department))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $department = Department::withCount('employees')->findOrFail($id);

        if ($department->employees_count > 0) {
            abort(422, "لا يمكن حذف القسم: مرتبطٌ بـ {$department->employees_count} موظفاً.");
        }

        $department->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = Department::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد قسم بهذا الاسم.');
        }
    }
}

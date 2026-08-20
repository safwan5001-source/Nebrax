<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreEmploymentTypeRequest;
use App\Http\Resources\EmploymentTypeResource;
use App\Models\EmploymentType;
use Illuminate\Http\JsonResponse;

/**
 * أنواع التوظيف — جزءٌ من الهيكل التنظيمي، بلا أثرٍ محاسبي مباشر.
 */
class EmploymentTypeController extends ApiController
{
    public function index(): JsonResponse
    {
        return EmploymentTypeResource::collection(
            EmploymentType::withCount('employees')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreEmploymentTypeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $employmentType = EmploymentType::create([
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new EmploymentTypeResource($employmentType))->response()->setStatusCode(201);
    }

    public function update(StoreEmploymentTypeRequest $request, string $id): JsonResponse
    {
        $employmentType = EmploymentType::findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $employmentType->id);

        $employmentType->update([
            'name'      => $data['name'],
            'is_active' => array_key_exists('is_active', $data) ? $data['is_active'] : $employmentType->is_active,
        ]);

        return (new EmploymentTypeResource($employmentType))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $employmentType = EmploymentType::withCount('employees')->findOrFail($id);

        if ($employmentType->employees_count > 0) {
            abort(422, "لا يمكن حذف نوع التوظيف: مرتبطٌ بـ {$employmentType->employees_count} موظفاً.");
        }

        $employmentType->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = EmploymentType::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد نوع توظيف بهذا الاسم.');
        }
    }
}

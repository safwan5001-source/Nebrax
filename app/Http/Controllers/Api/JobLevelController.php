<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreJobLevelRequest;
use App\Http\Resources\JobLevelResource;
use App\Models\JobLevel;
use Illuminate\Http\JsonResponse;

/**
 * المستويات الوظيفية — جزءٌ من الهيكل التنظيمي، بلا أثرٍ محاسبي مباشر.
 */
class JobLevelController extends ApiController
{
    public function index(): JsonResponse
    {
        return JobLevelResource::collection(
            JobLevel::withCount('employees')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreJobLevelRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $jobLevel = JobLevel::create([
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new JobLevelResource($jobLevel))->response()->setStatusCode(201);
    }

    public function update(StoreJobLevelRequest $request, string $id): JsonResponse
    {
        $jobLevel = JobLevel::findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $jobLevel->id);

        $jobLevel->update([
            'name'      => $data['name'],
            'is_active' => array_key_exists('is_active', $data) ? $data['is_active'] : $jobLevel->is_active,
        ]);

        return (new JobLevelResource($jobLevel))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $jobLevel = JobLevel::withCount('employees')->findOrFail($id);

        if ($jobLevel->employees_count > 0) {
            abort(422, "لا يمكن حذف المستوى الوظيفي: مرتبطٌ بـ {$jobLevel->employees_count} موظفاً.");
        }

        $jobLevel->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = JobLevel::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد مستوى وظيفي بهذا الاسم.');
        }
    }
}

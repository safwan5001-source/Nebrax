<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreJobTitleRequest;
use App\Http\Resources\JobTitleResource;
use App\Models\JobTitle;
use Illuminate\Http\JsonResponse;

/**
 * المسميات الوظيفية — جزءٌ من الهيكل التنظيمي، بلا أثرٍ محاسبي مباشر.
 */
class JobTitleController extends ApiController
{
    public function index(): JsonResponse
    {
        return JobTitleResource::collection(
            JobTitle::withCount('employees')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreJobTitleRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $jobTitle = JobTitle::create([
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new JobTitleResource($jobTitle))->response()->setStatusCode(201);
    }

    public function update(StoreJobTitleRequest $request, string $id): JsonResponse
    {
        $jobTitle = JobTitle::findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $jobTitle->id);

        $jobTitle->update([
            'name'      => $data['name'],
            'is_active' => array_key_exists('is_active', $data) ? $data['is_active'] : $jobTitle->is_active,
        ]);

        return (new JobTitleResource($jobTitle))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $jobTitle = JobTitle::withCount('employees')->findOrFail($id);

        if ($jobTitle->employees_count > 0) {
            abort(422, "لا يمكن حذف المسمى الوظيفي: مرتبطٌ بـ {$jobTitle->employees_count} موظفاً.");
        }

        $jobTitle->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = JobTitle::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد مسمى وظيفي بهذا الاسم.');
        }
    }
}

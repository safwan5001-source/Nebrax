<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreExpenseCategoryRequest;
use App\Http\Resources\ExpenseCategoryResource;
use App\Models\ExpenseCategory;
use Illuminate\Http\JsonResponse;

/**
 * تصنيفات المصروفات قائمة تشغيلية مضبوطة؛ أثرها التحليل والتصفية فقط.
 * الحساب المدين المختار في سند المصروف يظل مصدر الأثر المحاسبي.
 */
class ExpenseCategoryController extends ApiController
{
    public function index(): JsonResponse
    {
        return ExpenseCategoryResource::collection(
            ExpenseCategory::withCount('expenses')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreExpenseCategoryRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $category = ExpenseCategory::create([
            'name'        => $data['name'],
            'description' => $data['description'] ?? null,
            'is_active'   => $data['is_active'] ?? true,
        ]);

        return (new ExpenseCategoryResource($category))->response()->setStatusCode(201);
    }

    public function update(StoreExpenseCategoryRequest $request, string $id): JsonResponse
    {
        $category = ExpenseCategory::findOrFail($id);
        $data = $request->validated();
        $this->assertNameFree($data['name'], $category->id);

        $category->update([
            'name'        => $data['name'],
            'description' => array_key_exists('description', $data) ? $data['description'] : $category->description,
            'is_active'   => array_key_exists('is_active', $data) ? $data['is_active'] : $category->is_active,
        ]);

        return (new ExpenseCategoryResource($category))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $category = ExpenseCategory::withCount('expenses')->findOrFail($id);

        if ($category->expenses_count > 0) {
            abort(422, "لا يمكن حذف التصنيف: مرتبط بـ {$category->expenses_count} مصروفاً.");
        }

        $category->delete();

        return response()->json(['message' => 'deleted']);
    }

    /** الاسم فريد ضمن تصنيفات الفرع التي يراها المستخدم، لا على مستوى كل المستأجر. */
    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = ExpenseCategory::query()->where('name', $name);

        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد تصنيف مصروف بهذا الاسم.');
        }
    }
}

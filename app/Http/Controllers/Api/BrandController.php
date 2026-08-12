<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreBrandRequest;
use App\Http\Resources\BrandResource;
use App\Models\Brand;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;

/**
 * العلامات التجارية — قائمة مسطّحة مُدارة تحلّ محلّ النصّ الحرّ في
 * `products.brand`. **لا أثر محاسبي.**
 */
class BrandController extends ApiController
{
    public function index(): JsonResponse
    {
        return BrandResource::collection(
            Brand::withCount('products')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreBrandRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertNameFree($data['name']);

        $brand = Brand::create([
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new BrandResource($brand))->response()->setStatusCode(201);
    }

    public function update(StoreBrandRequest $request, string $id): JsonResponse
    {
        $brand = Brand::findOrFail($id);
        $data  = $request->validated();
        $this->assertNameFree($data['name'], $brand->id);

        $brand->update([
            'name'      => $data['name'],
            'is_active' => $data['is_active'] ?? $brand->is_active,
        ]);

        return (new BrandResource($brand))->response();
    }

    /** كالتصنيف: الحذف الناعم لا يُصفّر `products.brand_id`، فيُمنع ما دامت مستعمَلة. */
    public function destroy(string $id): JsonResponse
    {
        $brand = Brand::withCount('products')->findOrFail($id);

        if ($brand->products_count > 0) {
            abort(422, "لا يمكن حذف العلامة التجارية: مرتبطة بـ {$brand->products_count} منتجاً.");
        }

        $brand->delete();

        return response()->json(['message' => 'deleted']);
    }

    /**
     * التفرّد على مستوى المؤسسة لا الفرع النشط — وإلا مرّ اسمٌ مكرَّر من فرع
     * آخر ثم ظهرت علامتان بالاسم نفسه في قائمة مشتركة.
     */
    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = BranchScope::reference(Brand::class)->where('name', $name);

        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد علامة تجارية بهذا الاسم.');
        }
    }
}

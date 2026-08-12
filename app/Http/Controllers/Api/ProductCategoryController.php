<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreProductCategoryRequest;
use App\Http\Resources\ProductCategoryResource;
use App\Models\ProductCategory;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;

/**
 * تصنيفات المنتجات — قائمة مُدارة متعدّدة المستويات تحلّ محلّ النصّ الحرّ.
 *
 * **لا أثر محاسبي:** لا حساب يرتبط بالتصنيف ولا قيد يُولَّد منه. أثره تجميعٌ
 * وتصفية في القوائم والتقارير.
 */
class ProductCategoryController extends ApiController
{
    /** القائمة مسطّحة بـ `parent_id` — الشجرة تُبنى في العرض، لا في الاستعلام. */
    public function index(): JsonResponse
    {
        return ProductCategoryResource::collection(
            ProductCategory::withCount('products')->orderBy('name')->get()
        )->response();
    }

    public function store(StoreProductCategoryRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwned(ProductCategory::class, $data['parent_id'] ?? null, 'التصنيف الأب');
        $this->assertNameFree($data['name'], $data['parent_id'] ?? null);

        $category = ProductCategory::create([
            'name'      => $data['name'],
            'parent_id' => $data['parent_id'] ?? null,
            'is_active' => $data['is_active'] ?? true,
        ]);

        return (new ProductCategoryResource($category))->response()->setStatusCode(201);
    }

    public function update(StoreProductCategoryRequest $request, string $id): JsonResponse
    {
        $category = ProductCategory::findOrFail($id);
        $data     = $request->validated();
        $parentId = $data['parent_id'] ?? null;

        $this->assertTenantOwned(ProductCategory::class, $parentId, 'التصنيف الأب');
        $this->assertNoCycle($category->id, $parentId);
        $this->assertNameFree($data['name'], $parentId, $category->id);

        $category->update([
            'name'      => $data['name'],
            'parent_id' => $parentId,
            'is_active' => $data['is_active'] ?? $category->is_active,
        ]);

        return (new ProductCategoryResource($category))->response();
    }

    /**
     * الحذف يُمنع ما دام التصنيف مستعمَلاً.
     *
     * الحذف هنا ناعم (soft delete)، فالمفتاح الأجنبي لا يُطلَق ولا تُصفَّر
     * `products.category_id`. لو مرّ الحذف لاختفى تصنيف المنتج من الشاشة بلا
     * أثر مفهوم — **فقدان بيانات صامت**. الرفض برسالة تعدّ المرتبطين أوضح.
     */
    public function destroy(string $id): JsonResponse
    {
        $category = ProductCategory::withCount(['products', 'children'])->findOrFail($id);

        if ($category->products_count > 0) {
            abort(422, "لا يمكن حذف التصنيف: مرتبط بـ {$category->products_count} منتجاً. انقل المنتجات إلى تصنيف آخر أولاً.");
        }

        if ($category->children_count > 0) {
            abort(422, "لا يمكن حذف التصنيف: يحتوي {$category->children_count} تصنيفاً فرعياً.");
        }

        $category->delete();

        return response()->json(['message' => 'deleted']);
    }

    /**
     * الاسم فريد **بين الإخوة** لا في الشجرة كلّها: «فلاتر» تحت «زيوت» وأخرى
     * تحت «قطع غيار» تسميةٌ سليمة، ومنعُها تضييقٌ بلا سبب.
     *
     * الفحص هنا لا في قاعدة البيانات: قيدٌ فريد على `(tenant_id, parent_id,
     * name)` لا يمنع تكرار الجذور، لأن `NULL` لا يساوي `NULL` في الفهرس
     * الفريد — يمرّ جذران بالاسم نفسه بلا اعتراض.
     */
    private function assertNameFree(string $name, ?string $parentId, ?string $exceptId = null): void
    {
        $query = BranchScope::reference(ProductCategory::class)
            ->where('name', $name)
            ->when($parentId === null,
                fn ($q) => $q->whereNull('parent_id'),
                fn ($q) => $q->where('parent_id', $parentId));

        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }

        if ($query->exists()) {
            abort(422, 'يوجد تصنيف بهذا الاسم في المستوى نفسه.');
        }
    }

    /**
     * يمنع الدورة: تصنيفٌ أباً لنفسه أو لأحد أجداده يُنتج شجرة لا قاع لها،
     * فتدور كل عملية عرض إلى ما لا نهاية.
     */
    private function assertNoCycle(string $id, ?string $parentId): void
    {
        $seen = [];

        while ($parentId !== null) {
            if ($parentId === $id) {
                abort(422, 'لا يمكن جعل التصنيف تابعاً لنفسه أو لأحد فروعه.');
            }

            // حارس أخير: بيانات فاسدة من قبل يجب ألّا تُعلّق الطلب.
            if (isset($seen[$parentId])) {
                break;
            }
            $seen[$parentId] = true;

            $parentId = BranchScope::reference(ProductCategory::class)
                ->whereKey($parentId)->value('parent_id');
        }
    }
}

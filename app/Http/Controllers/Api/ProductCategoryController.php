<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreProductCategoryRequest;
use App\Http\Resources\ProductCategoryResource;
use App\Models\ProductCategory;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Tenancy\BranchScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * تصنيفات المنتجات — قائمة مُدارة متعدّدة المستويات تحلّ محلّ النصّ الحرّ.
 *
 * **لا أثر محاسبي:** لا حساب يرتبط بالتصنيف ولا قيد يُولَّد منه. أثره تجميعٌ
 * وتصفية في القوائم والتقارير.
 */
class ProductCategoryController extends ApiController
{
    public function __construct(protected DocumentStorageService $documentStorage) {}

    /**
     * القائمة مسطّحة بـ `parent_id` — الشجرة تُبنى في العرض، لا في الاستعلام.
     * وعند تمرير `image_id` يعيد المسار نفسه ملف الصورة محمياً بالمصادقة وRBAC.
     */
    public function index(Request $request)
    {
        if ($request->filled('image_id')) {
            $data = $request->validate(['image_id' => ['required', 'uuid']]);
            return $this->downloadImage((string) $data['image_id']);
        }

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
            'name'        => $data['name'],
            'description' => $data['description'] ?? null,
            'parent_id'   => $data['parent_id'] ?? null,
            'is_active'   => $data['is_active'] ?? true,
            'color'       => $data['color'] ?? null,
        ]);

        if ($request->hasFile('image')) {
            $this->replaceImage($category, $request);
        }

        return (new ProductCategoryResource($category->fresh()))->response()->setStatusCode(201);
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
            'name'        => $data['name'],
            'description' => $data['description'] ?? null,
            'parent_id'   => $parentId,
            'is_active'   => $data['is_active'] ?? $category->is_active,
            'color'       => $data['color'] ?? null,
        ]);

        if ($request->boolean('remove_image') && ! $request->hasFile('image')) {
            $this->deleteStoredImage($category);
        }
        if ($request->hasFile('image')) {
            $this->replaceImage($category, $request);
        }

        return (new ProductCategoryResource($category->fresh()))->response();
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

        $this->deleteStoredImage($category);
        $category->delete();

        return response()->json(['message' => 'deleted']);
    }

    /** صورة واحدة فقط للتصنيف؛ رفع صورة جديدة يستبدل القديمة بعد نجاح الحفظ. */
    private function replaceImage(ProductCategory $category, Request $request): void
    {
        $file = $request->file('image');
        if ($file === null) {
            return;
        }

        $extension = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'bin');
        $path = "product-category-media/{$category->tenant_id}/{$category->id}/" . Str::uuid() . ".{$extension}";
        $stream = fopen($file->getRealPath(), 'rb');

        try {
            $this->documentStorage->put($this->documentStorage->profile(), $path, $stream);
        } catch (RuntimeException $exception) {
            abort(503, 'تعذّر حفظ صورة التصنيف. أعد المحاولة.');
        } finally {
            if (is_resource($stream)) {
                fclose($stream);
            }
        }

        $oldPath = $category->image_path;
        $category->update([
            'image_path' => $path,
            'image_original_name' => $file->getClientOriginalName(),
            'image_mime_type' => $file->getMimeType(),
            'image_size' => $file->getSize(),
        ]);

        // بعد أن صار الصف يشير إلى الصورة الجديدة نحذف القديمة. فشل تنظيف كائن
        // قديم لا يحوّل استبدالاً ناجحاً للمستخدم إلى فشل ولا يعيد المؤشر إليه.
        if ($oldPath && $oldPath !== $path) {
            try {
                $this->documentStorage->delete($this->documentStorage->profile(), $oldPath);
            } catch (RuntimeException $exception) {
                report($exception);
            }
        }
    }

    /** تحميل مصادق عليه؛ الصور تبقى خاصة ولا تُكشف كرابط تخزين عام. */
    private function downloadImage(string $id)
    {
        $category = ProductCategory::findOrFail($id);
        if (! $category->image_path) {
            abort(404, 'لا توجد صورة لهذا التصنيف.');
        }

        try {
            $stream = $this->documentStorage->readStream(
                $this->documentStorage->profile(),
                $category->image_path,
            );
        } catch (RuntimeException $exception) {
            abort(404, 'ملف صورة التصنيف غير موجود.');
        }

        return response()->streamDownload(function () use ($stream): void {
            fpassthru($stream);
            fclose($stream);
        }, $category->image_original_name ?: "category-{$category->id}", [
            'Content-Type' => $category->image_mime_type ?: 'application/octet-stream',
        ]);
    }

    private function deleteStoredImage(ProductCategory $category): void
    {
        if ($category->image_path) {
            try {
                $this->documentStorage->delete($this->documentStorage->profile(), $category->image_path);
            } catch (RuntimeException $exception) {
                abort(503, 'تعذّر حذف صورة التصنيف من التخزين. أعد المحاولة.');
            }
        }

        $category->update([
            'image_path' => null,
            'image_original_name' => null,
            'image_mime_type' => null,
            'image_size' => null,
        ]);
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

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CreateProductVariantsRequest;
use App\Http\Requests\StoreProductOptionRequest;
use App\Http\Requests\StoreOptionValueSwatchRequest;
use App\Http\Requests\StoreProductOptionValueRequest;
use App\Http\Requests\UpdateProductOptionRequest;
use App\Http\Requests\UpdateProductOptionValueRequest;
use App\Http\Requests\UpdateProductVariantRequest;
use App\Http\Resources\ProductOptionResource;
use App\Http\Resources\ProductOptionValueResource;
use App\Http\Resources\ProductResource;
use App\Http\Resources\ProductVariantResource;
use App\Models\Product;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Services\ProductMediaService;
use App\Services\ProductVariantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * VAR-CORE-1 — خيارات/قيم/متغيّرات المنتج.
 *
 * كل مسار متداخلٌ تحت `products/{id}` عمداً — لا معرّف متغيّرٍ يُحلّ بمعزلٍ عن
 * منتجه أبداً. الملكية الهرمية (الخيار لهذا المنتج، القيمة لهذا الخيار،
 * المتغيّر لهذا المنتج) تُتحقَّق صراحةً في كل متحكّم قبل أي تعديل — النطاق
 * العام (`TenantScope`) يمنع تسرّب مستأجرٍ آخر، لكنه لا يمنع خلط منتجَين من
 * المستأجر نفسه، وهذا بالضبط ما يتحقق منه `assertBelongsToProduct` هنا.
 */
class ProductVariantController extends ApiController
{
    public function __construct(
        private readonly ProductVariantService $variants,
        private readonly ProductMediaService $media,
    ) {
    }

    // ───────────────────────── حالة المنتج ─────────────────────────

    public function enable(Request $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product = $this->domain(fn () => $this->variants->enableVariantManagement($product, $request->user()?->id));

        return (new ProductResource($product->fresh()))->response();
    }

    public function disable(Request $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product = $this->domain(fn () => $this->variants->disableVariantManagement($product, $request->user()?->id));

        return (new ProductResource($product->fresh()))->response();
    }

    // ───────────────────────── خيارات ─────────────────────────

    public function indexOptions(string $id): JsonResponse
    {
        $product = Product::findOrFail($id);

        return ProductOptionResource::collection(
            $product->options()->with('values.imageMedia')->get()
        )->response();
    }

    public function storeOption(StoreProductOptionRequest $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $option = $this->domain(fn () => $this->variants->createOption($product, $request->validated(), $request->user()?->id));

        return (new ProductOptionResource($option->fresh('values.imageMedia')))->response()->setStatusCode(201);
    }

    public function updateOption(UpdateProductOptionRequest $request, string $id, string $optionId): JsonResponse
    {
        $option = $this->resolveOption($id, $optionId);
        $option = $this->domain(fn () => $this->variants->updateOption($option, $request->validated(), $request->user()?->id));

        return (new ProductOptionResource($option->fresh('values.imageMedia')))->response();
    }

    public function destroyOption(Request $request, string $id, string $optionId): JsonResponse
    {
        $option = $this->resolveOption($id, $optionId);
        $this->domain(fn () => $this->variants->deleteOption($option, $request->user()?->id));

        return response()->json(['message' => 'تم الحذف.']);
    }

    // ───────────────────────── قيم الخيارات ─────────────────────────

    public function storeOptionValue(StoreProductOptionValueRequest $request, string $id, string $optionId): JsonResponse
    {
        $option = $this->resolveOption($id, $optionId);
        $value = $this->domain(fn () => $this->variants->addOptionValue($option, $request->validated(), $request->user()?->id));

        return (new ProductOptionValueResource($value->fresh('imageMedia')))->response()->setStatusCode(201);
    }

    public function updateOptionValue(UpdateProductOptionValueRequest $request, string $id, string $optionId, string $valueId): JsonResponse
    {
        $value = $this->resolveOptionValue($id, $optionId, $valueId);
        $value = $this->domain(fn () => $this->variants->updateOptionValue($value, $request->validated(), $request->user()?->id));

        return (new ProductOptionValueResource($value->fresh('imageMedia')))->response();
    }

    public function destroyOptionValue(Request $request, string $id, string $optionId, string $valueId): JsonResponse
    {
        $value = $this->resolveOptionValue($id, $optionId, $valueId);
        $this->domain(fn () => $this->variants->deleteOptionValue($value, $request->user()?->id));

        return response()->json(['message' => 'تم الحذف.']);
    }

    /**
     * VAR-OPTION-VISUAL-2B — رفع صورة صريّة (swatch) لقيمة خيارٍ قائمة.
     *
     * أصغر مسار تأليفٍ ممكن فوق سلطة VAR-MEDIA-1 القائمة: التخزين عبر
     * `ProductMediaService::attachToOptionValue()` (نفس `DocumentStorageService`
     * ونفس مسار `product-media/{tenant}/{product}/` المولَّد خادماً — لا مسار
     * من العميل إطلاقاً)، ثم اعتماد المرجع عبر سلطة الصريّة نفسها
     * (`updateOptionValue` → `applyVisualMetadata`) لا بكتابة العمود مباشرةً.
     *
     * الملكية الهرمية (المنتج ← الخيار ← القيمة) تُحلّ في `resolveOptionValue`
     * قبل أي كتابة؛ عزل المستأجر عبر `TenantScope` وصلاحية `products.manage`
     * على المسار. إن فشل اعتماد الصريّة بعد نجاح التخزين يُحذف الوسيط الجديد
     * فوراً — لا صفّ يتيم بلا مرجع.
     */
    public function storeOptionValueMedia(StoreOptionValueSwatchRequest $request, string $id, string $optionId, string $valueId): JsonResponse
    {
        $value = $this->resolveOptionValue($id, $optionId, $valueId);
        $product = $value->option->product;

        $media = $this->domain(fn () => $this->media->attachToOptionValue(
            $product, $value, [$request->file('image')], $request->user()?->id
        ))[0];

        try {
            $value = $this->domain(fn () => $this->variants->updateOptionValue($value->fresh(), [
                'visual_type' => \App\Models\ProductOptionValue::VISUAL_TYPE_IMAGE,
                'image_media_id' => $media->id,
            ], $request->user()?->id));
        } catch (\Throwable $exception) {
            $this->media->delete($media);

            throw $exception;
        }

        return (new ProductOptionValueResource($value->fresh('imageMedia')))->response()->setStatusCode(201);
    }

    // ───────────────────────── التركيبات والمتغيّرات ─────────────────────────

    public function combinations(string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $matrix = $this->domain(fn () => $this->variants->combinationsMatrix($product));

        return response()->json($matrix);
    }

    public function indexVariants(string $id): JsonResponse
    {
        $product = Product::findOrFail($id);

        return ProductVariantResource::collection(
            $product->variants()->with('optionValues.option')->orderBy('created_at')->get()
        )->response();
    }

    public function storeVariants(CreateProductVariantsRequest $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $result = $this->domain(fn () => $this->variants->createVariants($product, $request->validated()['combinations'], $request->user()?->id));

        return response()->json([
            'created' => ProductVariantResource::collection(
                collect($result['created'])->each->load('optionValues.option')
            ),
            'duplicates' => $result['duplicates'],
            'failed' => $result['failed'],
        ], 201);
    }

    public function updateVariant(UpdateProductVariantRequest $request, string $id, string $variantId): JsonResponse
    {
        $variant = $this->resolveVariant($id, $variantId);
        $variant = $this->domain(fn () => $this->variants->updateVariant($variant, $request->validated(), $request->user()?->id));

        return (new ProductVariantResource($variant->fresh(['optionValues.option'])))->response();
    }

    public function destroyVariant(Request $request, string $id, string $variantId): JsonResponse
    {
        $variant = $this->resolveVariant($id, $variantId);
        $this->domain(fn () => $this->variants->deleteVariant($variant, $request->user()?->id));

        return response()->json(['message' => 'تم الحذف.']);
    }

    // ───────────────────────── حلّ الملكية الهرمية ─────────────────────────

    private function resolveOption(string $productId, string $optionId): ProductOption
    {
        $option = ProductOption::findOrFail($optionId);
        if ($option->product_id !== $productId) {
            abort(404);
        }

        return $option;
    }

    private function resolveOptionValue(string $productId, string $optionId, string $valueId): ProductOptionValue
    {
        $option = $this->resolveOption($productId, $optionId);
        $value = ProductOptionValue::findOrFail($valueId);
        if ($value->product_option_id !== $option->id) {
            abort(404);
        }

        return $value;
    }

    private function resolveVariant(string $productId, string $variantId): ProductVariant
    {
        $variant = ProductVariant::findOrFail($variantId);
        if ($variant->product_id !== $productId) {
            abort(404);
        }

        return $variant;
    }
}

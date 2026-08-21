<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StorePriceListItemRequest;
use App\Http\Requests\StorePriceListRequest;
use App\Http\Requests\UpdatePriceListRequest;
use App\Http\Resources\PriceListItemResource;
use App\Http\Resources\PriceListResource;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Services\PriceListService;
use App\Support\Money;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * قوائم السعر هي إعدادات مبيعات مشتركة للمؤسسة. لا تترجم إلى خصمٍ عام ولا
 * تعدّل فواتير قائمة: اختيار القائمة يقتصر على اقتراح سعر عنصر الفاتورة.
 */
class PriceListController extends ApiController
{
    public function __construct(private PriceListService $priceLists) {}

    public function index(): JsonResponse
    {
        return PriceListResource::collection(
            PriceList::query()->withCount('items')->orderByDesc('is_active')->orderBy('name')->get()
        )->response();
    }

    public function show(string $id): JsonResponse
    {
        $priceList = PriceList::with(['items.product.unitTemplate.units'])->withCount('items')->findOrFail($id);

        return (new PriceListResource($priceList))->response();
    }

    public function store(StorePriceListRequest $request): JsonResponse
    {
        $data = $this->normalize($request->validated());
        $this->assertNameFree($data['name']);

        $priceList = PriceList::create($data);

        return (new PriceListResource($priceList->loadCount('items')))->response()->setStatusCode(201);
    }

    public function update(UpdatePriceListRequest $request, string $id): JsonResponse
    {
        $priceList = PriceList::findOrFail($id);
        $data = $this->normalize($request->validated(), $priceList);
        $this->assertNameFree($data['name'], $priceList->id);
        $priceList->update($data);

        return (new PriceListResource($priceList->fresh()->loadCount('items')))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        $priceList = PriceList::findOrFail($id);
        $this->domain(fn () => $this->priceLists->delete($priceList));

        return response()->json(['message' => 'deleted']);
    }

    public function storeItem(StorePriceListItemRequest $request, string $id): JsonResponse
    {
        $priceList = PriceList::findOrFail($id);
        $data = $request->validated();
        $product = Product::with('unitTemplate.units')->find($data['product_id']);
        if (! $product) {
            abort(422, 'المنتج غير موجود أو غير متاح في الفرع الحالي.');
        }

        $item = $this->domain(fn () => $this->priceLists->upsertItem($priceList, $product, $data));

        return (new PriceListItemResource($item->load('product')))->response()->setStatusCode(201);
    }

    public function destroyItem(string $id, string $itemId): JsonResponse
    {
        PriceList::findOrFail($id);
        $item = PriceListItem::where('price_list_id', $id)->findOrFail($itemId);
        $item->delete();

        return response()->json(['message' => 'deleted']);
    }

    /** يعيد السعر المقترح فقط؛ غياب عنصر القائمة يعني أن واجهة الفاتورة تستخدم سعر بطاقة المنتج. */
    public function resolve(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'product_id' => ['required', 'uuid'],
            'unit_name' => ['nullable', 'string', 'max:255'],
        ]);

        $priceList = PriceList::findOrFail($id);
        $product = Product::with('unitTemplate.units')->find($data['product_id']);
        if (! $product || ! $product->is_active) {
            abort(422, 'المنتج غير موجود أو غير نشط في الفرع الحالي.');
        }

        $price = $this->domain(fn () => $this->priceLists->resolve($priceList, $product, $data['unit_name'] ?? null));

        return response()->json(['data' => [
            'price_list_id' => $priceList->id,
            'product_id' => $product->id,
            'unit_name' => $data['unit_name'] ?? '',
            'price' => $price === null ? null : Money::toRiyal($price),
            'matched' => $price !== null,
        ]]);
    }

    private function normalize(array $data, ?PriceList $current = null): array
    {
        $value = static fn (string $key, mixed $fallback) => array_key_exists($key, $data) ? $data[$key] : $fallback;

        return [
            'name' => trim((string) $value('name', $current?->name ?? '')),
            'description' => $value('description', $current?->description),
            'is_active' => (bool) $value('is_active', $current?->is_active ?? true),
        ];
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        if ($name === '') {
            abort(422, 'اسم قائمة الأسعار مطلوب.');
        }

        $query = PriceList::where('name', $name);
        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            abort(422, 'توجد قائمة أسعار بهذا الاسم.');
        }
    }
}

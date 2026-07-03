<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use App\Services\Accounting\InventoryService;
use Illuminate\Http\JsonResponse;

class ProductController extends ApiController
{
    public function __construct(protected InventoryService $inventory) {}

    public function index(): JsonResponse
    {
        return ProductResource::collection(Product::latest()->get())->response();
    }

    public function store(StoreProductRequest $request): JsonResponse
    {
        $data = $request->validated();
        $product = Product::create($data); // initial_quantity ليست عموداً — يحرسها fillable

        // رصيد افتتاحي (قيد مدين 1140 / دائن 3130) عند تحديد كمية ابتدائية لمنتج متتبَّع.
        $this->domain(fn () => $this->inventory->recordOpeningStock($product, (int) ($data['initial_quantity'] ?? 0)));

        return (new ProductResource($product->fresh()))->response()->setStatusCode(201);
    }

    public function show(string $id): JsonResponse
    {
        return (new ProductResource(Product::findOrFail($id)))->response();
    }

    public function update(StoreProductRequest $request, string $id): JsonResponse
    {
        $product = Product::findOrFail($id);
        $product->update($request->validated());

        return (new ProductResource($product))->response();
    }

    public function destroy(string $id): JsonResponse
    {
        Product::findOrFail($id)->delete();

        return response()->json(['message' => 'تم الحذف.']);
    }
}

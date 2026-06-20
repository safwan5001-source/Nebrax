<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreProductRequest;
use App\Http\Resources\ProductResource;
use App\Models\Product;
use Illuminate\Http\JsonResponse;

class ProductController extends ApiController
{
    public function index(): JsonResponse
    {
        return ProductResource::collection(Product::latest()->get())->response();
    }

    public function store(StoreProductRequest $request): JsonResponse
    {
        $product = Product::create($request->validated());

        return (new ProductResource($product))->response()->setStatusCode(201);
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

<?php

namespace App\Http\Controllers\Api;

use App\Models\CommercialPlanVersion;
use App\Models\CommercialProduct;
use App\Models\CommercialProductVersion;
use App\Services\CommercialPlanVersionService;
use App\Services\CommercialProductVersionService;
use Illuminate\Http\JsonResponse;

class PlatformCommercialCatalogController extends ApiController
{
    public function __construct(
        private CommercialProductVersionService $products,
        private CommercialPlanVersionService $plans,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json(['data' => [
            'products' => CommercialProduct::query()->with(['versions.capabilities'])->orderBy('code')->get()->map(fn (CommercialProduct $product) => [
                'id' => $product->id, 'code' => $product->code, 'name' => $product->name,
                'versions' => $product->versions->map(fn (CommercialProductVersion $version) => $this->productVersion($version)),
            ]),
            'plans' => CommercialPlanVersion::query()->with('products')->orderBy('plan_code')->orderBy('version')->get()->map(fn (CommercialPlanVersion $version) => $this->planVersion($version)),
        ]]);
    }

    public function publishProduct(CommercialProductVersion $version): JsonResponse
    {
        return response()->json(['data' => $this->productVersion($this->products->publish($version))]);
    }

    public function retireProduct(CommercialProductVersion $version): JsonResponse
    {
        return response()->json(['data' => $this->productVersion($this->products->retire($version))]);
    }

    public function publishPlan(CommercialPlanVersion $version): JsonResponse
    {
        return response()->json(['data' => $this->planVersion($this->plans->publish($version))]);
    }

    public function retirePlan(CommercialPlanVersion $version): JsonResponse
    {
        return response()->json(['data' => $this->planVersion($this->plans->retire($version))]);
    }

    private function productVersion(CommercialProductVersion $version): array
    {
        return ['id' => $version->id, 'commercial_product_id' => $version->commercial_product_id, 'version' => $version->version, 'published_at' => $version->published_at?->toIso8601String(), 'retired_at' => $version->retired_at?->toIso8601String(), 'capabilities' => $version->capabilities->pluck('capability_key')->values()];
    }

    private function planVersion(CommercialPlanVersion $version): array
    {
        return ['id' => $version->id, 'plan_code' => $version->plan_code, 'version' => $version->version, 'published_at' => $version->published_at?->toIso8601String(), 'retired_at' => $version->retired_at?->toIso8601String(), 'product_version_ids' => $version->products->pluck('commercial_product_version_id')->values()];
    }
}

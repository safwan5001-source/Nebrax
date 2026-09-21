<?php

namespace App\Services\Pos;

use App\Models\Product;
use App\Models\ProductUnitPrice;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;

/**
 * التحضير العابر لأسعار كتالوج POS فقط. لا يبدّل سلطة ProductPricingService
 * لبقية المسارات، بل يقرأ صفوف الأسعار الصريحة مرة واحدة للمنتجات المعروضة.
 */
class PosCatalogPricePreparer
{
    /**
     * @param Collection<int, Product> $products
     * @return array{products: array<string, Product>, explicit: array<string, array<string, array<string, int>>>}
     */
    public function prepare(Collection $products): array
    {
        $productIds = $products->modelKeys();
        $tenantId = app(TenantContext::class)->id();

        if ($productIds === [] || $tenantId === null) {
            return ['products' => [], 'explicit' => []];
        }

        $explicit = [];
        ProductUnitPrice::query()
            ->where('tenant_id', $tenantId)
            ->whereIn('product_id', $productIds)
            ->get(['product_id', 'product_variant_id', 'unit_name', 'price'])
            ->each(function (ProductUnitPrice $price) use (&$explicit): void {
                $variantKey = $price->product_variant_id ?? '__base__';
                $explicit[$price->product_id][$variantKey][$price->unit_name] = (int) $price->price;
            });

        return [
            'products' => $products->keyBy('id')->all(),
            'explicit' => $explicit,
        ];
    }
}

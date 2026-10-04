<?php

namespace App\Services\Commerce;

use App\Models\CommerceProductPreparation;
use App\Models\Product;
use App\Tenancy\BranchScope;
use Illuminate\Support\Facades\DB;

/**
 * FLOWERS-H8 / ADR-20 — مهلة تجهيز المنتج. `0`/`null` تعني «بلا مهلة خاصة» وتحذف الصف (غياب = لا مهلة)، فلا
 * يوجد تمثيلان لنفس المعنى.
 */
final class ProductPreparationService
{
    public function minutes(Product $product): int
    {
        return (int) CommerceProductPreparation::query()->where('product_id', $product->id)->value('preparation_minutes');
    }

    /** @return array<string, int> `productId => minutes` (المنتجات بلا مهلة غائبة) باستعلام واحد */
    public function minutesMany(array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        return CommerceProductPreparation::query()->whereIn('product_id', $productIds)
            ->pluck('preparation_minutes', 'product_id')->map(fn ($v) => (int) $v)->all();
    }

    public function set(Product $product, ?int $minutes): int
    {
        return DB::transaction(function () use ($product, $minutes): int {
            // BranchScope وحده يُرفع؛ TenantScope وSoftDeletes يبقيان (منتج حُذف ⇒ 404 لا 500 من FK).
            Product::withoutGlobalScope(BranchScope::class)->whereKey($product->id)->lockForUpdate()->firstOrFail();
            $existing = CommerceProductPreparation::query()->where('product_id', $product->id)->first();

            if ($minutes === null || $minutes === 0) {
                $existing?->delete();

                return 0;
            }

            $existing === null
                ? CommerceProductPreparation::create(['product_id' => $product->id, 'preparation_minutes' => $minutes])
                : $existing->update(['preparation_minutes' => $minutes]);

            return $minutes;
        });
    }
}

<?php

namespace App\Support\Commerce;

use App\Models\CommerceCollection;
use App\Models\CommerceCollectionProduct;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Tenancy\BranchScope;

/**
 * FLOWERS-H2 / ADR-14 §2.3 — قراءة المجموعات العامة لقناة واحدة. تُظهر المجموعات
 * `active` فقط، و`product_count` يعدّ الأعضاء الذين يمرّون ببوابة نشر المنتج على
 * القناة (`is_active` + `CommerceListing` منشور). مجموعة بلا عضو ظاهر تُحذف من
 * القائمة (لا شيء يُعرض). استعلامان مجمّعان، بلا حلقة لكل مجموعة.
 */
final class CatalogCollectionReader
{
    /** @return list<array{slug: string, title: string, title_en: ?string, description: ?string, product_count: int}> */
    public function forChannel(string $channelId): array
    {
        $collections = CommerceCollection::query()
            ->where('status', CommerceCollection::STATUS_ACTIVE)
            ->orderBy('sort_order')
            ->orderBy('title')
            ->get();

        if ($collections->isEmpty()) {
            return [];
        }

        $visibleProducts = Product::query()
            ->withoutGlobalScope(BranchScope::class)
            ->where('is_active', true)
            ->whereIn('id', CommerceListing::query()
                ->where('sales_channel_id', $channelId)
                ->where('is_published', true)
                ->select('product_id'))
            ->select('id');

        $counts = CommerceCollectionProduct::query()
            ->whereIn('commerce_collection_id', $collections->pluck('id'))
            ->whereIn('product_id', $visibleProducts)
            ->groupBy('commerce_collection_id')
            ->selectRaw('commerce_collection_id, count(*) as aggregate')
            ->pluck('aggregate', 'commerce_collection_id');

        return $collections
            ->filter(fn (CommerceCollection $c) => ($counts[$c->id] ?? 0) > 0)
            ->map(fn (CommerceCollection $c) => [
                'slug' => $c->slug,
                'title' => $c->title,
                'title_en' => $c->title_en,
                'description' => $c->description,
                'product_count' => (int) $counts[$c->id],
            ])
            ->values()
            ->all();
    }
}

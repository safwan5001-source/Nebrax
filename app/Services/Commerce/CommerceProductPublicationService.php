<?php

namespace App\Services\Commerce;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * COM-WS-3 — publication overlay for AWJ products.
 * Product remains the source of truth; this service only manages CommerceListing
 * for web sales channels owned by the current tenant.
 */
final class CommerceProductPublicationService
{
    /** @return list<array{id:string,name:string,is_published:bool}> */
    public function state(Product $product): array
    {
        $tenantId = $this->tenantId();
        $this->assertProductTenant($product, $tenantId);

        $publishedChannelIds = CommerceListing::query()
            ->where('product_id', $product->id)
            ->where('is_published', true)
            ->pluck('sales_channel_id')
            ->all();

        return $this->webStorefronts($tenantId)
            ->map(fn (Storefront $storefront) => [
                'id' => $storefront->id,
                'name' => $storefront->name,
                'is_published' => in_array($storefront->sales_channel_id, $publishedChannelIds, true),
            ])
            ->values()
            ->all();
    }

    /**
     * COM-CATALOG-1 — Product Publication Workspace list.
     *
     * Lists the tenant's products (Product remains the master) with their actual
     * publication state read solely from CommerceListing.is_published on the
     * tenant-authorized active web storefronts. No new publication state, no
     * parallel flag — the same rows the public storefront gate already reads.
     *
     * Filters (server-side):
     *  - search: name / name_en / sku / barcode (LIKE, escaped).
     *  - status: all | published | unpublished — "published" means a published
     *    CommerceListing exists on at least one in-scope web sales channel.
     *  - storefront_id: optional scope to a single storefront. A foreign or
     *    unknown id is rejected (422), never silently ignored — the id arrives
     *    only as a *choice* inside the already tenant-authorized set, mirroring
     *    the replace() contract.
     *
     * @param array{search?:?string,status?:?string,storefront_id?:?string,page?:int,per_page?:int} $filters
     */
    public function list(array $filters): LengthAwarePaginator
    {
        $tenantId = $this->tenantId();
        $storefronts = $this->webStorefronts($tenantId);

        $scopedStorefronts = $storefronts;
        $scopedStorefrontId = $filters['storefront_id'] ?? null;
        if (filled($scopedStorefrontId)) {
            $match = $storefronts->firstWhere('id', (string) $scopedStorefrontId);
            if ($match === null) {
                abort(422, 'المتجر المحدد غير متاح لهذا المستأجر.');
            }
            $scopedStorefronts = collect([$match]);
        }
        $scopedChannelIds = $scopedStorefronts->pluck('sales_channel_id')->all();

        $query = Product::query()
            ->select(['id', 'tenant_id', 'sku', 'name', 'name_en', 'is_active']);

        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $like = "%{$needle}%";
            $query->where(function (Builder $search) use ($like): void {
                $search
                    ->where('name', 'like', $like)
                    ->orWhere('name_en', 'like', $like)
                    ->orWhere('sku', 'like', $like)
                    ->orWhere('barcode', 'like', $like);
            });
        }

        $status = $filters['status'] ?? 'all';
        if ($status === 'published' || $status === 'unpublished') {
            $publishedWhere = function (Builder $products) use ($scopedChannelIds): void {
                $products->whereExists(function ($listing) use ($scopedChannelIds): void {
                    $listing->from((new CommerceListing())->getTable())
                        ->whereColumn('product_id', 'products.id')
                        ->whereIn('sales_channel_id', $scopedChannelIds)
                        ->where('is_published', true);
                });
            };
            if ($status === 'published') {
                $query->where($publishedWhere);
            } else {
                $query->whereNot($publishedWhere);
            }
        }

        $paginator = $query
            ->orderBy('name')
            ->orderBy('id')
            ->paginate(
                perPage: (int) ($filters['per_page'] ?? 25),
                page: (int) ($filters['page'] ?? 1),
            );

        $this->attachPublicationState($paginator->getCollection(), $scopedStorefronts);

        return $paginator;
    }

    /**
     * يحوّل صفحة المنتجات إلى عناصر الـ Workspace بحالة النشر الفعلية لكل متجر —
     * استعلام واحد مجمّع للقوائم يمنع N+1.
     *
     * @param Collection<int, Product> $products
     * @param Collection<int, Storefront> $storefronts
     */
    private function attachPublicationState(Collection $products, Collection $storefronts): void
    {
        $listings = CommerceListing::query()
            ->whereIn('product_id', $products->modelKeys())
            ->whereIn('sales_channel_id', $storefronts->pluck('sales_channel_id')->all())
            ->where('is_published', true)
            ->get(['product_id', 'sales_channel_id'])
            ->keyBy(fn (CommerceListing $listing) => $listing->product_id.':'.$listing->sales_channel_id);

        $products->transform(function (Product $product) use ($storefronts, $listings): array {
            $stores = $storefronts->map(function (Storefront $storefront) use ($product, $listings): array {
                $published = $listings->has($product->id.':'.$storefront->sales_channel_id);

                return ['id' => $storefront->id, 'name' => $storefront->name, 'is_published' => $published];
            })->values()->all();

            return [
                'id' => $product->id,
                'sku' => $product->sku,
                'name' => $product->name,
                'name_en' => $product->name_en,
                'is_active' => (bool) $product->is_active,
                'is_published' => collect($stores)->contains('is_published', true),
                'stores' => $stores,
            ];
        });
    }

    /**
     * Replace the product's publication set across the current tenant's active web stores.
     * Storefront ids are accepted only as choices inside the already-authorized tenant set.
     *
     * @param list<string> $storefrontIds
     * @return list<array{id:string,name:string,is_published:bool}>
     */
    public function replace(Product $product, array $storefrontIds): array
    {
        $tenantId = $this->tenantId();
        $this->assertProductTenant($product, $tenantId);

        $storefronts = $this->webStorefronts($tenantId);
        $authorizedIds = $storefronts->pluck('id')->map(fn ($id) => (string) $id)->all();
        $requestedIds = array_values(array_unique(array_map('strval', $storefrontIds)));

        // Collection::whereIn() uses loose comparison. Validate the raw requested ids
        // strictly against the tenant-authorized set before resolving sales channels so a
        // foreign storefront can never be silently ignored or coerced into a valid choice.
        foreach ($requestedIds as $requestedId) {
            if (! in_array($requestedId, $authorizedIds, true)) {
                abort(422, 'أحد المتاجر المحددة غير متاح لهذا المستأجر.');
            }
        }

        $requestedChannelIds = $storefronts
            ->filter(fn (Storefront $storefront) => in_array((string) $storefront->id, $requestedIds, true))
            ->pluck('sales_channel_id')
            ->all();
        $webChannelIds = $storefronts->pluck('sales_channel_id')->all();

        DB::transaction(function () use ($product, $tenantId, $webChannelIds, $requestedChannelIds): void {
            foreach ($webChannelIds as $channelId) {
                CommerceListing::query()->updateOrCreate(
                    [
                        'product_id' => $product->id,
                        'sales_channel_id' => $channelId,
                    ],
                    [
                        'tenant_id' => $tenantId,
                        'is_published' => in_array($channelId, $requestedChannelIds, true),
                    ],
                );
            }
        });

        return $this->state($product);
    }

    private function tenantId(): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $tenantId;
    }

    private function assertProductTenant(Product $product, string $tenantId): void
    {
        if ($product->tenant_id !== $tenantId) {
            abort(404);
        }
    }

    private function webStorefronts(string $tenantId)
    {
        return Storefront::query()
            ->where('is_active', true)
            ->where('tenant_id', $tenantId)
            ->whereHas('salesChannel', function ($query) use ($tenantId): void {
                $query->where('tenant_id', $tenantId)
                    ->where('type', SalesChannel::TYPE_WEB)
                    ->where('is_active', true);
            })
            ->orderBy('name')
            ->orderBy('id')
            ->get();
    }
}

<?php

namespace App\Services\Commerce;

use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * COM-CATALOG-2 — Category Publication overlay for AWJ categories.
 * ProductCategory remains the master data (name/tree/`is_active` lifecycle);
 * this service only manages CommerceCategoryListing.is_published for web
 * sales channels owned by the current tenant — fully independent from
 * product publication (CommerceListing), which it never reads or writes.
 */
final class CommerceCategoryPublicationService
{
    /** @return list<array{id:string,name:string,is_published:bool}> */
    public function state(ProductCategory $category): array
    {
        $tenantId = $this->tenantId();
        $this->assertCategoryTenant($category, $tenantId);

        $publishedChannelIds = CommerceCategoryListing::query()
            ->where('category_id', $category->id)
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
     * COM-CATALOG-2 — Category Publication Workspace list.
     *
     * Lists the tenant's categories (ProductCategory remains the master) with
     * their actual publication state read solely from
     * CommerceCategoryListing.is_published on the tenant-authorized active web
     * storefronts — the same rows the public storefront category gate reads.
     *
     * Filters (server-side):
     *  - search: name (LIKE, escaped).
     *  - status: all | published | unpublished — "published" means a published
     *    CommerceCategoryListing exists on at least one in-scope web channel.
     *  - storefront_id: optional scope to a single storefront. A foreign or
     *    unknown id is rejected (422), never silently ignored.
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

        $query = ProductCategory::query()
            ->select(['id', 'tenant_id', 'parent_id', 'name', 'is_active'])
            ->with(['parent' => fn ($q) => $q->withoutGlobalScope(BranchScope::class)->select(['id', 'name'])]);

        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $query->where('name', 'like', "%{$needle}%");
        }

        $status = $filters['status'] ?? 'all';
        if ($status === 'published' || $status === 'unpublished') {
            $publishedWhere = function (Builder $categories) use ($scopedChannelIds): void {
                $categories->whereExists(function ($listing) use ($scopedChannelIds): void {
                    $listing->from((new CommerceCategoryListing())->getTable())
                        ->whereColumn('category_id', 'product_categories.id')
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
     * Replace the category's publication set across the current tenant's active
     * web stores. Storefront ids are accepted only as choices inside the
     * already-authorized tenant set — never as authority.
     *
     * @param list<string> $storefrontIds
     * @return list<array{id:string,name:string,is_published:bool}>
     */
    public function replace(ProductCategory $category, array $storefrontIds): array
    {
        $tenantId = $this->tenantId();
        $this->assertCategoryTenant($category, $tenantId);

        $storefronts = $this->webStorefronts($tenantId);
        $authorizedIds = $storefronts->pluck('id')->map(fn ($id) => (string) $id)->all();
        $requestedIds = array_values(array_unique(array_map('strval', $storefrontIds)));

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

        DB::transaction(function () use ($category, $tenantId, $webChannelIds, $requestedChannelIds): void {
            foreach ($webChannelIds as $channelId) {
                CommerceCategoryListing::query()->updateOrCreate(
                    [
                        'category_id' => $category->id,
                        'sales_channel_id' => $channelId,
                    ],
                    [
                        'tenant_id' => $tenantId,
                        'is_published' => in_array($channelId, $requestedChannelIds, true),
                    ],
                );
            }
        });

        return $this->state($category);
    }

    /**
     * يحوّل صفحة التصنيفات إلى عناصر الـ Workspace بحالة النشر الفعلية لكل
     * متجر — استعلام واحد مجمّع يمنع N+1.
     *
     * @param Collection<int, ProductCategory> $categories
     * @param Collection<int, Storefront> $storefronts
     */
    private function attachPublicationState(Collection $categories, Collection $storefronts): void
    {
        $listings = CommerceCategoryListing::query()
            ->whereIn('category_id', $categories->modelKeys())
            ->whereIn('sales_channel_id', $storefronts->pluck('sales_channel_id')->all())
            ->where('is_published', true)
            ->get(['category_id', 'sales_channel_id'])
            ->keyBy(fn (CommerceCategoryListing $listing) => $listing->category_id.':'.$listing->sales_channel_id);

        $categories->transform(function (ProductCategory $category) use ($storefronts, $listings): array {
            $stores = $storefronts->map(function (Storefront $storefront) use ($category, $listings): array {
                $published = $listings->has($category->id.':'.$storefront->sales_channel_id);

                return ['id' => $storefront->id, 'name' => $storefront->name, 'is_published' => $published];
            })->values()->all();

            return [
                'id' => $category->id,
                'name' => $category->name,
                'parent_id' => $category->parent_id,
                'parent_name' => $category->parent?->name,
                'is_active' => (bool) $category->is_active,
                'is_published' => collect($stores)->contains('is_published', true),
                'stores' => $stores,
            ];
        });
    }

    /** أقصى عدد معرّفات في طلب نشر جماعي واحد (حد صريح لا يُوسَّع بالتصفية). */
    public const BULK_MAX_IDS = 100;

    /**
     * Bulk publish/unpublish an *explicit* set of categories on ONE storefront.
     *
     * - The target is exactly one tenant-authorized active web storefront; a
     *   foreign/unknown/inactive id is rejected (422) before any write.
     * - Only the listed ids are touched, and only that storefront's channel
     *   listing — never the other stores, never anything outside the tenant.
     * - Ids that do not resolve through the tenant-scoped query are rejected
     *   with a uniform `not_found` (a foreign id is indistinguishable from a
     *   missing one). One record's failure never rolls back the others: each
     *   record commits in its own transaction and is reported individually.
     * - Writes CommerceCategoryListing.is_published only; no inventory/financial/accounting
     *   data is read or written.
     *
     * @param list<string> $ids
     * @return array{action:string,storefront_id:string,summary:array<string,int>,results:list<array{id:string,status:string,reason?:string}>}
     */
    public function bulkSet(array $ids, string $storefrontId, bool $publish): array
    {
        $tenantId = $this->tenantId();
        $storefront = $this->webStorefronts($tenantId)
            ->first(fn (Storefront $candidate) => (string) $candidate->id === $storefrontId);
        if ($storefront === null) {
            abort(422, 'المتجر المحدد غير متاح لهذا المستأجر.');
        }
        $channelId = $storefront->sales_channel_id;

        $requestedIds = array_values(array_unique(array_map('strval', $ids)));
        $records = ProductCategory::query()
            ->whereIn('id', $requestedIds)
            ->get(['id', 'tenant_id'])
            ->filter(fn (ProductCategory $record) => $record->tenant_id === $tenantId)
            ->keyBy('id');
        $listings = CommerceCategoryListing::query()
            ->whereIn('category_id', $records->keys()->all())
            ->where('sales_channel_id', $channelId)
            ->get()
            ->keyBy('category_id');

        $results = [];
        $summary = ['requested' => count($requestedIds), 'updated' => 0, 'unchanged' => 0, 'rejected' => 0, 'failed' => 0];

        foreach ($requestedIds as $id) {
            if (! $records->has($id)) {
                $results[] = ['id' => $id, 'status' => 'rejected', 'reason' => 'not_found'];
                $summary['rejected']++;

                continue;
            }

            $current = $listings->get($id);
            $isPublishedNow = $current !== null && (bool) $current->is_published;
            // يشمل إلغاء نشر سجل بلا قائمة نشر أصلاً: لا شيء لفعله ولا صف يُنشأ بلا داعٍ.
            if ($isPublishedNow === $publish) {
                $results[] = ['id' => $id, 'status' => 'unchanged'];
                $summary['unchanged']++;

                continue;
            }

            try {
                DB::transaction(function () use ($id, $tenantId, $channelId, $publish): void {
                    CommerceCategoryListing::query()->updateOrCreate(
                        ['category_id' => $id, 'sales_channel_id' => $channelId],
                        ['tenant_id' => $tenantId, 'is_published' => $publish],
                    );
                });
                $results[] = ['id' => $id, 'status' => 'updated'];
                $summary['updated']++;
            } catch (\Throwable $exception) {
                report($exception);
                $results[] = ['id' => $id, 'status' => 'failed', 'reason' => 'error'];
                $summary['failed']++;
            }
        }

        return [
            'action' => $publish ? 'publish' : 'unpublish',
            'storefront_id' => (string) $storefront->id,
            'summary' => $summary,
            'results' => $results,
        ];
    }

    private function tenantId(): string
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $tenantId;
    }

    private function assertCategoryTenant(ProductCategory $category, string $tenantId): void
    {
        if ($category->tenant_id !== $tenantId) {
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

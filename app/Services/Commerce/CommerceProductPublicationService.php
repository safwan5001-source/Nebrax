<?php

namespace App\Services\Commerce;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
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
        $authorizedIds = $storefronts->pluck('id')->all();
        $requestedIds = array_values(array_unique($storefrontIds));

        if (array_diff($requestedIds, $authorizedIds) !== []) {
            abort(422, 'أحد المتاجر المحددة غير متاح لهذا المستأجر.');
        }

        $requestedChannelIds = $storefronts
            ->whereIn('id', $requestedIds)
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

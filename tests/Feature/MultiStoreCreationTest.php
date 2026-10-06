<?php
namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CreateStorefrontForCurrentTenant;
use App\Support\ManagedStorefrontHostname;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MultiStoreCreationTest extends TestCase
{
    use RefreshDatabase;

    private function tenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => $slug,
            'slug' => $slug,
            'vat_number' => '3'.str_pad((string) random_int(1, 9999999999999), 13, '0', STR_PAD_LEFT),
            'currency' => 'SAR',
            'is_active' => true,
        ]);
    }

    private function create(Tenant $tenant, string $name): array
    {
        app(TenantContext::class)->set($tenant->id);
        try {
            return app(CreateStorefrontForCurrentTenant::class)->create($name);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function it_creates_second_and_third_stores_with_independent_graphs_and_hostnames(): void
    {
        config(['storefront.managed_base_domain' => 'store.awjdev.xyz']);
        $tenant = $this->tenant('multi');
        $second = $this->create($tenant, 'Gifts');
        $third = $this->create($tenant, 'Gifts');

        $this->assertNotSame($second['id'], $third['id']);
        $this->assertNotSame($second['sales_channel_id'], $third['sales_channel_id']);
        $this->assertSame('https://gifts.multi.store.awjdev.xyz/', $second['preview_url']);
        $this->assertSame('https://gifts-2.multi.store.awjdev.xyz/', $third['preview_url']);

        app(TenantContext::class)->set($tenant->id);
        $this->assertSame(2, SalesChannel::query()->where('type', SalesChannel::TYPE_WEB)->count());
        $this->assertSame(2, Storefront::query()->count());
        $this->assertSame(2, StorefrontDomain::query()->count());
        $this->assertSame(2, StorefrontDomain::query()->where('tenant_id', $tenant->id)->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function it_keeps_first_store_hostname_contract_unchanged(): void
    {
        config(['storefront.managed_base_domain' => 'store.awjdev.xyz']);
        $tenant = $this->tenant('legacy');
        app(TenantContext::class)->set($tenant->id);
        app(\App\Services\Commerce\StorefrontProvisioningService::class)->provisionFirstStorefrontForCurrentTenant();
        app(TenantContext::class)->forget();
        $additional = $this->create($tenant, 'Second');
        $firstDomain = StorefrontDomain::withoutGlobalScopes()->where('hostname', 'legacy.store.awjdev.xyz')->sole();
        $this->assertSame('legacy.store.awjdev.xyz', $firstDomain->hostname);
        $this->assertSame('https://second.legacy.store.awjdev.xyz/', $additional['preview_url']);
    }

    /** @test */
    public function it_is_scoped_to_current_tenant_and_does_not_use_a_foreign_channel(): void
    {
        $tenantA = $this->tenant('tenant-a');
        $tenantB = $this->tenant('tenant-b');
        $foreign = $this->create($tenantB, 'Foreign');
        $local = $this->create($tenantA, 'Local');

        $this->assertNotSame($foreign['sales_channel_id'], $local['sales_channel_id']);
        $this->assertSame($tenantA->id, Storefront::withoutGlobalScopes()->findOrFail($local['id'])->tenant_id);
        $this->assertSame($tenantA->id, SalesChannel::withoutGlobalScopes()->findOrFail($local['sales_channel_id'])->tenant_id);
        $this->assertSame($tenantA->id, StorefrontDomain::withoutGlobalScopes()->where('storefront_id', $local['id'])->sole()->tenant_id);
    }

    /** @test */
    public function failed_hostname_generation_rolls_back_the_entire_graph(): void
    {
        config(['storefront.managed_base_domain' => 'not a host']);
        $tenant = $this->tenant('rollback');
        $this->expectException(\App\Support\StorefrontBaseDomainMisconfiguredException::class);
        try {
            $this->create($tenant, 'Rollback');
        } finally {
            app(TenantContext::class)->set($tenant->id);
            $this->assertSame(0, SalesChannel::query()->count());
            $this->assertSame(0, Storefront::query()->count());
            $this->assertSame(0, StorefrontDomain::query()->count());
            app(TenantContext::class)->forget();
        }
    }
}

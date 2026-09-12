<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * COM-7-P3A — public storefront identity on GET store/v1/storefront.
 *
 * تشغيل: php artisan test --filter=StorefrontPublicIdentityTest
 */
class StorefrontPublicIdentityTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain} */
    private function seedDomainStore(string $hostname, array $storefrontOverrides = []): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$hostname}", 'slug' => 'id-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $storefront = Storefront::create(array_merge([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ], $storefrontOverrides));

        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront', 'domain');
    }

    /** @test */
    public function storefront_config_exposes_the_resolved_store_name_and_hides_internal_ids(): void
    {
        ['domain' => $domain] = $this->seedDomainStore('identity-host.example.com', [
            'name' => 'شركة دمينة للاستيراد والتصدير',
            'default_locale' => 'ar',
        ]);

        $res = $this->getJson("http://{$domain->hostname}/store/v1/storefront")->assertOk();

        $this->assertSame('شركة دمينة للاستيراد والتصدير', $res->json('data.name'));
        $this->assertSame('ar', $res->json('data.default_locale'));
        $this->assertArrayNotHasKey('tenant_id', $res->json('data'));
        $this->assertArrayNotHasKey('sales_channel_id', $res->json('data'));
        $this->assertArrayNotHasKey('storefront_id', $res->json('data'));
    }

    /** @test */
    public function storefront_config_does_not_return_another_tenants_name(): void
    {
        config(['storefront.gateway_secret' => 'test-shared-secret']);
        $this->seedDomainStore('name-a.example.com', ['name' => 'متجر ألف']);
        $this->seedDomainStore('name-b.example.com', ['name' => 'متجر باء']);

        $res = $this->withHeaders([
            'X-Storefront-Forwarded-Host' => 'name-a.example.com',
            'X-Storefront-Gateway-Secret' => 'test-shared-secret',
        ])->getJson('http://laravel-internal.test/store/v1/storefront');

        $res->assertOk();
        $this->assertSame('متجر ألف', $res->json('data.name'));
        $this->assertNotSame('متجر باء', $res->json('data.name'));
    }

    /** @test */
    public function storefront_config_fails_closed_for_an_unknown_hostname(): void
    {
        $this->getJson('http://unknown-host.example.com/store/v1/storefront')
            ->assertStatus(404);
    }

    /** @test */
    public function the_legacy_path_uses_the_tenant_name_because_it_resolves_no_storefront(): void
    {
        $tenant = Tenant::create([
            'name' => 'متجر متوارَث', 'slug' => 'legacy-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$tenant->slug}/storefront")->assertOk();

        $this->assertNull($res->json('data.default_locale'));
        $this->assertSame('متجر متوارَث', $res->json('data.name'));
    }
}

<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUSTOM-DOMAIN-EDGE-1 — أعمدة Edge/TLS: توافق رجعي، افتراضات آمنة،
 * بلا تفعيل تلقائي وبلا اتصال Railway.
 *
 * تشغيل: php artisan test --filter=StorefrontDomainEdgeStateMigrationTest
 */
class StorefrontDomainEdgeStateMigrationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedStorefront(string $tenantId): Storefront
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return $storefront;
    }

    /** @test */
    public function a_historical_awj_managed_row_defaults_edge_to_none_and_stays_valid(): void
    {
        $auth = $this->registerTenant('edge-mig-awj', 'owner@edge-mig-awj.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'historical-edge.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->assertSame(StorefrontDomain::EDGE_NONE, $domain->edge_status);
        $this->assertNull($domain->edge_provider);
        $this->assertNull($domain->edge_provider_id);
        $this->assertNull($domain->edge_dns_instructions);
        $this->assertNull($domain->edge_last_error);
        $this->assertNull($domain->edge_checked_at);
        $this->assertNull($domain->edge_ready_at);
        $this->assertTrue($domain->isVerified());
    }

    /** @test */
    public function an_existing_verified_custom_row_is_not_auto_provisioned(): void
    {
        $auth = $this->registerTenant('edge-mig-custom', 'owner@edge-mig-custom.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'shop.edge-mig-custom.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
            'verification_token' => 'token-not-a-railway-id',
        ]);
        app(TenantContext::class)->forget();

        $domain->refresh();
        $this->assertSame(StorefrontDomain::EDGE_NONE, $domain->edge_status);
        $this->assertNull($domain->edge_provider_id);
        $this->assertNull($domain->edge_ready_at);
        $this->assertSame(StorefrontDomain::VERIFICATION_VERIFIED, $domain->verification_status);
    }

    /** @test */
    public function workspace_json_never_leaks_provider_id_or_raw_edge_columns(): void
    {
        $auth = $this->registerTenant('edge-mig-leak', 'owner@edge-mig-leak.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'shop.edge-mig-leak.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
            'verification_token' => 'secret-awj-token',
            'edge_status' => StorefrontDomain::EDGE_DNS_REQUIRED,
            'edge_provider' => 'railway',
            'edge_provider_id' => 'secret-railway-domain-id',
            'edge_dns_instructions' => [
                'records' => [
                    ['type' => 'CNAME', 'name' => 'shop.edge-mig-leak.example.com', 'value' => 'g05ns7.up.railway.app'],
                ],
            ],
        ]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson('/api/commerce/workspace/storefronts/'.$storefront->id.'/domains')
            ->assertOk();

        $row = collect($res->json('data.domains'))->firstWhere('hostname', 'shop.edge-mig-leak.example.com');
        $this->assertNotNull($row);
        $this->assertArrayNotHasKey('edge_provider_id', $row);
        $this->assertArrayNotHasKey('edge_provider', $row);
        $this->assertArrayNotHasKey('verification_token', $row);
        $this->assertSame(StorefrontDomain::EDGE_DNS_REQUIRED, $row['edge']['status']);
        $this->assertArrayNotHasKey('provider_id', $row['edge']);
        $this->assertStringNotContainsString('secret-railway-domain-id', $res->getContent());
    }
}

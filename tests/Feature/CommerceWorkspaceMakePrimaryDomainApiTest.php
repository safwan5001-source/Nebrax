<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\Edge\FakeStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-3B — `POST .../domains/{domainId}/make-primary`:
 * تبديل أساسي آمن لنطاق AWJ مؤهل، ورفض فشلٍ مغلق لنطاق مخصَّص (لا دليل
 * Edge/TLS)، وعزل المستأجر/المتجر (404 لا 403)، وRBAC.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceMakePrimaryDomainApiTest
 */
class CommerceWorkspaceMakePrimaryDomainApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private FakeStorefrontEdgeClient $edge;

    protected function setUp(): void
    {
        parent::setUp();
        $this->edge = new FakeStorefrontEdgeClient();
        $this->app->instance(StorefrontEdgeClient::class, $this->edge);
    }

    private function path(string $storefrontId, string $domainId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains/'.$domainId.'/make-primary';
    }

    /**
     * @return array{storefront: Storefront, primary: StorefrontDomain, other: StorefrontDomain}
     */
    private function seedTwoAwjDomains(string $tenantId, string $prefix): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $primary = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $prefix.'-a.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $other = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $prefix.'-b.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'primary' => $primary, 'other' => $other];
    }

    /**
     * @return array{storefront: Storefront, domain: StorefrontDomain}
     */
    private function seedCustomDomainOn(Storefront $storefront, string $tenantId, string $hostname, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);
        $domain = StorefrontDomain::create(array_merge([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
        ], $overrides));
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'domain' => $domain];
    }

    /** @test */
    public function an_authorized_owner_can_make_an_eligible_awj_managed_domain_primary(): void
    {
        $auth = $this->registerTenant('mp-owner', 'owner@mp-owner.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-owner');

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['other']->id))
            ->assertOk();

        $this->assertTrue($res->json('data.domain.is_primary'));
        $this->assertSame($seeded['other']->id, $res->json('data.domain.id'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['other']->id)->is_primary);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['primary']->id)->is_primary);
        $this->assertSame(1, StorefrontDomain::query()->where('storefront_id', $seeded['storefront']->id)->where('is_primary', true)->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_authorized_admin_can_make_an_eligible_awj_managed_domain_primary(): void
    {
        $auth = $this->registerTenant('mp-admin', 'owner@mp-admin.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-admin');
        $admin = $this->tokenForRole($auth['tenant_id'], 'admin', 'admin@mp-admin.test');

        $this->withToken($admin)
            ->postJson($this->path($seeded['storefront']->id, $seeded['other']->id))
            ->assertOk();
    }

    /** @test */
    public function making_the_current_primary_awj_domain_primary_again_is_idempotent(): void
    {
        $auth = $this->registerTenant('mp-idempotent', 'owner@mp-idempotent.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-idempotent');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['primary']->id))
            ->assertOk()
            ->assertJsonPath('data.domain.is_primary', true);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['primary']->id)->is_primary);
        $this->assertFalse(StorefrontDomain::query()->find($seeded['other']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_verified_custom_domain_cannot_become_primary_without_edge_tls_readiness(): void
    {
        $auth = $this->registerTenant('mp-custom-verified', 'owner@mp-custom-verified.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-custom-verified');
        $custom = $this->seedCustomDomainOn($seeded['storefront'], $auth['tenant_id'], 'mp-custom-verified.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
        ]);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $custom['domain']->id));

        $res->assertStatus(422);
        $this->assertStringContainsString('تفعيل', (string) $res->json('message'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($custom['domain']->id)->is_primary);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['primary']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_custom_domain_with_persisted_ready_still_cannot_become_primary_without_live_provider_ready(): void
    {
        $auth = $this->registerTenant('mp-custom-ready', 'owner@mp-custom-ready.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-custom-ready');
        $custom = $this->seedCustomDomainOn($seeded['storefront'], $auth['tenant_id'], 'shop.mp-custom-ready.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
            'edge_status' => StorefrontDomain::EDGE_READY,
            'edge_provider' => 'railway',
            'edge_provider_id' => 'dom-ready-but-make-primary-still-closed',
            'edge_ready_at' => now(),
            'edge_checked_at' => now(),
        ]);
        $this->edge->unknownIdsAreMissing = true;

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $custom['domain']->id));

        $res->assertStatus(422);
        $this->assertStringContainsString('تفعيل', (string) $res->json('message'));
        $this->assertSame(0, $this->edge->provisionCalls);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($custom['domain']->id)->is_primary);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['primary']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_pending_custom_domain_cannot_become_primary(): void
    {
        $auth = $this->registerTenant('mp-custom-pending', 'owner@mp-custom-pending.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-custom-pending');
        $custom = $this->seedCustomDomainOn($seeded['storefront'], $auth['tenant_id'], 'mp-custom-pending.example.com');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $custom['domain']->id))
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($custom['domain']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_failed_custom_domain_cannot_become_primary(): void
    {
        $auth = $this->registerTenant('mp-custom-failed', 'owner@mp-custom-failed.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-custom-failed');
        $custom = $this->seedCustomDomainOn($seeded['storefront'], $auth['tenant_id'], 'mp-custom-failed.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_FAILED,
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $custom['domain']->id))
            ->assertStatus(422);
    }

    /** @test */
    public function an_inactive_awj_managed_domain_cannot_become_primary(): void
    {
        $auth = $this->registerTenant('mp-inactive', 'owner@mp-inactive.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-inactive');

        app(TenantContext::class)->set($auth['tenant_id']);
        $seeded['other']->forceFill(['is_active' => false])->save();
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['other']->id))
            ->assertStatus(422);
    }

    /** @test */
    public function client_cannot_supply_authority_fields_to_force_primary(): void
    {
        $auth = $this->registerTenant('mp-authority', 'owner@mp-authority.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-authority');
        $custom = $this->seedCustomDomainOn($seeded['storefront'], $auth['tenant_id'], 'mp-authority.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $custom['domain']->id), [
                'is_primary' => true,
                'is_active' => true,
                'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
                'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
                'edge_ready' => true,
                'tls_ready' => true,
            ])
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($custom['domain']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_domain_returns_404(): void
    {
        $a = $this->registerTenant('mp-idor-a', 'owner@mp-idor-a.test');
        $b = $this->registerTenant('mp-idor-b', 'owner@mp-idor-b.test');
        $seededB = $this->seedTwoAwjDomains($b['tenant_id'], 'mp-idor-b');

        $this->withToken($a['token'])
            ->postJson($this->path($seededB['storefront']->id, $seededB['other']->id))
            ->assertNotFound();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertFalse(StorefrontDomain::query()->find($seededB['other']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_domain_belonging_to_another_storefront_returns_404(): void
    {
        $auth = $this->registerTenant('mp-other-sf', 'owner@mp-other-sf.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-other-sf');

        app(TenantContext::class)->set($auth['tenant_id']);
        $otherChannel = SalesChannel::create([
            'slug' => 'web-2', 'name' => 'ويب 2', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $otherStorefront = Storefront::create([
            'slug' => 'second', 'name' => 'متجر آخر', 'sales_channel_id' => $otherChannel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson($this->path($otherStorefront->id, $seeded['other']->id))
            ->assertNotFound();
    }

    /** @test */
    public function an_unknown_domain_id_returns_404(): void
    {
        $auth = $this->registerTenant('mp-unknown', 'owner@mp-unknown.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-unknown');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, '00000000-0000-0000-0000-000000000000'))
            ->assertNotFound();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('mp-staff', 'owner@mp-staff.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-staff');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@mp-staff.test');

        $this->withToken($staff)
            ->postJson($this->path($seeded['storefront']->id, $seeded['other']->id))
            ->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('mp-ss', 'owner@mp-ss.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-ss');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@mp-ss.test');

        $this->withToken($ss)
            ->postJson($this->path($seeded['storefront']->id, $seeded['other']->id))
            ->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('mp-guest', 'owner@mp-guest.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-guest');

        $this->postJson($this->path($seeded['storefront']->id, $seeded['other']->id))
            ->assertUnauthorized();
    }

    /** @test */
    public function primary_uniqueness_remains_valid_after_a_successful_switch(): void
    {
        $auth = $this->registerTenant('mp-unique', 'owner@mp-unique.test');
        $seeded = $this->seedTwoAwjDomains($auth['tenant_id'], 'mp-unique');

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id, $seeded['other']->id))
            ->assertOk();

        $this->assertSame(
            1,
            StorefrontDomain::withoutGlobalScope(TenantScope::class)
                ->where('storefront_id', $seeded['storefront']->id)
                ->where('is_primary', true)
                ->count()
        );
    }
}

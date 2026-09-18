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
 * STORE-ADMIN-ADOPT-1B-3B — `DELETE .../domains/{domainId}`:
 * فصل نطاق مخصَّص غير أساسي، حماية نطاق AWJ والأساسي الحالي، عزل
 * المستأجر/المتجر (404 لا 403)، وإثبات أن النطاق المفصول لا يُحسم عاماً.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceDisconnectCustomDomainApiTest
 */
class CommerceWorkspaceDisconnectCustomDomainApiTest extends TestCase
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
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains/'.$domainId;
    }

    /**
     * @return array{storefront: Storefront, managed: StorefrontDomain, custom: StorefrontDomain}
     */
    private function seedManagedAndCustom(string $tenantId, string $prefix, array $customOverrides = []): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $managed = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $prefix.'.awj-commerce.test',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $custom = StorefrontDomain::create(array_merge([
            'storefront_id' => $storefront->id,
            'hostname' => $prefix.'.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ], $customOverrides));
        app(TenantContext::class)->forget();

        return ['storefront' => $storefront, 'managed' => $managed, 'custom' => $custom];
    }

    /** @test */
    public function a_custom_non_primary_domain_can_be_disconnected(): void
    {
        $auth = $this->registerTenant('dc-owner', 'owner@dc-owner.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-owner');
        $customId = $seeded['custom']->id;
        $customHostname = $seeded['custom']->hostname;

        $this->withToken($auth['token'])
            ->deleteJson($this->path($seeded['storefront']->id, $customId))
            ->assertOk()
            ->assertJsonPath('data.disconnected', true);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNull(StorefrontDomain::query()->find($customId));
        $this->assertNull(
            StorefrontDomain::withoutGlobalScope(TenantScope::class)->where('hostname', $customHostname)->first()
        );
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['managed']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_awj_managed_domain_cannot_be_disconnected(): void
    {
        $auth = $this->registerTenant('dc-managed', 'owner@dc-managed.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-managed');

        $res = $this->withToken($auth['token'])
            ->deleteJson($this->path($seeded['storefront']->id, $seeded['managed']->id));

        $res->assertStatus(422);
        $this->assertStringContainsString('أَوْج', (string) $res->json('message'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['managed']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_primary_custom_domain_cannot_be_disconnected_directly(): void
    {
        $auth = $this->registerTenant('dc-primary-custom', 'owner@dc-primary-custom.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-primary-custom');

        app(TenantContext::class)->set($auth['tenant_id']);
        $seeded['managed']->forceFill(['is_primary' => false])->save();
        $seeded['custom']->forceFill(['is_primary' => true])->save();
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->deleteJson($this->path($seeded['storefront']->id, $seeded['custom']->id));

        $res->assertStatus(422);
        $this->assertStringContainsString('الأساسي', (string) $res->json('message'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['custom']->id));
        $this->assertTrue(StorefrontDomain::query()->find($seeded['custom']->id)->is_primary);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_disconnected_domain_cannot_resolve_publicly(): void
    {
        $auth = $this->registerTenant('dc-resolve', 'owner@dc-resolve.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-resolve');
        $hostname = $seeded['custom']->hostname;

        $this->getJson('http://'.$hostname.'/store/v1/storefront')->assertOk();

        $this->withToken($auth['token'])
            ->deleteJson($this->path($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk();

        $this->getJson('http://'.$hostname.'/store/v1/storefront')->assertNotFound();

        $this->getJson('http://'.$seeded['managed']->hostname.'/store/v1/storefront')->assertOk();
    }

    /** @test */
    public function disconnecting_one_custom_domain_does_not_affect_an_unrelated_domain(): void
    {
        $auth = $this->registerTenant('dc-unrelated', 'owner@dc-unrelated.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-unrelated');

        app(TenantContext::class)->set($auth['tenant_id']);
        $otherCustom = StorefrontDomain::create([
            'storefront_id' => $seeded['storefront']->id,
            'hostname' => 'dc-unrelated-other.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->deleteJson($this->path($seeded['storefront']->id, $seeded['custom']->id))
            ->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNull(StorefrontDomain::query()->find($seeded['custom']->id));
        $this->assertNotNull(StorefrontDomain::query()->find($otherCustom->id));
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['managed']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function client_cannot_supply_authority_fields_to_force_a_disconnect(): void
    {
        $auth = $this->registerTenant('dc-authority', 'owner@dc-authority.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-authority');

        $this->withToken($auth['token'])
            ->deleteJson($this->path($seeded['storefront']->id, $seeded['managed']->id), [
                'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_primary' => false,
                'force' => true,
            ])
            ->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['managed']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_domain_returns_404(): void
    {
        $a = $this->registerTenant('dc-idor-a', 'owner@dc-idor-a.test');
        $b = $this->registerTenant('dc-idor-b', 'owner@dc-idor-b.test');
        $seededB = $this->seedManagedAndCustom($b['tenant_id'], 'dc-idor-b');

        $this->withToken($a['token'])
            ->deleteJson($this->path($seededB['storefront']->id, $seededB['custom']->id))
            ->assertNotFound();

        $this->assertSame(0, $this->edge->releaseCalls);

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seededB['custom']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_domain_belonging_to_another_storefront_returns_404(): void
    {
        $auth = $this->registerTenant('dc-other-sf', 'owner@dc-other-sf.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-other-sf');

        app(TenantContext::class)->set($auth['tenant_id']);
        $otherChannel = SalesChannel::create([
            'slug' => 'web-2', 'name' => 'ويب 2', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $otherStorefront = Storefront::create([
            'slug' => 'second', 'name' => 'متجر آخر', 'sales_channel_id' => $otherChannel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->deleteJson($this->path($otherStorefront->id, $seeded['custom']->id))
            ->assertNotFound();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertNotNull(StorefrontDomain::query()->find($seeded['custom']->id));
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_unknown_domain_id_returns_404(): void
    {
        $auth = $this->registerTenant('dc-unknown', 'owner@dc-unknown.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-unknown');

        $this->withToken($auth['token'])
            ->deleteJson($this->path($seeded['storefront']->id, '00000000-0000-0000-0000-000000000000'))
            ->assertNotFound();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('dc-staff', 'owner@dc-staff.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-staff');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@dc-staff.test');

        $this->withToken($staff)
            ->deleteJson($this->path($seeded['storefront']->id, $seeded['custom']->id))
            ->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('dc-ss', 'owner@dc-ss.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-ss');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@dc-ss.test');

        $this->withToken($ss)
            ->deleteJson($this->path($seeded['storefront']->id, $seeded['custom']->id))
            ->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('dc-guest', 'owner@dc-guest.test');
        $seeded = $this->seedManagedAndCustom($auth['tenant_id'], 'dc-guest');

        $this->deleteJson($this->path($seeded['storefront']->id, $seeded['custom']->id))
            ->assertUnauthorized();
    }
}

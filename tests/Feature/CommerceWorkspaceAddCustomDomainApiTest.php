<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * STORE-ADMIN-ADOPT-1B-3A — `POST /api/commerce/workspace/storefronts/{id}/domains`:
 * إضافة نطاق مخصَّص، عزل المستأجر (IDOR: 404 لا 403)، RBAC (`commerce.manage`)،
 * حماية نطاق AWJ المُدار، تفرّد عالمي، وعدم قبول أي حقل سلطة من العميل.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceAddCustomDomainApiTest
 */
class CommerceWorkspaceAddCustomDomainApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.managed_base_domain' => 'store.awjdev.test']);
    }

    private function path(string $storefrontId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/domains';
    }

    /**
     * @return array{channel: SalesChannel, storefront: Storefront}
     */
    private function seedWebStorefront(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return ['channel' => $channel, 'storefront' => $storefront];
    }

    /** @test */
    public function an_authorized_owner_can_add_a_valid_custom_domain(): void
    {
        $auth = $this->registerTenant('add-domain-owner', 'owner@add-domain-owner.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'shop.custom-add.example.com'])
            ->assertCreated();

        $row = $res->json('data.domain');
        $this->assertSame('shop.custom-add.example.com', $row['hostname']);
        $this->assertSame(StorefrontDomain::TYPE_CUSTOM, $row['type']);
        $this->assertFalse($row['is_primary']);
        $this->assertTrue($row['is_active']);
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $row['verification_status']);
        $this->assertSame('dns_txt', $row['verification']['method']);
        $this->assertSame('_awj-verification.shop.custom-add.example.com', $row['verification']['record_name']);
        $this->assertStringStartsWith('awj-domain-verification=', $row['verification']['record_value']);
        $this->assertNull($row['verification']['verified_at']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->where('hostname', 'shop.custom-add.example.com')->first();
        $this->assertNotNull($stored);
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $stored->verification_status);
        $this->assertNotNull($stored->verification_token);
        $this->assertNull($stored->verified_at);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function hostname_is_normalized_via_the_central_hostname_normalizer(): void
    {
        $auth = $this->registerTenant('add-domain-normalize', 'owner@add-domain-normalize.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'HTTPS://Shop.Normalize-Example.COM:443/some/path'])
            ->assertCreated();

        $this->assertSame('shop.normalize-example.com', $res->json('data.domain.hostname'));
    }

    /** @test */
    public function the_client_cannot_supply_authority_fields(): void
    {
        $auth = $this->registerTenant('add-domain-authority', 'owner@add-domain-authority.test');
        $other = $this->registerTenant('add-domain-authority-other', 'owner@add-domain-authority-other.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $res = $this->withToken($auth['token'])->postJson($this->path($seeded['storefront']->id), [
            'hostname' => 'authority-test.example.com',
            'tenant_id' => $other['tenant_id'],
            'storefront_id' => 'not-a-real-id',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verification_token' => 'attacker-chosen-token',
            'verified_at' => now()->toIso8601String(),
            'is_primary' => true,
            'is_active' => false,
        ])->assertCreated();

        $row = $res->json('data.domain');
        $this->assertSame(StorefrontDomain::TYPE_CUSTOM, $row['type']);
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $row['verification_status']);
        $this->assertFalse($row['is_primary']);
        $this->assertTrue($row['is_active']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = StorefrontDomain::query()->where('hostname', 'authority-test.example.com')->first();
        $this->assertSame($auth['tenant_id'], $stored->tenant_id);
        $this->assertSame($seeded['storefront']->id, $stored->storefront_id);
        $this->assertNotSame('attacker-chosen-token', $stored->verification_token);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_hostname_inside_the_awj_managed_namespace_is_rejected(): void
    {
        $auth = $this->registerTenant('add-domain-managed-ns', 'owner@add-domain-managed-ns.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'fake.store.awjdev.test'])
            ->assertStatus(422);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'store.awjdev.test'])
            ->assertStatus(422);
    }

    /** @test */
    public function a_malformed_hostname_is_rejected(): void
    {
        $auth = $this->registerTenant('add-domain-malformed', 'owner@add-domain-malformed.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'not a valid host!!'])
            ->assertStatus(422);

        $this->withToken($auth['token'])
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'localhost'])
            ->assertStatus(422);
    }

    /** @test */
    public function a_duplicate_global_hostname_is_rejected_with_409(): void
    {
        $a = $this->registerTenant('add-domain-dup-a', 'owner@add-domain-dup-a.test');
        $b = $this->registerTenant('add-domain-dup-b', 'owner@add-domain-dup-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $this->withToken($a['token'])
            ->postJson($this->path($seededA['storefront']->id), ['hostname' => 'duplicate-across-tenants.example.com'])
            ->assertCreated();

        $this->withToken($b['token'])
            ->postJson($this->path($seededB['storefront']->id), ['hostname' => 'duplicate-across-tenants.example.com'])
            ->assertStatus(409);

        app(TenantContext::class)->set($a['tenant_id']);
        $this->assertSame(1, StorefrontDomain::withoutGlobalScope(\App\Tenancy\TenantScope::class)
            ->where('hostname', 'duplicate-across-tenants.example.com')->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_storefront_id_returns_404_and_leaks_nothing(): void
    {
        $a = $this->registerTenant('add-domain-idor-a', 'owner@add-domain-idor-a.test');
        $b = $this->registerTenant('add-domain-idor-b', 'owner@add-domain-idor-b.test');
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        $res = $this->withToken($a['token'])
            ->postJson($this->path($seededB['storefront']->id), ['hostname' => 'idor-attempt.example.com']);

        $res->assertNotFound();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertSame(0, StorefrontDomain::query()->where('hostname', 'idor-attempt.example.com')->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_unknown_storefront_id_returns_404(): void
    {
        $auth = $this->registerTenant('add-domain-missing', 'owner@add-domain-missing.test');

        $this->withToken($auth['token'])
            ->postJson($this->path('00000000-0000-0000-0000-000000000000'), ['hostname' => 'missing-store.example.com'])
            ->assertNotFound();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('add-domain-staff', 'owner@add-domain-staff.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@add-domain-staff.test');

        $this->withToken($staff)
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'staff-denied.example.com'])
            ->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('add-domain-ss', 'owner@add-domain-ss.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@add-domain-ss.test');

        $this->withToken($ss)
            ->postJson($this->path($seeded['storefront']->id), ['hostname' => 'ss-denied.example.com'])
            ->assertForbidden();
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('add-domain-guest', 'owner@add-domain-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->postJson($this->path($seeded['storefront']->id), ['hostname' => 'guest-denied.example.com'])
            ->assertUnauthorized();
    }
}

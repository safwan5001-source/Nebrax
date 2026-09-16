<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * COM-STORE-PROVISION-1 — `POST /api/commerce/workspace/storefronts` عند
 * مستوى الـHTTP: RBAC (`commerce.manage`)، عزل المستأجر، رفض هوية العميل
 * (hostname/tenant/verification)، تعارض النطاق، وتكامل حسم `ResolveStorefrontDomain`
 * العام مع النطاق المُنشأ فعلياً — بلا أي تعديل على الوسيط نفسه.
 *
 * تشغيل: php artisan test --filter=StorefrontProvisioningApiSecurityTest
 */
class StorefrontProvisioningApiSecurityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PATH = '/api/commerce/workspace/storefronts';

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.managed_base_domain' => 'storefronts.test']);
    }

    /** @test */
    public function an_authorized_owner_can_provision_the_first_storefront(): void
    {
        $auth = $this->registerTenant('alrshd', 'owner@alrshd.test');

        $res = $this->withToken($auth['token'])->postJson(self::PATH)->assertCreated();

        $this->assertSame('https://alrshd.storefronts.test/', $res->json('data.store.preview_url'));
        $this->assertTrue($res->json('meta.created'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $domain = StorefrontDomain::query()->sole();
        app(TenantContext::class)->forget();

        $this->assertSame('alrshd.storefronts.test', $domain->hostname);
        $this->assertSame(StorefrontDomain::TYPE_AWJ_SUBDOMAIN, $domain->type);
        $this->assertTrue($domain->isVerified());
        $this->assertTrue($domain->is_active);
    }

    /** @test */
    public function repeated_calls_are_idempotent_over_http(): void
    {
        $auth = $this->registerTenant('idem', 'owner@idem.test');

        $this->withToken($auth['token'])->postJson(self::PATH)->assertCreated();
        $second = $this->withToken($auth['token'])->postJson(self::PATH)->assertOk();

        $this->assertFalse($second->json('meta.created'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(1, StorefrontDomain::query()->count());
        $this->assertSame(1, Storefront::query()->count());
        $this->assertSame(1, SalesChannel::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function guests_are_rejected_and_nothing_is_created(): void
    {
        $this->postJson(self::PATH)->assertUnauthorized();
    }

    /** @test */
    public function self_service_principals_cannot_provision_a_storefront(): void
    {
        $auth = $this->registerTenant('ss-provision', 'owner@ss-provision.test');
        $token = $this->tokenForRole($auth['tenant_id'], 'self_service', 'customer@ss-provision.test');

        $this->withToken($token)->postJson(self::PATH)->assertForbidden();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, SalesChannel::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_cannot_provision_a_storefront(): void
    {
        $auth = $this->registerTenant('staff-provision', 'owner@staff-provision.test');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@staff-provision.test');

        $this->withToken($staff)->postJson(self::PATH)->assertForbidden();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, SalesChannel::query()->count());
        $this->assertSame(0, Storefront::query()->count());
        $this->assertSame(0, StorefrontDomain::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function an_accountant_without_commerce_manage_cannot_provision_a_storefront(): void
    {
        $auth = $this->registerTenant('acct-provision', 'owner@acct-provision.test');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acct@acct-provision.test');

        $this->withToken($accountant)->postJson(self::PATH)->assertForbidden();
    }

    /** @test */
    public function tenant_a_cannot_provision_a_storefront_for_tenant_b(): void
    {
        $a = $this->registerTenant('tenant-a-prov', 'owner@a-prov.test');
        $b = $this->registerTenant('tenant-b-prov', 'owner@b-prov.test');

        // No client-supplied tenant identity exists in this endpoint's contract
        // at all — proving isolation means proving that trying to smuggle one
        // in has zero effect, not that a parameter is rejected.
        $this->withToken($a['token'])->postJson(self::PATH, [
            'tenant_id' => $b['tenant_id'],
        ])->assertCreated();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertSame(0, SalesChannel::query()->count());
        $this->assertSame(0, Storefront::query()->count());
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($a['tenant_id']);
        $domain = StorefrontDomain::query()->sole();
        app(TenantContext::class)->forget();
        $this->assertSame('tenant-a-prov.storefronts.test', $domain->hostname);
    }

    /** @test */
    public function the_client_cannot_choose_the_generated_hostname(): void
    {
        $auth = $this->registerTenant('no-hostname-input', 'owner@no-hostname-input.test');

        $res = $this->withToken($auth['token'])->postJson(self::PATH, [
            'hostname' => 'evil-attacker-domain.com',
        ])->assertCreated();

        $this->assertSame('https://no-hostname-input.storefronts.test/', $res->json('data.store.preview_url'));
        $this->assertStringNotContainsString('evil-attacker-domain.com', $res->getContent());
    }

    /** @test */
    public function the_client_cannot_choose_verification_status_or_domain_type(): void
    {
        $auth = $this->registerTenant('no-verification-input', 'owner@no-verification-input.test');

        $this->withToken($auth['token'])->postJson(self::PATH, [
            'verification_status' => 'failed',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => false,
        ])->assertCreated();

        app(TenantContext::class)->set($auth['tenant_id']);
        $domain = StorefrontDomain::query()->sole();
        app(TenantContext::class)->forget();

        $this->assertTrue($domain->isVerified());
        $this->assertSame(StorefrontDomain::TYPE_AWJ_SUBDOMAIN, $domain->type);
        $this->assertTrue($domain->is_active);
    }

    /** @test */
    public function a_hostname_collision_with_another_tenant_fails_closed_with_a_conflict(): void
    {
        $other = $this->registerTenant('conflict-owner', 'owner@conflict-owner.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $otherChannel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $otherStorefront = Storefront::create(['slug' => 'main', 'name' => 'متجر', 'sales_channel_id' => $otherChannel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $otherStorefront->id,
            'hostname' => 'conflict-slug.storefronts.test',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $auth = $this->registerTenant('conflict-slug', 'owner@conflict-slug.test');

        $this->withToken($auth['token'])->postJson(self::PATH)->assertStatus(409);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Storefront::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_pending_custom_domain_is_left_untouched_by_provisioning_the_managed_domain(): void
    {
        $auth = $this->registerTenant('custom-untouched', 'owner@custom-untouched.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'متجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        $custom = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'shop.merchant-owned.example',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->postJson(self::PATH)->assertCreated();

        $custom->refresh();
        $this->assertSame(StorefrontDomain::VERIFICATION_PENDING, $custom->verification_status);
        $this->assertSame(StorefrontDomain::TYPE_CUSTOM, $custom->type);

        app(TenantContext::class)->set($auth['tenant_id']);
        $managed = StorefrontDomain::query()->where('type', StorefrontDomain::TYPE_AWJ_SUBDOMAIN)->sole();
        app(TenantContext::class)->forget();
        $this->assertTrue($managed->isVerified());
    }

    /** @test */
    public function missing_managed_base_domain_configuration_returns_a_server_error_and_creates_no_partial_graph(): void
    {
        config(['storefront.managed_base_domain' => '']);
        $auth = $this->registerTenant('misconfigured', 'owner@misconfigured.test');

        $this->withToken($auth['token'])->postJson(self::PATH)->assertStatus(500);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, SalesChannel::query()->count());
        $this->assertSame(0, Storefront::query()->count());
        $this->assertSame(0, StorefrontDomain::query()->count());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function the_provisioned_managed_domain_resolves_correctly_through_the_unmodified_public_resolver(): void
    {
        $auth = $this->registerTenant('resolver-integration', 'owner@resolver-integration.test');
        $created = $this->withToken($auth['token'])->postJson(self::PATH)->assertCreated();
        $storefrontName = $created->json('data.store.name');

        $res = $this->getJson('http://resolver-integration.storefronts.test/store/v1/storefront')->assertOk();

        $this->assertSame($storefrontName, $res->json('data.name'));
    }

    /** @test */
    public function an_unknown_hostname_still_fails_closed_through_the_unmodified_resolver(): void
    {
        $auth = $this->registerTenant('resolver-negative', 'owner@resolver-negative.test');
        $this->withToken($auth['token'])->postJson(self::PATH)->assertCreated();

        $this->getJson('http://not-a-real-tenant.storefronts.test/store/v1/storefront')->assertStatus(404);
    }

    /** @test */
    public function a_second_tenant_hostname_never_resolves_to_the_first_tenant_data(): void
    {
        $a = $this->registerTenant('cross-a', 'owner@cross-a.test');
        $b = $this->registerTenant('cross-b', 'owner@cross-b.test');
        $createdA = $this->withToken($a['token'])->postJson(self::PATH)->assertCreated();
        $createdB = $this->withToken($b['token'])->postJson(self::PATH)->assertCreated();

        $resA = $this->getJson('http://cross-a.storefronts.test/store/v1/storefront')->assertOk();
        $resB = $this->getJson('http://cross-b.storefronts.test/store/v1/storefront')->assertOk();

        $this->assertSame($createdA->json('data.store.name'), $resA->json('data.name'));
        $this->assertSame($createdB->json('data.store.name'), $resB->json('data.name'));
        $this->assertNotSame($resA->json('data.name'), $resB->json('data.name'));
    }
}

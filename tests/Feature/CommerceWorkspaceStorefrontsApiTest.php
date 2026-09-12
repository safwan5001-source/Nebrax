<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * COM-WS-2 — عزل المستأجر في قائمة متاجر مساحة عمل التجارة.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceStorefrontsApiTest
 */
class CommerceWorkspaceStorefrontsApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PATH = '/api/commerce/workspace/storefronts';

    /**
     * @param  array{
     *     slug?: string,
     *     name?: string,
     *     storefront_active?: bool,
     *     channel_slug?: string,
     *     channel_active?: bool,
     *     hostname?: ?string,
     *     domain_active?: bool,
     *     verification?: string,
     *     is_primary?: bool
     * }  $overrides
     * @return array{channel: SalesChannel, storefront: Storefront, domain: ?StorefrontDomain}
     */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channelSlug = $overrides['channel_slug'] ?? 'web';
        $channel = SalesChannel::query()->where('slug', $channelSlug)->first()
            ?? SalesChannel::create([
                'slug' => $channelSlug,
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => $overrides['channel_active'] ?? true,
            ]);

        if (array_key_exists('channel_active', $overrides) && $channel->is_active !== (bool) $overrides['channel_active']) {
            $channel->forceFill(['is_active' => (bool) $overrides['channel_active']])->save();
        }

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => $overrides['storefront_active'] ?? true,
        ]);

        $domain = null;
        if (array_key_exists('hostname', $overrides) && $overrides['hostname'] !== null) {
            $domain = StorefrontDomain::create([
                'storefront_id' => $storefront->id,
                'hostname' => $overrides['hostname'],
                'type' => StorefrontDomain::TYPE_CUSTOM,
                'is_primary' => $overrides['is_primary'] ?? true,
                'is_active' => $overrides['domain_active'] ?? true,
                'verification_status' => $overrides['verification'] ?? StorefrontDomain::VERIFICATION_VERIFIED,
            ]);
        }

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront', 'domain');
    }

    /** @test */
    public function tenant_a_sees_only_its_own_web_storefronts(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $storeA = $this->seedWebStorefront($a['tenant_id'], [
            'name' => 'متجر ألف',
            'hostname' => 'shop-a.example.com',
        ]);
        $this->seedWebStorefront($b['tenant_id'], [
            'name' => 'متجر باء',
            'hostname' => 'shop-b.example.com',
        ]);

        $res = $this->withToken($a['token'])->getJson(self::PATH)->assertOk();

        $this->assertCount(1, $res->json('data.stores'));
        $this->assertSame($storeA['storefront']->id, $res->json('data.stores.0.id'));
        $this->assertSame('متجر ألف', $res->json('data.stores.0.name'));
        $this->assertSame($storeA['channel']->id, $res->json('data.stores.0.sales_channel_id'));
        $this->assertTrue($res->json('data.stores.0.is_active'));
        $this->assertSame('https://shop-a.example.com/', $res->json('data.stores.0.preview_url'));
        $this->assertSame(['id', 'name', 'sales_channel_id', 'is_active', 'preview_url'], array_keys($res->json('data.stores.0')));
        $this->assertStringNotContainsString('shop-b.example.com', $res->getContent());
        $this->assertStringNotContainsString($b['tenant_id'], $res->getContent());
        $this->assertStringNotContainsString($a['tenant_id'], $res->getContent());
    }

    /** @test */
    public function tenant_a_cannot_retrieve_tenant_b_storefronts_via_client_supplied_identifiers(): void
    {
        $a = $this->registerTenant('alpha', 'a@alpha.test');
        $b = $this->registerTenant('beta', 'b@beta.test');

        $this->seedWebStorefront($a['tenant_id'], [
            'name' => 'متجر ألف',
            'hostname' => 'only-a.example.com',
        ]);
        $storeB = $this->seedWebStorefront($b['tenant_id'], [
            'name' => 'متجر باء',
            'hostname' => 'only-b.example.com',
        ]);

        $res = $this->withToken($a['token'])->getJson(
            self::PATH.'?tenant='.$b['tenant_id']
            .'&storefront_id='.$storeB['storefront']->id
            .'&hostname=only-b.example.com'
        )->assertOk();

        $ids = collect($res->json('data.stores'))->pluck('id')->all();
        $this->assertNotContains($storeB['storefront']->id, $ids);
        $this->assertCount(1, $ids);
        $this->assertStringNotContainsString('only-b.example.com', $res->getContent());
        $this->assertStringNotContainsString('متجر باء', $res->getContent());
    }

    /** @test */
    public function an_empty_tenant_receives_an_empty_store_list_not_a_not_found(): void
    {
        $auth = $this->registerTenant('empty', 'empty@acme.test');

        $this->withToken($auth['token'])->getJson(self::PATH)
            ->assertOk()
            ->assertJsonPath('data.stores', []);
    }

    /** @test */
    public function inactive_storefronts_are_omitted(): void
    {
        $auth = $this->registerTenant('inactive-sf', 'inactive-sf@acme.test');
        $this->seedWebStorefront($auth['tenant_id'], [
            'name' => 'متجر متوقف',
            'storefront_active' => false,
            'hostname' => 'inactive-store.example.com',
        ]);

        $res = $this->withToken($auth['token'])->getJson(self::PATH)->assertOk();

        $this->assertSame([], $res->json('data.stores'));
        $this->assertStringNotContainsString('inactive-store.example.com', $res->getContent());
    }

    /** @test */
    public function unverified_or_inactive_domains_do_not_receive_a_preview_url(): void
    {
        $auth = $this->registerTenant('domains', 'domains@acme.test');
        $this->seedWebStorefront($auth['tenant_id'], [
            'slug' => 'pending',
            'name' => 'بانتظار التحقق',
            'hostname' => 'pending.example.com',
            'verification' => StorefrontDomain::VERIFICATION_PENDING,
        ]);
        $this->seedWebStorefront($auth['tenant_id'], [
            'slug' => 'inactive-domain',
            'channel_slug' => 'web-inactive-domain',
            'name' => 'نطاق متوقف',
            'hostname' => 'inactive-domain.example.com',
            'domain_active' => false,
        ]);
        $this->seedWebStorefront($auth['tenant_id'], [
            'slug' => 'failed',
            'channel_slug' => 'web-failed',
            'name' => 'تحقق فاشل',
            'hostname' => 'failed.example.com',
            'verification' => StorefrontDomain::VERIFICATION_FAILED,
        ]);

        $res = $this->withToken($auth['token'])->getJson(self::PATH)->assertOk();
        $stores = collect($res->json('data.stores'));

        $this->assertCount(3, $stores);
        $this->assertTrue($stores->every(fn (array $store) => $store['preview_url'] === null));
        $this->assertStringNotContainsString('pending.example.com', $res->getContent());
        $this->assertStringNotContainsString('inactive-domain.example.com', $res->getContent());
        $this->assertStringNotContainsString('failed.example.com', $res->getContent());
    }

    /** @test */
    public function an_inactive_web_channel_keeps_the_store_but_clears_preview_url(): void
    {
        $auth = $this->registerTenant('channel', 'channel@acme.test');
        $this->seedWebStorefront($auth['tenant_id'], [
            'name' => 'قناة متوقفة',
            'channel_active' => false,
            'hostname' => 'inactive-channel.example.com',
        ]);

        $res = $this->withToken($auth['token'])->getJson(self::PATH)->assertOk();

        $this->assertCount(1, $res->json('data.stores'));
        $this->assertSame('قناة متوقفة', $res->json('data.stores.0.name'));
        $this->assertNull($res->json('data.stores.0.preview_url'));
        $this->assertStringNotContainsString('inactive-channel.example.com', $res->getContent());
    }

    /** @test */
    public function preview_url_prefers_the_primary_verified_active_domain(): void
    {
        $auth = $this->registerTenant('primary', 'primary@acme.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id'], [
            'name' => 'متجر النطاقات',
            'hostname' => 'secondary.example.com',
            'is_primary' => false,
        ]);

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontDomain::create([
            'storefront_id' => $seeded['storefront']->id,
            'hostname' => 'primary.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])->getJson(self::PATH)->assertOk();

        $this->assertSame('https://primary.example.com/', $res->json('data.stores.0.preview_url'));
        $this->assertStringNotContainsString('secondary.example.com', $res->getContent());
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $this->getJson(self::PATH)->assertUnauthorized();
    }

    /** @test */
    public function self_service_users_are_forbidden(): void
    {
        $auth = $this->registerTenant('ss', 'owner-ss@acme.test');
        $token = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@acme.test');

        $this->withToken($token)->getJson(self::PATH)->assertForbidden();
    }

    /** @test */
    public function a_staff_user_can_list_the_current_tenants_storefronts_without_a_new_permission(): void
    {
        $auth = $this->registerTenant('staff-ws', 'owner-staff@acme.test');
        $this->seedWebStorefront($auth['tenant_id'], [
            'name' => 'متجر الموظفين',
            'hostname' => 'staff-shop.example.com',
        ]);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');

        $this->withToken($staff)->getJson(self::PATH)
            ->assertOk()
            ->assertJsonCount(1, 'data.stores')
            ->assertJsonPath('data.stores.0.name', 'متجر الموظفين');
    }
}

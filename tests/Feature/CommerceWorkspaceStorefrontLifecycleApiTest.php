<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\Edge\FakeStorefrontEdgeClient;
use App\Services\Commerce\Edge\StorefrontEdgeClient;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * STORE-ADMIN-LIFECYCLE-1 — تفعيل/إيقاف متجر مستضاف عبر
 * `Storefront.is_active` فقط: RBAC، عزل المستأجر، الحفاظ على البيانات،
 * مثالية التكرار، فشل عام مغلق، وتفعيل متجر AWJ-managed بلا Railway/EDGE.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceStorefrontLifecycleApiTest
 */
class CommerceWorkspaceStorefrontLifecycleApiTest extends TestCase
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

    private function activatePath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/activate';
    }

    private function deactivatePath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/deactivate';
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array{channel: SalesChannel, storefront: Storefront, managed: StorefrontDomain, custom: StorefrontDomain}
     */
    private function seedManagedStore(string $tenantId, array $overrides = []): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create([
                'slug' => 'web',
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);

        $storefront = Storefront::create([
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => $overrides['storefront_active'] ?? true,
            'default_locale' => 'ar',
        ]);

        $managedHost = $overrides['managed_hostname'] ?? 'lifecycle.store.awjdev.test';
        $managed = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $managedHost,
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'is_primary' => true,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
        ]);

        $custom = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $overrides['custom_hostname'] ?? 'shop.lifecycle.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_primary' => false,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
            'verified_at' => now(),
            'edge_status' => StorefrontDomain::EDGE_PENDING,
            'edge_provider' => 'railway',
            'edge_provider_id' => 'dom_lifecycle_fixture',
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront', 'managed', 'custom');
    }

    private function publishedProduct(string $tenantId, SalesChannel $channel): Product
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6),
            'name' => 'منتج منشور',
            'name_en' => 'Published Product',
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 25000,
            'tax_rate' => 15,
            'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id,
            'sales_channel_id' => $channel->id,
            'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /**
     * @return array{is_active: bool, is_primary: bool, verification_status: string, verified_at: ?string, edge_status: ?string, edge_provider_id: ?string, hostname: string, type: string}
     */
    private function domainSnapshot(StorefrontDomain $domain): array
    {
        $fresh = $domain->fresh();

        return [
            'is_active' => (bool) $fresh->is_active,
            'is_primary' => (bool) $fresh->is_primary,
            'verification_status' => $fresh->verification_status,
            'verified_at' => $fresh->verified_at?->toIso8601String(),
            'edge_status' => $fresh->edge_status,
            'edge_provider_id' => $fresh->edge_provider_id,
            'hostname' => $fresh->hostname,
            'type' => $fresh->type,
        ];
    }

    private function publicUrl(string $hostname, string $path): string
    {
        return 'http://'.$hostname.'/store/v1/'.$path;
    }

    /** @test */
    public function guests_are_rejected(): void
    {
        $auth = $this->registerTenant('lc-guest', 'owner@lc-guest.test');
        $seeded = $this->seedManagedStore($auth['tenant_id']);

        $this->postJson($this->deactivatePath($seeded['storefront']->id))->assertUnauthorized();
        $this->postJson($this->activatePath($seeded['storefront']->id))->assertUnauthorized();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('lc-ss', 'owner@lc-ss.test');
        $seeded = $this->seedManagedStore($auth['tenant_id']);
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@lc-ss.test');

        $this->withToken($ss)->postJson($this->deactivatePath($seeded['storefront']->id))->assertForbidden();
        $this->withToken($ss)->postJson($this->activatePath($seeded['storefront']->id))->assertForbidden();
    }

    /** @test */
    public function a_staff_user_without_commerce_manage_is_denied(): void
    {
        $auth = $this->registerTenant('lc-staff', 'owner@lc-staff.test');
        $seeded = $this->seedManagedStore($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@lc-staff.test');

        $this->withToken($staff)->postJson($this->deactivatePath($seeded['storefront']->id))->assertForbidden();
        $this->withToken($staff)->postJson($this->activatePath($seeded['storefront']->id))->assertForbidden();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(Storefront::query()->find($seeded['storefront']->id)->is_active);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_cross_tenant_storefront_id_returns_404_and_leaves_it_unchanged(): void
    {
        $a = $this->registerTenant('lc-idor-a', 'owner@lc-idor-a.test');
        $b = $this->registerTenant('lc-idor-b', 'owner@lc-idor-b.test');
        $seededB = $this->seedManagedStore($b['tenant_id'], [
            'managed_hostname' => 'b.store.awjdev.test',
            'custom_hostname' => 'shop-b.example.com',
        ]);

        $this->withToken($a['token'])
            ->postJson($this->deactivatePath($seededB['storefront']->id))
            ->assertNotFound();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertTrue(Storefront::query()->find($seededB['storefront']->id)->is_active);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_nonexistent_storefront_id_returns_404(): void
    {
        $auth = $this->registerTenant('lc-missing', 'owner@lc-missing.test');

        $this->withToken($auth['token'])
            ->postJson($this->deactivatePath('00000000-0000-0000-0000-000000000000'))
            ->assertNotFound();
        $this->withToken($auth['token'])
            ->postJson($this->activatePath('00000000-0000-0000-0000-000000000000'))
            ->assertNotFound();
    }

    /** @test */
    public function deactivate_sets_only_storefront_is_active_and_preserves_channel_domains_and_edge(): void
    {
        $auth = $this->registerTenant('lc-deact', 'owner@lc-deact.test');
        $seeded = $this->seedManagedStore($auth['tenant_id']);
        $this->publishedProduct($auth['tenant_id'], $seeded['channel']);

        $managedBefore = $this->domainSnapshot($seeded['managed']);
        $customBefore = $this->domainSnapshot($seeded['custom']);

        $res = $this->withToken($auth['token'])
            ->postJson($this->deactivatePath($seeded['storefront']->id), [
                'is_active' => true,
                'edge_status' => 'ready',
            ])
            ->assertOk();

        $this->assertFalse($res->json('data.store.is_active'));
        $this->assertNull($res->json('data.store.preview_url'));
        $this->assertSame($seeded['storefront']->id, $res->json('data.store.id'));
        $this->assertSame(
            ['id', 'name', 'sales_channel_id', 'is_active', 'preview_url', 'default_locale'],
            array_keys($res->json('data.store'))
        );

        app(TenantContext::class)->set($auth['tenant_id']);
        $storefront = Storefront::query()->find($seeded['storefront']->id);
        $channel = SalesChannel::query()->find($seeded['channel']->id);
        $this->assertFalse($storefront->is_active);
        $this->assertTrue($channel->is_active);
        $this->assertSame($managedBefore, $this->domainSnapshot($seeded['managed']));
        $this->assertSame($customBefore, $this->domainSnapshot($seeded['custom']));
        app(TenantContext::class)->forget();

        $this->assertSame(0, $this->edge->provisionCalls);
        $this->assertSame(0, $this->edge->fetchCalls);
        $this->assertSame(0, $this->edge->findCalls);
        $this->assertSame(0, $this->edge->releaseCalls);
    }

    /** @test */
    public function public_store_v1_fails_closed_after_deactivate_and_is_restored_by_activate_without_railway(): void
    {
        $auth = $this->registerTenant('lc-public', 'owner@lc-public.test');
        $seeded = $this->seedManagedStore($auth['tenant_id'], [
            'managed_hostname' => 'lc-public.store.awjdev.test',
            'custom_hostname' => 'shop.lc-public.example.com',
        ]);
        $product = $this->publishedProduct($auth['tenant_id'], $seeded['channel']);
        $host = 'lc-public.store.awjdev.test';
        $mediaId = (string) Str::uuid();

        $this->getJson($this->publicUrl($host, 'products'))->assertOk();
        $this->getJson($this->publicUrl($host, 'storefront'))->assertOk();
        $this->getJson($this->publicUrl($host, 'cart'))->assertOk();
        $this->getJson($this->publicUrl($host, 'checkout'))->assertOk();

        $this->withToken($auth['token'])
            ->postJson($this->deactivatePath($seeded['storefront']->id))
            ->assertOk()
            ->assertJsonPath('data.store.is_active', false);

        foreach (['products', 'storefront', 'cart', 'checkout', 'media/'.$mediaId] as $path) {
            $this->getJson($this->publicUrl($host, $path))->assertNotFound();
        }

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(CommerceListing::query()->where('product_id', $product->id)->exists());
        $this->assertTrue(SalesChannel::query()->find($seeded['channel']->id)->is_active);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['managed']->id)->is_active);
        $this->assertTrue(StorefrontDomain::query()->find($seeded['custom']->id)->is_active);
        app(TenantContext::class)->forget();

        $activate = $this->withToken($auth['token'])
            ->postJson($this->activatePath($seeded['storefront']->id))
            ->assertOk();

        $this->assertTrue($activate->json('data.store.is_active'));
        $this->assertSame('https://lc-public.store.awjdev.test/', $activate->json('data.store.preview_url'));

        $this->getJson($this->publicUrl($host, 'products'))->assertOk()
            ->assertJsonFragment(['id' => $product->id]);
        $this->getJson($this->publicUrl($host, 'storefront'))->assertOk();
        $this->getJson($this->publicUrl($host, 'cart'))->assertOk();
        $this->getJson($this->publicUrl($host, 'checkout'))->assertOk();

        $this->assertSame(0, $this->edge->provisionCalls);
        $this->assertSame(0, $this->edge->fetchCalls);
        $this->assertSame(0, $this->edge->findCalls);
        $this->assertSame(0, $this->edge->releaseCalls);
    }

    /** @test */
    public function activate_and_deactivate_are_idempotent(): void
    {
        $auth = $this->registerTenant('lc-idemp', 'owner@lc-idemp.test');
        $seeded = $this->seedManagedStore($auth['tenant_id'], [
            'managed_hostname' => 'lc-idemp.store.awjdev.test',
            'custom_hostname' => 'shop.lc-idemp.example.com',
        ]);

        $first = $this->withToken($auth['token'])
            ->postJson($this->deactivatePath($seeded['storefront']->id))
            ->assertOk();
        $second = $this->withToken($auth['token'])
            ->postJson($this->deactivatePath($seeded['storefront']->id))
            ->assertOk();

        $this->assertFalse($first->json('data.store.is_active'));
        $this->assertFalse($second->json('data.store.is_active'));

        $third = $this->withToken($auth['token'])
            ->postJson($this->activatePath($seeded['storefront']->id))
            ->assertOk();
        $fourth = $this->withToken($auth['token'])
            ->postJson($this->activatePath($seeded['storefront']->id))
            ->assertOk();

        $this->assertTrue($third->json('data.store.is_active'));
        $this->assertTrue($fourth->json('data.store.is_active'));
    }

    /** @test */
    public function get_list_includes_an_inactive_store_with_a_truthful_flag(): void
    {
        $auth = $this->registerTenant('lc-list', 'owner@lc-list.test');
        $seeded = $this->seedManagedStore($auth['tenant_id'], [
            'name' => 'متجر القائمة',
            'managed_hostname' => 'lc-list.store.awjdev.test',
            'custom_hostname' => 'shop.lc-list.example.com',
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->deactivatePath($seeded['storefront']->id))
            ->assertOk();

        $res = $this->withToken($auth['token'])
            ->getJson('/api/commerce/workspace/storefronts')
            ->assertOk();

        $this->assertCount(1, $res->json('data.stores'));
        $this->assertSame($seeded['storefront']->id, $res->json('data.stores.0.id'));
        $this->assertFalse($res->json('data.stores.0.is_active'));
        $this->assertNull($res->json('data.stores.0.preview_url'));
    }

    /** @test */
    public function identity_put_still_cannot_flip_is_active(): void
    {
        $auth = $this->registerTenant('lc-identity', 'owner@lc-identity.test');
        $seeded = $this->seedManagedStore($auth['tenant_id'], [
            'name' => 'قبل',
            'managed_hostname' => 'lc-identity.store.awjdev.test',
            'custom_hostname' => 'shop.lc-identity.example.com',
        ]);

        $this->withToken($auth['token'])
            ->postJson($this->deactivatePath($seeded['storefront']->id))
            ->assertOk();

        $res = $this->withToken($auth['token'])
            ->putJson('/api/commerce/workspace/storefronts/'.$seeded['storefront']->id, [
                'is_active' => true,
                'name' => 'بعد',
            ])
            ->assertOk();

        $this->assertSame('بعد', $res->json('data.store.name'));
        $this->assertFalse($res->json('data.store.is_active'));

        app(TenantContext::class)->set($auth['tenant_id']);
        $fresh = Storefront::query()->find($seeded['storefront']->id);
        $this->assertSame('بعد', $fresh->name);
        $this->assertFalse($fresh->is_active);
        app(TenantContext::class)->forget();
    }
}

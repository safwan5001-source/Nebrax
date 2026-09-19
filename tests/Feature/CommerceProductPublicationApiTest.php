<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CommerceProductPublicationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedProductAndStore(string $tenantId, string $suffix): array
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create([
            'name' => 'منتج '.$suffix,
            'sku' => 'COM-'.$suffix,
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 10000,
            'purchase_price' => 5000,
            'tax_rate' => 15,
            'is_active' => true,
        ]);
        $channel = SalesChannel::create([
            'slug' => 'web-'.$suffix,
            'name' => 'ويب '.$suffix,
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'store-'.$suffix,
            'name' => 'متجر '.$suffix,
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return compact('product', 'channel', 'storefront');
    }

    /** @test */
    public function owner_can_publish_and_unpublish_a_product_in_its_web_store(): void
    {
        $auth = $this->registerTenant('pub-a', 'pub-a@example.test');
        $scene = $this->seedProductAndStore($auth['tenant_id'], 'a');
        $path = '/api/commerce/workspace/products/'.$scene['product']->id.'/publication';

        $this->withToken($auth['token'])->getJson($path)
            ->assertOk()
            ->assertJsonPath('data.stores.0.id', $scene['storefront']->id)
            ->assertJsonPath('data.stores.0.is_published', false);

        $this->withToken($auth['token'])->putJson($path, [
            'storefront_ids' => [$scene['storefront']->id],
        ])->assertOk()->assertJsonPath('data.stores.0.is_published', true);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(CommerceListing::query()
            ->where('product_id', $scene['product']->id)
            ->where('sales_channel_id', $scene['channel']->id)
            ->where('is_published', true)->exists());
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->putJson($path, ['storefront_ids' => []])
            ->assertOk()->assertJsonPath('data.stores.0.is_published', false);
    }

    /** @test */
    public function tenant_a_cannot_publish_its_product_to_tenant_b_store(): void
    {
        $a = $this->registerTenant('pub-a2', 'pub-a2@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('pub-b2', 'pub-b2@example.test');
        $sceneA = $this->seedProductAndStore($a['tenant_id'], 'a2');
        $sceneB = $this->seedProductAndStore($b['tenant_id'], 'b2');

        $this->withToken($a['token'])->putJson(
            '/api/commerce/workspace/products/'.$sceneA['product']->id.'/publication',
            ['storefront_ids' => [$sceneB['storefront']->id]],
        )->assertUnprocessable();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertFalse(CommerceListing::query()
            ->where('product_id', $sceneA['product']->id)
            ->where('sales_channel_id', $sceneB['channel']->id)->exists());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function tenant_a_cannot_read_or_mutate_tenant_b_product_publication(): void
    {
        $a = $this->registerTenant('pub-a3', 'pub-a3@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('pub-b3', 'pub-b3@example.test');
        $this->seedProductAndStore($a['tenant_id'], 'a3');
        $sceneB = $this->seedProductAndStore($b['tenant_id'], 'b3');
        $path = '/api/commerce/workspace/products/'.$sceneB['product']->id.'/publication';

        $this->withToken($a['token'])->getJson($path)->assertNotFound();
        $this->withToken($a['token'])->putJson($path, ['storefront_ids' => []])->assertNotFound();
    }

    /** @test */
    public function inactive_store_or_channel_is_not_publishable(): void
    {
        $auth = $this->registerTenant('pub-inactive', 'pub-inactive@example.test');
        $scene = $this->seedProductAndStore($auth['tenant_id'], 'inactive');
        app(TenantContext::class)->set($auth['tenant_id']);
        $scene['storefront']->forceFill(['is_active' => false])->save();
        app(TenantContext::class)->forget();

        $path = '/api/commerce/workspace/products/'.$scene['product']->id.'/publication';
        $this->withToken($auth['token'])->getJson($path)
            ->assertOk()->assertJsonPath('data.stores', []);
        $this->withToken($auth['token'])->putJson($path, [
            'storefront_ids' => [$scene['storefront']->id],
        ])->assertUnprocessable();
    }

    // ── COM-CATALOG-1 — Product Publication Workspace list ─────────────────

    private const LIST_PATH = '/api/commerce/workspace/products/publication';

    private function publishListing(string $tenantId, Product $product, SalesChannel $channel, bool $published = true): CommerceListing
    {
        app(TenantContext::class)->set($tenantId);
        $listing = CommerceListing::query()->updateOrCreate(
            ['product_id' => $product->id, 'sales_channel_id' => $channel->id],
            ['tenant_id' => $tenantId, 'is_published' => $published],
        );
        app(TenantContext::class)->forget();

        return $listing;
    }

    /** @test */
    public function list_reads_publication_state_from_commerce_listing_is_published(): void
    {
        $auth = $this->registerTenant('pub-list', 'pub-list@example.test');
        $scene = $this->seedProductAndStore($auth['tenant_id'], 'list');

        $this->withToken($auth['token'])->getJson(self::LIST_PATH)
            ->assertOk()
            ->assertJsonPath('data.0.id', $scene['product']->id)
            ->assertJsonPath('data.0.is_published', false)
            ->assertJsonPath('data.0.stores.0.id', $scene['storefront']->id)
            ->assertJsonPath('data.0.stores.0.is_published', false)
            ->assertJsonPath('meta.total', 1);

        // نشر عبر العقد نفسه ثم القراءة من القائمة — مصدر واحد للحالة.
        $this->withToken($auth['token'])->putJson(
            '/api/commerce/workspace/products/'.$scene['product']->id.'/publication',
            ['storefront_ids' => [$scene['storefront']->id]],
        )->assertOk();

        $this->withToken($auth['token'])->getJson(self::LIST_PATH)
            ->assertOk()
            ->assertJsonPath('data.0.is_published', true)
            ->assertJsonPath('data.0.stores.0.is_published', true);
    }

    /** @test */
    public function list_search_and_status_filters_run_server_side(): void
    {
        $auth = $this->registerTenant('pub-filter', 'pub-filter@example.test');
        $sceneA = $this->seedProductAndStore($auth['tenant_id'], 'fa');
        $sceneB = $this->seedProductAndStore($auth['tenant_id'], 'fb');
        $this->publishListing($auth['tenant_id'], $sceneA['product'], $sceneA['channel']);

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?status=published')
            ->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $sceneA['product']->id);

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?status=unpublished')
            ->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $sceneB['product']->id);

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?search=COM-fb')
            ->assertOk()->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.sku', 'COM-fb');

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?status=published&search=COM-fb')
            ->assertOk()->assertJsonPath('meta.total', 0)->assertJsonPath('data', []);
    }

    /** @test */
    public function list_paginates_server_side(): void
    {
        $auth = $this->registerTenant('pub-page', 'pub-page@example.test');
        $this->seedProductAndStore($auth['tenant_id'], 'p1');
        app(TenantContext::class)->set($auth['tenant_id']);
        foreach (range(2, 12) as $i) {
            Product::create([
                'name' => 'منتج p'.$i,
                'sku' => 'COM-p'.$i,
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 1000,
                'purchase_price' => 500,
                'tax_rate' => 15,
                'is_active' => true,
            ]);
        }
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?per_page=10&page=2')
            ->assertOk()
            ->assertJsonPath('meta.current_page', 2)
            ->assertJsonPath('meta.per_page', 10)
            ->assertJsonPath('meta.total', 12)
            ->assertJsonCount(2, 'data');
    }

    /** @test */
    public function list_is_tenant_isolated_and_never_leaks_other_tenant_products(): void
    {
        $a = $this->registerTenant('pub-la', 'pub-la@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('pub-lb', 'pub-lb@example.test');
        $sceneA = $this->seedProductAndStore($a['tenant_id'], 'la');
        $sceneB = $this->seedProductAndStore($b['tenant_id'], 'lb');
        $this->publishListing($b['tenant_id'], $sceneB['product'], $sceneB['channel']);

        $response = $this->withToken($a['token'])->getJson(self::LIST_PATH)->assertOk();
        $ids = collect($response->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($sceneA['product']->id));
        $this->assertFalse($ids->contains($sceneB['product']->id));
        // حالة مستأجر آخر لا تتسرب حتى لو بحث المستخدم باسم منتجه صراحةً.
        $this->withToken($a['token'])->getJson(self::LIST_PATH.'?search=COM-lb')
            ->assertOk()->assertJsonPath('meta.total', 0);
    }

    /** @test */
    public function list_rejects_cross_tenant_storefront_scope_without_leaking(): void
    {
        $a = $this->registerTenant('pub-sa', 'pub-sa@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('pub-sb', 'pub-sb@example.test');
        $this->seedProductAndStore($a['tenant_id'], 'sa');
        $sceneB = $this->seedProductAndStore($b['tenant_id'], 'sb');

        $this->withToken($a['token'])
            ->getJson(self::LIST_PATH.'?storefront_id='.$sceneB['storefront']->id)
            ->assertUnprocessable();
    }

    /** @test */
    public function list_scopes_state_to_a_single_storefront_in_multi_store_tenants(): void
    {
        $auth = $this->registerTenant('pub-multi', 'pub-multi@example.test');
        $sceneA = $this->seedProductAndStore($auth['tenant_id'], 'm1');
        $sceneB = $this->seedProductAndStore($auth['tenant_id'], 'm2');
        // نشر المنتج نفسه على المتجر الأول فقط — السلوك مستقل لكل متجر.
        $this->withToken($auth['token'])->putJson(
            '/api/commerce/workspace/products/'.$sceneA['product']->id.'/publication',
            ['storefront_ids' => [$sceneA['storefront']->id]],
        )->assertOk();

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?storefront_id='.$sceneA['storefront']->id)
            ->assertOk()
            ->assertJsonPath('data.0.is_published', true)
            ->assertJsonCount(1, 'data.0.stores')
            ->assertJsonPath('data.0.stores.0.id', $sceneA['storefront']->id);

        // المتجر الثاني لم ينشر عليه شيء — كلا المنتجين «غير منشور» فيه.
        $this->withToken($auth['token'])->getJson(
            self::LIST_PATH.'?storefront_id='.$sceneB['storefront']->id.'&status=unpublished',
        )->assertOk()->assertJsonPath('meta.total', 2);
    }

    /** @test */
    public function staff_can_read_the_list_but_cannot_mutate_publication(): void
    {
        $auth = $this->registerTenant('pub-rbac', 'pub-rbac@example.test');
        $scene = $this->seedProductAndStore($auth['tenant_id'], 'rbac');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@pub-rbac.test');

        // staff يملك products.view — القراءة مسموحة.
        $this->withToken($staff)->getJson(self::LIST_PATH)->assertOk();
        // ولا يملك products.manage — الكتابة مرفوضة.
        $this->withToken($staff)->putJson(
            '/api/commerce/workspace/products/'.$scene['product']->id.'/publication',
            ['storefront_ids' => [$scene['storefront']->id]],
        )->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden_from_the_publication_workspace(): void
    {
        $auth = $this->registerTenant('pub-ss', 'pub-ss@example.test');
        $scene = $this->seedProductAndStore($auth['tenant_id'], 'ss');
        $ss = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@pub-ss.test');

        $this->withToken($ss)->getJson(self::LIST_PATH)->assertForbidden();
        $this->withToken($ss)->getJson(
            '/api/commerce/workspace/products/'.$scene['product']->id.'/publication',
        )->assertForbidden();
    }
}

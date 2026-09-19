<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * COM-CATALOG-2 — Category Publication Workspace API.
 *
 * يثبت: القراءة/البحث/الترشيح/الترقيم من `CommerceCategoryListing.is_published`
 * حصرياً، العزل بين المستأجرين (404/422 بلا تسريب)، RBAC (products.view قراءة،
 * products.manage كتابة، staff قراءة فقط، self_service ممنوع)، استقلال نشر
 * التصنيف عن نشر المنتج في الاتجاهات كلها، والاستقلال بين المتاجر المتعددة.
 *
 * تشغيل: php artisan test --filter=CommerceCategoryPublicationApiTest
 */
class CommerceCategoryPublicationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const LIST_PATH = '/api/commerce/workspace/categories/publication';

    /** @return array{category: ProductCategory, channel: SalesChannel, storefront: Storefront} */
    private function seedCategoryAndStore(string $tenantId, string $suffix): array
    {
        app(TenantContext::class)->set($tenantId);
        $category = ProductCategory::create([
            'name' => 'تصنيف '.$suffix,
            'is_active' => true,
        ]);
        $channel = SalesChannel::create([
            'slug' => 'web-cat-'.$suffix,
            'name' => 'ويب '.$suffix,
            'type' => SalesChannel::TYPE_WEB,
            'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'store-cat-'.$suffix,
            'name' => 'متجر '.$suffix,
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        return compact('category', 'channel', 'storefront');
    }

    private function publishCategoryListing(
        string $tenantId,
        ProductCategory $category,
        SalesChannel $channel,
        bool $published = true,
    ): CommerceCategoryListing {
        app(TenantContext::class)->set($tenantId);
        $listing = CommerceCategoryListing::query()->updateOrCreate(
            ['category_id' => $category->id, 'sales_channel_id' => $channel->id],
            ['tenant_id' => $tenantId, 'is_published' => $published],
        );
        app(TenantContext::class)->forget();

        return $listing;
    }

    /** @test */
    public function owner_can_publish_and_unpublish_a_category_in_its_web_store(): void
    {
        $auth = $this->registerTenant('cat-a', 'cat-a@example.test');
        $scene = $this->seedCategoryAndStore($auth['tenant_id'], 'a');
        $path = '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication';

        $this->withToken($auth['token'])->getJson($path)
            ->assertOk()
            ->assertJsonPath('data.stores.0.id', $scene['storefront']->id)
            ->assertJsonPath('data.stores.0.is_published', false);

        $this->withToken($auth['token'])->putJson($path, [
            'storefront_ids' => [$scene['storefront']->id],
        ])->assertOk()->assertJsonPath('data.stores.0.is_published', true);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(CommerceCategoryListing::query()
            ->where('category_id', $scene['category']->id)
            ->where('sales_channel_id', $scene['channel']->id)
            ->where('is_published', true)->exists());
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->putJson($path, ['storefront_ids' => []])
            ->assertOk()->assertJsonPath('data.stores.0.is_published', false);
    }

    /** @test */
    public function tenant_a_cannot_publish_its_category_to_tenant_b_store(): void
    {
        $a = $this->registerTenant('cat-a2', 'cat-a2@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('cat-b2', 'cat-b2@example.test');
        $sceneA = $this->seedCategoryAndStore($a['tenant_id'], 'a2');
        $sceneB = $this->seedCategoryAndStore($b['tenant_id'], 'b2');

        $this->withToken($a['token'])->putJson(
            '/api/commerce/workspace/categories/'.$sceneA['category']->id.'/publication',
            ['storefront_ids' => [$sceneB['storefront']->id]],
        )->assertUnprocessable();

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertFalse(CommerceCategoryListing::query()
            ->where('category_id', $sceneA['category']->id)
            ->where('sales_channel_id', $sceneB['channel']->id)->exists());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function tenant_a_cannot_read_or_mutate_tenant_b_category_publication(): void
    {
        $a = $this->registerTenant('cat-a3', 'cat-a3@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('cat-b3', 'cat-b3@example.test');
        $this->seedCategoryAndStore($a['tenant_id'], 'a3');
        $sceneB = $this->seedCategoryAndStore($b['tenant_id'], 'b3');
        $path = '/api/commerce/workspace/categories/'.$sceneB['category']->id.'/publication';

        $this->withToken($a['token'])->getJson($path)->assertNotFound();
        $this->withToken($a['token'])->putJson($path, ['storefront_ids' => []])->assertNotFound();
    }

    /** @test */
    public function inactive_store_or_channel_is_not_publishable_for_categories(): void
    {
        $auth = $this->registerTenant('cat-inactive', 'cat-inactive@example.test');
        $scene = $this->seedCategoryAndStore($auth['tenant_id'], 'inactive');
        app(TenantContext::class)->set($auth['tenant_id']);
        $scene['storefront']->forceFill(['is_active' => false])->save();
        app(TenantContext::class)->forget();

        $path = '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication';
        $this->withToken($auth['token'])->getJson($path)
            ->assertOk()->assertJsonPath('data.stores', []);
        $this->withToken($auth['token'])->putJson($path, [
            'storefront_ids' => [$scene['storefront']->id],
        ])->assertUnprocessable();
    }

    /** @test */
    public function list_reads_publication_state_from_commerce_category_listing_is_published(): void
    {
        $auth = $this->registerTenant('cat-list', 'cat-list@example.test');
        $scene = $this->seedCategoryAndStore($auth['tenant_id'], 'list');

        $this->withToken($auth['token'])->getJson(self::LIST_PATH)
            ->assertOk()
            ->assertJsonPath('data.0.id', $scene['category']->id)
            ->assertJsonPath('data.0.is_published', false)
            ->assertJsonPath('data.0.stores.0.id', $scene['storefront']->id)
            ->assertJsonPath('data.0.stores.0.is_published', false);

        $this->publishCategoryListing($auth['tenant_id'], $scene['category'], $scene['channel']);

        $this->withToken($auth['token'])->getJson(self::LIST_PATH)
            ->assertOk()
            ->assertJsonPath('data.0.is_published', true)
            ->assertJsonPath('data.0.stores.0.is_published', true);
    }

    /** @test */
    public function list_search_and_status_filters_run_server_side(): void
    {
        $auth = $this->registerTenant('cat-filter', 'cat-filter@example.test');
        $sceneA = $this->seedCategoryAndStore($auth['tenant_id'], 'fa');
        $sceneB = $this->seedCategoryAndStore($auth['tenant_id'], 'fb');
        $this->publishCategoryListing($auth['tenant_id'], $sceneA['category'], $sceneA['channel']);

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?status=published')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $sceneA['category']->id);

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?status=unpublished')
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $sceneB['category']->id);

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?search='.urlencode('fa'))
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonPath('data.0.id', $sceneA['category']->id);
    }

    /** @test */
    public function list_paginates_server_side(): void
    {
        $auth = $this->registerTenant('cat-page', 'cat-page@example.test');
        $this->seedCategoryAndStore($auth['tenant_id'], 'p1');
        app(TenantContext::class)->set($auth['tenant_id']);
        foreach (range(2, 12) as $i) {
            ProductCategory::create(['name' => 'تصنيف p'.$i, 'is_active' => true]);
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
    public function list_is_tenant_isolated_and_never_leaks_other_tenant_categories(): void
    {
        $a = $this->registerTenant('cat-la', 'cat-la@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('cat-lb', 'cat-lb@example.test');
        $sceneA = $this->seedCategoryAndStore($a['tenant_id'], 'la');
        $sceneB = $this->seedCategoryAndStore($b['tenant_id'], 'lb');
        $this->publishCategoryListing($b['tenant_id'], $sceneB['category'], $sceneB['channel']);

        $response = $this->withToken($a['token'])->getJson(self::LIST_PATH)->assertOk();
        $ids = collect($response->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($sceneA['category']->id));
        $this->assertFalse($ids->contains($sceneB['category']->id));
        $this->withToken($a['token'])->getJson(self::LIST_PATH.'?search='.urlencode('lb'))
            ->assertOk()->assertJsonPath('meta.total', 0);
    }

    /** @test */
    public function list_rejects_cross_tenant_storefront_scope_without_leaking(): void
    {
        $a = $this->registerTenant('cat-sa', 'cat-sa@example.test');
        app(TenantContext::class)->forget();
        $b = $this->registerTenant('cat-sb', 'cat-sb@example.test');
        $this->seedCategoryAndStore($a['tenant_id'], 'sa');
        $sceneB = $this->seedCategoryAndStore($b['tenant_id'], 'sb');

        $this->withToken($a['token'])
            ->getJson(self::LIST_PATH.'?storefront_id='.$sceneB['storefront']->id)
            ->assertUnprocessable();
    }

    /** @test */
    public function list_scopes_category_state_to_a_single_storefront_in_multi_store_tenants(): void
    {
        $auth = $this->registerTenant('cat-multi', 'cat-multi@example.test');
        $sceneA = $this->seedCategoryAndStore($auth['tenant_id'], 'm1');
        $sceneB = $this->seedCategoryAndStore($auth['tenant_id'], 'm2');
        // نشر التصنيف على المتجر الأول فقط — الاستقلال لكل متجر.
        $this->withToken($auth['token'])->putJson(
            '/api/commerce/workspace/categories/'.$sceneA['category']->id.'/publication',
            ['storefront_ids' => [$sceneA['storefront']->id]],
        )->assertOk();

        $this->withToken($auth['token'])->getJson(self::LIST_PATH.'?storefront_id='.$sceneA['storefront']->id)
            ->assertOk()
            ->assertJsonPath('data.0.is_published', true)
            ->assertJsonCount(1, 'data.0.stores')
            ->assertJsonPath('data.0.stores.0.id', $sceneA['storefront']->id);

        $this->withToken($auth['token'])->getJson(
            self::LIST_PATH.'?storefront_id='.$sceneB['storefront']->id.'&status=unpublished',
        )->assertOk()->assertJsonPath('meta.total', 2);
    }

    /** @test */
    public function staff_can_read_the_category_list_but_cannot_mutate_publication(): void
    {
        $auth = $this->registerTenant('cat-staff', 'cat-staff@example.test');
        $scene = $this->seedCategoryAndStore($auth['tenant_id'], 'staff');
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-cat@example.test');

        $this->withToken($staffToken)->getJson(self::LIST_PATH)->assertOk();
        $this->withToken($staffToken)->getJson(
            '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication',
        )->assertOk();
        $this->withToken($staffToken)->putJson(
            '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication',
            ['storefront_ids' => [$scene['storefront']->id]],
        )->assertForbidden();
    }

    /** @test */
    public function self_service_is_forbidden_from_the_category_publication_workspace(): void
    {
        $auth = $this->registerTenant('cat-self', 'cat-self@example.test');
        $scene = $this->seedCategoryAndStore($auth['tenant_id'], 'self');
        $selfToken = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self-cat@example.test');

        $this->withToken($selfToken)->getJson(self::LIST_PATH)->assertForbidden();
        $this->withToken($selfToken)->getJson(
            '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication',
        )->assertForbidden();
        $this->withToken($selfToken)->putJson(
            '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication',
            ['storefront_ids' => [$scene['storefront']->id]],
        )->assertForbidden();
    }

    // ── الاستقلالية بين نشر التصنيف ونشر المنتج (الاتجاهات الأربعة) ────────

    /** @test */
    public function category_publication_never_touches_product_commerce_listings(): void
    {
        $auth = $this->registerTenant('cat-ind1', 'cat-ind1@example.test');
        $scene = $this->seedCategoryAndStore($auth['tenant_id'], 'ind1');
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create([
            'name' => 'منتج داخل التصنيف', 'sku' => 'COM-ind1', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 1000, 'purchase_price' => 500,
            'tax_rate' => 15, 'is_active' => true, 'category_id' => $scene['category']->id,
        ]);
        app(TenantContext::class)->forget();

        // نشر التصنيف لا يُنشئ ولا يغيّر أي CommerceListing للمنتج.
        $this->withToken($auth['token'])->putJson(
            '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication',
            ['storefront_ids' => [$scene['storefront']->id]],
        )->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(CommerceListing::query()
            ->where('product_id', $product->id)->exists());
        app(TenantContext::class)->forget();

        // وإلغاء نشر التصنيف لا يمسّ قائمة منتج منشور أصلاً.
        app(TenantContext::class)->set($auth['tenant_id']);
        CommerceListing::create([
            'tenant_id' => $auth['tenant_id'],
            'product_id' => $product->id,
            'sales_channel_id' => $scene['channel']->id,
            'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])->putJson(
            '/api/commerce/workspace/categories/'.$scene['category']->id.'/publication',
            ['storefront_ids' => []],
        )->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(CommerceListing::query()
            ->where('product_id', $product->id)
            ->where('sales_channel_id', $scene['channel']->id)
            ->where('is_published', true)->exists());
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function product_publication_never_touches_category_commerce_listings(): void
    {
        $auth = $this->registerTenant('cat-ind2', 'cat-ind2@example.test');
        $scene = $this->seedCategoryAndStore($auth['tenant_id'], 'ind2');
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create([
            'name' => 'منتج للاستقلال', 'sku' => 'COM-ind2', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 1000, 'purchase_price' => 500,
            'tax_rate' => 15, 'is_active' => true, 'category_id' => $scene['category']->id,
        ]);
        app(TenantContext::class)->forget();

        // نشر المنتج لا يُنشئ ولا يغيّر أي CommerceCategoryListing.
        $this->withToken($auth['token'])->putJson(
            '/api/commerce/workspace/products/'.$product->id.'/publication',
            ['storefront_ids' => [$scene['storefront']->id]],
        )->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertFalse(CommerceCategoryListing::query()
            ->where('category_id', $scene['category']->id)->exists());
        app(TenantContext::class)->forget();

        // وإلغاء نشر المنتج لا يمسّ تصنيفاً منشوراً أصلاً.
        $this->publishCategoryListing($auth['tenant_id'], $scene['category'], $scene['channel']);

        $this->withToken($auth['token'])->putJson(
            '/api/commerce/workspace/products/'.$product->id.'/publication',
            ['storefront_ids' => []],
        )->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(CommerceCategoryListing::query()
            ->where('category_id', $scene['category']->id)
            ->where('sales_channel_id', $scene['channel']->id)
            ->where('is_published', true)->exists());
        app(TenantContext::class)->forget();
    }
}

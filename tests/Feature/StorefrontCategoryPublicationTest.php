<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\CommerceListing;
use App\Models\FulfillmentPolicy;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * COM-CATALOG-2 — بوابة نشر التصنيفات على الواجهات العامة (store/v1 و
 * commerce/v1): تصنيفٌ منشور يظهر، غير المنشور يغيب عن القائمة والتفاصيل
 * (404) وعن الترشيح بالتصنيف في قائمة المنتجات، بينما يبقى المنتج المنشور
 * (`CommerceListing`) ظاهراً في القائمة العامة حتى لو كان تصنيفه غير منشور —
 * استقلالية كاملة بين البوابتين.
 *
 * تشغيل: php artisan test --filter=StorefrontCategoryPublicationTest
 */
class StorefrontCategoryPublicationTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function seedWebStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $warehouse = Warehouse::create([
            'code' => 'WH-'.Str::random(4), 'name' => 'المخزن الرئيسي', 'is_active' => true,
        ]);
        FulfillmentPolicy::create(['sales_channel_id' => $channel->id, 'warehouse_id' => $warehouse->id]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    private function category(Tenant $tenant, string $name, ?string $parentId = null): ProductCategory
    {
        app(TenantContext::class)->set($tenant->id);
        $category = ProductCategory::create([
            'name' => $name, 'is_active' => true, 'parent_id' => $parentId,
        ]);
        app(TenantContext::class)->forget();

        return $category;
    }

    private function setCategoryPublication(
        Tenant $tenant,
        ProductCategory $category,
        SalesChannel $channel,
        bool $published,
    ): void {
        app(TenantContext::class)->set($tenant->id);
        CommerceCategoryListing::query()->updateOrCreate(
            ['category_id' => $category->id, 'sales_channel_id' => $channel->id],
            ['tenant_id' => $tenant->id, 'is_published' => $published],
        );
        app(TenantContext::class)->forget();
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel, array $attrs = []): Product
    {
        app(TenantContext::class)->set($tenant->id);
        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 25000, 'tax_rate' => 15, 'is_active' => true,
        ], $attrs));
        CommerceListing::create([
            'tenant_id' => $tenant->id, 'product_id' => $product->id,
            'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    // ── /store/v1 (web) ──────────────────────────────────────────────────

    /** @test */
    public function published_category_is_listed_and_unpublished_is_absent(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedWebStore('catvis');
        $published = $this->category($tenant, 'تصنيف منشور');
        $unpublished = $this->category($tenant, 'تصنيف غير منشور');
        $this->setCategoryPublication($tenant, $published, $channel, true);
        $this->setCategoryPublication($tenant, $unpublished, $channel, false);

        $response = $this->getJson("/store/v1/{$tenant->slug}/categories")->assertOk();
        $ids = collect($response->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($published->id));
        $this->assertFalse($ids->contains($unpublished->id));
    }

    /** @test */
    public function unpublished_category_show_is_404_and_children_are_gated(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedWebStore('catshow');
        $parent = $this->category($tenant, 'أب منشور');
        $visibleChild = $this->category($tenant, 'ابن منشور', $parent->id);
        $hiddenChild = $this->category($tenant, 'ابن غير منشور', $parent->id);
        $hidden = $this->category($tenant, 'مخفي');
        $this->setCategoryPublication($tenant, $parent, $channel, true);
        $this->setCategoryPublication($tenant, $visibleChild, $channel, true);
        $this->setCategoryPublication($tenant, $hiddenChild, $channel, false);
        $this->setCategoryPublication($tenant, $hidden, $channel, false);

        $this->getJson("/store/v1/{$tenant->slug}/categories/{$hidden->id}")->assertNotFound();

        $response = $this->getJson("/store/v1/{$tenant->slug}/categories/{$parent->id}")->assertOk();
        $childIds = collect($response->json('data.children'))->pluck('id');
        $this->assertTrue($childIds->contains($visibleChild->id));
        $this->assertFalse($childIds->contains($hiddenChild->id));
    }

    /** @test */
    public function unpublished_parent_is_absent_from_breadcrumb_ancestors(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedWebStore('catanc');
        $parent = $this->category($tenant, 'أب غير منشور');
        $child = $this->category($tenant, 'ابن منشور', $parent->id);
        // الابن منشور والأب غير منشور — لا يظهر الأب حتى كسياق تنقّل.
        $this->setCategoryPublication($tenant, $parent, $channel, false);
        $this->setCategoryPublication($tenant, $child, $channel, true);

        $response = $this->getJson("/store/v1/{$tenant->slug}/categories/{$child->id}")->assertOk();
        // لا أب غير منشور في سياق التنقّل (يُحذف المفتاح كلياً حين تفرغ القائمة).
        $this->assertSame([], $response->json('data.ancestors') ?? []);
    }

    /** @test */
    public function category_filtered_products_respect_the_category_gate(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedWebStore('catfilter');
        $published = $this->category($tenant, 'منشور للترشيح');
        $unpublished = $this->category($tenant, 'غير منشور للترشيح');
        $this->setCategoryPublication($tenant, $published, $channel, true);
        $this->setCategoryPublication($tenant, $unpublished, $channel, false);

        $inPublished = $this->publishedProduct($tenant, $channel, ['category_id' => $published->id]);
        $this->publishedProduct($tenant, $channel, ['category_id' => $unpublished->id, 'name' => 'منتج في تصنيف مخفي']);

        // الترشيح بتصنيف منشور يعمل كالمعتاد.
        $this->getJson("/store/v1/{$tenant->slug}/products?category_id={$published->id}")
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1)
            ->assertJsonPath('data.0.id', $inPublished->id);

        // الترشيح بتصنيف غير منشور ليس سطحاً عاماً — نتيجة فارغة حتمية.
        $this->getJson("/store/v1/{$tenant->slug}/products?category_id={$unpublished->id}")
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 0)
            ->assertJsonCount(0, 'data');
    }

    /** @test */
    public function published_product_in_unpublished_category_stays_visible_in_the_main_list(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedWebStore('catind');
        $hiddenCategory = $this->category($tenant, 'تصنيف مخفي مع منتج منشور');
        $this->setCategoryPublication($tenant, $hiddenCategory, $channel, false);
        $product = $this->publishedProduct($tenant, $channel, ['category_id' => $hiddenCategory->id]);

        // استقلالية كاملة: إخفاء التصنيف لا يغيّر حالة المنتج المنشور إطلاقاً.
        $this->getJson("/store/v1/{$tenant->slug}/products")
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 1)
            ->assertJsonPath('data.0.id', $product->id);

        $this->getJson("/store/v1/{$tenant->slug}/products/{$product->id}")->assertOk();
    }

    /** @test */
    public function category_publication_is_independent_per_sales_channel(): void
    {
        ['tenant' => $tenant, 'channel' => $channelA] = $this->seedWebStore('catmulti');
        app(TenantContext::class)->set($tenant->id);
        $channelB = SalesChannel::create([
            'slug' => 'web-second', 'name' => 'متجر ثانٍ', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $category = $this->category($tenant, 'تصنيف متعدد القنوات');
        // منشور على قناة المتجر الأول (القناة التي تحلّها المسار المتوارث)،
        // غير منشور على القناة الثانية — القراءة من القناة الأولى لا تتأثر.
        $this->setCategoryPublication($tenant, $category, $channelA, true);
        $this->setCategoryPublication($tenant, $category, $channelB, false);

        $this->getJson("/store/v1/{$tenant->slug}/categories")
            ->assertOk()
            ->assertJsonPath('data.0.id', $category->id);

        // وقلب الحالتين يخفي التصنيف عن قناة المسار فوراً — حتمية بلا fallback.
        $this->setCategoryPublication($tenant, $category, $channelA, false);
        $this->setCategoryPublication($tenant, $category, $channelB, true);
        $this->getJson("/store/v1/{$tenant->slug}/categories")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    // ── /commerce/v1 (mobile) ────────────────────────────────────────────

    /** @test */
    public function mobile_catalog_applies_the_same_category_gate_on_the_mobile_channel(): void
    {
        $tenant = Tenant::create([
            'name' => 'متجر جوال', 'slug' => 'mobile-cat-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $mobile = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
        $key = app(ApiClientKeyService::class)->issueKey($client, 'default', []);

        $published = $this->category($tenant, 'تصنيف جوال منشور');
        $unpublished = $this->category($tenant, 'تصنيف جوال غير منشور');
        $this->setCategoryPublication($tenant, $published, $mobile, true);
        $this->setCategoryPublication($tenant, $unpublished, $mobile, false);

        $response = $this->withToken($key->plainTextToken)->getJson('/commerce/v1/categories')->assertOk();
        $ids = collect($response->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($published->id));
        $this->assertFalse($ids->contains($unpublished->id));

        $this->withToken($key->plainTextToken)
            ->getJson('/commerce/v1/categories/'.$unpublished->id)
            ->assertNotFound();
    }
}

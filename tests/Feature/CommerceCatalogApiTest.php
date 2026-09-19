<?php

namespace Tests\Feature;

use App\Models\ApiClient;
use App\Models\CommerceListing;
use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — PR-2 (Read-only Catalog)
 * ═══════════════════════════════════════════════════════════════
 *  يثبت: عزل المستأجرين، رفض قناة خاطئة/معطَّلة، إخفاء المنتجات غير
 *  المنشورة، التسعير حسب القناة المحلولة، pagination، وأن `/store/v1` يبقى
 *  بلا أي تغيير سلوكي (منتجٌ منشور لقناة web لا يظهر في /commerce/v1 والعكس).
 *
 *  تشغيل: php artisan test --filter=CommerceCatalogApiTest
 */
class CommerceCatalogApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $key = $this->service()->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel, array $attrs = []): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 25000, 'tax_rate' => 15,
            'is_active' => true,
            'avg_cost' => 9999, 'purchase_price' => 8000, 'quantity_on_hand' => 42,
            'internal_notes' => 'سرّي جداً', 'tags' => 'internal-tag',
        ], $attrs));

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    // ── 1. عزل المستأجرين ────────────────────────────────────────────────

    /** @test */
    public function tenant_a_products_never_appear_for_tenant_b(): void
    {
        $a = $this->seedMobileStore('a');
        $b = $this->seedMobileStore('b');

        $productA = $this->publishedProduct($a['tenant'], $a['channel'], ['name' => 'منتج أ']);
        $productB = $this->publishedProduct($b['tenant'], $b['channel'], ['name' => 'منتج ب']);

        $resA = $this->getJson('/commerce/v1/products', $this->bearer($a['token']))->assertOk();
        $idsA = collect($resA->json('data'))->pluck('id')->all();
        $this->assertContains($productA->id, $idsA);
        $this->assertNotContains($productB->id, $idsA);

        // معرّف منتج المستأجر الآخر مباشرةً أيضاً غير متاح (404 لا تسريب وجوده).
        $this->getJson("/commerce/v1/products/{$productB->id}", $this->bearer($a['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function tenant_a_categories_never_appear_for_tenant_b(): void
    {
        $a = $this->seedMobileStore('cat-a');
        $b = $this->seedMobileStore('cat-b');

        app(TenantContext::class)->set($a['tenant']->id);
        $categoryA = ProductCategory::create(['name' => 'تصنيف أ', 'is_active' => true]);
        // COM-CATALOG-2 — البوابة الجديدة: ظهور التصنيف يتطلب صف نشر على قناة الجوال.
        \App\Models\CommerceCategoryListing::create([
            'tenant_id' => $a['tenant']->id, 'category_id' => $categoryA->id,
            'sales_channel_id' => $a['channel']->id, 'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($b['tenant']->id);
        $categoryB = ProductCategory::create(['name' => 'تصنيف ب', 'is_active' => true]);
        app(TenantContext::class)->forget();

        $res = $this->getJson('/commerce/v1/categories', $this->bearer($a['token']))->assertOk();
        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertContains($categoryA->id, $ids);
        $this->assertNotContains($categoryB->id, $ids);

        $this->getJson("/commerce/v1/categories/{$categoryB->id}", $this->bearer($a['token']))
            ->assertStatus(404);
    }

    // ── 2. قناة خاطئة/معطَّلة — fail closed ─────────────────────────────

    /** @test */
    public function an_inactive_mobile_channel_denies_the_catalog(): void
    {
        $store = $this->seedMobileStore('inactive-chan');
        $this->publishedProduct($store['tenant'], $store['channel']);

        $store['channel']->update(['is_active' => false]);

        $this->getJson('/commerce/v1/products', $this->bearer($store['token']))
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');

        $this->getJson('/commerce/v1/categories', $this->bearer($store['token']))
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function a_tenant_with_no_mobile_channel_is_denied_the_catalog(): void
    {
        $tenant = Tenant::create([
            'name' => 'بلا قناة', 'slug' => 'no-channel-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $token = $this->service()->issueKey($client, 'default', [])->plainTextToken;

        $this->getJson('/commerce/v1/products', $this->bearer($token))->assertStatus(404);
        $this->getJson('/commerce/v1/categories', $this->bearer($token))->assertStatus(404);
    }

    // ── 3. منتجات غير منشورة ──────────────────────────────────────────────

    /** @test */
    public function an_unpublished_product_is_not_listed_or_shown(): void
    {
        $store = $this->seedMobileStore('unpublished');

        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج غير منشور', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => false,
        ]);
        app(TenantContext::class)->forget();

        $res = $this->getJson('/commerce/v1/products', $this->bearer($store['token']))->assertOk();
        $this->assertNotContains($product->id, collect($res->json('data'))->pluck('id')->all());

        $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function an_inactive_product_is_not_exposed_even_if_listed(): void
    {
        $store = $this->seedMobileStore('inactive-product');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['is_active' => false]);

        $res = $this->getJson('/commerce/v1/products', $this->bearer($store['token']))->assertOk();
        $this->assertNotContains($product->id, collect($res->json('data'))->pluck('id')->all());

        $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function sensitive_internal_fields_never_appear_in_the_response(): void
    {
        $store = $this->seedMobileStore('sensitive');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        $body = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))
            ->assertOk()
            ->json('data');

        foreach (['avg_cost', 'purchase_price', 'quantity_on_hand', 'internal_notes', 'tags', 'min_sale_price'] as $field) {
            $this->assertArrayNotHasKey($field, $body, "الحقل الحسّاس «{$field}» ظهر في استجابة عامة.");
        }
    }

    // ── 4. التسعير حسب القناة المحلولة ────────────────────────────────────

    /** @test */
    public function pricing_resolves_from_the_channels_own_price_list_when_configured(): void
    {
        $store = $this->seedMobileStore('priced');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['sale_price' => 10000]);

        app(TenantContext::class)->set($store['tenant']->id);
        $priceList = PriceList::create(['name' => 'سعر الجوال', 'is_active' => true]);
        PriceListItem::create([
            'price_list_id' => $priceList->id, 'product_id' => $product->id,
            'unit_name' => $product->unit, 'price' => 7500,
        ]);
        $store['channel']->update(['default_price_list_id' => $priceList->id]);
        app(TenantContext::class)->forget();

        $this->getJson('/commerce/v1/products', $this->bearer($store['token']))
            ->assertOk()
            ->assertJsonPath('data.0.price.amount_minor', 7500)
            ->assertJsonPath('data.0.price.currency', 'SAR');

        $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))
            ->assertOk()
            ->assertJsonPath('data.price.amount_minor', 7500);
    }

    /** @test */
    public function pricing_falls_back_to_the_product_base_price_with_no_channel_price_list(): void
    {
        $store = $this->seedMobileStore('base-priced');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['sale_price' => 12345]);

        $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))
            ->assertOk()
            ->assertJsonPath('data.price.amount_minor', 12345);
    }

    // ── 5. Pagination ──────────────────────────────────────────────────

    /** @test */
    public function per_page_beyond_the_hard_maximum_is_rejected(): void
    {
        $store = $this->seedMobileStore('pagination');

        // يطابق عقد /store/v1 نفسه: per_page خارج 1..100 خطأ تحقّق صريح (422)، لا قصّاً صامتاً.
        $this->getJson('/commerce/v1/products?per_page=500', $this->bearer($store['token']))
            ->assertStatus(422);
    }

    /** @test */
    public function pagination_meta_reflects_the_real_result_set(): void
    {
        $store = $this->seedMobileStore('pagination-meta');
        $this->publishedProduct($store['tenant'], $store['channel'], ['name' => 'م1']);
        $this->publishedProduct($store['tenant'], $store['channel'], ['name' => 'م2']);
        $this->publishedProduct($store['tenant'], $store['channel'], ['name' => 'م3']);

        $this->getJson('/commerce/v1/products?per_page=2', $this->bearer($store['token']))
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 3)
            ->assertJsonPath('meta.pagination.per_page', 2)
            ->assertJsonPath('meta.pagination.last_page', 2)
            ->assertJsonPath('meta.pagination.has_more', true)
            ->assertJsonCount(2, 'data');
    }

    // ── 6. /store/v1 يبقى بلا أي تغيير سلوكي ─────────────────────────────

    /** @test */
    public function a_web_only_listing_never_leaks_into_the_commerce_v1_catalog(): void
    {
        $store = $this->seedMobileStore('web-boundary');

        app(TenantContext::class)->set($store['tenant']->id);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'متجر الويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        // منشور لقناة الويب فقط — يجب ألا يظهر عبر /commerce/v1 (قناة الجوال).
        $webOnlyProduct = $this->publishedProduct($store['tenant'], $webChannel, ['name' => 'منتج الويب فقط']);

        $res = $this->getJson('/commerce/v1/products', $this->bearer($store['token']))->assertOk();
        $this->assertNotContains($webOnlyProduct->id, collect($res->json('data'))->pluck('id')->all());
    }

    /** @test */
    public function store_v1_web_catalog_is_unaffected_by_the_commerce_v1_route_group(): void
    {
        $tenant = Tenant::create([
            'name' => 'متجر ويب أصلي', 'slug' => 'store-v1-untouched-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $product = $this->publishedProduct($tenant, $webChannel, ['name' => 'منتج الويب الأصلي']);

        $res = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk();
        $this->assertContains($product->id, collect($res->json('data'))->pluck('id')->all());
    }
}

<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\FulfillmentPolicy;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\ProductWarehouseStock;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COM-7-P1 — Storefront Public Catalog API (store/v1) — tenant isolation,
 *  publish-gating, sensitive-field exclusion, pagination bounds, and price/
 *  availability derivation.
 * ═══════════════════════════════════════════════════════════════
 *  تشغيل: php artisan test --filter=StorefrontCatalogApiTest
 */
class StorefrontCatalogApiTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{tenant: Tenant, channel: SalesChannel, warehouse: Warehouse} */
    private function seedStore(string $slug, bool $withWarehouse = true): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $warehouse = null;
        if ($withWarehouse) {
            $warehouse = Warehouse::create([
                'code' => 'WH-'.Str::random(4), 'name' => 'المخزن الرئيسي', 'is_active' => true,
            ]);
            FulfillmentPolicy::create(['sales_channel_id' => $channel->id, 'warehouse_id' => $warehouse->id]);
        }

        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'warehouse');
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel, array $attrs = []): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 25000, 'tax_rate' => 15,
            'is_active' => true,
            // بيانات حسّاسة يجب ألا تظهر في أي استجابة عامة.
            'avg_cost' => 9999, 'purchase_price' => 8000, 'min_sale_price' => 20000,
            'discount' => 500, 'discount_type' => 'amount', 'profit_margin' => 17,
            'quantity_on_hand' => 42, 'internal_notes' => 'سرّي جداً', 'tags' => 'internal-tag',
        ], $attrs));

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    // ── 1/2. Tenant & channel isolation ─────────────────────────────────

    /** @test */
    public function tenant_a_catalog_never_exposes_tenant_b_products(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedStore('a');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->seedStore('b');

        $productA = $this->publishedProduct($tenantA, $channelA, ['name' => 'منتج المستأجر أ']);
        $productB = $this->publishedProduct($tenantB, $channelB, ['name' => 'منتج المستأجر ب']);

        $resA = $this->getJson("/store/v1/{$tenantA->slug}/products")->assertOk();
        $idsA = collect($resA->json('data'))->pluck('id')->all();
        $this->assertContains($productA->id, $idsA);
        $this->assertNotContains($productB->id, $idsA);

        $resB = $this->getJson("/store/v1/{$tenantB->slug}/products")->assertOk();
        $idsB = collect($resB->json('data'))->pluck('id')->all();
        $this->assertContains($productB->id, $idsB);
        $this->assertNotContains($productA->id, $idsB);

        // منتج المستأجر الآخر بمعرّفه المباشر أيضاً غير متاح (404 لا تسريب وجوده).
        $this->getJson("/store/v1/{$tenantA->slug}/products/{$productB->id}")->assertStatus(404);
    }

    /** @test */
    public function a_listing_on_a_different_channel_within_the_same_tenant_is_not_exposed(): void
    {
        ['tenant' => $tenant, 'channel' => $webChannel] = $this->seedStore('c');

        app(TenantContext::class)->set($tenant->id);
        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        $mobileOnlyProduct = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج الجوال فقط', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $mobileOnlyProduct->id, 'sales_channel_id' => $mobileChannel->id, 'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        // القناة المحلولة للمتجر العام هي `web` النشطة حصراً — لا تسرّب قناة أخرى.
        $res = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk();
        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertNotContains($mobileOnlyProduct->id, $ids);
        $this->getJson("/store/v1/{$tenant->slug}/products/{$mobileOnlyProduct->id}")->assertStatus(404);
    }

    // ── 3. Unknown/invalid store context ────────────────────────────────

    /** @test */
    public function unknown_tenant_slug_fails_safely_with_404(): void
    {
        $this->getJson('/store/v1/no-such-store/products')->assertStatus(404);
        $this->getJson('/store/v1/no-such-store/categories')->assertStatus(404);
    }

    /** @test */
    public function inactive_tenant_fails_safely_with_404(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('d');
        $this->publishedProduct($tenant, $channel);

        $tenant->update(['is_active' => false]);

        $this->getJson("/store/v1/{$tenant->slug}/products")->assertStatus(404);
    }

    /** @test */
    public function tenant_with_no_active_web_channel_fails_safely_with_404(): void
    {
        $tenant = Tenant::create([
            'name' => 'بلا متجر', 'slug' => 'no-channel-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);

        $this->getJson("/store/v1/{$tenant->slug}/products")->assertStatus(404);
    }

    // ── 4. Publish gating ────────────────────────────────────────────────

    /** @test */
    public function unpublished_listing_is_not_publicly_exposed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('e');

        app(TenantContext::class)->set($tenant->id);
        $unpublished = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج غير منشور', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 5000, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $unpublished->id, 'sales_channel_id' => $channel->id, 'is_published' => false,
        ]);
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk();
        $this->assertNotContains($unpublished->id, collect($res->json('data'))->pluck('id')->all());
        $this->getJson("/store/v1/{$tenant->slug}/products/{$unpublished->id}")->assertStatus(404);
    }

    /** @test */
    public function inactive_product_is_not_publicly_exposed_even_if_listed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('f');
        $product = $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $product->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk();
        $this->assertNotContains($product->id, collect($res->json('data'))->pluck('id')->all());
        $this->getJson("/store/v1/{$tenant->slug}/products/{$product->id}")->assertStatus(404);
    }

    // ── 5. Sensitive fields absent ───────────────────────────────────────

    /** @test */
    public function sensitive_cost_and_internal_fields_never_appear_in_the_response(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('g');
        $product = $this->publishedProduct($tenant, $channel);

        $forbidden = [
            'avg_cost', 'purchase_price', 'min_sale_price', 'discount', 'discount_type',
            'profit_margin', 'sales_account_id', 'cogs_account_id', 'supplier_id',
            'quantity_on_hand', 'internal_notes', 'tags', 'reorder_level', 'on_hand', 'active_reserved',
        ];

        $list = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk();
        $show = $this->getJson("/store/v1/{$tenant->slug}/products/{$product->id}")->assertOk();

        foreach ([$list, $show] as $response) {
            $raw = $response->getContent();
            foreach ($forbidden as $field) {
                $this->assertStringNotContainsString('"'.$field.'"', $raw, "leaked field: {$field}");
            }
        }
    }

    // ── 6. Pagination / filter bounds ───────────────────────────────────

    /** @test */
    public function per_page_beyond_the_hard_maximum_is_rejected(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('h');
        $this->publishedProduct($tenant, $channel);

        // يطابق عقد PublicProductController نفسه: per_page خارج 1..100 خطأ
        // تحقّق صريح (422)، لا قصّاً صامتاً.
        $this->getJson("/store/v1/{$tenant->slug}/products?per_page=500")->assertStatus(422);

        $res = $this->getJson("/store/v1/{$tenant->slug}/products?per_page=100")->assertOk();
        $this->assertSame(100, $res->json('meta.pagination.per_page'));
    }

    /** @test */
    public function an_unsupported_sort_field_is_rejected(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('i');
        $this->publishedProduct($tenant, $channel);

        $this->getJson("/store/v1/{$tenant->slug}/products?sort=avg_cost")->assertStatus(422);
    }

    // ── 7. Price authority ──────────────────────────────────────────────

    /** @test */
    public function list_and_detail_price_agree_and_match_the_product_sale_price(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('j');
        $product = $this->publishedProduct($tenant, $channel, ['sale_price' => 77700]);

        $list = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk();
        $show = $this->getJson("/store/v1/{$tenant->slug}/products/{$product->id}")->assertOk();

        $listItem = collect($list->json('data'))->firstWhere('id', $product->id);
        $this->assertSame(77700, $listItem['price']['amount_minor']);
        $this->assertSame('SAR', $listItem['price']['currency']);
        $this->assertSame(77700, $show->json('data.price.amount_minor'));
        $this->assertSame('SAR', $show->json('data.price.currency'));
    }

    // ── 8. Availability without valuation leakage ───────────────────────

    /** @test */
    public function availability_reflects_available_to_sell_without_exposing_raw_valuation(): void
    {
        ['tenant' => $tenant, 'channel' => $channel, 'warehouse' => $warehouse] = $this->seedStore('k');
        $product = $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10]);
        app(TenantContext::class)->forget();

        $show = $this->getJson("/store/v1/{$tenant->slug}/products/{$product->id}")->assertOk();
        $this->assertTrue($show->json('data.in_stock'));
        $this->assertArrayNotHasKey('quantity_on_hand', $show->json('data'));
        $this->assertArrayNotHasKey('avg_cost', $show->json('data'));

        app(TenantContext::class)->set($tenant->id);
        ProductWarehouseStock::where('product_id', $product->id)->update(['quantity' => 0]);
        app(TenantContext::class)->forget();

        $showOut = $this->getJson("/store/v1/{$tenant->slug}/products/{$product->id}")->assertOk();
        $this->assertFalse($showOut->json('data.in_stock'));
    }

    /** @test */
    public function availability_is_null_when_the_channel_has_no_fulfillment_policy(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedStore('l', withWarehouse: false);
        $product = $this->publishedProduct($tenant, $channel);

        $show = $this->getJson("/store/v1/{$tenant->slug}/products/{$product->id}")->assertOk();
        $this->assertNull($show->json('in_stock'));

        $list = $this->getJson("/store/v1/{$tenant->slug}/products")->assertOk();
        $listItem = collect($list->json('data'))->firstWhere('id', $product->id);
        $this->assertNull($listItem['in_stock']);
    }

    // ── Categories ───────────────────────────────────────────────────────

    /** @test */
    public function category_tree_is_tenant_isolated_and_excludes_inactive_categories(): void
    {
        ['tenant' => $tenantA] = $this->seedStore('m');
        ['tenant' => $tenantB] = $this->seedStore('n');

        app(TenantContext::class)->set($tenantA->id);
        $active = ProductCategory::create(['name' => 'إلكترونيات', 'is_active' => true]);
        ProductCategory::create(['name' => 'مصنّف معطّل', 'is_active' => false]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($tenantB->id);
        ProductCategory::create(['name' => 'تصنيف مستأجر آخر', 'is_active' => true]);
        app(TenantContext::class)->forget();

        $res = $this->getJson("/store/v1/{$tenantA->slug}/categories")->assertOk();
        $names = collect($res->json('data'))->pluck('name')->all();

        $this->assertContains($active->name, $names);
        $this->assertNotContains('مصنّف معطّل', $names);
        $this->assertNotContains('تصنيف مستأجر آخر', $names);
    }
}

<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — COM-MOBILE-VARIANTS-1
 * ═══════════════════════════════════════════════════════════════
 *  يثبت: `GET /commerce/v1/products/{id}` لمنتجٍ متعدد الخيارات يعرض
 *  `options`/`variants` (وصفٌ/سعرٌ/توفّرٌ/وسائط لكل متغيّرٍ نشِط) بنفس شكل
 *  `/store/v1` تماماً؛ متغيّرٌ معطَّل لا يظهر؛ القائمة (`index`) تبقى مؤجَّلة
 *  كما هي (`is_variant_managed` فقط)؛ عزل مستأجرين/قنوات كما في بقية
 *  الكتالوج.
 *
 *  تشغيل: php artisan test --filter=CommerceVariantApiTest
 */
class CommerceVariantApiTest extends TestCase
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

    /**
     * منتجٌ متعدد الخيارات بمتغيّرين نشطين — نفس هيكل
     * `StorefrontVariantCommerceTest::variantManagedProduct()` عمداً (نفس
     * السلطة `ProductVariantService`، نفس التركيب).
     *
     * @return array{0: Product, 1: \App\Models\ProductVariant, 2: \App\Models\ProductVariant}
     */
    private function variantManagedProduct(Tenant $tenant, SalesChannel $channel, string $sku = 'SHIRT-CV', bool $published = true): array
    {
        app(TenantContext::class)->set($tenant->id);
        $tenantId = $tenant->id;

        $product = Product::create([
            'name' => 'قميص', 'sku' => $sku, 'sale_price' => 20000,
            'unit' => 'piece', 'is_active' => true,
        ]);

        $color = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $size = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $large = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'كبير', 'value_key' => 'كبير', 'sort_order' => 0]);
        $small = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'صغير', 'value_key' => 'صغير', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();

        $black1 = $variants->createSingleVariant($product, [$black->id, $large->id], null)['variant'];
        $white1 = $variants->createSingleVariant($product, [$white->id, $small->id], null)['variant'];

        $black1->unitPrices()->create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'unit_name' => $product->unit, 'price' => 20000]);
        $white1->unitPrices()->create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'unit_name' => $product->unit, 'price' => 22000]);

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => $published,
        ]);

        app(TenantContext::class)->forget();

        return [$product->fresh(), $black1->fresh(), $white1->fresh()];
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    // ── 1. عقد التفاصيل ──────────────────────────────────────────────────

    /** @test */
    public function a_published_variant_managed_product_exposes_its_active_variants_with_descriptor_and_price(): void
    {
        $store = $this->seedMobileStore('variants');
        [$product, $black, $white] = $this->variantManagedProduct($store['tenant'], $store['channel']);

        $response = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))->assertOk();
        $response->assertJsonPath('data.is_variant_managed', true);

        $variants = $response->json('data.variants');
        $this->assertCount(2, $variants);
        $byId = collect($variants)->keyBy('id');
        $this->assertSame('أسود / كبير', $byId[$black->id]['descriptor']);
        $this->assertSame(20000, $byId[$black->id]['price']['amount_minor']);
        $this->assertSame('أبيض / صغير', $byId[$white->id]['descriptor']);
        $this->assertSame(22000, $byId[$white->id]['price']['amount_minor']);

        $options = $response->json('data.options');
        $this->assertCount(2, $options);
    }

    /** @test */
    public function a_simple_products_detail_has_null_options_and_variants(): void
    {
        $store = $this->seedMobileStore('simple');
        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create(['name' => 'منتج بسيط', 'sku' => 'SIMPLE-CV', 'unit' => 'piece', 'sale_price' => 3000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => true]);
        app(TenantContext::class)->forget();

        $response = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))->assertOk();
        $response->assertJsonPath('data.is_variant_managed', false);
        $this->assertNull($response->json('data.variants'));
        $this->assertNull($response->json('data.options'));
    }

    /** @test */
    public function an_inactive_variant_does_not_appear_among_purchasable_options(): void
    {
        $store = $this->seedMobileStore('inactive-variant');
        [$product, $black, $white] = $this->variantManagedProduct($store['tenant'], $store['channel']);

        app(TenantContext::class)->set($store['tenant']->id);
        $white->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $response = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))->assertOk();
        $variants = collect($response->json('data.variants'))->pluck('id')->all();
        $this->assertContains($black->id, $variants);
        $this->assertNotContains($white->id, $variants);
    }

    /** @test */
    public function the_list_endpoint_keeps_the_deferred_row_with_no_variant_payload(): void
    {
        $store = $this->seedMobileStore('list-deferred');
        [$product] = $this->variantManagedProduct($store['tenant'], $store['channel']);

        $response = $this->getJson('/commerce/v1/products', $this->bearer($store['token']))->assertOk();
        $item = collect($response->json('data'))->firstWhere('id', $product->id);

        $this->assertTrue($item['is_variant_managed']);
        $this->assertSame(0, $item['price']['amount_minor']);
        $this->assertNull($item['in_stock']);
        $this->assertArrayNotHasKey('options', $item);
        $this->assertArrayNotHasKey('variants', $item);
    }

    // ── 2. حدود الثقة ─────────────────────────────────────────────────────

    /** @test */
    public function a_variant_managed_product_unpublished_on_the_mobile_channel_is_not_shown(): void
    {
        $store = $this->seedMobileStore('unpublished-variant');
        [$product] = $this->variantManagedProduct($store['tenant'], $store['channel'], published: false);

        $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function a_foreign_tenants_variant_managed_product_is_not_shown(): void
    {
        $a = $this->seedMobileStore('a');
        $b = $this->seedMobileStore('b');
        [$productB] = $this->variantManagedProduct($b['tenant'], $b['channel']);

        $this->getJson("/commerce/v1/products/{$productB->id}", $this->bearer($a['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function no_sensitive_internal_fields_leak_through_the_variant_payload(): void
    {
        $store = $this->seedMobileStore('sensitive-variant');
        [$product] = $this->variantManagedProduct($store['tenant'], $store['channel']);

        $response = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))->assertOk();
        $encoded = json_encode($response->json('data.variants'));

        foreach (['avg_cost', 'purchase_price', 'quantity_on_hand', 'tenant_id'] as $field) {
            $this->assertStringNotContainsString('"'.$field.'"', $encoded, "الحقل الحسّاس «{$field}» ظهر في وسائط متغيّرات مسار Commerce.");
        }
    }
}

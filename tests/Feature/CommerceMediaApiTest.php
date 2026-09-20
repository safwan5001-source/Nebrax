<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Public/Mobile Commerce API V1 — COM-MOBILE-MEDIA-1
 * ═══════════════════════════════════════════════════════════════
 *  يثبت: `thumbnail_url`/`media` في `/commerce/v1/products` تشير إلى
 *  `/commerce/v1/media/{id}` الجديد لا رابط `/store/v1`، وأن ذلك المسار
 *  يخدم البايتات فقط لوسائط منتجٍ منشورٍ فعلاً على قناة الجوال المحلولة —
 *  عزل مستأجرين، حجب قناةٍ أجنبية/منتجٍ غير منشور، ومعرّفٍ غير موجود، دون
 *  تكرار سلطة تخزين وسائط موازية.
 *
 *  تشغيل: php artisan test --filter=CommerceMediaApiTest
 */
class CommerceMediaApiTest extends TestCase
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
        ], $attrs));

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function attachMedia(Tenant $tenant, Product $product, string $filename = 'pineapple.webp'): ProductMedia
    {
        app(TenantContext::class)->set($tenant->id);
        Storage::disk('local')->put("products/{$filename}", 'image-bytes');
        $media = ProductMedia::create([
            'product_id' => $product->id,
            'disk' => 'local',
            'path' => "products/{$filename}",
            'original_name' => 'IMG_0363.webp',
            'mime_type' => 'image/webp',
            'size' => 11,
            'sort_order' => 0,
        ]);
        app(TenantContext::class)->forget();

        return $media;
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    // ── 1. الرابط والغلاف/المعرض ──────────────────────────────────────────

    /** @test */
    public function published_product_media_is_returned_as_the_listing_thumbnail_and_detail_gallery(): void
    {
        Storage::fake('local');
        $store = $this->seedMobileStore('media');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $media = $this->attachMedia($store['tenant'], $product);

        $list = $this->getJson('/commerce/v1/products', $this->bearer($store['token']))->assertOk();
        $item = collect($list->json('data'))->firstWhere('id', $product->id);
        $this->assertSame(
            "/commerce/v1/media/{$media->id}",
            parse_url($item['thumbnail_url'], PHP_URL_PATH),
        );

        $show = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))->assertOk();
        $this->assertSame($media->id, $show->json('data.media.0.id'));
        $this->assertSame(
            "/commerce/v1/media/{$media->id}",
            parse_url($show->json('data.media.0.url'), PHP_URL_PATH),
        );
    }

    /** @test */
    public function a_product_with_no_media_has_a_null_thumbnail_and_empty_gallery(): void
    {
        $store = $this->seedMobileStore('no-media');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);

        $list = $this->getJson('/commerce/v1/products', $this->bearer($store['token']))->assertOk();
        $item = collect($list->json('data'))->firstWhere('id', $product->id);
        $this->assertNull($item['thumbnail_url']);

        $show = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))->assertOk();
        $this->assertSame([], $show->json('data.media'));
    }

    // ── 2. خدمة البايتات الفعلية ──────────────────────────────────────────

    /** @test */
    public function the_media_route_serves_the_actual_file_bytes_for_a_published_product(): void
    {
        Storage::fake('local');
        $store = $this->seedMobileStore('bytes');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $media = $this->attachMedia($store['tenant'], $product);

        $this->get("/commerce/v1/media/{$media->id}", $this->bearer($store['token']))
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp');
    }

    // ── 3. حدود الثقة ─────────────────────────────────────────────────────

    /** @test */
    public function a_foreign_tenants_media_id_is_not_served(): void
    {
        Storage::fake('local');
        $a = $this->seedMobileStore('a');
        $b = $this->seedMobileStore('b');

        $productB = $this->publishedProduct($b['tenant'], $b['channel']);
        $mediaB = $this->attachMedia($b['tenant'], $productB);

        $this->get("/commerce/v1/media/{$mediaB->id}", $this->bearer($a['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function media_of_an_unpublished_product_is_not_served(): void
    {
        Storage::fake('local');
        $store = $this->seedMobileStore('unpublished-media');

        app(TenantContext::class)->set($store['tenant']->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج غير منشور', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true,
        ]);
        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $store['channel']->id, 'is_published' => false,
        ]);
        app(TenantContext::class)->forget();

        $media = $this->attachMedia($store['tenant'], $product);

        $this->get("/commerce/v1/media/{$media->id}", $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function media_published_only_on_a_web_channel_is_not_served_via_commerce_v1(): void
    {
        Storage::fake('local');
        $store = $this->seedMobileStore('web-only-media');

        app(TenantContext::class)->set($store['tenant']->id);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'متجر الويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        // منشور لقناة الويب فقط، لا قناة الجوال المحلولة لهذا العميل.
        $webOnlyProduct = $this->publishedProduct($store['tenant'], $webChannel);
        $media = $this->attachMedia($store['tenant'], $webOnlyProduct);

        $this->get("/commerce/v1/media/{$media->id}", $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function an_inactive_products_media_is_still_served_since_publication_alone_gates_media(): void
    {
        // يطابق سلوك `/store/v1` نفسه حرفياً: `StorefrontMediaController` لا
        // يفحص `is_active` أصلاً — بوابة الوسائط هي النشر على القناة فقط، لا
        // حالة تفعيل المنتج (التي تُطبَّق على ظهوره في القائمة/التفاصيل).
        Storage::fake('local');
        $store = $this->seedMobileStore('inactive-product-media');
        $product = $this->publishedProduct($store['tenant'], $store['channel'], ['is_active' => false]);
        $media = $this->attachMedia($store['tenant'], $product);

        $this->get("/commerce/v1/media/{$media->id}", $this->bearer($store['token']))
            ->assertOk();
    }

    /** @test */
    public function a_nonexistent_media_id_returns_a_non_revealing_404(): void
    {
        $store = $this->seedMobileStore('missing');

        $this->get('/commerce/v1/media/'.Str::uuid(), $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function an_invalid_media_id_shape_is_rejected(): void
    {
        $store = $this->seedMobileStore('invalid-id');

        $this->get('/commerce/v1/media/not-a-uuid', $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function an_inactive_mobile_channel_denies_media_access(): void
    {
        Storage::fake('local');
        $store = $this->seedMobileStore('inactive-channel-media');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $media = $this->attachMedia($store['tenant'], $product);

        $store['channel']->update(['is_active' => false]);

        $this->get("/commerce/v1/media/{$media->id}", $this->bearer($store['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function no_sensitive_storage_path_or_disk_leaks_in_any_response(): void
    {
        Storage::fake('local');
        $store = $this->seedMobileStore('no-leak');
        $product = $this->publishedProduct($store['tenant'], $store['channel']);
        $this->attachMedia($store['tenant'], $product);

        $body = $this->getJson("/commerce/v1/products/{$product->id}", $this->bearer($store['token']))
            ->assertOk()
            ->json('data');

        $encoded = json_encode($body);
        $this->assertStringNotContainsString('products/pineapple.webp', $encoded);
        $this->assertStringNotContainsString('"disk"', $encoded);
        $this->assertStringNotContainsString('"path"', $encoded);
    }
}

<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\S3\S3ClientInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * AWJ-R2-4B/4E — القراءة التوافقية للوسائط عبر السطحين العامين اللذين
 * يخدمان بايتات الوسائط مباشرة: `/commerce/v1/media/{id}` (COM-MOBILE-MEDIA-1)
 * و`/store/v1/{tenantSlug}/media/{id}` (COM-7-P1) — كلاهما يجب أن يخدم
 * وسائط `disk = 'r2'` بنفس حراسة النشر/القناة القائمة، دون سلطة تخزين موازية.
 */
class ProductMediaR2CommerceStorefrontReadTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    private function mockR2(): MockInterface
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-key', 'secret' => 'placeholder-secret',
            'bucket' => 'awj-product-media-test', 'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto', 'use_path_style_endpoint' => false,
        ]);

        $client = Mockery::mock(S3ClientInterface::class);
        $this->app->instance(R2StorageService::class, new R2StorageService(app(TenantContext::class), $client));

        return $client;
    }

    private function attachR2Media(Product $product, MockInterface $client, string $filename = 'public.webp', string $bytes = 'public-r2-bytes'): ProductMedia
    {
        $key = "tenant/{$product->tenant_id}/product-media/{$product->id}/{$filename}";
        $client->shouldReceive('getObject')->with(['Bucket' => 'awj-product-media-test', 'Key' => $key])
            ->andReturn(['Body' => $bytes]);

        return ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'r2', 'path' => $key,
            'original_name' => $filename, 'mime_type' => 'image/webp', 'size' => strlen($bytes), 'sort_order' => 0,
        ]);
    }

    /** @test */
    public function the_mobile_commerce_media_route_serves_r2_backed_bytes_for_a_published_product(): void
    {
        $client = $this->mockR2();

        $tenant = Tenant::create([
            'name' => 'متجر جوال', 'slug' => 'mobile-r2-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج جوال', 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 25000, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        $media = $this->attachR2Media($product, $client);
        app(TenantContext::class)->forget();

        $apiClientService = app(ApiClientKeyService::class);
        $apiClient = $apiClientService->createClient($tenant, 'mobile-app', true);
        $token = $apiClientService->issueKey($apiClient, 'default', [])->plainTextToken;

        $response = $this->get("/commerce/v1/media/{$media->id}", ['Authorization' => 'Bearer '.$token])
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('public-r2-bytes', $response->streamedContent());
    }

    /** @test */
    public function the_public_storefront_media_route_serves_r2_backed_bytes_for_a_published_product(): void
    {
        $client = $this->mockR2();

        $tenant = Tenant::create([
            'name' => 'متجر ويب', 'slug' => 'web-r2-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج ويب', 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 25000, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);
        $media = $this->attachR2Media($product, $client, 'store.webp', 'store-r2-bytes');
        app(TenantContext::class)->forget();

        $response = $this->get("/store/v1/{$tenant->slug}/media/{$media->id}")
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('store-r2-bytes', $response->streamedContent());
    }
}

<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Response;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * AWJ-R2-4B/4E — القراءة التوافقية عبر `ProductController::downloadMedia()`:
 * وسائط قديمة (`document`) وجديدة (`r2`) تُخدَّم معاً من نفس المنتج، مع
 * بقاء حراسة المستأجر كما هي تماماً.
 */
class ProductMediaR2ReadTest extends TestCase
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

    private function product(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج قراءة', 'sku' => 'READ-SKU-'.\Illuminate\Support\Str::random(6),
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    private function attachDocumentMedia(Product $product, string $filename = 'legacy.webp'): ProductMedia
    {
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        Storage::disk('local')->put("product-media/{$product->tenant_id}/{$product->id}/{$filename}", 'legacy-bytes');

        return ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'document',
            'path' => "product-media/{$product->tenant_id}/{$product->id}/{$filename}",
            'original_name' => 'legacy.webp', 'mime_type' => 'image/webp', 'size' => 12, 'sort_order' => 0,
        ]);
    }

    private function attachR2Media(Product $product, MockInterface $client, string $filename = 'new.webp', string $bytes = 'r2-bytes'): ProductMedia
    {
        $key = "tenant/{$product->tenant_id}/product-media/{$product->id}/{$filename}";
        $client->shouldReceive('getObject')->with(['Bucket' => 'awj-product-media-test', 'Key' => $key])
            ->andReturn(['Body' => $bytes]);

        return ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'r2', 'path' => $key,
            'original_name' => 'new.webp', 'mime_type' => 'image/webp', 'size' => strlen($bytes), 'sort_order' => 1,
        ]);
    }

    /** @test */
    public function legacy_and_r2_media_coexist_and_both_serve_correctly_for_the_same_product(): void
    {
        Storage::fake('local');
        $client = $this->mockR2();
        $auth = $this->registerTenant('coexist');
        $productData = $this->product($auth['token']);
        $product = Product::findOrFail($productData['id']);

        $legacy = $this->attachDocumentMedia($product);
        $fresh = $this->attachR2Media($product, $client);

        $legacyResponse = $this->withToken($auth['token'])->get("/api/products/{$product->id}/media/{$legacy->id}/download")
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('legacy-bytes', $legacyResponse->streamedContent());

        $freshResponse = $this->withToken($auth['token'])->get("/api/products/{$product->id}/media/{$fresh->id}/download")
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('r2-bytes', $freshResponse->streamedContent());
    }

    /** @test */
    public function a_missing_r2_object_returns_a_clean_404_not_an_internal_error(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('missing-object');
        $productData = $this->product($auth['token']);
        $product = Product::findOrFail($productData['id']);

        $key = "tenant/{$product->tenant_id}/product-media/{$product->id}/gone.webp";
        $media = ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'r2', 'path' => $key,
            'original_name' => 'gone.webp', 'mime_type' => 'image/webp', 'size' => 1, 'sort_order' => 0,
        ]);

        $client->shouldReceive('getObject')->once()->andThrow(new AwsException(
            'missing', Mockery::mock('Aws\\CommandInterface'),
            ['code' => 'NoSuchKey', 'response' => new Response(404)],
        ));

        $this->withToken($auth['token'])->get("/api/products/{$product->id}/media/{$media->id}/download")
            ->assertStatus(404);
    }

    /** @test */
    public function a_foreign_tenants_r2_backed_media_is_not_served(): void
    {
        $client = $this->mockR2();
        $owner = $this->registerTenant('r2-owner', 'owner@r2-owner.test');
        $attacker = $this->registerTenant('r2-attacker', 'owner@r2-attacker.test');
        $productData = $this->product($owner['token']);
        app(TenantContext::class)->set($owner['tenant_id']);
        $product = Product::findOrFail($productData['id']);
        $media = $this->attachR2Media($product, $client);
        app(TenantContext::class)->forget();

        $this->withToken($attacker['token'])->get("/api/products/{$product->id}/media/{$media->id}/download")
            ->assertStatus(404);
    }
}

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
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * AWJ-R2-4D/4E — حذف وسائط R2-backed يستهدف الكائن الدقيق فقط، بلا سرد أو
 * حذفٍ جماعي، وبلا تلويثٍ لحالة `ProductMedia` عند فشل الحذف من التخزين.
 */
class ProductMediaR2DeleteTest extends TestCase
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

    private function product(string $token): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج حذف', 'sku' => 'DEL-SKU-'.\Illuminate\Support\Str::random(6),
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 10000,
        ])->assertCreated()['data'];
    }

    private function attachR2Media(Product $product, string $filename = 'target.webp'): ProductMedia
    {
        $key = "tenant/{$product->tenant_id}/product-media/{$product->id}/{$filename}";

        return ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'r2', 'path' => $key,
            'original_name' => $filename, 'mime_type' => 'image/webp', 'size' => 1, 'sort_order' => 0,
        ]);
    }

    /** @test */
    public function deleting_r2_backed_media_targets_the_exact_object_only(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('r2-delete');
        $productData = $this->product($auth['token']);
        $product = Product::findOrFail($productData['id']);
        $decoy = $this->attachR2Media($product, 'decoy.webp');
        $target = $this->attachR2Media($product, 'target.webp');

        $expectedKeys = [
            "tenant/{$product->tenant_id}/product-media/{$product->id}/{$target->id}-thumbnail.webp",
            "tenant/{$product->tenant_id}/product-media/{$product->id}/{$target->id}-card.webp",
            "tenant/{$product->tenant_id}/product-media/{$product->id}/target.webp",
        ];
        $client->shouldNotReceive('deleteObjects');
        $client->shouldReceive('deleteObject')->times(3)
            ->with(Mockery::on(fn (array $args): bool => $args['Bucket'] === 'awj-product-media-test' && in_array($args['Key'], $expectedKeys, true)))
            ->andReturn([]);

        $this->withToken($auth['token'])->deleteJson("/api/products/{$product->id}/media/{$target->id}")
            ->assertOk();

        $this->assertNull(ProductMedia::find($target->id));
        $this->assertNotNull(ProductMedia::find($decoy->id));
    }

    /** @test */
    public function a_foreign_tenant_cannot_delete_another_tenants_r2_backed_media(): void
    {
        $client = $this->mockR2();
        $owner = $this->registerTenant('del-owner', 'owner@del-owner.test');
        $attacker = $this->registerTenant('del-attacker', 'owner@del-attacker.test');
        $productData = $this->product($owner['token']);
        app(TenantContext::class)->set($owner['tenant_id']);
        $product = Product::findOrFail($productData['id']);
        $media = $this->attachR2Media($product);
        app(TenantContext::class)->forget();

        $client->shouldNotReceive('deleteObject');

        $this->withToken($attacker['token'])->deleteJson("/api/products/{$product->id}/media/{$media->id}")
            ->assertStatus(404);

        $this->assertNotNull(ProductMedia::find($media->id));
    }

    /** @test */
    public function a_failed_r2_delete_does_not_remove_the_product_media_row(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('del-fail');
        $productData = $this->product($auth['token']);
        $product = Product::findOrFail($productData['id']);
        $media = $this->attachR2Media($product);

        $client->shouldReceive('deleteObject')->once()->andThrow(new AwsException(
            'network failure', Mockery::mock('Aws\\CommandInterface'),
            ['code' => 'InternalError', 'response' => new Response(500)],
        ));

        $this->withToken($auth['token'])->deleteJson("/api/products/{$product->id}/media/{$media->id}")
            ->assertStatus(503);

        $this->assertNotNull(ProductMedia::find($media->id));
    }
}

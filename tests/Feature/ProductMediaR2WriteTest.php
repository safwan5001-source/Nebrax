<?php

namespace Tests\Feature;

use App\Models\ProductMedia;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Response;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * AWJ-R2-4A/4E — كتابة وسائط منتجٍ جديدة إلى R2 عند تفعيل السياسة، بمفتاح
 * مشتقٍّ من `TenantContext` وحده، بلا أي استدعاء ACL/سرد/رابط عام، وبلا
 * تلويثٍ لحالة `ProductMedia` عند فشل التخزين.
 */
class ProductMediaR2WriteTest extends TestCase
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
            'key' => 'placeholder-key',
            'secret' => 'placeholder-secret',
            'bucket' => 'awj-product-media-test',
            'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto',
            'use_path_style_endpoint' => false,
        ]);
        config()->set('product_media.r2.enabled', true);

        $client = Mockery::mock(S3ClientInterface::class);
        $this->app->instance(R2StorageService::class, new R2StorageService(app(TenantContext::class), $client));

        return $client;
    }

    private function product(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج R2', 'sku' => 'R2-SKU-'.\Illuminate\Support\Str::random(6),
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    /** @test */
    public function new_product_media_write_goes_to_r2_with_a_tenant_scoped_key_and_no_acl_or_listing_calls(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('r2-write');
        $product = $this->product($auth['token']);

        $client->shouldNotReceive('putObjectAcl');
        $client->shouldNotReceive('getObjectAcl');
        $client->shouldNotReceive('listObjects');
        $client->shouldNotReceive('listObjectsV2');
        $client->shouldNotReceive('putBucketAcl');
        $client->shouldReceive('putObject')->once()->with(Mockery::on(
            function (array $args) use ($auth, $product): bool {
                $expected = "tenant/{$auth['tenant_id']}/product-media/{$product['id']}/";

                return $args['Bucket'] === 'awj-product-media-test'
                    && str_starts_with($args['Key'], $expected)
                    && preg_match('/\A[A-Za-z0-9._-]+\.jpg\z/', substr($args['Key'], strlen($expected))) === 1
                    && ! str_contains($args['Key'], '..')
                    && $args['ContentType'] === 'image/jpeg'
                    && ! array_key_exists('ACL', $args);
            }
        ))->andReturn([]);

        $media = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", [
            'media' => [UploadedFile::fake()->image('cover.jpg')],
        ])->assertCreated()['data'][0];

        $stored = ProductMedia::findOrFail($media['id']);
        $this->assertSame('r2', $stored->disk);
        $this->assertStringStartsWith("tenant/{$auth['tenant_id']}/product-media/{$product['id']}/", $stored->path);
    }

    /** @test */
    public function a_crafted_original_filename_cannot_influence_the_stored_r2_key(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('r2-traversal');
        $product = $this->product($auth['token']);

        $client->shouldReceive('putObject')->once()->with(Mockery::on(
            fn (array $args): bool => ! str_contains($args['Key'], '..') && ! str_contains($args['Key'], '/etc/')
        ))->andReturn([]);

        $file = UploadedFile::fake()->image('../../../../etc/passwd.jpg');
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", [
            'media' => [$file],
        ])->assertCreated();
    }

    /** @test */
    public function when_the_flag_is_disabled_new_media_still_writes_to_the_legacy_document_path(): void
    {
        config()->set('product_media.r2.enabled', false);
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        \Illuminate\Support\Facades\Storage::fake('local');

        $auth = $this->registerTenant('r2-disabled');
        $product = $this->product($auth['token']);

        $media = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", [
            'media' => [UploadedFile::fake()->image('legacy.jpg')],
        ])->assertCreated()['data'][0];

        $stored = ProductMedia::findOrFail($media['id']);
        $this->assertSame('document', $stored->disk);
        $this->assertStringStartsWith("product-media/{$auth['tenant_id']}/{$product['id']}/", $stored->path);
    }

    /** @test */
    public function an_r2_write_failure_does_not_create_a_product_media_row(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('r2-write-fail');
        $product = $this->product($auth['token']);

        $client->shouldReceive('putObject')->once()->andThrow(new AwsException(
            'network failure',
            Mockery::mock('Aws\\CommandInterface'),
            ['code' => 'InternalError', 'response' => new Response(500)],
        ));

        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", [
            'media' => [UploadedFile::fake()->image('will-fail.jpg')],
        ])->assertStatus(503);

        $this->assertSame(0, ProductMedia::query()->count());
    }
}

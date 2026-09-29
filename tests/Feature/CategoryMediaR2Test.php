<?php

namespace Tests\Feature;

use App\Models\ProductCategory;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\S3\S3ClientInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * Category media durability — new category images use the same tenant-scoped,
 * private R2 boundary as product media when the category flag is enabled.
 * Legacy local paths stay readable/writable while the flag is off.
 */
class CategoryMediaR2Test extends TestCase
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
            'bucket' => 'awj-category-media-test',
            'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto',
            'use_path_style_endpoint' => false,
        ]);
        config()->set('category_media.r2.enabled', true);

        $client = Mockery::mock(S3ClientInterface::class);
        $this->app->instance(
            R2StorageService::class,
            new R2StorageService(app(TenantContext::class), $client),
        );

        return $client;
    }

    /** @test */
    public function new_category_image_writes_to_private_tenant_scoped_r2_storage(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('category-r2-write');

        $client->shouldNotReceive('putObjectAcl');
        $client->shouldNotReceive('getObjectAcl');
        $client->shouldNotReceive('listObjects');
        $client->shouldNotReceive('listObjectsV2');
        $client->shouldReceive('putObject')->once()->with(Mockery::on(
            function (array $args) use ($auth): bool {
                $prefix = "tenant/{$auth['tenant_id']}/product-category-media/";

                return $args['Bucket'] === 'awj-category-media-test'
                    && str_starts_with($args['Key'], $prefix)
                    && preg_match('#/[^/]+\\.jpg\\z#', $args['Key']) === 1
                    && $args['ContentType'] === 'image/jpeg'
                    && ! str_contains($args['Key'], '..')
                    && ! array_key_exists('ACL', $args);
            },
        ))->andReturn([]);

        $category = $this->withToken($auth['token'])->postJson('/api/product-categories', [
            'name' => 'تصنيف R2',
            'image' => UploadedFile::fake()->image('category.jpg'),
        ])->assertCreated()['data'];

        $stored = ProductCategory::findOrFail($category['id']);
        $this->assertTrue(ProductCategory::isR2ImagePath($stored->image_path));
        $this->assertStringStartsWith(
            "tenant/{$auth['tenant_id']}/product-category-media/{$category['id']}/",
            $stored->image_path,
        );
    }

    /** @test */
    public function category_media_flag_off_preserves_the_legacy_document_storage_path(): void
    {
        config()->set('category_media.r2.enabled', false);
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        Storage::fake('local');

        $auth = $this->registerTenant('category-local-write');
        $category = $this->withToken($auth['token'])->postJson('/api/product-categories', [
            'name' => 'تصنيف محلي',
            'image' => UploadedFile::fake()->image('legacy.png'),
        ])->assertCreated()['data'];

        $stored = ProductCategory::findOrFail($category['id']);
        $this->assertFalse(ProductCategory::isR2ImagePath($stored->image_path));
        $this->assertStringStartsWith(
            "product-category-media/{$auth['tenant_id']}/{$category['id']}/",
            $stored->image_path,
        );
        Storage::disk('local')->assertExists($stored->image_path);
    }

    /** @test */
    public function removing_an_r2_category_image_deletes_only_the_tenant_scoped_object(): void
    {
        $client = $this->mockR2();
        $auth = $this->registerTenant('category-r2-delete');

        $category = ProductCategory::create([
            'tenant_id' => $auth['tenant_id'],
            'name' => 'تصنيف للحذف',
            'image_path' => "tenant/{$auth['tenant_id']}/product-category-media/placeholder/category.jpg",
            'image_original_name' => 'category.jpg',
            'image_mime_type' => 'image/jpeg',
            'image_size' => 123,
        ]);

        // Align the resource segment with the real category id; the stored path
        // remains a marker only — R2StorageService reconstructs the tenant key.
        $category->update([
            'image_path' => "tenant/{$auth['tenant_id']}/product-category-media/{$category->id}/category.jpg",
        ]);

        $client->shouldReceive('deleteObject')->once()->with(Mockery::on(
            fn (array $args): bool => $args['Bucket'] === 'awj-category-media-test'
                && $args['Key'] === "tenant/{$auth['tenant_id']}/product-category-media/{$category->id}/category.jpg",
        ))->andReturn([]);

        $this->withToken($auth['token'])->putJson("/api/product-categories/{$category->id}", [
            'name' => 'تصنيف للحذف',
            'remove_image' => true,
        ])->assertOk()->assertJsonPath('data.image', null);

        $category->refresh();
        $this->assertNull($category->image_path);
        $this->assertNull($category->image_original_name);
    }
}

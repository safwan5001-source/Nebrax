<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\S3\S3ClientInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;

class StorefrontCategoryMediaTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local']);
    }

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @return array{tenant: Tenant, category: ProductCategory, domain: StorefrontDomain} */
    private function seedStore(string $hostname, ?string $imagePath = null, ?string $color = null): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$hostname}", 'slug' => 'category-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);
        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        $category = ProductCategory::create([
            'name' => 'إلكترونيات', 'description' => 'وصف', 'color' => $color,
            'image_path' => $imagePath, 'image_original_name' => $imagePath ? 'electronics.webp' : null,
            'image_mime_type' => $imagePath ? 'image/webp' : null, 'image_size' => $imagePath ? 4 : null,
            'is_active' => true,
        ]);
        CommerceCategoryListing::create([
            'tenant_id' => $tenant->id, 'category_id' => $category->id,
            'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'category', 'domain');
    }

    public function test_public_categories_include_a_safe_image_shape_and_retain_color(): void
    {
        $path = 'product-category-media/category/electronics.webp';
        ['category' => $category, 'domain' => $domain] = $this->seedStore('category-media.example.com', $path, '#123456');
        Storage::disk('local')->put($path, 'data');

        $response = $this->getJson("http://{$domain->hostname}/store/v1/categories")->assertOk();
        $image = $response->json('data.0.image');

        $this->assertSame("/store/v1/media/categories/{$category->id}", $image['url']);
        $this->assertSame('إلكترونيات', $image['alt']);
        $this->assertSame('#123456', $response->json('data.0.color'));
        $this->assertArrayNotHasKey('image_path', $response->json('data.0'));
        $this->assertArrayNotHasKey('tenant_id', $response->json('data.0'));
    }

    public function test_public_categories_return_null_image_without_an_image(): void
    {
        ['domain' => $domain] = $this->seedStore('category-no-image.example.com', null, '#123456');

        $this->getJson("http://{$domain->hostname}/store/v1/categories")
            ->assertOk()
            ->assertJsonPath('data.0.image', null)
            ->assertJsonPath('data.0.color', '#123456');
    }

    public function test_category_image_bytes_are_public_only_on_the_resolved_storefront(): void
    {
        $path = 'product-category-media/category/isolation.webp';
        ['category' => $category, 'domain' => $domain] = $this->seedStore('category-image-a.example.com', $path);
        Storage::disk('local')->put($path, 'data');
        ['domain' => $otherDomain] = $this->seedStore('category-image-b.example.com');

        $this->getJson("http://{$domain->hostname}/store/v1/media/categories/{$category->id}")
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->getJson("http://{$otherDomain->hostname}/store/v1/media/categories/{$category->id}")
            ->assertNotFound();
    }


    public function test_r2_category_image_bytes_are_served_through_the_same_storefront_tenant_boundary(): void
    {
        ['tenant' => $tenant, 'category' => $category, 'domain' => $domain] =
            $this->seedStore('category-r2.example.com');

        $category->update([
            'image_path' => "tenant/{$tenant->id}/product-category-media/{$category->id}/category.webp",
            'image_original_name' => 'category.webp',
            'image_mime_type' => 'image/webp',
            'image_size' => 7,
        ]);

        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-key',
            'secret' => 'placeholder-secret',
            'bucket' => 'awj-category-media-test',
            'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto',
            'use_path_style_endpoint' => false,
        ]);

        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldReceive('getObject')->once()->with(Mockery::on(
            fn (array $args): bool => $args['Bucket'] === 'awj-category-media-test'
                && $args['Key'] === "tenant/{$tenant->id}/product-category-media/{$category->id}/category.webp",
        ))->andReturn(['Body' => 'r2-data']);

        $this->app->instance(
            R2StorageService::class,
            new R2StorageService(app(TenantContext::class), $client),
        );

        $this->get("http://{$domain->hostname}/store/v1/media/categories/{$category->id}")
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp');
    }

    public function test_missing_category_image_is_a_non_revealing_not_found(): void
    {
        $path = 'product-category-media/category/deleted.webp';
        ['category' => $category, 'domain' => $domain] = $this->seedStore('category-missing-image.example.com', $path);

        $this->getJson("http://{$domain->hostname}/store/v1/media/categories/{$category->id}")
            ->assertNotFound();
    }
}

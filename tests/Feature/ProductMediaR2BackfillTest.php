<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\Tenant;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\S3\S3ClientInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * AWJ-R2-4C/4E — أداة الترحيل اليدوية: تعمل ضمن مستأجرٍ واحدٍ فقط، idempotent
 * (لا تُعيد معالجة صفٍّ رُحِّل)، لا تحذف المصدر القديم أبداً، وتتحقّق من
 * تكامل المحتوى قبل تحويل الإشارة.
 */
class ProductMediaR2BackfillTest extends TestCase
{
    use RefreshDatabase;

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

    /** @return array{tenant: Tenant, product: Product, media: ProductMedia} */
    private function seedLegacyMedia(string $slug, string $bytes = 'legacy-bytes'): array
    {
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');

        $tenant = Tenant::create([
            'name' => "شركة {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج قديم', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true,
        ]);

        $path = "product-media/{$tenant->id}/{$product->id}/legacy.webp";
        Storage::disk('local')->put($path, $bytes);
        $media = ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'document', 'path' => $path,
            'original_name' => 'legacy.webp', 'mime_type' => 'image/webp', 'size' => strlen($bytes), 'sort_order' => 0,
        ]);

        app(TenantContext::class)->forget();

        return ['tenant' => $tenant, 'product' => $product, 'media' => $media];
    }

    /** @test */
    public function it_migrates_a_legacy_row_to_r2_and_never_deletes_the_legacy_source(): void
    {
        Storage::fake('local');
        $client = $this->mockR2();
        $seed = $this->seedLegacyMedia('backfill-basic');

        $expectedKey = "tenant/{$seed['tenant']->id}/product-media/{$seed['product']->id}/legacy.webp";
        $client->shouldReceive('putObject')->once()->with(Mockery::on(
            fn (array $args): bool => $args['Key'] === $expectedKey && $args['Body'] === 'legacy-bytes' && ! array_key_exists('ACL', $args)
        ))->andReturn([]);
        $client->shouldReceive('headObject')->once()->with(['Bucket' => 'awj-product-media-test', 'Key' => $expectedKey])->andReturn([]);
        $client->shouldReceive('getObject')->once()->with(['Bucket' => 'awj-product-media-test', 'Key' => $expectedKey])->andReturn(['Body' => 'legacy-bytes']);
        $client->shouldNotReceive('deleteObject');
        $client->shouldNotReceive('listObjects');
        $client->shouldNotReceive('listObjectsV2');
        $client->shouldNotReceive('putObjectAcl');

        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $seed['tenant']->id])
            ->assertExitCode(0);

        $seed['media']->refresh();
        $this->assertSame('r2', $seed['media']->disk);
        $this->assertSame($expectedKey, $seed['media']->path);

        // المصدر القديم لا يزال موجوداً — لم يُحذف.
        Storage::disk('local')->assertExists("product-media/{$seed['tenant']->id}/{$seed['product']->id}/legacy.webp");
    }

    /** @test */
    public function running_the_command_twice_does_not_reprocess_an_already_migrated_row(): void
    {
        Storage::fake('local');
        $client = $this->mockR2();
        $seed = $this->seedLegacyMedia('backfill-idempotent');

        $client->shouldReceive('putObject')->once()->andReturn([]);
        $client->shouldReceive('headObject')->once()->andReturn([]);
        $client->shouldReceive('getObject')->once()->andReturn(['Body' => 'legacy-bytes']);

        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $seed['tenant']->id])->assertExitCode(0);
        // ثاني تشغيلٍ: لا putObject/headObject/getObject إضافية — الصفّ لم يعد disk=document.
        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $seed['tenant']->id])->assertExitCode(0);

        $this->assertSame(1, ProductMedia::query()->count());
    }

    /** @test */
    public function it_never_migrates_another_tenants_media(): void
    {
        Storage::fake('local');
        $client = $this->mockR2();
        $a = $this->seedLegacyMedia('backfill-tenant-a');
        $b = $this->seedLegacyMedia('backfill-tenant-b');

        $client->shouldReceive('putObject')->once()->andReturn([]);
        $client->shouldReceive('headObject')->once()->andReturn([]);
        $client->shouldReceive('getObject')->once()->andReturn(['Body' => 'legacy-bytes']);

        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $a['tenant']->id])->assertExitCode(0);

        $a['media']->refresh();
        $b['media']->refresh();
        $this->assertSame('r2', $a['media']->disk);
        $this->assertSame('document', $b['media']->disk);
    }

    /** @test */
    public function a_dry_run_makes_no_r2_calls_and_leaves_the_row_unchanged(): void
    {
        Storage::fake('local');
        $client = $this->mockR2();
        $seed = $this->seedLegacyMedia('backfill-dry-run');

        $client->shouldNotReceive('putObject');
        $client->shouldNotReceive('headObject');
        $client->shouldNotReceive('getObject');

        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $seed['tenant']->id, '--dry-run' => true])
            ->assertExitCode(0);

        $seed['media']->refresh();
        $this->assertSame('document', $seed['media']->disk);
    }

    /** @test */
    public function a_content_integrity_mismatch_leaves_the_row_on_the_legacy_disk(): void
    {
        Storage::fake('local');
        $client = $this->mockR2();
        $seed = $this->seedLegacyMedia('backfill-mismatch');

        $client->shouldReceive('putObject')->once()->andReturn([]);
        $client->shouldReceive('headObject')->once()->andReturn([]);
        // القراءة الرجعية تعيد محتوًى مختلفاً — يجب رفض الترحيل، لا افتراض النجاح.
        $client->shouldReceive('getObject')->once()->andReturn(['Body' => 'corrupted-bytes']);

        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $seed['tenant']->id])
            ->assertExitCode(1);

        $seed['media']->refresh();
        $this->assertSame('document', $seed['media']->disk);
    }

    /** @test */
    public function it_only_ever_touches_product_media_rows_never_other_domains(): void
    {
        Storage::fake('local');
        $client = $this->mockR2();
        $seed = $this->seedLegacyMedia('backfill-scope');

        $client->shouldReceive('putObject')->once()->andReturn([]);
        $client->shouldReceive('headObject')->once()->andReturn([]);
        $client->shouldReceive('getObject')->once()->andReturn(['Body' => 'legacy-bytes']);

        $productBefore = $seed['product']->only(['id', 'name', 'sku', 'sale_price']);

        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $seed['tenant']->id])->assertExitCode(0);

        $seed['product']->refresh();
        $this->assertSame($productBefore, $seed['product']->only(['id', 'name', 'sku', 'sale_price']));
    }

    /** @test */
    public function the_tenant_option_must_be_a_valid_uuid(): void
    {
        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => 'not-a-uuid'])
            ->assertExitCode(\Illuminate\Console\Command::INVALID);
    }

    /** @test */
    public function the_limit_option_is_bounded(): void
    {
        $tenant = Tenant::create([
            'name' => 'شركة الحد', 'slug' => 'backfill-limit-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);

        $this->artisan('awj:product-media-r2-backfill', ['--tenant' => $tenant->id, '--limit' => 5000])
            ->assertExitCode(\Illuminate\Console\Command::INVALID);
    }
}

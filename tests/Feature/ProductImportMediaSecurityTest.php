<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ProductMedia;
use App\Services\ProductImageArchiveService;
use App\Services\ProductImageInspector;
use App\Services\ProductImageRemoteFetcher;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;
use ZipArchive;

class ProductImportMediaSecurityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function png(string $name = 'SKU-1.png'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $this->pngBytes());
    }

    private function pngBytes(): string
    {
        return base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true) ?: '';
    }

    /** @param array<string,string> $entries */
    private function zip(array $entries, string $name = 'images.zip'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'product-images-test-');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $entry => $bytes) {
            $zip->addFromString($entry, $bytes);
        }
        $zip->close();

        return new UploadedFile($path, $name, 'application/zip', null, true);
    }

    /** @test */
    public function inspector_rejects_extension_content_mismatch(): void
    {
        $this->expectException(RuntimeException::class);
        app(ProductImageInspector::class)->inspect(UploadedFile::fake()->createWithContent('fake.png', 'not-an-image'));
    }

    /** @test */
    public function remote_image_urls_reject_loopback_and_remote_fetching_ships_disabled(): void
    {
        $fetcher = app(ProductImageRemoteFetcher::class);
        try {
            $fetcher->validateUrl('https://127.0.0.1/product.png');
            $this->fail('كان يجب رفض عنوان loopback.');
        } catch (\Throwable $exception) {
            $this->assertStringContainsString('غير مسموح', $exception->getMessage());
        }

        $this->expectException(RuntimeException::class);
        $fetcher->fetch('https://example.com/product.png');
    }

    /** @test */
    public function archive_rejects_zip_slip_and_duplicate_basenames(): void
    {
        $bytes = $this->pngBytes();

        try {
            app(ProductImageArchiveService::class)->manifest($this->zip(['../SKU-1.png' => $bytes]));
            $this->fail('كان يجب رفض Zip Slip.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('Zip Slip', $exception->getMessage());
        }

        $this->expectException(RuntimeException::class);
        app(ProductImageArchiveService::class)->manifest($this->zip([
            'folder-a/SKU-1.png' => $bytes,
            'folder-b/sku-1.PNG' => $bytes,
        ]));
    }

    /** @test */
    public function durable_job_persists_archive_identity_and_idempotency_includes_its_hash(): void
    {
        $auth = $this->registerTenant();
        $bytes = $this->pngBytes();
        $csv = fn () => UploadedFile::fake()->createWithContent('catalog.csv', "sku,name,type,sale_price\nSKU-1,منتج,good,100\n");

        $first = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog',
            'idempotency_key' => 'media-job-0001',
            'file' => $csv(),
            'media_archive' => $this->zip(['SKU-1.png' => $bytes]),
        ])->assertCreated()->assertJsonPath('data.media_archive.original_filename', 'images.zip');

        $job = ImportJob::findOrFail($first->json('data.id'));
        Storage::disk('local')->assertExists($job->media_archive_storage_path);
        $this->assertSame(64, strlen((string) $job->media_archive_content_sha256));

        $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog',
            'idempotency_key' => 'media-job-0001',
            'file' => $csv(),
            'media_archive' => $this->zip(['SKU-2.png' => $bytes]),
        ])->assertStatus(422);

        $this->assertSame(1, ImportJob::count());
        $this->assertCount(2, Storage::disk('local')->allFiles(), 'ملف الكتالوج وأرشيف واحد فقط؛ لا يتيم من الطلب المرفوض.');
    }

    /** @test */
    public function legacy_catalog_file_without_media_remains_ready_and_has_no_archive(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog',
            'file' => UploadedFile::fake()->createWithContent('legacy.csv', "sku,name\nOLD-1,قديم\n"),
        ])->assertCreated()
            ->assertJsonPath('data.status', 'ready')
            ->assertJsonPath('data.media_archive', null);
    }

    /** @test */
    public function matched_zip_image_is_attached_once_and_existing_products_need_explicit_approval(): void
    {
        config([
            'document_center.storage.driver' => 'local',
            'document_center.storage.disk' => 'local',
        ]);
        $auth = $this->registerTenant();
        $bytes = $this->pngBytes();
        $createCsv = UploadedFile::fake()->createWithContent(
            'catalog.csv',
            "sku,name,type,sale_price\nIMAGE-SKU-1,منتج بصورة,good,100\n",
        );

        $created = $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $createCsv,
            'media_archive' => $this->zip(['IMAGE-SKU-1.png' => $bytes]),
            'apply_product_images' => '1',
            'mode' => 'create',
        ])->assertOk()
            ->assertJsonPath('data.created', 1)
            ->assertJsonPath('data.media.attached', 1);

        $this->assertSame(1, ProductMedia::count());

        $updateCsv = UploadedFile::fake()->createWithContent(
            'catalog.csv',
            "sku,name\nIMAGE-SKU-1,اسم محدث\n",
        );
        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $updateCsv,
            'media_archive' => $this->zip(['IMAGE-SKU-1__2.png' => $bytes]),
            'apply_product_images' => '1',
            'mode' => 'update',
        ])->assertStatus(422);

        $this->assertSame(1, ProductMedia::count(), 'لا تكرار ولا تعديل صور منتج قائم بلا موافقة صريحة.');
        $this->assertSame(1, $created->json('data.media.requested'));
    }
}

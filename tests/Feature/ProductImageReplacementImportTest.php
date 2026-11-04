<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\StockMovement;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\ProductMediaService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;
use ZipArchive;

/**
 * استيراد الصور — وضع «استبدال الصور الموجودة» (`media_mode=replace`).
 *
 * يحرس: المطابقة بـ SKU داخل المستأجر وحده، الصورة الرئيسية `SKU.ext` والإضافية `SKU__N.ext`، المعاينة (عدد المنتجات المتأثرة
 * والصور القديمة/الجديدة)، التأكيد الصريح، «الإضافة أولاً ثم الإزالة»، عدم حذف ملف ما زال مستعملاً، عدم المساس بأي بيانات منتج أو مالية،
 * idempotency الإعادة، والفشل الجزئي، والصلاحيات.
 */
class ProductImageReplacementImportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private static bool $failNextMediaSaves = false;

    private static int $mediaSaveCount = 0;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config([
            'document_center.storage.driver' => 'local',
            'document_center.storage.disk' => 'local',
        ]);
        self::$failNextMediaSaves = false;
        self::$mediaSaveCount = 0;
    }

    protected function tearDown(): void
    {
        self::$failNextMediaSaves = false;
        parent::tearDown();
    }

    // ── أدوات ───────────────────────────────────────────────────────────────

    /** PNG صالح يختلف محتواه (فبصمته) باختلاف اللون. */
    private function pngBytes(int $r, int $g = 0, int $b = 0): string
    {
        $image = imagecreatetruecolor(4, 4);
        imagefill($image, 0, 0, imagecolorallocate($image, $r, $g, $b));
        ob_start();
        imagepng($image);
        $bytes = (string) ob_get_clean();
        imagedestroy($image);

        return $bytes;
    }

    private function png(string $name, int $r, int $g = 0, int $b = 0): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $this->pngBytes($r, $g, $b));
    }

    /** @param array<string,string> $entries */
    private function zip(array $entries, string $name = 'images.zip'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'replace-images-test-');
        $zip = new ZipArchive();
        $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
        foreach ($entries as $entry => $bytes) {
            $zip->addFromString($entry, $bytes);
            // ثابت عمداً: addFromString يختم كل مدخل بالوقت الحالي (دقة ثانيتين)، فيبني الاستدعاءان المتتاليان (المعاينة ثم إنشاء المهمة) أرشيفين
            // مختلفين بايتاً حين يعبران حدّ ثانيتين، فتُرفض المهمة بحق «الملف تغيّر عمّا عاينته». وقت ثابت = بصمة محتوى ثابتة.
            $zip->setMtimeName($entry, 1700000000);
        }
        $zip->close();

        return new UploadedFile($path, $name, 'application/zip', null, true);
    }

    /** @param list<string> $skus */
    private function sheet(array $skus, string $name = 'skus.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, "sku\n".implode("\n", $skus)."\n");
    }

    private function product(string $sku, string $name = 'منتج', int $price = 10000): Product
    {
        return Product::create(['name' => $name, 'sku' => $sku, 'type' => 'good', 'sale_price' => $price, 'purchase_price' => 4000, 'track_inventory' => true]);
    }

    /** @return list<ProductMedia> */
    private function attach(Product $product, array $files): array
    {
        return app(ProductMediaService::class)->attachToProduct($product, $files, null, true);
    }

    private function onDisk(ProductMedia $media): bool
    {
        $storage = app(DocumentStorageService::class);

        return $storage->exists($storage->profile(), $media->path);
    }

    /** ملفات وسائط المنتج (الأصول والمشتقات) فقط — بلا ملفات تشغيلات الاستيراد المخزَّنة. */
    private function mediaFileCount(): int
    {
        return count(array_filter(Storage::disk('local')->allFiles(), fn (string $path) => str_contains($path, 'product-media')));
    }

    private function scene(string $slug = 'acme'): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);

        return $auth;
    }

    /** @return array<string,mixed> بيانات المعاينة */
    private function preview(string $token, UploadedFile $sheet, UploadedFile $zip, bool $confirm, array $extra = []): array
    {
        $body = array_merge([
            'file' => $sheet, 'media_archive' => $zip, 'media_mode' => 'replace',
            'mapping' => [0 => 'sku'], 'for_durable' => '1',
        ], $confirm ? ['confirm_media_replacement' => '1'] : [], $extra);

        return $this->withToken($token)->post('/api/products/import/preview', $body, ['Accept' => 'application/json'])
            ->assertOk()->json('data');
    }

    /** ينشئ التشغيلة المربوطة بالمعاينة ويرحّلها؛ يعيد استجابة آخر ترحيل. */
    private function runJob(string $token, UploadedFile $sheet, UploadedFile $zip, array $preview, bool $confirm, ?string &$jobId = null)
    {
        $options = ['mapping' => [0 => 'sku'], 'media_mode' => 'replace'] + ($confirm ? ['confirm_media_replacement' => '1'] : []);
        $created = $this->withToken($token)->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $sheet, 'media_archive' => $zip, 'options' => $options,
            'preview_id' => $preview['binding']['id'], 'preview_hash' => $preview['binding']['hash'],
        ], ['Accept' => 'application/json'])->assertCreated();
        $jobId = $created->json('data.id');

        for ($i = 0; $i < 5; $i++) {
            $response = $this->withToken($token)->postJson("/api/import-jobs/{$jobId}/apply", []);
            if ($response->status() !== 200 || $response->json('data.status') === 'completed') {
                return $response;
            }
        }

        return $response;
    }

    // ── المعاينة ────────────────────────────────────────────────────────────

    /** @test */
    public function preview_reports_affected_products_and_old_vs_new_images_and_requires_explicit_confirmation(): void
    {
        $auth = $this->scene();
        $product = $this->product('SKU-A');
        $this->attach($product, [$this->png('old1.png', 200), $this->png('old2.png', 150)]);
        $this->product('SKU-NOIMG');

        $zip = $this->zip([
            'SKU-A.png' => $this->pngBytes(10),
            'SKU-A__2.png' => $this->pngBytes(20),
            'SKU-A__3.png' => $this->pngBytes(30),
            'ORPHAN.png' => $this->pngBytes(40),
        ]);
        $data = $this->preview($auth['token'], $this->sheet(['SKU-A', 'SKU-NOIMG']), $zip, false);

        $media = $data['media'];
        $this->assertSame('replace', $media['mode']);
        $this->assertSame(1, $media['needs_approval_rows']);
        $this->assertSame(1, $media['affected_products']);
        $this->assertSame(3, $media['images_to_add']);
        $this->assertSame(2, $media['images_to_remove']);
        $this->assertSame(['ORPHAN.png'], $media['unmatched_archive']);
        $this->assertSame([3], $media['missing_rows'], 'منتج بلا صور في الأرشيف لا يُمسّ معرضه ويظهر ضمن الصفوف بلا صور.');
        $row = $media['rows'][0];
        $this->assertSame('needs_approval', $row['status']);
        $this->assertSame(2, $row['replacement']['existing_count']);
        $this->assertSame(3, $row['replacement']['new_count']);
        $this->assertSame(['SKU-A.png', 'SKU-A__2.png', 'SKU-A__3.png'], array_column($row['sources'], 'name'));
        $this->assertSame(['primary', 'additional', 'additional'], array_column($row['sources'], 'role'));
        $this->assertNotEmpty($data['binding']['id']);

        $confirmed = $this->preview($auth['token'], $this->sheet(['SKU-A', 'SKU-NOIMG']), $zip, true);
        $this->assertSame(0, $confirmed['media']['needs_approval_rows']);
        $this->assertSame(1, $confirmed['media']['ready_rows']);
        $this->assertNotSame($data['binding']['hash'], $confirmed['binding']['hash'], 'التأكيد جزء من الخيارات المربوطة بالبصمة.');
        $this->assertSame(2, ProductMedia::count(), 'المعاينة لا تكتب شيئاً.');
    }

    // ── التنفيذ ─────────────────────────────────────────────────────────────

    /** @test */
    public function confirmed_replacement_swaps_the_gallery_removes_old_files_and_touches_no_product_or_financial_data(): void
    {
        $auth = $this->scene();
        $product = $this->product('SKU-A', 'اسم أصلي', 12345);
        [$old1, $old2] = $this->attach($product, [$this->png('old1.png', 200), $this->png('old2.png', 150)]);
        $this->assertTrue($this->onDisk($old1) && $this->onDisk($old2));
        $before = Product::query()->whereKey($product->id)->first()->only(['name', 'sku', 'sale_price', 'purchase_price', 'track_inventory', 'type']);
        $journals = JournalEntry::count();
        $movements = StockMovement::count();

        $sheet = fn () => $this->sheet(['SKU-A']);
        $zip = fn () => $this->zip(['SKU-A.png' => $this->pngBytes(10), 'SKU-A__2.png' => $this->pngBytes(20)]);
        $preview = $this->preview($auth['token'], $sheet(), $zip(), true);
        $response = $this->runJob($auth['token'], $sheet(), $zip(), $preview, true)->assertOk()->assertJsonPath('data.status', 'completed');

        $media = $response->json('data.apply_result.media');
        $this->assertSame(1, $media['products_replaced']);
        $this->assertSame(2, $media['images_added']);
        $this->assertSame(2, $media['images_removed']);
        $this->assertSame(0, $response->json('data.apply_result.created'));
        $this->assertSame(0, $response->json('data.apply_result.updated'));

        $gallery = ProductMedia::query()->where('product_id', $product->id)->orderBy('sort_order')->get();
        $this->assertCount(2, $gallery);
        $this->assertSame(['SKU-A.png', 'SKU-A__2.png'], $gallery->pluck('original_name')->all());
        $this->assertSame([0, 1], $gallery->pluck('sort_order')->all());
        $this->assertNull(ProductMedia::query()->whereKey($old1->id)->first());
        $this->assertNull(ProductMedia::query()->whereKey($old2->id)->first());
        $this->assertFalse($this->onDisk($old1), 'الملف القديم غير المستعمل يُحذف فعلياً بعد الالتزام.');
        $this->assertFalse($this->onDisk($old2));
        $this->assertTrue($gallery->every(fn (ProductMedia $m) => $this->onDisk($m)));

        $this->assertSame($before, Product::query()->whereKey($product->id)->first()->only(array_keys($before)), 'لا اسم ولا سعر ولا بيانات منتج.');
        $this->assertSame($journals, JournalEntry::count(), 'لا قيود محاسبية.');
        $this->assertSame($movements, StockMovement::count(), 'لا حركات مخزون.');
    }

    /** @test */
    public function unconfirmed_replacement_job_fails_before_any_write_and_keeps_the_old_gallery(): void
    {
        $auth = $this->scene();
        $product = $this->product('SKU-A');
        [$old] = $this->attach($product, [$this->png('old.png', 200)]);

        $sheet = fn () => $this->sheet(['SKU-A']);
        $zip = fn () => $this->zip(['SKU-A.png' => $this->pngBytes(10)]);
        $preview = $this->preview($auth['token'], $sheet(), $zip(), false);
        $response = $this->runJob($auth['token'], $sheet(), $zip(), $preview, false);

        $response->assertStatus(422);
        $this->assertSame([$old->id], ProductMedia::query()->where('product_id', $product->id)->pluck('id')->all());
        $this->assertTrue($this->onDisk($old));
        $this->assertSame(1, ProductMedia::count());
    }

    /** @test */
    public function rerunning_the_same_archive_is_idempotent_and_never_duplicates_images(): void
    {
        $auth = $this->scene();
        $product = $this->product('SKU-A');
        $this->attach($product, [$this->png('old.png', 200)]);

        $sheet = fn () => $this->sheet(['SKU-A']);
        $zip = fn () => $this->zip(['SKU-A.png' => $this->pngBytes(10), 'SKU-A__2.png' => $this->pngBytes(20)]);
        $first = $this->preview($auth['token'], $sheet(), $zip(), true);
        $this->runJob($auth['token'], $sheet(), $zip(), $first, true)->assertOk();
        $ids = ProductMedia::query()->where('product_id', $product->id)->orderBy('sort_order')->pluck('id')->all();
        $files = $this->mediaFileCount();

        $second = $this->preview($auth['token'], $sheet(), $zip(), false);
        $this->assertSame(1, $second['media']['unchanged_rows']);
        $this->assertSame(0, $second['media']['needs_approval_rows'], 'لا تأكيد مطلوب حين لا شيء سيتغيّر.');
        $this->assertSame(0, $second['media']['images_to_add']);
        $this->assertSame(0, $second['media']['images_to_remove']);

        $this->runJob($auth['token'], $sheet(), $zip(), $second, false)->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame($ids, ProductMedia::query()->where('product_id', $product->id)->orderBy('sort_order')->pluck('id')->all(), 'المعرّفات نفسها: لا رفع جديد ولا حذف.');
        $this->assertSame(2, ProductMedia::count());
        $this->assertSame($files, $this->mediaFileCount(), 'لا ملفات صور يتيمة ولا مكررة في التخزين.');
    }

    /** @test */
    public function a_failure_while_saving_a_replacement_rolls_back_to_the_untouched_old_gallery_and_retry_completes(): void
    {
        $this->scene();
        $product = $this->product('SKU-A');
        [$old1, $old2] = $this->attach($product, [$this->png('old1.png', 200), $this->png('old2.png', 150)]);
        $storedBefore = $this->mediaFileCount();

        // الصورة الجديدة الثانية تفشل عند الحفظ (بعد كتابة ملفاتها): يجب أن تعود الحال كما كانت بالضبط، لا صور يتيمة.
        ProductMedia::saving(function (): void {
            if (self::$failNextMediaSaves && ++self::$mediaSaveCount === 2) {
                throw new RuntimeException('فشل مصطنع أثناء حفظ البديل الثاني.');
            }
        });
        self::$failNextMediaSaves = true;

        $files = [$this->png('SKU-A.png', 10), $this->png('SKU-A__2.png', 20)];
        try {
            app(ProductMediaService::class)->replaceProductGallery($product, $files, null);
            $this->fail('كان يجب أن يفشل الاستبدال.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('فشل مصطنع', $exception->getMessage());
        }

        $this->assertEqualsCanonicalizing([$old1->id, $old2->id], ProductMedia::query()->where('product_id', $product->id)->pluck('id')->all());
        $this->assertTrue($this->onDisk($old1) && $this->onDisk($old2), 'لم يُزَل أي ارتباط ولا ملف قديم قبل نجاح البدائل.');
        $this->assertSame($storedBefore, $this->mediaFileCount(), 'ملفات البدائل المكتوبة نُظّفت.');

        self::$failNextMediaSaves = false;
        $outcome = app(ProductMediaService::class)->replaceProductGallery($product, [$this->png('SKU-A.png', 10), $this->png('SKU-A__2.png', 20)], null);

        $this->assertSame(['added' => 2, 'kept' => 0, 'removed' => 2], $outcome);
        $this->assertSame(['SKU-A.png', 'SKU-A__2.png'], ProductMedia::query()->where('product_id', $product->id)->orderBy('sort_order')->pluck('original_name')->all());

        // إعادة المحاولة بعد النجاح لا تكرّر شيئاً.
        $again = app(ProductMediaService::class)->replaceProductGallery($product, [$this->png('SKU-A.png', 10), $this->png('SKU-A__2.png', 20)], null);
        $this->assertSame(['added' => 0, 'kept' => 2, 'removed' => 0], $again);
        $this->assertSame(2, ProductMedia::query()->where('product_id', $product->id)->count());
    }

    /** @test */
    public function an_interrupted_run_that_left_both_old_and_new_images_is_completed_by_retry_without_duplicates(): void
    {
        $this->scene();
        $product = $this->product('SKU-A');
        [$old] = $this->attach($product, [$this->png('old.png', 200)]);
        // حالة انقطاع بين «إضافة البدائل» و«إزالة القديم»: البديل الأول موجود بالفعل إلى جانب القديم.
        $this->attach($product, [$this->png('SKU-A.png', 10)]);

        $outcome = app(ProductMediaService::class)->replaceProductGallery($product, [$this->png('SKU-A.png', 10), $this->png('SKU-A__2.png', 20)], null);

        $this->assertSame(['added' => 1, 'kept' => 1, 'removed' => 1], $outcome);
        $this->assertNull(ProductMedia::query()->whereKey($old->id)->first());
        $this->assertSame(['SKU-A.png', 'SKU-A__2.png'], ProductMedia::query()->where('product_id', $product->id)->orderBy('sort_order')->pluck('original_name')->all());
    }

    /** @test */
    public function an_old_file_still_referenced_by_another_row_is_not_physically_deleted(): void
    {
        $this->scene();
        $productA = $this->product('SKU-A');
        $productB = $this->product('SKU-B');
        [$shared] = $this->attach($productA, [$this->png('shared.png', 200)]);
        // صفّ آخر يشير إلى الملف الفعلي نفسه (موضع استعمال آخر).
        ProductMedia::create([
            'product_id' => $productB->id, 'disk' => $shared->disk, 'path' => $shared->path, 'original_name' => 'shared.png',
            'mime_type' => $shared->mime_type, 'size' => $shared->size, 'content_sha256' => $shared->content_sha256, 'sort_order' => 0,
        ]);

        app(ProductMediaService::class)->replaceProductGallery($productA, [$this->png('SKU-A.png', 10)], null);

        $this->assertNull(ProductMedia::query()->whereKey($shared->id)->first(), 'ارتباط المنتج A القديم أُزيل.');
        $this->assertTrue($this->onDisk($shared), 'الملف الفعلي باقٍ لأن المنتج B ما زال يستعمله.');
        $this->assertSame(1, ProductMedia::query()->where('product_id', $productB->id)->count());
    }

    /** @test */
    public function replacement_never_empties_a_gallery_or_exceeds_the_cap_and_only_touches_product_level_media(): void
    {
        $this->scene();
        $product = $this->product('SKU-A');
        [$old] = $this->attach($product, [$this->png('old.png', 200)]);

        try {
            app(ProductMediaService::class)->replaceProductGallery($product, [], null);
            $this->fail('قائمة فارغة يجب أن تُرفض.');
        } catch (RuntimeException) {
            // متوقع
        }
        $many = array_map(fn (int $i) => $this->png("img{$i}.png", $i * 20), range(1, 9));
        try {
            app(ProductMediaService::class)->replaceProductGallery($product, $many, null);
            $this->fail('أكثر من 8 صور يجب أن يُرفض.');
        } catch (RuntimeException) {
            // متوقع
        }
        $this->assertSame([$old->id], ProductMedia::query()->where('product_id', $product->id)->pluck('id')->all());
    }

    /** @test */
    public function a_multi_chunk_replacement_job_completes_and_accumulates_totals_across_chunks(): void
    {
        $auth = $this->scene();
        $skus = [];
        $entries = [];
        $bytes = $this->pngBytes(10);
        for ($i = 1; $i <= 101; $i++) {
            $sku = sprintf('BULK-%03d', $i);
            $skus[] = $sku;
            $entries["{$sku}.png"] = $bytes;
            $this->product($sku);
        }

        $sheet = fn () => $this->sheet($skus);
        $zip = fn () => $this->zip($entries);
        $preview = $this->preview($auth['token'], $sheet(), $zip(), true);
        $this->assertSame(101, $preview['total_rows']);
        $this->assertSame(101, $preview['media']['affected_products']);

        $response = $this->runJob($auth['token'], $sheet(), $zip(), $preview, true, $jobId)->assertOk();
        $response->assertJsonPath('data.status', 'completed')->assertJsonPath('data.processed_rows', 101);
        $totals = $response->json('data.apply_result.media.totals');
        $this->assertSame(101, $totals['products_replaced']);
        $this->assertSame(101, $totals['images_added']);
        $this->assertSame(0, $totals['failed']);
        $this->assertSame(101, ProductMedia::count());
    }

    /** @test */
    public function removal_consent_and_gallery_drift_are_rechecked_against_the_locked_gallery(): void
    {
        $this->scene();
        $product = $this->product('SKU-A');
        [$previewed] = $this->attach($product, [$this->png('previewed.png', 200)]);
        // صورة رُفعت بعد المعاينة وقبل أخذ القفل (مثلاً عبر مسار رفع المعرض العادي).
        [$late] = $this->attach($product, [$this->png('late.png', 150)]);
        $service = app(ProductMediaService::class);

        try {
            $service->replaceProductGallery($product, [$this->png('SKU-A.png', 10)], null, true, ProductMediaService::galleryFingerprint([$previewed->id]));
            $this->fail('انجراف المعرض بعد المعاينة يجب أن يُرفض.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('تغيّر معرض', $exception->getMessage());
        }
        try {
            $service->replaceProductGallery($product, [$this->png('SKU-A.png', 10)], null, false, ProductMediaService::galleryFingerprint([$previewed->id, $late->id]));
            $this->fail('الإزالة بلا تأكيد يجب أن تُرفض تحت القفل.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('لم يُؤكَّد', $exception->getMessage());
        }

        $this->assertEqualsCanonicalizing([$previewed->id, $late->id], ProductMedia::query()->where('product_id', $product->id)->pluck('id')->all());
        $this->assertTrue($this->onDisk($previewed) && $this->onDisk($late));

        // المعرض كما عُوين + موافقة ⇒ يمضي.
        $outcome = $service->replaceProductGallery($product, [$this->png('SKU-A.png', 10)], null, true, ProductMediaService::galleryFingerprint([$previewed->id, $late->id]));
        $this->assertSame(['added' => 1, 'kept' => 0, 'removed' => 2], $outcome);
    }

    /** @test */
    public function an_image_added_after_the_confirmed_preview_is_never_deleted_by_the_bound_job(): void
    {
        $auth = $this->scene();
        $product = $this->product('SKU-A');
        [$previewed] = $this->attach($product, [$this->png('previewed.png', 200)]);

        $sheet = fn () => $this->sheet(['SKU-A']);
        $zip = fn () => $this->zip(['SKU-A.png' => $this->pngBytes(10)]);
        $preview = $this->preview($auth['token'], $sheet(), $zip(), true);
        $this->assertArrayNotHasKey('gallery_plan', $preview['media'], 'البصمات داخلية ولا تظهر في الاستجابة.');

        // بعد أن أكّد المستخدم المعاينة وقبل التنفيذ: صورة تُرفع عبر مسار المعرض العادي.
        [$late] = $this->attach($product, [$this->png('late.png', 150)]);

        $this->runJob($auth['token'], $sheet(), $zip(), $preview, true)->assertStatus(422);

        $this->assertEqualsCanonicalizing([$previewed->id, $late->id], ProductMedia::query()->where('product_id', $product->id)->pluck('id')->all());
        $this->assertTrue($this->onDisk($previewed) && $this->onDisk($late));
    }

    /** @test */
    public function a_duplicate_sku_across_chunk_windows_is_caught_before_any_gallery_is_written(): void
    {
        $auth = $this->scene();
        $product = $this->product('DUP-1');
        [$old] = $this->attach($product, [$this->png('old.png', 200)]);
        $skus = ['DUP-1'];
        for ($i = 1; $i <= 99; $i++) {
            $skus[] = "NOPE-{$i}";
        }
        $skus[] = 'DUP-1'; // الصف 101: النافذة الثانية

        $created = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $this->sheet($skus),
            'media_archive' => $this->zip(['DUP-1.png' => $this->pngBytes(10)]),
            'options' => ['mapping' => [0 => 'sku'], 'media_mode' => 'replace', 'confirm_media_replacement' => '1'],
        ], ['Accept' => 'application/json'])->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/import-jobs/'.$created->json('data.id').'/apply', [])->assertStatus(422);

        $this->assertSame([$old->id], ProductMedia::query()->where('product_id', $product->id)->pluck('id')->all(), 'لا استبدال جزئي قبل اكتشاف التكرار.');
        $this->assertTrue($this->onDisk($old));
    }

    // ── العزل والمطابقة ─────────────────────────────────────────────────────

    /** @test */
    public function matching_is_by_sku_within_the_current_tenant_only(): void
    {
        $a = $this->scene('acme');
        $productA = $this->product('SKU-X', 'منتج أ');
        [$mediaA] = $this->attach($productA, [$this->png('a-old.png', 200)]);

        $b = $this->registerTenant('beta', 'owner@beta.test');
        app(TenantContext::class)->set($b['tenant_id']);
        $productB = $this->product('SKU-X', 'منتج ب');
        $this->product('ONLY-B');
        [$mediaB] = $this->attach($productB, [$this->png('b-old.png', 100)]);

        // المستأجر A يستبدل SKU-X (موجود عنده وعند B) ويطلب أيضاً ONLY-B (موجود عند B فقط).
        app(TenantContext::class)->set($a['tenant_id']);
        $sheet = fn () => $this->sheet(['SKU-X', 'ONLY-B']);
        $zip = fn () => $this->zip(['SKU-X.png' => $this->pngBytes(10), 'ONLY-B.png' => $this->pngBytes(30)]);
        $preview = $this->preview($a['token'], $sheet(), $zip(), true);

        $this->assertSame(1, $preview['media']['error_rows'], 'SKU غير موجود في مؤسسة A يُرفض ولا يُطابَق عبر مؤسسة أخرى.');
        $errorRow = collect($preview['media']['rows'])->firstWhere('sku', 'ONLY-B');
        $this->assertSame('error', $errorRow['status']);
        $this->assertNull($errorRow['product_id']);

        // نكمل بصفّ صالح فقط: أثر الاستبدال يقتصر على مؤسسة A.
        $sheet = fn () => $this->sheet(['SKU-X']);
        $zip = fn () => $this->zip(['SKU-X.png' => $this->pngBytes(10)]);
        $preview = $this->preview($a['token'], $sheet(), $zip(), true);
        $this->runJob($a['token'], $sheet(), $zip(), $preview, true)->assertOk()->assertJsonPath('data.status', 'completed');

        app(TenantContext::class)->set($b['tenant_id']);
        $this->assertSame([$mediaB->id], ProductMedia::query()->where('product_id', $productB->id)->pluck('id')->all(), 'صور المستأجر B لم تُمسّ.');
        $this->assertTrue($this->onDisk($mediaB));
        app(TenantContext::class)->set($a['tenant_id']);
        $this->assertNull(ProductMedia::query()->whereKey($mediaA->id)->first());
        $this->assertSame(['SKU-X.png'], ProductMedia::query()->where('product_id', $productA->id)->pluck('original_name')->all());
    }

    /** @test */
    public function rows_without_sku_or_with_duplicate_sku_or_the_same_image_for_two_rows_are_errors(): void
    {
        $auth = $this->scene();
        $this->product('SKU-A');
        $zip = $this->zip(['SKU-A.png' => $this->pngBytes(10)]);

        $dup = $this->preview($auth['token'], $this->sheet(['SKU-A', 'SKU-A']), $zip, true);
        $this->assertSame(1, $dup['media']['error_rows']);

        $blank = $this->preview($auth['token'], UploadedFile::fake()->createWithContent('s.csv', "sku,name\n,بلا sku\n"), $this->zip(['SKU-A.png' => $this->pngBytes(10)]), true);
        $this->assertSame(1, $blank['media']['error_rows']);
    }

    // ── الصلاحيات والتحقق ───────────────────────────────────────────────────

    /** @test */
    public function users_without_product_manage_permission_cannot_preview_or_create_a_replacement_job(): void
    {
        $auth = $this->scene();
        $this->product('SKU-A');
        $viewer = $this->tokenForRole($auth['tenant_id'], 'viewer', 'viewer@acme.test');

        $this->withToken($viewer)->post('/api/products/import/preview', [
            'file' => $this->sheet(['SKU-A']), 'media_archive' => $this->zip(['SKU-A.png' => $this->pngBytes(10)]),
            'media_mode' => 'replace', 'mapping' => [0 => 'sku'],
        ], ['Accept' => 'application/json'])->assertForbidden();

        $this->withToken($viewer)->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $this->sheet(['SKU-A']),
            'media_archive' => $this->zip(['SKU-A.png' => $this->pngBytes(10)]),
            'options' => ['media_mode' => 'replace', 'confirm_media_replacement' => '1', 'mapping' => [0 => 'sku']],
        ], ['Accept' => 'application/json'])->assertForbidden();
        $this->assertSame(0, ImportJob::count());
    }

    /** @test */
    public function replace_mode_requires_an_archive_a_sku_mapping_and_is_catalog_only_and_not_synchronous(): void
    {
        $auth = $this->scene();
        $this->product('SKU-A');

        $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => $this->sheet(['SKU-A']), 'media_mode' => 'replace', 'mapping' => [0 => 'sku'],
        ], ['Accept' => 'application/json'])->assertStatus(422);

        $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => UploadedFile::fake()->createWithContent('s.csv', "name\nمنتج\n"),
            'media_archive' => $this->zip(['SKU-A.png' => $this->pngBytes(10)]),
            'media_mode' => 'replace', 'mapping' => [0 => 'name'],
        ], ['Accept' => 'application/json'])->assertStatus(422);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $this->sheet(['SKU-A']), 'media_archive' => $this->zip(['SKU-A.png' => $this->pngBytes(10)]),
            'media_mode' => 'replace', 'confirm_media_replacement' => '1', 'mapping' => [0 => 'sku'],
        ], ['Accept' => 'application/json'])->assertStatus(422);

        $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'partner_master', 'file' => $this->sheet(['SKU-A']),
            'media_archive' => $this->zip(['SKU-A.png' => $this->pngBytes(10)]),
            'options' => ['media_mode' => 'replace', 'type' => 'customer'],
        ], ['Accept' => 'application/json'])->assertStatus(422);

        $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $this->sheet(['SKU-A']),
            'options' => ['media_mode' => 'replace'],
        ], ['Accept' => 'application/json'])->assertStatus(422);
    }

    /** @test */
    public function add_mode_is_unchanged_by_default_and_does_not_remove_existing_images(): void
    {
        $auth = $this->scene();
        $product = $this->product('SKU-A');
        [$old] = $this->attach($product, [$this->png('old.png', 200)]);

        $data = $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => UploadedFile::fake()->createWithContent('c.csv', "sku,name\nSKU-A,اسم\n"),
            'media_archive' => $this->zip(['SKU-A__2.png' => $this->pngBytes(10)]),
            'mode' => 'update', 'mapping' => [0 => 'sku', 1 => 'name'],
        ], ['Accept' => 'application/json'])->assertOk()->json('data');

        $this->assertArrayNotHasKey('mode', $data['media'], 'عقد معاينة الإضافة لم يتغيّر.');
        $this->assertSame(1, $data['media']['needs_approval_rows']);
        $this->assertNotNull(ProductMedia::query()->whereKey($old->id)->first());
    }
}

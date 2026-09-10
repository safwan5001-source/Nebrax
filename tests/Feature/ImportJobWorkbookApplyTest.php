<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\StockMovement;
use App\Services\ImportJobService;
use App\Support\ImportJobStatus;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;
use Throwable;

/**
 * PR-DUR-3 — يربط `ImportJobService::applyNextChunk()` بمجال `product_workbook`،
 * معيداً استعمال `ProductWorkbookService::apply()` حصراً (Products/Barcodes/
 * Unit Prices) بلا أي تعديل على منطقه أو عقد PR-UOM2-4. لا تكرار لاختبارات
 * قواعد UOM/الباركود/الأسعار التفصيلية — تلك مثبتة في `ProductWorkbookTest`
 * على المسار الجلسي القائم وتبقى كما هي بلا تعديل؛ هنا يُختبَر فقط أن الربط
 * الدائم (رفع مرّة واحدة → فحص → تطبيق بلا إعادة رفع → استئناف/تزامن/
 * idempotency) لا يكسرها ولا يفتح مساراً موازياً.
 *
 * **الباركود/السعر يستهدفان منتجاً قائماً مسبقاً** — تماماً كاصطلاح
 * `ProductWorkbookTest` كله: `ProductWorkbookService::apply()` يتحقق من
 * الأوراق الثلاث معاً **قبل** أي كتابة (`parseBarcodesSheet`/
 * `parseUnitPricesSheet` يطابقان رمز الصنف بحالة القاعدة الحالية، لا بما
 * ستُنشئه ورقة Products بعد لحظات داخل نفس المعاملة) — فمنتجٌ جديدٌ بالكامل
 * في نفس ورقة Products لا يمكن أن تشير إليه Barcodes/Unit Prices في نفس
 * الملف. هذا سلوكٌ قائمٌ في `ProductWorkbookService` نفسه، لا شيء غيّرته
 * هذه المهمّة فيه ولا يصح تغييره هنا.
 *
 * **المصنّف ذرّيٌّ بطبيعته:** لا `batch_offset`/`batch_size` في عقده أصلاً
 * (خلافاً لـ`product_catalog`) — قطعةٌ واحدة تُنجز الملف كله أو تفشل كله.
 */
class ImportJobWorkbookApplyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** مستأجر اختبار القفل — يُنشأ خارج معاملة الاختبار عبر اتصالٍ منفصل، فيُنظَّف يدوياً. */
    protected ?string $lockTestTenantId = null;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        $tenantId = $this->lockTestTenantId;
        parent::tearDown();

        if ($tenantId !== null) {
            DB::connection('rival')->table('import_jobs')->where('tenant_id', $tenantId)->delete();
            DB::connection('rival')->table('tenants')->where('id', $tenantId)->delete();
            DB::connection('rival')->disconnect();
        }
    }

    /** @param array<int, array{name:string, headers:array<int,string>, rows:array<int,array<int,string>>}> $sheets */
    private function workbookFile(array $sheets, string $name = 'workbook.xlsx'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'test-durable-workbook-');
        SpreadsheetWriter::workbookXlsx($path, $sheets);
        $file = UploadedFile::fake()->createWithContent($name, (string) file_get_contents($path));
        @unlink($path);

        return $file;
    }

    private function createPriceList(string $token, string $name = 'قائمة الجملة'): string
    {
        return $this->withToken($token)->postJson('/api/price-lists', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function createProduct(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج قائم', 'sku' => 'SKU-WB-1', 'type' => 'good', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    /** ورقتا Barcodes/Unit Prices تستهدفان منتجاً قائماً — Products فارغة. */
    private function barcodeAndPriceWorkbook(string $sku, string $barcode = '6281234500001', string $price = '55.00'): UploadedFile
    {
        return $this->workbookFile([
            ['name' => 'Products', 'headers' => ['sku', 'name', 'type', 'unit', 'sale_price'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => [[$sku, $barcode]]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => [[$sku, '', $price]]],
        ]);
    }

    private function createReadyWorkbookJob(string $token, UploadedFile $file): string
    {
        return $this->withToken($token)
            ->post('/api/import-jobs', ['domain' => 'product_workbook', 'file' => $file])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->json('data.id');
    }

    /** @test */
    public function durable_upload_inspect_and_apply_creates_the_barcode_and_unit_price(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $priceListId = $this->createPriceList($auth['token']);

        $jobId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_workbook', 'file' => $this->barcodeAndPriceWorkbook($product['sku'])])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->assertJsonPath('data.row_count', 2) // باركودٌ واحد + سعرٌ واحد (Products فارغة)
            ->json('data.id');

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);

        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count());
        $this->assertSame(1, PriceListItem::where('product_id', $product['id'])->where('price_list_id', $priceListId)->count());
    }

    /** @test */
    public function apply_is_refused_without_a_selected_price_list(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $jobId = $this->createReadyWorkbookJob($auth['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create'])
            ->assertStatus(422);

        $this->assertSame(ImportJobStatus::FAILED, ImportJob::findOrFail($jobId)->status);
        $this->assertSame(0, ProductBarcode::where('product_id', $product['id'])->count());
    }

    /** @test */
    public function apply_rejects_a_price_list_from_another_tenant(): void
    {
        $authA = $this->registerTenant('tenant-a', 'owner@a.test');
        $authB = $this->registerTenant('tenant-b', 'owner@b.test');
        $foreignPriceListId = $this->createPriceList($authB['token']);

        $product = $this->createProduct($authA['token']);
        $jobId = $this->createReadyWorkbookJob($authA['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        $this->withToken($authA['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $foreignPriceListId])
            ->assertStatus(422);

        $this->assertSame(ImportJobStatus::FAILED, ImportJob::findOrFail($jobId)->status);
        $this->assertSame(0, ProductBarcode::where('product_id', $product['id'])->count());
    }

    /** @test */
    public function apply_rejects_an_inactive_price_list(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $this->withToken($auth['token'])->putJson("/api/price-lists/{$priceListId}", ['is_active' => false])->assertOk();

        $product = $this->createProduct($auth['token']);
        $jobId = $this->createReadyWorkbookJob($auth['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId])
            ->assertStatus(422);

        $this->assertSame(ImportJobStatus::FAILED, ImportJob::findOrFail($jobId)->status);
    }

    /** @test */
    public function apply_cannot_be_called_from_another_tenant(): void
    {
        $authA = $this->registerTenant('tenant-a', 'owner@a.test');
        $authB = $this->registerTenant('tenant-b', 'owner@b.test');
        $product = $this->createProduct($authA['token']);
        $jobId = $this->createReadyWorkbookJob($authA['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        $this->withToken($authB['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertNotFound();
    }

    /** @test */
    public function a_csv_upload_is_rejected_for_the_workbook_domain(): void
    {
        $auth = $this->registerTenant();
        $csv = UploadedFile::fake()->createWithContent('catalog.csv', "sku,name\nSKU-1,test\n");

        $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_workbook', 'file' => $csv])
            ->assertStatus(422);

        $this->assertSame(0, ImportJob::count());
    }

    /** @test */
    public function blank_rows_across_the_sheets_are_not_counted_or_applied(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $priceListId = $this->createPriceList($auth['token']);

        $file = $this->workbookFile([
            ['name' => 'Products', 'headers' => ['sku', 'name', 'type', 'unit', 'sale_price'], 'rows' => [['', '', '', '', '']]],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'],
                'rows' => [['', ''], [$product['sku'], '6281234500002']]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'],
                'rows' => [[$product['sku'], '', '55.00'], ['', '', '']]],
        ]);

        $jobId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_workbook', 'file' => $file])
            ->assertCreated()
            ->assertJsonPath('data.row_count', 2) // صفّان فعليّان بلا الفارغة الثلاثة
            ->json('data.id');

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);

        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count());
    }

    /** @test */
    public function a_single_apply_call_completes_the_whole_workbook_with_no_partial_progress(): void
    {
        // المصنّف لا يقبل `batch_size` — قطعةٌ واحدةٌ تُنجز الأوراق الثلاث
        // معاً أو لا شيء، خلافاً لـ`product_catalog` القابل للتجزئة عبر عدة
        // استدعاءات. تمرير `batch_size` هنا يُتجاهل بلا أثر.
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $priceListId = $this->createPriceList($auth['token']);
        $jobId = $this->createReadyWorkbookJob($auth['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId, 'batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);
    }

    /** @test */
    public function an_interrupted_apply_leaves_no_partial_state_and_a_retry_completes_cleanly(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->createProduct($auth['token']);
        $priceListId = $this->createPriceList($auth['token']);
        $jobId = $this->createReadyWorkbookJob($auth['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        ImportJob::saving(function ($model) use ($jobId) {
            static $fired = false;
            if ($fired || $model->id !== $jobId) {
                return;
            }
            $fired = true;

            throw new RuntimeException('محاكاة انقطاع العملية قبل الالتزام.');
        });

        $service = app(ImportJobService::class);
        $job = ImportJob::findOrFail($jobId);

        $crashed = false;
        try {
            $service->applyNextChunk($job, ['mode' => 'create', 'price_list_id' => $priceListId], null, true);
        } catch (Throwable $e) {
            $crashed = true;
        }
        $this->assertTrue($crashed);

        $job->refresh();
        $this->assertSame(ImportJobStatus::READY, $job->status);
        $this->assertSame(0, $job->processed_rows);
        $this->assertSame(0, ProductBarcode::where('product_id', $product['id'])->count());

        $result = $service->applyNextChunk($job->fresh(), ['mode' => 'create', 'price_list_id' => $priceListId], null, true);
        $this->assertSame(ImportJobStatus::COMPLETED, $result->status);
        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count(), 'لا أثر مضاعف بعد الاستئناف.');
    }

    /** @test */
    public function retrying_a_completed_workbook_job_is_idempotent(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $priceListId = $this->createPriceList($auth['token']);
        $jobId = $this->createReadyWorkbookJob($auth['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count());
        $this->assertSame(1, PriceListItem::where('product_id', $product['id'])->count());

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count(), 'إعادة محاولة تشغيلة مكتملة لا تنشئ شيئاً ثانيةً.');
        $this->assertSame(1, PriceListItem::where('product_id', $product['id'])->count());
    }

    /**
     * نفس اصطلاح `ImportJobApplyTest::a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock`
     * — اتصالٌ منفصل فعلياً على PostgreSQL يثبت أن القفل حقيقيٌّ، لا افتراضاً.
     */
    /** @test */
    public function a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('قفل الصفّ الحقيقي يُختبر على PostgreSQL فقط.');
        }

        config(['database.connections.rival' => config('database.connections.pgsql')]);
        $rival = DB::connection('rival');
        $rival->statement("SET lock_timeout = '200ms'");

        $tenantId = (string) Str::uuid();
        $rival->table('tenants')->insert([
            'id' => $tenantId,
            'name' => 'مستأجر قفل المصنّف',
            'slug' => 'wb-lock-'.substr($tenantId, 0, 8),
            'currency' => 'SAR',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->lockTestTenantId = $tenantId;

        app(TenantContext::class)->set($tenantId);
        $token = $this->tokenForRole($tenantId, 'owner', 'owner@wb-lock.test');
        $product = $this->createProduct($token, ['sku' => 'SKU-WB-LOCK']);

        $priceListId = (string) Str::uuid();
        $rival->table('price_lists')->insert([
            'id' => $priceListId,
            'tenant_id' => $tenantId,
            'name' => 'قائمة القفل',
            'is_active' => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $file = $this->barcodeAndPriceWorkbook($product['sku']);
        $contents = file_get_contents($file->getRealPath());
        $sha256 = hash('sha256', $contents);
        $jobId = (string) Str::uuid();
        $storagePath = "imports/{$tenantId}/{$jobId}/original.xlsx";
        Storage::disk('local')->put($storagePath, $contents);

        $rival->table('import_jobs')->insert([
            'id' => $jobId,
            'tenant_id' => $tenantId,
            'domain' => 'product_workbook',
            'status' => ImportJobStatus::READY,
            'original_filename' => 'workbook.xlsx',
            'extension' => 'xlsx',
            'mime_type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'byte_size' => strlen($contents),
            'storage_disk' => 'local',
            'storage_path' => $storagePath,
            'content_sha256' => $sha256,
            'row_count' => 2,
            'column_count' => 5,
            'processed_rows' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $blocked = false;
        ImportJob::saving(function ($model) use ($jobId, $rival, &$blocked) {
            static $fired = false;
            if ($fired || $model->id !== $jobId) {
                return;
            }
            $fired = true;

            try {
                $rival->select('select * from import_jobs where id = ? for update', [$jobId]);
            } catch (Throwable $e) {
                $blocked = true;
            }
        });

        $this->withToken($token)
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertTrue($blocked, 'اتصالٌ آخر يجب أن يُمنع من قراءة نفس الصفّ FOR UPDATE أثناء ترحيل القطعة.');
        $this->assertSame(1, ProductBarcode::withoutGlobalScopes()->where('product_id', $product['id'])->count());
    }

    /** @test */
    public function completed_workbook_apply_creates_zero_stock_or_ledger_effect(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token']);
        $priceListId = $this->createPriceList($auth['token']);
        $jobId = $this->createReadyWorkbookJob($auth['token'], $this->barcodeAndPriceWorkbook($product['sku']));

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        // الباركود وسعر الوحدة أثران متوقَّعان لهذا المسار — الممنوع فقط أثرٌ
        // مخزنيٌّ أو محاسبيٌّ (D-08 يبقى NO).
        $this->assertSame(1, ProductBarcode::where('product_id', $product['id'])->count());
        $this->assertSame(1, PriceListItem::where('product_id', $product['id'])->count());
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, JournalLine::count());

        $fresh = Product::findOrFail($product['id']);
        $this->assertSame(0, (int) $fresh->quantity_on_hand);
        $this->assertSame(0, (int) $fresh->avg_cost);
    }
}

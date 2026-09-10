<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\InventoryOpening;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Warehouse;
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
 * PR-DUR-4 — يربط `ImportJobService::applyNextChunk()` بمجال `inventory_opening`،
 * معيداً استعمال `InventoryOpeningImportService::apply()` حصراً بلا أي تعديل
 * على منطقه. `apply()` هنا ينشئ **مسودة فقط** (`InventoryOpeningService::createDraft()`)
 * — الترحيل (`InventoryOpeningService::post()`، المُختبَر كاملاً في
 * `InventoryOpeningPostingTest`) مسارٌ منفصل تماماً غير مربوطٍ بهذا الـPR.
 *
 * **ذرّيٌّ بطبيعته تماماً كمصنّف المنتجات (PR-DUR-3):**
 * `InventoryOpeningImportService::apply()` لا يقبل `batch_offset`/
 * `batch_size` أصلاً — مستندٌ واحدٌ من كل أسطر الملف معاً. قطعةٌ واحدة تُنجز
 * الملف كله أو تفشل كله.
 */
class ImportJobInventoryOpeningApplyTest extends TestCase
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

    /** @param array<int, string> $headers @param array<int, array<int, string>> $rows */
    private function csv(array $headers, array $rows, string $name = 'openings.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($headers, $rows));
    }

    /** مؤسسة بمخزن ومنتج جاهزين. */
    private function scene(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        app(TenantContext::class)->set($auth['tenant_id']);

        // رمزٌ ومخزنٌ مشتقّان من `$slug` — تعارضٌ صدفويٌّ بين مستأجرَي اختبار
        // «SKU-1001»/«WH-1» كان يُبطل اختبارات عزل المستأجر (يتطابق الصفّ مع
        // منتج/مخزن المستأجر نفسه لا مع الآخر عن طريق الخطأ).
        $warehouse = Warehouse::create(['name' => 'مستودع الرياض', 'code' => "WH-{$slug}"]);
        $product = Product::create([
            'name' => 'قهوة عربية', 'sku' => "SKU-{$slug}", 'barcode' => '6280000000001', 'type' => 'good',
            'sale_price' => 25000, 'purchase_price' => 15000, 'track_inventory' => true,
        ]);

        return $auth + ['warehouse' => $warehouse, 'product' => $product];
    }

    private function validOpeningsFile(string $sku = 'SKU-acme', string $warehouse = 'WH-acme'): UploadedFile
    {
        return $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [[$sku, $warehouse, '120', '18.50']]
        );
    }

    private function createReadyJob(string $token, UploadedFile $file): string
    {
        return $this->withToken($token)
            ->post('/api/import-jobs', ['domain' => 'inventory_opening', 'file' => $file])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->json('data.id');
    }

    /** @test */
    public function durable_upload_inspect_and_apply_creates_a_draft_only(): void
    {
        $scene = $this->scene();

        $jobId = $this->withToken($scene['token'])
            ->post('/api/import-jobs', ['domain' => 'inventory_opening', 'file' => $this->validOpeningsFile()])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->assertJsonPath('data.row_count', 1)
            ->json('data.id');

        $response = $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 1);

        $openingId = $response->json('data.apply_result.inventory_opening_id');
        $opening = InventoryOpening::findOrFail($openingId);
        $this->assertSame('draft', $opening->status);
        $this->assertSame(1, $opening->lines()->count());
        $this->assertNull($opening->posted_at);
        $this->assertNull($opening->journal_entry_id);
    }

    /** @test */
    public function apply_creates_zero_stock_or_ledger_effect(): void
    {
        $scene = $this->scene();
        $jobId = $this->createReadyJob($scene['token'], $this->validOpeningsFile());

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, JournalLine::count());
        $this->assertSame(0, ProductWarehouseStock::count());

        $fresh = Product::findOrFail($scene['product']->id);
        $this->assertSame(0, (int) $fresh->quantity_on_hand);
        $this->assertSame(0, (int) $fresh->avg_cost);
    }

    /** @test */
    public function apply_is_refused_without_an_opening_date(): void
    {
        $scene = $this->scene();
        $jobId = $this->createReadyJob($scene['token'], $this->validOpeningsFile());

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", [])
            ->assertStatus(422);

        $this->assertSame(ImportJobStatus::FAILED, ImportJob::findOrFail($jobId)->status);
        $this->assertSame(0, InventoryOpening::count());
    }

    /** @test */
    public function a_row_referencing_a_product_from_another_tenant_is_rejected(): void
    {
        $sceneA = $this->scene('tenant-a', 'owner@a.test');
        $sceneB = $this->scene('tenant-b', 'owner@b.test');

        // ملفٌ داخل مستأجر A يشير إلى رمز صنف موجودٍ فقط في مستأجر B — يظهر
        // كـ"غير موجود" لا يُكشف وجوده الفعلي في مؤسسة أخرى.
        app(TenantContext::class)->set($sceneA['tenant_id']);
        $jobId = $this->createReadyJob($sceneA['token'], $this->validOpeningsFile($sceneB['product']->sku, $sceneA['warehouse']->code));

        $this->withToken($sceneA['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertStatus(422);

        $this->assertSame(ImportJobStatus::FAILED, ImportJob::findOrFail($jobId)->status);
        $this->assertSame(0, InventoryOpening::withoutGlobalScopes()->where('tenant_id', $sceneA['tenant_id'])->count());
    }

    /** @test */
    public function a_row_referencing_a_warehouse_from_another_tenant_is_rejected(): void
    {
        $sceneA = $this->scene('tenant-a', 'owner@a.test');
        $sceneB = $this->scene('tenant-b', 'owner@b.test');

        app(TenantContext::class)->set($sceneA['tenant_id']);
        $jobId = $this->createReadyJob($sceneA['token'], $this->validOpeningsFile($sceneA['product']->sku, $sceneB['warehouse']->code));

        $this->withToken($sceneA['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertStatus(422);

        $this->assertSame(ImportJobStatus::FAILED, ImportJob::findOrFail($jobId)->status);
        $this->assertSame(0, InventoryOpening::withoutGlobalScopes()->where('tenant_id', $sceneA['tenant_id'])->count());
    }

    /** @test */
    public function apply_cannot_be_called_from_another_tenant(): void
    {
        $sceneA = $this->scene('tenant-a', 'owner@a.test');
        $sceneB = $this->scene('tenant-b', 'owner@b.test');
        $jobId = $this->createReadyJob($sceneA['token'], $this->validOpeningsFile());

        $this->withToken($sceneB['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertNotFound();
    }

    /** @test */
    public function blank_rows_are_not_counted_or_applied(): void
    {
        $scene = $this->scene();
        $file = $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [
                ['', '', '', ''],
                ['SKU-acme', 'WH-acme', '120', '18.50'],
                ['', '', '', ''],
            ]
        );

        $jobId = $this->withToken($scene['token'])
            ->post('/api/import-jobs', ['domain' => 'inventory_opening', 'file' => $file])
            ->assertCreated()
            ->assertJsonPath('data.row_count', 1)
            ->json('data.id');

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 1);

        $this->assertSame(1, InventoryOpening::firstOrFail()->lines()->count());
    }

    /** @test */
    public function an_invalid_quantity_row_fails_the_job_and_creates_no_draft(): void
    {
        $scene = $this->scene();
        $file = $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-acme', 'WH-acme', '-5', '18.50']]
        );
        $jobId = $this->createReadyJob($scene['token'], $file);

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertStatus(422);

        $this->assertSame(ImportJobStatus::FAILED, ImportJob::findOrFail($jobId)->status);
        $this->assertSame(0, InventoryOpening::count());
    }

    /** @test */
    public function a_zero_cost_row_is_refused_unless_explicitly_allowed(): void
    {
        $scene = $this->scene();
        $file = $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-acme', 'WH-acme', '10', '0']]
        );
        $jobId = $this->createReadyJob($scene['token'], $file);

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertStatus(422);
        $this->assertSame(0, InventoryOpening::count());

        $jobId2 = $this->createReadyJob($scene['token'], $file);
        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId2}/apply", ['opening_date' => '2026-01-01', 'allow_zero_cost' => true])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);
        $this->assertSame(1, InventoryOpening::count());
    }

    /** @test */
    public function an_interrupted_apply_leaves_no_partial_draft_and_a_retry_completes_cleanly(): void
    {
        $scene = $this->scene();
        $jobId = $this->createReadyJob($scene['token'], $this->validOpeningsFile());

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
            $service->applyNextChunk($job, ['opening_date' => '2026-01-01'], null, true);
        } catch (Throwable $e) {
            $crashed = true;
        }
        $this->assertTrue($crashed);

        $job->refresh();
        $this->assertSame(ImportJobStatus::READY, $job->status);
        $this->assertSame(0, $job->processed_rows);
        $this->assertSame(0, InventoryOpening::count());

        $result = $service->applyNextChunk($job->fresh(), ['opening_date' => '2026-01-01'], null, true);
        $this->assertSame(ImportJobStatus::COMPLETED, $result->status);
        $this->assertSame(1, InventoryOpening::count(), 'لا مسودة مضاعفة بعد الاستئناف.');
    }

    /** @test */
    public function retrying_a_completed_job_is_idempotent_and_creates_no_second_draft(): void
    {
        $scene = $this->scene();
        $jobId = $this->createReadyJob($scene['token'], $this->validOpeningsFile());

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(1, InventoryOpening::count());

        $this->withToken($scene['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(1, InventoryOpening::count(), 'إعادة محاولة تشغيلة مكتملة لا تنشئ مسودة ثانية.');
    }

    /**
     * نفس اصطلاح `ImportJobApplyTest`/`ImportJobWorkbookApplyTest` — اتصالٌ
     * منفصل فعلياً على PostgreSQL يثبت أن القفل حقيقيٌّ، لا افتراضاً.
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
            'name' => 'مستأجر قفل الافتتاح',
            'slug' => 'io-lock-'.substr($tenantId, 0, 8),
            'currency' => 'SAR',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->lockTestTenantId = $tenantId;

        app(TenantContext::class)->set($tenantId);
        $token = $this->tokenForRole($tenantId, 'owner', 'owner@io-lock.test');
        $warehouse = Warehouse::create(['name' => 'مستودع القفل', 'code' => 'WH-LOCK']);
        Product::create([
            'name' => 'صنف القفل', 'sku' => 'SKU-LOCK', 'type' => 'good',
            'sale_price' => 1000, 'track_inventory' => true,
        ]);

        $file = $this->csv(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'], [['SKU-LOCK', 'WH-LOCK', '10', '5.00']]);
        $contents = file_get_contents($file->getRealPath());
        $sha256 = hash('sha256', $contents);
        $jobId = (string) Str::uuid();
        $storagePath = "imports/{$tenantId}/{$jobId}/original.csv";
        Storage::disk('local')->put($storagePath, $contents);

        $rival->table('import_jobs')->insert([
            'id' => $jobId,
            'tenant_id' => $tenantId,
            'domain' => 'inventory_opening',
            'status' => ImportJobStatus::READY,
            'original_filename' => 'openings.csv',
            'extension' => 'csv',
            'mime_type' => 'text/csv',
            'byte_size' => strlen($contents),
            'storage_disk' => 'local',
            'storage_path' => $storagePath,
            'content_sha256' => $sha256,
            'row_count' => 1,
            'column_count' => 4,
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
            ->postJson("/api/import-jobs/{$jobId}/apply", ['opening_date' => '2026-01-01'])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertTrue($blocked, 'اتصالٌ آخر يجب أن يُمنع من قراءة نفس الصفّ FOR UPDATE أثناء ترحيل القطعة.');
        $this->assertSame(1, InventoryOpening::withoutGlobalScopes()->where('tenant_id', $tenantId)->count());
    }
}

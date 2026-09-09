<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\StockMovement;
use App\Services\ImportJobService;
use App\Support\ImportJobStatus;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-DUR-2 — محرّك الترحيل المجزّأ/القابل للاستئناف لتشغيلة `product_catalog`
 * وحدها. يعيد استعمال `ProductImportService::apply()` حصراً كحد الطفرة —
 * الاختبارات هنا تثبت التسلسل عبر القطع، الاستئناف من مؤشّر دائم بعد انقطاع،
 * عدم التكرار عند إعادة محاولة قطعة مكتملة أو متزامنة، الفشل المغلَق على
 * مجال/حالة خاطئة، وصِفر أثرٍ مخزنيّ أو محاسبيّ.
 */
class ImportJobApplyTest extends TestCase
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

    private function csv(int $rows): UploadedFile
    {
        $lines = ["sku,name,type,sale_price"];
        for ($i = 1; $i <= $rows; $i++) {
            $lines[] = "SKU-{$i},منتج رقم {$i},good,100.00";
        }

        return UploadedFile::fake()->createWithContent('catalog.csv', implode("\n", $lines)."\n");
    }

    private function createReadyJob(string $token, int $rows): string
    {
        return $this->withToken($token)
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csv($rows)])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->json('data.id');
    }

    /** @test */
    public function first_apply_processes_chunks_and_completes(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 3);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::PROCESSING)
            ->assertJsonPath('data.processed_rows', 1);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::PROCESSING)
            ->assertJsonPath('data.processed_rows', 2);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply", ['batch_size' => 1])
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 3);

        $this->assertSame(3, Product::count());
        $this->assertNotNull(ImportJob::findOrFail($jobId)->finished_at);
    }

    /** @test */
    public function an_interrupted_first_chunk_leaves_no_partial_state_and_a_retry_completes_cleanly(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $jobId = $this->createReadyJob($auth['token'], 2);

        // يحاكي انقطاع العملية بعد قفل الصفّ ومحاولة تجميد الخيارات، وقبل أي
        // التزام — استثناءٌ يُطلَق مرّةً واحدة فقط أثناء حفظ هذه التشغيلة
        // تحديداً، فيتراجع `DB::transaction()` عن كل شيء تلقائياً.
        ImportJob::saving(function ($model) use ($jobId) {
            static $fired = false;
            if ($fired || $model->id !== $jobId) {
                return;
            }
            $fired = true;

            throw new \RuntimeException('محاكاة انقطاع العملية قبل الالتزام.');
        });

        $service = app(ImportJobService::class);
        $job = ImportJob::findOrFail($jobId);

        $crashed = false;
        try {
            $service->applyNextChunk($job, [], null, true);
        } catch (\Throwable $e) {
            $crashed = true;
        }
        $this->assertTrue($crashed, 'الانقطاع المحاكى يجب أن يظهر كاستثناء لهذه المحاولة.');

        $job->refresh();
        $this->assertSame(ImportJobStatus::READY, $job->status, 'انقطاعٌ قبل الالتزام لا يجب أن يترك حالة معلَّقة.');
        $this->assertSame(0, $job->processed_rows);
        $this->assertNull($job->apply_options);
        $this->assertSame(0, Product::count());

        // إعادة المحاولة (الاستئناف) من نفس المؤشّر الدائم (صفر) تنجح كاملةً.
        $result = $service->applyNextChunk($job->fresh(), [], null, true);
        $this->assertSame(ImportJobStatus::COMPLETED, $result->status);
        $this->assertSame(2, $result->processed_rows);
        $this->assertSame(2, Product::count(), 'لا أثر مضاعف بعد الاستئناف.');
    }

    /** @test */
    public function retrying_a_completed_job_is_idempotent_and_creates_nothing_twice(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 2);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(2, Product::count());

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED)
            ->assertJsonPath('data.processed_rows', 2);

        $this->assertSame(2, Product::count(), 'إعادة محاولة تشغيلة مكتملة لا تنشئ شيئاً ثانيةً.');
    }

    /**
     * قفلٌ حقيقيّ على صفّ التشغيلة يُختبر على PostgreSQL فقط — اتصالٌ منفصل
     * فعلياً (نفس اصطلاح `DocumentNumberingTest`/`ImportJobTest`) يحاول
     * `SELECT ... FOR UPDATE` على نفس الصفّ أثناء إمساك معاملتنا بالقفل؛
     * `lock_timeout` قصير يجعله يفشل حتماً بدل التجمّد، مثبتاً أن القفل حقيقيٌّ
     * لا افتراضاً. SQLite يُسلسِل الكتابات بقفلٍ عامّ على مستوى الملف فلا
     * يختبر نفس الشيء.
     */
    /** @test */
    public function a_concurrent_apply_attempt_is_blocked_by_a_real_row_lock(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('قفل الصفّ الحقيقي يُختبر على PostgreSQL فقط.');
        }

        // التشغيلة والمستأجر يُنشآن عبر اتصالٍ منفصل فعلياً ملتزَم فوراً (لا
        // معاملة الاختبار المغلَّفة) — تماماً كاصطلاح `DocumentNumberingTest`/
        // `ImportJobTest::concurrent_duplicate_creation_...`: صفٌّ يعيش داخل
        // معاملة اختبارنا غير مرئيٍّ أصلاً لاتصالٍ آخر، فلا معنى لمحاولة قفله.
        config(['database.connections.rival' => config('database.connections.pgsql')]);
        $rival = DB::connection('rival');
        $rival->statement("SET lock_timeout = '200ms'");

        $tenantId = (string) Str::uuid();
        $rival->table('tenants')->insert([
            'id' => $tenantId,
            'name' => 'مستأجر قفل الترحيل',
            'slug' => 'lock-' . substr($tenantId, 0, 8),
            'currency' => 'SAR',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->lockTestTenantId = $tenantId;

        $file = $this->csv(2);
        $contents = file_get_contents($file->getRealPath());
        $sha256 = hash('sha256', $contents);
        $jobId = (string) Str::uuid();
        $storagePath = "imports/{$tenantId}/{$jobId}/original.csv";
        Storage::disk('local')->put($storagePath, $contents);

        $rival->table('import_jobs')->insert([
            'id' => $jobId,
            'tenant_id' => $tenantId,
            'domain' => 'product_catalog',
            'status' => ImportJobStatus::READY,
            'original_filename' => 'catalog.csv',
            'extension' => 'csv',
            'mime_type' => 'text/csv',
            'byte_size' => strlen($contents),
            'storage_disk' => 'local',
            'storage_path' => $storagePath,
            'content_sha256' => $sha256,
            'row_count' => 2,
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
            } catch (\Throwable $e) {
                $blocked = true;
            }
        });

        $token = $this->tokenForRole($tenantId, 'owner', 'owner@lock.test');

        $this->withToken($token)
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertTrue($blocked, 'اتصالٌ آخر يجب أن يُمنع من قراءة نفس الصفّ FOR UPDATE أثناء ترحيل القطعة.');
        $this->assertSame(2, Product::withoutGlobalScopes()->where('tenant_id', $tenantId)->count(), 'لا تكرار رغم محاولة القراءة المتزامنة.');
    }

    /** @test */
    public function apply_cannot_be_called_from_another_tenant(): void
    {
        $authA = $this->registerTenant('tenant-a', 'owner@a.test');
        $authB = $this->registerTenant('tenant-b', 'owner@b.test');

        $jobId = $this->createReadyJob($authA['token'], 2);

        $this->withToken($authB['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertNotFound();

        $this->assertSame(0, Product::withoutGlobalScopes()->count());
    }

    /** @test */
    public function apply_fails_closed_on_a_cancelled_job(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 2);

        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$jobId}/cancel")->assertOk();

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertStatus(422);

        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function apply_fails_closed_on_a_domain_with_no_apply_engine(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $service = app(ImportJobService::class);
        $job = $service->create($this->csv(2), 'product_catalog', null, null);
        $job->forceFill(['domain' => 'a_future_domain'])->save();

        $this->expectException(\RuntimeException::class);
        $service->applyNextChunk($job, [], null, true);
    }

    /** @test */
    public function completed_apply_creates_zero_inventory_or_ledger_effect(): void
    {
        $auth = $this->registerTenant();
        $jobId = $this->createReadyJob($auth['token'], 2);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/apply")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::COMPLETED);

        $this->assertSame(2, Product::count());
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, JournalLine::count());

        foreach (Product::all() as $product) {
            $this->assertSame(0, (int) $product->quantity_on_hand);
            $this->assertSame(0, (int) $product->avg_cost);
        }
    }
}

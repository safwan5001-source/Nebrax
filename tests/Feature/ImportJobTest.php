<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\Product;
use App\Services\ImportJobService;
use App\Support\ImportJobStatus;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-DUR-1 — بنية تشغيلة الاستيراد الدائم. لا علاقة له بأي مسار استيراد
 * حالي؛ الاختبارات هنا تثبت الهوية الدائمة (رفع/بصمة/فحص هيكلي/إلغاء/عزل
 * المستأجر/تقليم) وحدها، وأن صِفر أثر يقع على الكتالوج.
 */
class ImportJobTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** مستأجر سباق التزامن — يُنشأ خارج معاملة الاختبار عبر اتصالٍ منفصل، فيُنظَّف يدوياً. */
    protected ?string $raceTenantId = null;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    protected function tearDown(): void
    {
        $tenantId = $this->raceTenantId;
        parent::tearDown();

        if ($tenantId !== null) {
            DB::connection('rival')->table('tenants')->where('id', $tenantId)->delete();
            DB::connection('rival')->disconnect();
        }
    }

    private function validCsv(string $name = 'catalog.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent(
            $name,
            "sku,name\nSKU-1,منتج تجريبي\nSKU-2,منتج آخر\n"
        );
    }

    /** @test */
    public function uploading_a_valid_csv_reaches_ready_with_row_and_column_counts(): void
    {
        $auth = $this->registerTenant();

        $response = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv()])
            ->assertCreated()
            ->assertJsonPath('data.domain', 'product_catalog')
            ->assertJsonPath('data.status', ImportJobStatus::READY)
            ->assertJsonPath('data.row_count', 2)
            ->assertJsonPath('data.column_count', 2);

        $job = ImportJob::findOrFail($response->json('data.id'));
        $this->assertNotEmpty($job->content_sha256);
        $this->assertSame(64, strlen($job->content_sha256));
        $this->assertNotNull($job->storage_path);
        Storage::disk($job->storage_disk)->assertExists($job->storage_path);

        $this->assertSame(0, Product::count(), 'PR-DUR-1 لا ينشئ ولا يعدّل أي منتج.');
    }

    /** @test */
    public function a_file_exceeding_the_column_ceiling_fails_the_job_and_deletes_the_stored_file(): void
    {
        $auth = $this->registerTenant();

        $headerColumns = array_map(fn (int $i) => "c{$i}", range(1, 201));
        $file = UploadedFile::fake()->createWithContent('too-wide.csv', implode(',', $headerColumns)."\n");

        $response = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $file])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::FAILED);

        $this->assertNotEmpty($response->json('data.error_message'));

        $job = ImportJob::findOrFail($response->json('data.id'));
        $this->assertNull($job->storage_path, 'فشل الفحص يحذف الملف المخزَّن؛ السجل يبقى للتدقيق.');
    }

    /** @test */
    public function unknown_domain_is_rejected_before_any_write(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'not_a_real_domain', 'file' => $this->validCsv()])
            ->assertStatus(422);

        $this->assertSame(0, ImportJob::count());
    }

    /** @test */
    public function repeating_the_same_idempotency_key_returns_the_same_job_without_a_second_write(): void
    {
        $auth = $this->registerTenant();

        $first = $this->withToken($auth['token'])
            ->post('/api/import-jobs', [
                'domain' => 'product_catalog',
                'idempotency_key' => 'submit-1',
                'file' => $this->validCsv(),
            ])
            ->assertCreated();

        $second = $this->withToken($auth['token'])
            ->post('/api/import-jobs', [
                'domain' => 'product_catalog',
                'idempotency_key' => 'submit-1',
                'file' => $this->validCsv('catalog-2.csv'),
            ])
            ->assertCreated();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, ImportJob::count());
    }

    /** @test */
    public function the_same_idempotency_key_in_another_tenant_does_not_collide(): void
    {
        $authA = $this->registerTenant('tenant-a', 'owner@a.test');
        $authB = $this->registerTenant('tenant-b', 'owner@b.test');

        $this->withToken($authA['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'idempotency_key' => 'shared-key', 'file' => $this->validCsv()])
            ->assertCreated();

        $this->withToken($authB['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'idempotency_key' => 'shared-key', 'file' => $this->validCsv()])
            ->assertCreated();

        $this->assertSame(2, ImportJob::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_job_cannot_be_read_or_cancelled_from_another_tenant(): void
    {
        $authA = $this->registerTenant('tenant-a', 'owner@a.test');
        $authB = $this->registerTenant('tenant-b', 'owner@b.test');

        $jobId = $this->withToken($authA['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv()])
            ->assertCreated()
            ->json('data.id');

        $this->withToken($authB['token'])->getJson("/api/import-jobs/{$jobId}")->assertNotFound();
        $this->withToken($authB['token'])->postJson("/api/import-jobs/{$jobId}/cancel")->assertNotFound();

        // يبقى مرئياً وقابلاً للإلغاء لمالكه.
        $this->withToken($authA['token'])->getJson("/api/import-jobs/{$jobId}")->assertOk();
    }

    /** @test */
    public function cancel_deletes_the_stored_file_and_is_rejected_once_already_terminal(): void
    {
        $auth = $this->registerTenant();

        $jobId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv()])
            ->assertCreated()
            ->json('data.id');

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', ImportJobStatus::CANCELLED);

        $job = ImportJob::findOrFail($jobId);
        $this->assertNull($job->storage_path);

        $this->withToken($auth['token'])
            ->postJson("/api/import-jobs/{$jobId}/cancel")
            ->assertStatus(422);
    }

    /** @test */
    public function no_code_path_in_this_pr_reaches_queued_processing_or_completed(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv()])
            ->assertCreated();

        $reached = ImportJob::withoutGlobalScopes()
            ->whereIn('status', ImportJobStatus::NOT_YET_REACHABLE)
            ->count();

        $this->assertSame(0, $reached, 'queued/processing/completed مفردات مُقرَّرة سلفاً فقط في PR-DUR-1، لا مساراً حياً.');
    }

    /** @test */
    public function prune_only_removes_terminal_jobs_past_their_retention_window(): void
    {
        $auth = $this->registerTenant();

        $readyId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv('ready.csv')])
            ->assertCreated()
            ->json('data.id');

        $cancelledId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv('cancelled.csv')])
            ->assertCreated()
            ->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$cancelledId}/cancel")->assertOk();

        // كلاهما بعد نافذة الاحتفاظ — لكن التقليم لا يمسّ ready مهما تقادم.
        ImportJob::withoutGlobalScopes()->whereKey([$readyId, $cancelledId])
            ->update(['purge_after' => now()->subDay()]);

        Artisan::call('imports:prune', ['--dry-run' => true]);
        $this->assertStringContainsString('1', Artisan::output());
        $this->assertSame(2, ImportJob::withoutGlobalScopes()->count(), 'dry-run لا يحذف شيئاً.');

        Artisan::call('imports:prune');

        $this->assertNotNull(ImportJob::withoutGlobalScopes()->find($readyId), 'ready لا تُقلَّم مهما تقادمت.');
        $this->assertNull(ImportJob::withoutGlobalScopes()->find($cancelledId), 'cancelled بعد النافذة تُقلَّم.');
    }

    // ═══════════════════════════════════════════════════════════
    //  عقد التخزين: محايد عن السائق، فشلٌ صريح، مسارات معزولة وخاصة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function s3_driver_with_missing_configuration_fails_closed_before_any_write(): void
    {
        config(['imports.storage.driver' => 's3']); // key/secret/bucket/endpoint تبقى فارغة عمداً
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv()])
            ->assertStatus(422);

        $this->assertSame(0, ImportJob::count(), 'إعداد s3 الناقص يجب أن يمنع أي كتابة — لا سجل يتيم.');
    }

    /** @test */
    public function storage_paths_are_tenant_separated_and_private(): void
    {
        $auth = $this->registerTenant();

        $jobId = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->validCsv()])
            ->assertCreated()
            ->json('data.id');

        $job = ImportJob::findOrFail($jobId);
        $this->assertStringStartsWith("imports/{$auth['tenant_id']}/", $job->storage_path);
        $this->assertSame('private', Storage::disk('local')->getVisibility($job->storage_path));
    }

    /** @test */
    public function a_true_retry_reuses_the_existing_job_and_stores_no_second_file(): void
    {
        $auth = $this->registerTenant();

        $first = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'idempotency_key' => 'true-retry', 'file' => $this->validCsv()])
            ->assertCreated();

        $second = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'idempotency_key' => 'true-retry', 'file' => $this->validCsv()])
            ->assertCreated();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, ImportJob::count());
        $this->assertCount(1, Storage::disk('local')->allFiles(), 'إعادة محاولة فعلية لا تخزّن ملفاً ثانياً.');
    }

    /** @test */
    public function the_same_key_with_a_different_file_fails_closed_and_leaves_no_orphan(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'idempotency_key' => 'dup-key', 'file' => $this->validCsv()])
            ->assertCreated();

        $differentFile = UploadedFile::fake()->createWithContent('other.csv', "sku,name\nSKU-9,منتج مختلف\n");

        $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_catalog', 'idempotency_key' => 'dup-key', 'file' => $differentFile])
            ->assertStatus(422);

        $this->assertSame(1, ImportJob::count(), 'المفتاح المعاد بملف مختلف لا يُنشئ تشغيلة ثانية.');
        $this->assertCount(1, Storage::disk('local')->allFiles(), 'المحاولة المرفوضة لا تخزّن ملفاً على الإطلاق.');
    }

    /** @test */
    public function the_same_key_with_a_different_domain_fails_closed(): void
    {
        // المجال الوحيد المسموح به عبر الـHTTP اليوم `product_catalog` (D-G) —
        // فالتحقق من تمييز المجال يمرّ عبر الخدمة مباشرة، تحسّباً لمجالات
        // PR-DUR-3/PR-DUR-4 القادمة التي ستوسّع القائمة المسموحة فعلياً.
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $service = app(ImportJobService::class);

        $file = $this->validCsv();
        $service->create($file, 'product_catalog', 'cross-domain-key', null);

        $this->expectException(\RuntimeException::class);
        $service->create($this->validCsv(), 'a_future_domain', 'cross-domain-key', null);
    }

    /**
     * التزامن الحقيقي عبر اتصالٍ ثانٍ يُختبر على PostgreSQL فقط — نفس اصطلاح
     * `DocumentNumberingTest::two_concurrent_requests_cannot_take_the_same_number`.
     * SQLite يُسلسِل الكتابات بقفلٍ عامّ على الملف: اتصالٌ ثانٍ يحاول
     * الإدراج بينما معاملتنا مفتوحة يتجمّد (قفلٌ ذاتي)، لا يفشل بخطأٍ نظيف.
     */
    /** @test */
    public function concurrent_duplicate_creation_leaves_exactly_one_job_and_no_orphan_file(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('التزامن الحقيقي يُختبر على PostgreSQL — SQLite يُسلسِل الكتابات بقفل ملفٍّ عام.');
        }

        // اتصالٌ منفصل فعلياً (نفس اصطلاح DocumentNumberingTest): إدراجٌ عبره
        // يُلتزَم (commit) استقلالاً عن معاملة الاختبار، فيراه أي اتصالٍ آخر
        // فوراً. مستأجرٌ يُنشأ عبر `registerTenant()` (الاتصال الافتراضي
        // المغلَّف بمعاملة الاختبار) يبقى غير مرئي لاتصالٍ منفصل — فيصطدم
        // إدراج «الفائز» أدناه بقيد مفتاح أجنبي، لا بما نختبره.
        config(['database.connections.rival' => config('database.connections.pgsql')]);
        $rival = DB::connection('rival');

        $tenantId = (string) Str::uuid();
        $rival->table('tenants')->insert([
            'id' => $tenantId,
            'name' => 'مستأجر سباق الاستيراد',
            'slug' => 'race-' . substr($tenantId, 0, 8),
            'currency' => 'SAR',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->raceTenantId = $tenantId;
        app(TenantContext::class)->set($tenantId);

        $file = $this->validCsv();
        $sha256 = hash('sha256', file_get_contents($file->getRealPath()));
        $winnerId = (string) Str::uuid();

        // يحاكي طلباً منافساً يفوز بسباق الإدراج على (tenant_id, idempotency_key)
        // فيما بين فحصنا المسبق وإدراجنا نحن — عبر إدراج خام (لا Eloquent، فلا
        // يعيد استدعاء الحدث نفسه) يُنفَّذ فور بدء إدراج تشغيلتنا.
        ImportJob::creating(function ($model) use ($rival, $winnerId, $tenantId, $sha256) {
            static $fired = false;
            if ($fired) {
                return;
            }
            $fired = true;

            $rival->table('import_jobs')->insert([
                'id' => $winnerId,
                'tenant_id' => $tenantId,
                'domain' => 'product_catalog',
                'status' => ImportJobStatus::READY,
                'idempotency_key' => 'race-key',
                'original_filename' => 'winner.csv',
                'extension' => 'csv',
                'mime_type' => 'text/csv',
                'byte_size' => 10,
                'storage_disk' => 'local',
                'storage_path' => null,
                'content_sha256' => $sha256,
                'row_count' => 1,
                'column_count' => 2,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        });

        try {
            $job = app(ImportJobService::class)->create($file, 'product_catalog', 'race-key', null);

            $this->assertSame($winnerId, $job->id, 'الخاسر يجب أن يعيد سجل الفائز نفسه، لا سجلاً جديداً.');
            $this->assertSame(1, ImportJob::where('idempotency_key', 'race-key')->count());
            $this->assertSame([], Storage::disk('local')->allFiles(), 'ملف المحاولة الخاسرة يجب أن يُحذف — لا يتيم.');
        } finally {
            ImportJob::flushEventListeners();
        }
    }
}

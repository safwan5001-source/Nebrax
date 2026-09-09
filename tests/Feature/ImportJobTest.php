<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\Product;
use App\Support\ImportJobStatus;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Storage;
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

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
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
}

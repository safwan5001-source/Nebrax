<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentFileScanExceptionAdmission;
use App\Models\DocumentProcessingRun;
use App\Models\Branch;
use App\Models\PlatformAdministrator;
use App\Models\PlatformDocumentFileScanException;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentFileScanService;
use App\Services\DocumentCenter\DocumentProcessingService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\EntitlementGrantService;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

class DocumentCenterProcessingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $png;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('queue.default', 'redis');
        Queue::fake();
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_processing',
            'provider' => 'redis',
            'enabled' => true,
            'configuration' => [
                'max_attempts' => 3,
                'timeout_seconds' => 90,
                'backoff_seconds' => [30, 120, 300],
            ],
        ]);
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => [
                'host' => 'clamav.internal',
                'port' => 3310,
                'timeout_seconds' => 10,
            ],
        ]);
        $this->png = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            true,
        );
    }

    /** @test */
    public function completing_intake_creates_one_idempotent_run_and_dispatches_a_branch_scoped_job(): void
    {
        $auth = $this->authorizedTenant('processing-queue');
        $batch = $this->batchWithFile($auth['token']);

        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk();

        $run = DocumentProcessingRun::firstOrFail();
        $this->assertSame(DocumentProcessingStatus::QUEUED, $run->status);
        $this->assertSame($auth['tenant_id'], $run->tenant_id);
        $this->assertSame($auth['branch_id'], $run->branch_id);
        $this->assertSame(DocumentProcessingService::STAGE_SAFETY_SCAN, $run->stage);

        Queue::assertPushed(ScanDocumentFile::class, function (ScanDocumentFile $job) use ($auth, $run): bool {
            return $job->tenantId === $auth['tenant_id']
                && $job->branchId === $auth['branch_id']
                && $job->processingRunId === $run->id
                && $job->tries === 3
                && $job->timeout === 90
                && $job->backoff() === [30, 120, 300]
                && $job->queue === 'documents';
        });

        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($auth['branch_id']);
        $batchModel = DocumentBatch::findOrFail($batch['id']);
        $this->assertSame(0, app(DocumentProcessingService::class)->queueSafetyScans($batchModel));
        $this->assertSame(1, DocumentProcessingRun::count());
        Queue::assertPushed(ScanDocumentFile::class, 1);
    }

    /** @test */
    public function a_clean_scan_finishes_the_run_and_always_clears_worker_tenant_and_branch_contexts(): void
    {
        $auth = $this->authorizedTenant('processing-clean');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $job = $this->queuedJob();

        $this->app->bind(DocumentSafetyScanner::class, fn () => new class implements DocumentSafetyScanner {
            public function scan($stream): DocumentScanStatus
            {
                return DocumentScanStatus::CLEAN;
            }

            public function ping(): bool
            {
                return true;
            }

            public function providerName(): string
            {
                return 'test-clean-scanner';
            }
        });

        $job->handle(
            app(TenantContext::class),
            app(BranchContext::class),
            app(DocumentProcessingService::class),
            app(DocumentStorageService::class),
            app(DocumentSafetyScanner::class),
            app(DocumentFileScanService::class),
            app(PlatformIntegrationResolver::class),
        );

        $this->assertSame(DocumentScanStatus::CLEAN, DocumentFile::findOrFail($job->documentFileId)->scan_status);
        $this->assertSame(DocumentProcessingStatus::SUCCEEDED, DocumentProcessingRun::firstOrFail()->status);
        $this->assertFalse(app(TenantContext::class)->has());
        $this->assertFalse(app(BranchContext::class)->has());
    }

    /** @test */
    public function scanner_exhaustion_fails_closed_quarantines_the_batch_and_keeps_only_safe_errors(): void
    {
        $auth = $this->authorizedTenant('processing-failed');
        $admin = PlatformAdministrator::create([
            'name' => 'Scanner Failure Admin',
            'email' => 'scanner-failure-admin@nebrax.test',
            'password' => 'platform-password-123',
        ]);
        PlatformDocumentFileScanException::create([
            'tenant_id' => $auth['tenant_id'],
            'reason' => 'temporary scanner outage',
            'granted_by' => $admin->id,
            'granted_at' => now('UTC'),
        ]);
        $processingSetting = PlatformIntegrationSetting::where('integration_key', 'document_processing')->firstOrFail();
        $processingSetting->configuration = [
            'max_attempts' => 1,
            'timeout_seconds' => 30,
            'backoff_seconds' => [1],
        ];
        $processingSetting->save();
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $job = $this->queuedJob();

        $this->app->bind(DocumentSafetyScanner::class, fn () => new class implements DocumentSafetyScanner {
            public function scan($stream): DocumentScanStatus
            {
                throw new RuntimeException('raw scanner host and secret must never be stored');
            }

            public function ping(): bool
            {
                return false;
            }

            public function providerName(): string
            {
                return 'test-failed-scanner';
            }
        });

        $job->handle(
            app(TenantContext::class),
            app(BranchContext::class),
            app(DocumentProcessingService::class),
            app(DocumentStorageService::class),
            app(DocumentSafetyScanner::class),
            app(DocumentFileScanService::class),
            app(PlatformIntegrationResolver::class),
        );

        $run = DocumentProcessingRun::firstOrFail();
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->status);
        $this->assertSame('scanner_unavailable', $run->error_code);
        $this->assertStringNotContainsString('raw scanner', (string) $run->error_message_safe);
        $this->assertSame(DocumentScanStatus::FAILED, DocumentFile::findOrFail($job->documentFileId)->scan_status);
        $this->assertSame(DocumentWorkflowStatus::QUARANTINED, DocumentBatch::findOrFail($batch['id'])->status);
        $this->assertSame(0, DocumentFileScanExceptionAdmission::withoutGlobalScopes()->count());
        $this->assertFalse(app(TenantContext::class)->has());
        $this->assertFalse(app(BranchContext::class)->has());
    }

    /** @test */
    public function completing_intake_does_not_queue_work_while_platform_processing_is_disabled(): void
    {
        PlatformIntegrationSetting::where('integration_key', 'document_processing')->update(['enabled' => false]);
        $auth = $this->authorizedTenant('processing-disabled');
        $batch = $this->batchWithFile($auth['token']);

        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'received');

        $this->assertDatabaseCount('document_processing_runs', 0);
        Queue::assertNothingPushed();
    }

    private function queuedJob(): ScanDocumentFile
    {
        $job = null;
        Queue::assertPushed(ScanDocumentFile::class, function (ScanDocumentFile $queued) use (&$job): bool {
            $job = $queued;

            return true;
        });

        return $job;
    }

    private function authorizedTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']),
            'document_center.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON,
            now('UTC')->subMinute(),
            null,
            'document-center-pr3-test',
            (string) Str::uuid(),
        );

        return [...$auth, 'branch_id' => $branchId];
    }

    private function batchWithFile(string $token): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', [
            'document_type' => 'purchase_invoice',
        ])->assertCreated()->json('data');

        $this->withToken($token)->post("/api/document-batches/{$batch['id']}/files", [
            'file' => UploadedFile::fake()->createWithContent('invoice.png', $this->png),
        ], ['Accept' => 'application/json'])->assertCreated();

        return $batch;
    }
}

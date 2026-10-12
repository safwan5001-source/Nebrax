<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/** الكنّاس لا يعلّم أي ملف CLEAN بنفسه: يعيد الإدخال في مسار الفحص القائم أو يغلق fail-closed. */
class DocumentScanSweepTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private string $png;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('queue.default', 'redis');
        Queue::fake();
        $this->app->bind(DocumentSafetyScanner::class, fn () => $this->eicarAwareScanner());
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** @test */
    public function a_file_received_before_the_scanner_existed_is_queued_but_never_marked_clean_by_the_sweep(): void
    {
        $a = $this->tenantWithPendingFile('sw-a');
        $this->configureScanner();

        $report = $this->sweep();

        $this->assertTrue($report['scanner_ready']);
        $this->assertSame(1, $report['requeued']);
        Queue::assertPushed(ScanDocumentFile::class, 1);
        $file = DocumentFile::withoutGlobalScopes()->findOrFail($a['file_id']);
        $this->assertSame(DocumentScanStatus::PENDING, $file->scan_status);
        $run = DocumentProcessingRun::withoutGlobalScopes()->where('document_file_id', $file->id)->firstOrFail();
        $this->assertSame(DocumentProcessingStatus::QUEUED, $run->status);
        $this->assertSame($a['tenant_id'], $run->tenant_id);
    }

    /** @test */
    public function with_no_scanner_configured_nothing_changes_and_the_command_signals_attention(): void
    {
        $a = $this->tenantWithPendingFile('sw-b');

        $report = $this->sweep();

        $this->assertFalse($report['scanner_ready']);
        $this->assertSame(1, $report['unattended']);
        $this->assertSame(0, $report['requeued']);
        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::withoutGlobalScopes()->findOrFail($a['file_id'])->scan_status);
        $this->assertSame(0, DocumentProcessingRun::withoutGlobalScopes()->count());
        $this->artisan('documents:sweep-scans')->assertFailed();
    }

    /** @test */
    public function files_younger_than_the_threshold_and_dry_runs_are_left_alone(): void
    {
        $a = $this->tenantWithPendingFile('sw-c', ageMinutes: 1);
        $this->configureScanner();

        $this->assertSame(0, $this->sweep()['examined']);

        DB::table('document_files')->update(['created_at' => now('UTC')->subHour()]);
        $dry = $this->sweep(dryRun: true);
        $this->assertSame(1, $dry['requeued']);
        $this->assertSame(0, DocumentProcessingRun::withoutGlobalScopes()->count());
        Queue::assertNothingPushed();
        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::withoutGlobalScopes()->findOrFail($a['file_id'])->scan_status);
    }

    /** @test */
    public function a_stale_queued_run_is_redispatched_until_the_attempt_budget_then_the_file_fails_closed(): void
    {
        $a = $this->tenantWithPendingFile('sw-d');
        $this->configureScanner();
        $this->sweep();
        $run = DocumentProcessingRun::withoutGlobalScopes()->firstOrFail();
        DB::table('document_processing_runs')->where('id', $run->id)->update(['updated_at' => now('UTC')->subHour(), 'attempt_count' => 1]);

        // المهمة ShouldBeUnique (قفل 900ث): الكنّاس لا يتجاوزه — نمرّر العتبة بتفريغ القفل كما ينقضي إنتاجياً.
        \Illuminate\Support\Facades\Cache::lock('laravel_unique_job:' . ScanDocumentFile::class . ':document-safety-scan:' . $a['tenant_id'] . ':' . $a['branch_id'] . ':' . $a['file_id'])->forceRelease();
        $this->assertSame(1, $this->sweep()['requeued']);
        Queue::assertPushed(ScanDocumentFile::class, 2);

        DB::table('document_processing_runs')->where('id', $run->id)->update(['updated_at' => now('UTC')->subHour(), 'attempt_count' => 3]);
        $report = $this->sweep();

        $this->assertSame(1, $report['failed_closed']);
        Queue::assertPushed(ScanDocumentFile::class, 2);
        $this->assertSame(DocumentScanStatus::FAILED, DocumentFile::withoutGlobalScopes()->findOrFail($a['file_id'])->scan_status);
        $this->assertSame(DocumentProcessingStatus::FAILED, DocumentProcessingRun::withoutGlobalScopes()->findOrFail($run->id)->status);
        $this->as($a['token'])->getJson("/api/document-files/{$a['file_id']}/download-url")->assertStatus(422);
    }

    /** @test */
    public function a_failed_run_is_only_counted_for_the_operator_and_never_auto_retried(): void
    {
        $a = $this->tenantWithPendingFile('sw-e');
        $this->configureScanner();
        $this->sweep();
        $run = DocumentProcessingRun::withoutGlobalScopes()->firstOrFail();
        DB::table('document_processing_runs')->where('id', $run->id)->update(['status' => 'failed']);
        Queue::fake();

        $report = $this->sweep();

        $this->assertSame(1, $report['failed_runs']);
        $this->assertSame(0, $report['requeued']);
        Queue::assertNothingPushed();
        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::withoutGlobalScopes()->findOrFail($a['file_id'])->scan_status);
    }

    /** @test */
    public function sync_mode_scans_inline_infected_files_are_blocked_and_clean_files_become_downloadable(): void
    {
        $clean = $this->tenantWithPendingFile('sw-f', content: $this->png);
        $infected = $this->tenantWithPendingFile('sw-g', content: $this->png . $this->eicar());
        $this->configureScanner(syncMode: true);
        $this->app->bind(DocumentSafetyScanner::class, fn () => $this->eicarAwareScanner());

        $report = $this->sweep();

        $this->assertSame(2, $report['requeued']);
        Queue::assertNothingPushed();
        $this->assertSame(DocumentScanStatus::CLEAN, DocumentFile::withoutGlobalScopes()->findOrFail($clean['file_id'])->scan_status);
        $this->assertSame(DocumentScanStatus::INFECTED, DocumentFile::withoutGlobalScopes()->findOrFail($infected['file_id'])->scan_status);
        $this->as($clean['token'])->getJson("/api/document-files/{$clean['file_id']}/download-url")->assertOk();
        $this->as($infected['token'])->getJson("/api/document-files/{$infected['file_id']}/download-url")->assertStatus(422);
        // لا كشف عابر للمستأجرين: B لا يرى ملف A ولا حالته.
        $this->as($infected['token'])->getJson("/api/document-files/{$clean['file_id']}/download-url")->assertNotFound();
        $this->as($clean['token'])->getJson("/api/document-files/{$infected['file_id']}/download-url")->assertNotFound();
    }


    /** @test */
    public function an_unreachable_scanner_never_burns_the_attempt_budget_and_alerts(): void
    {
        $a = $this->tenantWithPendingFile('sw-h');
        $this->configureScanner();
        $this->sweep();
        $run = DocumentProcessingRun::withoutGlobalScopes()->firstOrFail();
        DB::table('document_processing_runs')->where('id', $run->id)->update(['updated_at' => now('UTC')->subHour(), 'attempt_count' => 2]);
        $this->app->bind(DocumentSafetyScanner::class, fn () => $this->throwingScanner());
        Queue::fake();

        $report = $this->sweep();

        $this->assertTrue($report['scanner_ready']);
        $this->assertFalse($report['scanner_reachable']);
        $this->assertSame(1, $report['unattended']);
        $this->assertSame(0, $report['requeued']);
        Queue::assertNothingPushed();
        $this->assertSame(2, DocumentProcessingRun::withoutGlobalScopes()->findOrFail($run->id)->attempt_count);
        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::withoutGlobalScopes()->findOrFail($a['file_id'])->scan_status);
    }

    /** @test */
    public function scanner_error_or_timeout_in_sync_mode_fails_closed_and_blocks_download(): void
    {
        $a = $this->tenantWithPendingFile('sw-i');
        $this->configureScanner(syncMode: true);
        $this->app->bind(DocumentSafetyScanner::class, fn () => $this->throwingScanner(scanFails: true));

        $report = $this->sweep();

        $this->assertSame(1, $report['requeued']);
        $this->assertSame(DocumentScanStatus::FAILED, DocumentFile::withoutGlobalScopes()->findOrFail($a['file_id'])->scan_status);
        $run = DocumentProcessingRun::withoutGlobalScopes()->firstOrFail();
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->status);
        $this->as($a['token'])->getJson("/api/document-files/{$a['file_id']}/download-url")->assertStatus(422);

        // التشغيل الفاشل لا يُعاد تلقائياً: يُعدّ ويُنبَّه عنه فقط (إعادته قرار بشري عبر retry).
        $this->assertSame(0, DocumentFile::withoutGlobalScopes()->where('scan_status', 'pending')->count());
    }

    /** @test */
    public function sweeping_twice_never_creates_a_duplicate_scan_run_or_second_job(): void
    {
        $this->tenantWithPendingFile('sw-j');
        $this->configureScanner();

        $this->sweep();
        $second = $this->sweep();

        $this->assertSame(1, DocumentProcessingRun::withoutGlobalScopes()->count());
        Queue::assertPushed(ScanDocumentFile::class, 1);
        $this->assertSame(0, $second['requeued']);
    }

    /** @test */
    public function the_alert_log_carries_counts_only_never_tenant_or_file_identifiers(): void
    {
        $a = $this->tenantWithPendingFile('sw-k');
        $this->configureScanner();
        $this->app->bind(DocumentSafetyScanner::class, fn () => $this->throwingScanner());
        $logged = [];
        \Illuminate\Support\Facades\Log::shouldReceive('error')->andReturnUsing(function ($message, $context = []) use (&$logged) {
            $logged[] = [$message, $context];
        });
        \Illuminate\Support\Facades\Log::shouldReceive('warning')->andReturnUsing(function ($message, $context = []) use (&$logged) {
            $logged[] = [$message, $context];
        });

        $this->sweep();

        $this->assertNotEmpty($logged);
        $dump = json_encode($logged);
        $this->assertStringNotContainsString($a['tenant_id'], $dump);
        $this->assertStringNotContainsString($a['file_id'], $dump);
        $this->assertStringNotContainsString('clamav.internal', $dump);
    }

    private function throwingScanner(bool $scanFails = false): DocumentSafetyScanner
    {
        return new class($scanFails) implements DocumentSafetyScanner
        {
            public function __construct(private readonly bool $scanFails)
            {
            }

            public function scan($stream): DocumentScanStatus
            {
                throw new \RuntimeException('Malware scanner connection timed out.');
            }

            public function ping(): bool
            {
                if ($this->scanFails) {
                    return true;
                }
                throw new \RuntimeException('Malware scanner is unavailable.');
            }

            public function providerName(): string
            {
                return 'test-throwing-scanner';
            }
        };
    }

    /** @return array{scanner_ready:bool,scanner_reachable:bool,examined:int,requeued:int,failed_closed:int,failed_runs:int,unattended:int,dry_run:bool} */
    private function sweep(bool $dryRun = false): array
    {
        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();

        return app(\App\Services\DocumentCenter\DocumentScanSweepService::class)->sweep(15, 100, $dryRun);
    }

    /** كل طلب إنتاجي يبدأ بسياق فارغ؛ الاختبار يتقاسم حاوية واحدة فنمسح ما خلّفه الطلب السابق. */
    private function as(string $token): static
    {
        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();

        return $this->withToken($token);
    }

    private function eicar(): string
    {
        // سلسلة EICAR القياسية (غير ضارة بتصميمها) مجزّأة كي لا يلتقطها فاحص المستودع.
        return 'X5O!P%@AP[4\PZX54(P^)7CC)7}$' . 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    }

    private function eicarAwareScanner(): DocumentSafetyScanner
    {
        $marker = $this->eicar();

        return new class($marker) implements DocumentSafetyScanner
        {
            public function __construct(private readonly string $marker)
            {
            }

            public function scan($stream): DocumentScanStatus
            {
                return str_contains((string) stream_get_contents($stream), $this->marker)
                    ? DocumentScanStatus::INFECTED
                    : DocumentScanStatus::CLEAN;
            }

            public function ping(): bool
            {
                return true;
            }

            public function providerName(): string
            {
                return 'test-eicar-scanner';
            }
        };
    }

    private function configureScanner(bool $syncMode = false): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => ['host' => 'clamav.internal', 'port' => 3310, 'timeout_seconds' => 10],
        ]);
        if ($syncMode) {
            PlatformIntegrationSetting::create([
                'integration_key' => 'document_ai',
                'provider' => 'google_gemini',
                'enabled' => false,
                'configuration' => ['processing_mode' => 'sync'],
            ]);
        }
    }

    /** @return array{tenant_id:string,token:string,branch_id:string,file_id:string} */
    private function tenantWithPendingFile(string $slug, int $ageMinutes = 60, ?string $content = null): array
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
            'sweep-test',
            (string) Str::uuid(),
        );

        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();
        $batch = $this->as($auth['token'])->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data.id');
        $fileId = $this->as($auth['token'])->post("/api/document-batches/{$batch}/files", [
            'file' => UploadedFile::fake()->createWithContent('sweep.png', $content ?? $this->png),
        ], ['Accept' => 'application/json'])->assertCreated()->json('data.id');
        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();
        $this->as($auth['token'])->postJson("/api/document-batches/{$batch}/complete")->assertOk();

        DB::table('document_files')->where('id', $fileId)->update(['created_at' => now('UTC')->subMinutes($ageMinutes)]);

        return [...$auth, 'branch_id' => $branchId, 'file_id' => $fileId];
    }
}

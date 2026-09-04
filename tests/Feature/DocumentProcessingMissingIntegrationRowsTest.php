<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentFileScanExceptionAdmission;
use App\Models\DocumentProcessingRun;
use App\Models\PlatformAdministrator;
use App\Models\PlatformDocumentFileScanException;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentFileScanAdmissionService;
use App\Services\DocumentCenter\DocumentRetryService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\EntitlementGrantService;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentTypeCatalog;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * تكرار وضع الإنتاج المضبوط: جدول platform_integration_settings موجود (الهجرات مُطبَّقة)
 * لكن بلا أي صف لـ document_processing أو malware_scanner — لا صفوف مُدرجة يدوياً هنا،
 * فقط اعتماد على السلوك الافتراضي الصحيح بعد الإصلاح.
 */
class DocumentProcessingMissingIntegrationRowsTest extends TestCase
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
        config()->set('document_center.ai.provider_network_enabled', true);
        Queue::fake();
        $this->png = base64_decode(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            true,
        );
        $this->assertSame(0, PlatformIntegrationSetting::query()->count());
    }

    /** @test */
    public function document_processing_is_authoritatively_disabled_only_by_an_explicit_disabled_row(): void
    {
        $this->assertFalse(app(PlatformIntegrationResolver::class)->documentProcessingIsAuthoritativelyDisabled());

        PlatformIntegrationSetting::create([
            'integration_key' => 'document_processing',
            'provider' => 'redis',
            'enabled' => true,
            'configuration' => [],
        ]);
        $this->app->forgetInstance(PlatformIntegrationResolver::class);
        $this->assertFalse(app(PlatformIntegrationResolver::class)->documentProcessingIsAuthoritativelyDisabled());

        PlatformIntegrationSetting::query()->where('integration_key', 'document_processing')->update(['enabled' => false]);
        $this->app->forgetInstance(PlatformIntegrationResolver::class);
        $this->assertTrue(app(PlatformIntegrationResolver::class)->documentProcessingIsAuthoritativelyDisabled());

        PlatformIntegrationSetting::query()->where('integration_key', 'document_processing')->delete();
        $this->app->forgetInstance(PlatformIntegrationResolver::class);
        $this->assertFalse(app(PlatformIntegrationResolver::class)->documentProcessingIsAuthoritativelyDisabled());

        Schema::shouldReceive('hasTable')->once()->with('platform_integration_settings')->andReturn(false);
        $this->assertFalse((new PlatformIntegrationResolver())->documentProcessingIsAuthoritativelyDisabled());
    }

    /** @test */
    public function zero_configured_rows_admit_via_a_valid_tenant_exception_and_reach_extraction_in_async_mode(): void
    {
        $this->configureDocumentAi('async');
        config()->set('queue.default', 'redis');
        $auth = $this->authorizedTenant('missing-rows-async');
        $this->grantScanException($auth['tenant_id']);
        Http::fake();

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'queued');

        $file = DocumentFile::firstOrFail();
        $admission = DocumentFileScanExceptionAdmission::withoutGlobalScopes()->sole();
        $this->assertSame(DocumentScanStatus::PENDING, $file->scan_status);
        $this->assertSame($file->id, $admission->document_file_id);
        $this->assertSame($auth['tenant_id'], $admission->tenant_id);
        Queue::assertNotPushed(ScanDocumentFile::class);
        Queue::assertPushed(ExtractDocumentFile::class, function (ExtractDocumentFile $job) use ($auth, $file): bool {
            return $job->tenantId === $auth['tenant_id']
                && $job->branchId === $auth['branch_id']
                && $job->documentFileId === $file->id
                && $job->queue === 'documents';
        });
        Http::assertNothingSent();
    }

    /** @test */
    public function zero_configured_rows_admit_via_a_valid_tenant_exception_and_extract_inline_in_sync_mode(): void
    {
        $this->configureDocumentAi('sync');
        $this->bindCleanScannerIsNeverCalled();
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('missing-rows-sync');
        $this->grantScanException($auth['tenant_id']);
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response($this->geminiResponse())]);

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'needs_review');

        Queue::assertNotPushed(ScanDocumentFile::class);
        Queue::assertNotPushed(ExtractDocumentFile::class);
        Http::assertSentCount(1);
        $this->assertSame(1, DocumentExtractionResult::count());
        $this->assertSame(1, DocumentFileScanExceptionAdmission::withoutGlobalScopes()->count());
    }

    /** @test */
    public function zero_configured_rows_without_any_tenant_exception_fail_closed(): void
    {
        $auth = $this->authorizedTenant('missing-rows-no-exception');
        Http::fake();

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'received');

        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::firstOrFail()->scan_status);
        $this->assertSame(0, DocumentProcessingRun::count());
        $this->assertSame(0, DocumentFileScanExceptionAdmission::withoutGlobalScopes()->count());
        $this->assertSame(0, DocumentExtractionResult::count());
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    /** @test */
    public function zero_configured_rows_a_cross_tenant_exception_cannot_authorize(): void
    {
        $excepted = $this->authorizedTenant('missing-rows-exception-owner');
        $this->grantScanException($excepted['tenant_id']);
        $target = $this->authorizedTenant('missing-rows-exception-target');
        Http::fake();

        $batch = $this->batchWithFile($target['token']);
        $this->withToken($target['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'received');

        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::firstOrFail()->scan_status);
        $this->assertSame(0, DocumentFileScanExceptionAdmission::withoutGlobalScopes()->count());
        $this->assertSame(0, DocumentExtractionResult::count());
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    /** @test */
    public function a_scanner_enabled_with_empty_configuration_still_fails_closed_even_without_a_document_processing_row(): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => [],
        ]);
        $auth = $this->authorizedTenant('missing-rows-scanner-enabled-empty');
        $this->grantScanException($auth['tenant_id']);
        Http::fake();

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'received');

        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::firstOrFail()->scan_status);
        $this->assertSame(0, DocumentProcessingRun::count());
        $this->assertSame(0, DocumentFileScanExceptionAdmission::withoutGlobalScopes()->count());
        Queue::assertNothingPushed();
        Http::assertNothingSent();
    }

    /** @test */
    public function unsafe_terminal_file_and_batch_states_cannot_authorize_when_no_rows_are_configured(): void
    {
        $auth = $this->authorizedTenant('missing-rows-unsafe-states');
        $this->grantScanException($auth['tenant_id']);
        $batch = $this->batchWithFile($auth['token']);
        $file = DocumentFile::firstOrFail();
        $admission = app(DocumentFileScanAdmissionService::class);

        $this->assertTrue($admission->authorize($file));
        $this->assertSame(1, DocumentFileScanExceptionAdmission::withoutGlobalScopes()->count());

        $file->fill(['scan_status' => DocumentScanStatus::INFECTED])->save();
        $this->assertFalse($admission->authorize($file->fresh()));

        $file->fill(['scan_status' => DocumentScanStatus::FAILED])->save();
        $this->assertFalse($admission->authorize($file->fresh()));

        $file->fill(['scan_status' => DocumentScanStatus::PENDING])->save();
        $batchModel = DocumentBatch::findOrFail($batch['id']);
        app(DocumentWorkflowService::class)->transition($batchModel, DocumentWorkflowStatus::QUARANTINED, 'test_quarantined', 'system');
        $this->assertFalse($admission->authorize($file->fresh()));
    }

    /** @test */
    public function retrying_a_failed_safety_scan_run_is_not_rejected_solely_because_document_processing_has_no_row(): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => ['host' => 'clamav.internal', 'port' => 3310, 'timeout_seconds' => 10],
        ]);
        config()->set('queue.default', 'redis');
        $auth = $this->authorizedTenant('missing-rows-retry-allowed');
        [$batch, $file] = $this->batchWithFileModels($auth['token']);
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'stage' => 'safety_scan',
            'status' => DocumentProcessingStatus::FAILED,
            'attempt_count' => 0,
            'queued_at' => now('UTC'),
            'finished_at' => now('UTC'),
            'error_code' => 'scanner_unavailable',
            'error_message_safe' => 'فشل سابق آمن.',
        ]);

        $result = app(DocumentRetryService::class)->retry($run, null);

        $this->assertTrue($result['accepted']);
        $this->assertSame(DocumentProcessingStatus::QUEUED, $run->fresh()->status);
        Queue::assertPushed(ScanDocumentFile::class);
    }

    /** @test */
    public function retrying_a_failed_safety_scan_run_stays_fail_closed_when_the_scanner_configuration_is_empty(): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => [],
        ]);
        config()->set('queue.default', 'redis');
        $auth = $this->authorizedTenant('missing-rows-retry-blocked');
        [$batch, $file] = $this->batchWithFileModels($auth['token']);
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'stage' => 'safety_scan',
            'status' => DocumentProcessingStatus::FAILED,
            'attempt_count' => 0,
            'queued_at' => now('UTC'),
            'finished_at' => now('UTC'),
            'error_code' => 'scanner_unavailable',
            'error_message_safe' => 'فشل سابق آمن.',
        ]);

        $result = app(DocumentRetryService::class)->retry($run, null);

        $this->assertFalse($result['accepted']);
        $this->assertSame(DocumentRetryService::CODE_RUNTIME_UNAVAILABLE, $result['code']);
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);
        Queue::assertNothingPushed();
    }

    private function bindCleanScannerIsNeverCalled(): void
    {
        $this->app->bind(DocumentSafetyScanner::class, fn () => new class implements DocumentSafetyScanner
        {
            public function scan($stream): DocumentScanStatus
            {
                throw new \RuntimeException('scanner must never be invoked when authoritatively unconfigured');
            }

            public function ping(): bool
            {
                return false;
            }

            public function providerName(): string
            {
                return 'test-unreachable-scanner';
            }
        });
    }

    private function configureDocumentAi(string $mode): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai',
            'provider' => 'google_gemini',
            'enabled' => true,
            'configuration' => [
                'engine_enabled' => true,
                'processing_mode' => $mode,
                'primary_provider' => 'google_gemini',
                'fallback_enabled' => false,
                'fallback_providers' => [],
                'confidence_threshold_percent' => 0,
                'default_language' => 'ar',
                'max_files_per_batch' => 10,
                'max_pages_per_file' => 100,
                'max_file_size_bytes' => 10485760,
                'test_mode' => true,
                'providers' => [
                    'openai' => [],
                    'anthropic' => [],
                    'google_gemini' => [
                        'enabled' => true,
                        'api_key' => 'gemini-secret-key',
                        'model' => 'gemini-test',
                        'connection_timeout_seconds' => 15,
                        'processing_timeout_seconds' => 90,
                        'max_attempts' => 2,
                        'allow_document_sending' => true,
                    ],
                ],
            ],
        ]);
    }

    private function grantScanException(string $tenantId): PlatformDocumentFileScanException
    {
        $admin = PlatformAdministrator::create([
            'name' => 'مدير استثناء الفحص',
            'email' => 'scan-exception-'.Str::uuid().'@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return PlatformDocumentFileScanException::create([
            'tenant_id' => $tenantId,
            'reason' => 'temporary scanner outage',
            'granted_by' => $admin->id,
            'granted_at' => now('UTC'),
        ]);
    }

    /** @return array{token:string,tenant_id:string,branch_id:string} */
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
            'document-processing-missing-rows-test',
            (string) Str::uuid(),
        );
        Settings::put('document_intelligence', [
            'processing_enabled' => true,
            'allowed_document_types' => DocumentTypeCatalog::all(),
        ]);

        return [...$auth, 'branch_id' => $branchId];
    }

    private function batchWithFile(string $token): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])
            ->assertCreated()
            ->json('data');
        $this->withToken($token)->post(
            "/api/document-batches/{$batch['id']}/files",
            ['file' => UploadedFile::fake()->createWithContent('invoice.png', $this->png)],
            ['Accept' => 'application/json'],
        )->assertCreated();

        return $batch;
    }

    /** @return array{0: DocumentBatch, 1: DocumentFile} */
    private function batchWithFileModels(string $token): array
    {
        $batch = $this->batchWithFile($token);

        return [DocumentBatch::findOrFail($batch['id']), DocumentFile::query()->where('document_batch_id', $batch['id'])->firstOrFail()];
    }

    /** @return array<string, mixed> */
    private function geminiResponse(): array
    {
        $payload = [
            'document_type' => 'purchase_invoice',
            'language' => 'ar',
            'confidence' => '0.8700',
            'fields' => [
                'issuer_name' => 'مورد تجريبي',
                'issuer_tax_number' => '310000000000003',
                'document_number' => 'PI-42',
                'document_date' => '2026-08-24',
                'currency' => 'SAR',
                'subtotal' => '100.00',
                'tax_amount' => '15.00',
                'total_amount' => '115.00',
            ],
            'lines' => [['description' => 'خدمة اختبار', 'quantity' => '1', 'unit_price' => '100.00', 'total' => '100.00', 'tax_rate' => '15%']],
            'warnings' => [],
        ];

        return [
            'candidates' => [[
                'content' => ['parts' => [['text' => json_encode($payload, JSON_THROW_ON_ERROR)]]],
            ]],
            'usageMetadata' => ['promptTokenCount' => 11, 'candidatesTokenCount' => 7],
        ];
    }
}

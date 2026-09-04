<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentExtractionService;
use App\Services\EntitlementGrantService;
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
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class DocumentExtractionProcessingModeTest extends TestCase
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
    }

    /** @test */
    public function sync_mode_extracts_inline_once_without_dispatching_jobs(): void
    {
        $this->configurePlatform('sync');
        $this->bindCleanScanner();
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('sync-inline');
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response($this->geminiResponse())]);

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'needs_review');

        Queue::assertNotPushed(ScanDocumentFile::class);
        Queue::assertNotPushed(ExtractDocumentFile::class);
        Http::assertSentCount(1);
        $this->assertSame(DocumentScanStatus::CLEAN, DocumentFile::firstOrFail()->scan_status);
        $this->assertSame(1, DocumentExtractionResult::count());
        $this->assertSame(1, DocumentProcessingRun::query()->where('stage', 'extraction')->count());
        $this->assertDatabaseMissing('journal_entries', ['tenant_id' => $auth['tenant_id']]);
        $this->assertDatabaseMissing('stock_movements', ['tenant_id' => $auth['tenant_id']]);

        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($auth['branch_id']);
        $this->assertSame(0, app(DocumentExtractionService::class)->queueExtractions(DocumentBatch::findOrFail($batch['id'])));
        Http::assertSentCount(1);
    }

    /** @test */
    public function async_mode_still_dispatches_the_existing_scan_job(): void
    {
        $this->configurePlatform('async');
        config()->set('queue.default', 'redis');
        $auth = $this->authorizedTenant('async-dispatch');
        Http::fake();

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();

        Queue::assertPushed(ScanDocumentFile::class, 1);
        Queue::assertNotPushed(ExtractDocumentFile::class);
        Http::assertNothingSent();
        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::firstOrFail()->scan_status);
        $this->assertSame(DocumentWorkflowStatus::RECEIVED, DocumentBatch::findOrFail($batch['id'])->status);
    }

    /** @test */
    public function a_tenant_disabled_document_type_is_never_sent_to_the_provider_in_sync_mode(): void
    {
        $this->configurePlatform('sync');
        $this->bindCleanScanner();
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('sync-type-blocked', processingEnabled: true, allowedTypes: ['delivery_note']);
        Http::fake();

        $batch = $this->batchWithFile($auth['token'], 'purchase_invoice');
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();

        Http::assertNothingSent();
        Queue::assertNothingPushed();
        $this->assertSame(DocumentScanStatus::CLEAN, DocumentFile::firstOrFail()->scan_status);
        $this->assertSame(0, DocumentExtractionResult::count());
        $this->assertNotSame(DocumentWorkflowStatus::FAILED, DocumentBatch::findOrFail($batch['id'])->status);
    }

    /** @test */
    public function disabled_malware_scanner_leaves_files_pending_and_never_marks_them_clean(): void
    {
        $this->configurePlatform('sync');
        PlatformIntegrationSetting::query()->where('integration_key', 'malware_scanner')->update(['enabled' => false]);
        $this->bindCleanScanner();
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('sync-scanner-off');
        Http::fake();

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'received');

        Queue::assertNothingPushed();
        Http::assertNothingSent();
        $this->assertSame(DocumentScanStatus::PENDING, DocumentFile::firstOrFail()->scan_status);
        $this->assertSame(0, DocumentExtractionResult::count());
        $this->assertSame(0, DocumentProcessingRun::count());
    }

    /** @test */
    public function a_provider_timeout_in_sync_mode_leaves_a_failed_retryable_run_without_posting(): void
    {
        $this->configurePlatform('sync');
        $this->bindCleanScanner();
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('sync-timeout');
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::sequence()
                ->push([], 504)
                ->push($this->geminiResponse()),
        ]);

        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();

        $run = DocumentProcessingRun::query()->where('stage', 'extraction')->firstOrFail();
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->status);
        $this->assertSame('extraction_failed', $run->error_code);
        $this->assertSame(DocumentWorkflowStatus::FAILED, DocumentBatch::findOrFail($batch['id'])->status);
        $this->assertSame(0, DocumentExtractionResult::count());
        $this->assertDatabaseMissing('journal_entries', ['tenant_id' => $auth['tenant_id']]);

        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->fresh()->updated_at->toIso8601String(),
        ])->assertStatus(202);

        Queue::assertNothingPushed();
        $this->assertSame(DocumentWorkflowStatus::NEEDS_REVIEW, DocumentBatch::findOrFail($batch['id'])->status);
        $this->assertSame(1, DocumentExtractionResult::count());
    }

    /** @test */
    public function sync_extraction_is_isolated_to_the_request_tenant(): void
    {
        $this->configurePlatform('sync');
        $this->bindCleanScanner();
        config()->set('queue.default', 'sync');
        $first = $this->authorizedTenant('sync-tenant-a');
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response($this->geminiResponse())]);

        $batch = $this->batchWithFile($first['token']);
        $this->withToken($first['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();

        $second = $this->authorizedTenant('sync-tenant-b');
        app(TenantContext::class)->set($first['tenant_id']);
        app(BranchContext::class)->set($first['branch_id']);
        $result = DocumentExtractionResult::firstOrFail();
        $this->assertSame($first['tenant_id'], $result->tenant_id);
        $this->assertNotSame($second['tenant_id'], $result->tenant_id);
        app(TenantContext::class)->set($second['tenant_id']);
        app(BranchContext::class)->set($second['branch_id']);
        $this->assertSame(0, DocumentExtractionResult::query()->count());
    }

    /** @test */
    public function saving_processing_mode_requires_the_platform_administrator_password(): void
    {
        $this->configurePlatform('async');
        [, $token] = $this->platformToken();
        $payload = $this->documentAiPayload('sync');
        unset($payload['current_password']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $payload)
            ->assertStatus(422);

        $this->assertSame('async', PlatformIntegrationSetting::query()
            ->where('integration_key', 'document_ai')->firstOrFail()
            ->configuration['processing_mode'] ?? 'async');

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload('sync'))
            ->assertOk();

        $stored = PlatformIntegrationSetting::query()->where('integration_key', 'document_ai')->firstOrFail();
        $this->assertSame('sync', $stored->configuration['processing_mode']);
        $overview = $this->withToken($token)->getJson('/api/platform/integrations')->assertOk()->json('data');
        $encoded = json_encode($overview, JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('gemini-secret-key', $encoded);
        $this->assertSame('sync', $overview['integrations'][3]['configuration']['processing_mode']);
        $this->assertSame('sync', $overview['runtime']['processing_mode']);
        $this->assertFalse($overview['runtime']['worker_required']);
    }

    /** @test */
    public function omitting_processing_mode_on_save_preserves_async_as_the_safe_default(): void
    {
        $this->configurePlatform('async');
        [, $token] = $this->platformToken();
        $payload = $this->documentAiPayload('async');
        unset($payload['processing_mode']);

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $payload)->assertOk();

        $this->assertSame('async', PlatformIntegrationSetting::query()
            ->where('integration_key', 'document_ai')->firstOrFail()
            ->configuration['processing_mode']);
    }

    /** @test */
    public function an_invalid_processing_mode_is_rejected_on_save_and_the_stored_async_default_is_unchanged(): void
    {
        $this->configurePlatform('async');
        [, $token] = $this->platformToken();
        $payload = $this->documentAiPayload('async');
        $payload['processing_mode'] = 'immediate';

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $payload)
            ->assertStatus(422);

        $this->assertSame('async', PlatformIntegrationSetting::query()
            ->where('integration_key', 'document_ai')->firstOrFail()
            ->configuration['processing_mode']);
    }

    private function configurePlatform(string $mode): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_processing',
            'provider' => 'redis',
            'enabled' => true,
            'configuration' => ['max_attempts' => 3, 'timeout_seconds' => 90, 'backoff_seconds' => [30, 120, 300]],
        ]);
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner',
            'provider' => 'clamav_tcp',
            'enabled' => true,
            'configuration' => ['host' => 'clamav.internal', 'port' => 3310, 'timeout_seconds' => 10],
        ]);
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

    private function bindCleanScanner(): void
    {
        $this->app->bind(DocumentSafetyScanner::class, fn () => new class implements DocumentSafetyScanner
        {
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
    }

    /** @param  list<string>|null  $allowedTypes
     * @return array{token:string,tenant_id:string,branch_id:string}
     */
    private function authorizedTenant(string $slug, bool $processingEnabled = true, ?array $allowedTypes = null): array
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
            'processing-mode-test',
            (string) Str::uuid(),
        );
        Settings::put('document_intelligence', [
            'processing_enabled' => $processingEnabled,
            'allowed_document_types' => $allowedTypes ?? DocumentTypeCatalog::all(),
        ]);

        return [...$auth, 'branch_id' => $branchId];
    }

    private function batchWithFile(string $token, string $documentType = 'purchase_invoice'): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => $documentType])
            ->assertCreated()
            ->json('data');
        $this->withToken($token)->post(
            "/api/document-batches/{$batch['id']}/files",
            ['file' => UploadedFile::fake()->createWithContent('invoice.png', $this->png)],
            ['Accept' => 'application/json'],
        )->assertCreated();

        return $batch;
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

    /** @return array<string, mixed> */
    private function documentAiPayload(string $mode): array
    {
        $provider = fn (string $model): array => [
            'enabled' => $model === 'gemini-test',
            'clear_api_key' => false,
            'model' => $model,
            'connection_timeout_seconds' => 15,
            'processing_timeout_seconds' => 90,
            'max_attempts' => 2,
            'allow_document_sending' => $model === 'gemini-test',
            'monthly_operation_limit' => null,
            'monthly_page_limit' => null,
            'data_region' => '',
            'retention_policy' => '',
        ];

        return [
            'enabled' => true,
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
                'openai' => $provider('gpt-test'),
                'anthropic' => $provider('claude-test'),
                'google_gemini' => $provider('gemini-test'),
            ],
            'current_password' => 'platform-password-123',
        ];
    }

    /** @return array{PlatformAdministrator,string} */
    private function platformToken(): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير نمط المعالجة',
            'email' => 'processing-mode@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [$administrator, $administrator->createToken('platform-console', ['platform:read', 'platform:manage'])->plainTextToken];
    }
}

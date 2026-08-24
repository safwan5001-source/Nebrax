<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentProviderAttempt;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentExtractionService;
use App\Services\DocumentCenter\DocumentFileScanService;
use App\Services\DocumentCenter\DocumentProcessingService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\EntitlementGrantService;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class DocumentExtractionProviderTest extends TestCase
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
        // الاختبارات وحدها تفتح الحارس مع HTTP fake؛ يبقى الافتراضي في التطبيق false.
        config()->set('document_center.ai.provider_network_enabled', true);
        Queue::fake();
        $this->configurePlatform();
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** @test */
    public function provider_credentials_are_encrypted_and_masked_in_the_platform_overview(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $payload = $this->documentAiPayload('TOP-SECRET-OPENAI-KEY', 'TOP-SECRET-ANTHROPIC-KEY', 'TOP-SECRET-GEMINI-KEY');

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $payload)
            ->assertOk()
            ->assertJsonPath('data.integrations.3.configuration.providers.openai.has_api_key', true)
            ->assertJsonPath('data.integrations.3.configuration.providers.anthropic.has_api_key', true)
            ->assertJsonPath('data.integrations.3.configuration.providers.google_gemini.has_api_key', true)
            ->assertJsonMissing(['TOP-SECRET-OPENAI-KEY', 'TOP-SECRET-ANTHROPIC-KEY', 'TOP-SECRET-GEMINI-KEY']);

        $raw = (string) \Illuminate\Support\Facades\DB::table('platform_integration_settings')->where('integration_key', 'document_ai')->value('configuration');
        $this->assertStringNotContainsString('TOP-SECRET-OPENAI-KEY', $raw);
        $this->assertStringNotContainsString('TOP-SECRET-ANTHROPIC-KEY', $raw);
        $this->assertStringNotContainsString('TOP-SECRET-GEMINI-KEY', $raw);
    }

    /** @test */
    public function a_platform_manager_can_explicitly_clear_a_provider_key_without_receiving_it_back(): void
    {
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);
        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $this->documentAiPayload('OPENAI-KEY-TO-CLEAR', 'ANTHROPIC-KEY', 'GEMINI-KEY'))->assertOk();
        $payload = $this->documentAiPayload('', 'ANTHROPIC-KEY', 'GEMINI-KEY');
        $payload['providers']['openai']['clear_api_key'] = true;

        $this->withToken($token)->putJson('/api/platform/integrations/document_ai', $payload)
            ->assertOk()
            ->assertJsonMissingPath('data.integrations.3.configuration.providers.openai.has_api_key');
        $raw = (string) \Illuminate\Support\Facades\DB::table('platform_integration_settings')->where('integration_key', 'document_ai')->value('configuration');
        $this->assertStringNotContainsString('OPENAI-KEY-TO-CLEAR', $raw);
    }

    /** @test */
    public function the_default_network_gate_prevents_external_extraction_and_http_requests(): void
    {
        config()->set('document_center.ai.provider_network_enabled', false);
        Http::fake();
        $auth = $this->authorizedTenant('extraction-network-gate');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();
        $this->bindCleanScanner();
        $scanJob->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        Queue::assertNotPushed(ExtractDocumentFile::class);
        Http::assertNothingSent();
    }

    /** @test */
    public function clean_files_are_extracted_into_versioned_evidence_and_move_the_batch_to_review(): void
    {
        $auth = $this->authorizedTenant('extraction-success');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();

        $this->bindCleanScanner();
        $scanJob->handle(
            app(TenantContext::class),
            app(BranchContext::class),
            app(DocumentProcessingService::class),
            app(DocumentStorageService::class),
            app(DocumentSafetyScanner::class),
            app(DocumentFileScanService::class),
            app(PlatformIntegrationResolver::class),
            app(DocumentExtractionService::class),
        );

        $extractionJob = $this->queuedExtractionJob();
        Http::fake([
            'api.openai.com/*' => Http::response([
                'output_text' => json_encode($this->providerPayload('purchase_invoice'), JSON_THROW_ON_ERROR),
                'usage' => ['input_tokens' => 125, 'output_tokens' => 42],
            ]),
        ]);
        $extractionJob->handle(
            app(TenantContext::class),
            app(BranchContext::class),
            app(DocumentProcessingService::class),
            app(DocumentExtractionService::class),
        );

        $result = DocumentExtractionResult::firstOrFail();
        $this->assertSame('document-schema-v1', $result->schema_version);
        $this->assertSame('openai', $result->provider_key);
        $this->assertSame(8700, $result->confidence_basis_points);
        $this->assertSame('PI-42', $result->normalized_payload['fields']['document_number']);
        $this->assertSame(10000, $result->normalized_payload['fields']['subtotal_minor']);
        $this->assertSame(DocumentWorkflowStatus::NEEDS_REVIEW, DocumentBatch::findOrFail($batch['id'])->status);
        $this->assertDatabaseHas('document_provider_usage_events', ['provider_key' => 'openai', 'input_tokens' => 125, 'output_tokens' => 42]);
        $this->assertFalse(app(TenantContext::class)->has());
        $this->assertFalse(app(BranchContext::class)->has());
    }

    /** @test */
    public function a_failed_primary_provider_uses_the_ordered_anthropic_fallback_with_safe_attempt_evidence(): void
    {
        $setting = PlatformIntegrationSetting::query()->where('integration_key', 'document_ai')->firstOrFail();
        $configuration = $setting->configuration;
        $configuration['fallback_enabled'] = true;
        $configuration['fallback_providers'] = ['anthropic'];
        $configuration['providers']['openai']['max_attempts'] = 1;
        $configuration['providers']['anthropic']['enabled'] = true;
        $configuration['providers']['anthropic']['api_key'] = 'anthropic-test-secret';
        $configuration['providers']['anthropic']['model'] = 'claude-test';
        $configuration['providers']['anthropic']['allow_document_sending'] = true;
        $setting->configuration = $configuration;
        $setting->save();

        $auth = $this->authorizedTenant('extraction-fallback');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();
        $this->bindCleanScanner();
        $scanJob->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        Http::fake([
            'api.openai.com/*' => Http::response([], 503),
            'api.anthropic.com/*' => Http::response([
                'content' => [['type' => 'tool_use', 'input' => $this->providerPayload('purchase_invoice')]],
                'usage' => ['input_tokens' => 80, 'output_tokens' => 30],
            ]),
        ]);
        $this->queuedExtractionJob()->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentExtractionService::class));

        $attempts = DocumentProviderAttempt::query()->orderBy('sequence')->get();
        $this->assertSame(['openai', 'anthropic'], $attempts->pluck('provider_key')->all());
        $this->assertSame('failed', $attempts->first()->status);
        $this->assertSame('provider_unavailable', $attempts->first()->error_code);
        $this->assertStringNotContainsString('503', (string) $attempts->first()->error_message_safe);
        $this->assertSame('anthropic', DocumentExtractionResult::firstOrFail()->provider_key);
    }

    private function configurePlatform(): void
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
            'provider' => 'openai',
            'enabled' => true,
            'configuration' => [
                'engine_enabled' => true,
                'primary_provider' => 'openai',
                'fallback_enabled' => false,
                'fallback_providers' => [],
                'confidence_threshold_percent' => 0,
                'default_language' => 'ar',
                'max_files_per_batch' => 10,
                'max_pages_per_file' => 100,
                'max_file_size_bytes' => 10485760,
                'test_mode' => true,
                'providers' => [
                    'openai' => ['enabled' => true, 'api_key' => 'openai-test-secret', 'model' => 'gpt-test', 'connection_timeout_seconds' => 15, 'processing_timeout_seconds' => 90, 'max_attempts' => 1, 'allow_document_sending' => true],
                    'anthropic' => [],
                    'google_gemini' => [],
                ],
            ],
        ]);
    }

    private function bindCleanScanner(): void
    {
        $this->app->bind(DocumentSafetyScanner::class, fn () => new class implements DocumentSafetyScanner {
            public function scan($stream): DocumentScanStatus { return DocumentScanStatus::CLEAN; }
            public function ping(): bool { return true; }
            public function providerName(): string { return 'test-clean-scanner'; }
        });
    }

    private function queuedScanJob(): ScanDocumentFile
    {
        $job = null;
        Queue::assertPushed(ScanDocumentFile::class, function (ScanDocumentFile $queued) use (&$job): bool { $job = $queued; return true; });

        return $job;
    }

    private function queuedExtractionJob(): ExtractDocumentFile
    {
        $job = null;
        Queue::assertPushed(ExtractDocumentFile::class, function (ExtractDocumentFile $queued) use (&$job): bool { $job = $queued; return true; });

        return $job;
    }

    private function authorizedTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'document-center-pr4-test', (string) Str::uuid());

        return [...$auth, 'branch_id' => $branchId];
    }

    private function batchWithFile(string $token): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data');
        $this->withToken($token)->post("/api/document-batches/{$batch['id']}/files", ['file' => UploadedFile::fake()->createWithContent('invoice.png', $this->png)], ['Accept' => 'application/json'])->assertCreated();

        return $batch;
    }

    /** @return array<string, mixed> */
    private function providerPayload(string $documentType): array
    {
        return [
            'document_type' => $documentType,
            'language' => 'ar',
            'confidence' => '0.8700',
            'fields' => ['issuer_name' => 'مورد تجريبي', 'issuer_tax_number' => '310000000000003', 'recipient_name' => 'نبراكس', 'recipient_tax_number' => null, 'document_number' => 'PI-42', 'document_date' => '2026-08-24', 'currency' => 'SAR', 'subtotal' => '100.00', 'tax_amount' => '15.00', 'total_amount' => '115.00'],
            'lines' => [['description' => 'خدمة اختبار', 'quantity' => '1', 'unit_price' => '100.00', 'total' => '100.00', 'tax_rate' => '15%']],
            'warnings' => [],
        ];
    }

    /** @return array<string, mixed> */
    private function documentAiPayload(string $openAiKey, string $anthropicKey, string $geminiKey): array
    {
        $provider = fn (string $key, string $model): array => ['enabled' => false, 'api_key' => $key, 'clear_api_key' => false, 'model' => $model, 'connection_timeout_seconds' => 15, 'processing_timeout_seconds' => 90, 'max_attempts' => 2, 'allow_document_sending' => false, 'monthly_operation_limit' => null, 'monthly_page_limit' => null, 'data_region' => '', 'retention_policy' => ''];

        return ['enabled' => false, 'provider' => null, 'primary_provider' => null, 'fallback_enabled' => false, 'fallback_providers' => [], 'confidence_threshold_percent' => 0, 'default_language' => 'ar', 'max_files_per_batch' => 10, 'max_pages_per_file' => 100, 'max_file_size_bytes' => 10485760, 'test_mode' => true, 'providers' => ['openai' => $provider($openAiKey, 'gpt-test'), 'anthropic' => $provider($anthropicKey, 'claude-test'), 'google_gemini' => $provider($geminiKey, 'gemini-test')], 'current_password' => 'platform-password-123'];
    }

    /** @return array{\App\Models\PlatformAdministrator,string} */
    private function platformToken(array $abilities): array
    {
        $administrator = \App\Models\PlatformAdministrator::create([
            'name' => 'مدير تكاملات المنصة',
            'email' => 'pr4-integrations@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [$administrator, $administrator->createToken('platform-console', $abilities)->plainTextToken];
    }
}

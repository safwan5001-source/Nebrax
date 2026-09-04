<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Support\DocumentIntelligence;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * جاهزية الاستخراج على GET /document-governance مشتقة من منطق العمليات القائم.
 * لا سياسة ثانية، ولا أسرار مزود، ولا اقتران باحتفاظ الأصل لدى المستأجر.
 */
class DocumentGovernanceReadinessTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const GEMINI_SECRET = 'gemini-secret-should-not-leak';

    /** @test */
    public function a_locked_provider_network_gate_reports_locked_and_not_ready(): void
    {
        $auth = $this->authorizedTenant('gov-network-locked');
        $this->seedDocumentAi(engineEnabled: true, primary: 'google_gemini');
        config()->set('document_center.ai.provider_network_enabled', false);
        config()->set('queue.default', 'redis');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertTrue($readiness['provider_network_locked']);
        $this->assertTrue($readiness['platform_engine_enabled']);
        $this->assertTrue($readiness['primary_provider_ready']);
        $this->assertTrue($readiness['queue_async']);
        $this->assertFalse($readiness['ready']);
    }

    /** @test */
    public function a_configured_gemini_provider_does_not_enable_extraction_when_the_engine_is_off(): void
    {
        $auth = $this->authorizedTenant('gov-engine-off');
        $this->seedDocumentAi(engineEnabled: false, primary: 'google_gemini');
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'redis');

        $payload = $this->governance($auth['token']);
        $readiness = $payload['extraction_readiness'];

        $this->assertFalse($readiness['platform_engine_enabled']);
        $this->assertFalse($readiness['ready']);
        $this->assertSame(self::GEMINI_SECRET, PlatformIntegrationSetting::query()
            ->where('integration_key', 'document_ai')->firstOrFail()
            ->configuration['providers']['google_gemini']['api_key']);
        $this->assertStringNotContainsString(self::GEMINI_SECRET, json_encode($payload, JSON_THROW_ON_ERROR));
        $this->assertArrayNotHasKey('api_key', $readiness);
        $this->assertArrayNotHasKey('providers', $readiness);
        $this->assertArrayNotHasKey('configuration', $payload);
    }

    /** @test */
    public function a_sync_queue_is_not_ready_even_when_the_engine_is_configured(): void
    {
        $auth = $this->authorizedTenant('gov-sync-queue');
        $this->seedDocumentAi(engineEnabled: true, primary: 'google_gemini');
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'sync');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertFalse($readiness['queue_async']);
        $this->assertSame('async', $readiness['processing_mode']);
        $this->assertTrue($readiness['queue_required']);
        $this->assertTrue($readiness['worker_required']);
        $this->assertSame('offline', $readiness['worker_status']);
        $this->assertTrue($readiness['platform_engine_enabled']);
        $this->assertTrue($readiness['primary_provider_ready']);
        $this->assertFalse($readiness['ready']);
    }

    /** @test */
    public function an_async_queue_without_a_worker_heartbeat_is_not_ready(): void
    {
        $auth = $this->authorizedTenant('gov-async-no-worker');
        $this->seedDocumentAi(engineEnabled: true, primary: 'google_gemini');
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'redis');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertTrue($readiness['queue_async']);
        $this->assertSame('async', $readiness['processing_mode']);
        $this->assertSame('offline', $readiness['worker_status']);
        $this->assertFalse($readiness['ready']);
    }

    /** @test */
    public function extraction_is_ready_only_when_the_existing_operations_conjunction_is_true(): void
    {
        $auth = $this->authorizedTenant('gov-ready');
        $this->seedDocumentAi(engineEnabled: true, primary: 'google_gemini');
        $this->seedWorkerHeartbeat();
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'redis');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertFalse($readiness['provider_network_locked']);
        $this->assertTrue($readiness['platform_engine_enabled']);
        $this->assertTrue($readiness['primary_provider_ready']);
        $this->assertTrue($readiness['queue_async']);
        $this->assertSame('online', $readiness['worker_status']);
        $this->assertTrue($readiness['ready']);
    }

    /** @test */
    public function sync_processing_mode_is_ready_without_an_async_queue_or_worker(): void
    {
        $auth = $this->authorizedTenant('gov-sync-mode');
        $this->seedDocumentAi(engineEnabled: true, primary: 'google_gemini', processingMode: 'sync');
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'sync');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertSame('sync', $readiness['processing_mode']);
        $this->assertFalse($readiness['queue_async']);
        $this->assertFalse($readiness['queue_required']);
        $this->assertFalse($readiness['worker_required']);
        $this->assertSame('not_required', $readiness['worker_status']);
        $this->assertTrue($readiness['ready']);
        $this->assertArrayNotHasKey('api_key', $readiness);
        $this->assertArrayNotHasKey('providers', $readiness);
    }

    /** @test */
    public function sync_processing_mode_is_not_ready_when_the_network_gate_is_locked(): void
    {
        $auth = $this->authorizedTenant('gov-sync-locked');
        $this->seedDocumentAi(engineEnabled: true, primary: 'google_gemini', processingMode: 'sync');
        config()->set('document_center.ai.provider_network_enabled', false);
        config()->set('queue.default', 'sync');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertSame('sync', $readiness['processing_mode']);
        $this->assertTrue($readiness['provider_network_locked']);
        $this->assertFalse($readiness['ready']);
    }

    /** @test */
    public function sync_processing_mode_is_not_ready_when_the_engine_is_off(): void
    {
        $auth = $this->authorizedTenant('gov-sync-engine-off');
        $this->seedDocumentAi(engineEnabled: false, primary: 'google_gemini', processingMode: 'sync');
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'sync');

        $this->assertFalse($this->governance($auth['token'])['extraction_readiness']['ready']);
    }

    /** @test */
    public function sync_processing_mode_is_not_ready_when_the_primary_provider_is_unavailable(): void
    {
        $auth = $this->authorizedTenant('gov-sync-no-provider');
        $this->seedDocumentAi(engineEnabled: true, primary: null, processingMode: 'sync');
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'sync');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertFalse($readiness['primary_provider_ready']);
        $this->assertFalse($readiness['ready']);
    }

    /** @test */
    public function an_invalid_stored_processing_mode_fails_closed_to_async(): void
    {
        $auth = $this->authorizedTenant('gov-invalid-mode');
        $this->seedDocumentAi(engineEnabled: true, primary: 'google_gemini', processingMode: 'immediate');
        config()->set('document_center.ai.provider_network_enabled', true);
        config()->set('queue.default', 'sync');

        $readiness = $this->governance($auth['token'])['extraction_readiness'];

        $this->assertSame('async', $readiness['processing_mode']);
        $this->assertFalse($readiness['ready']);
    }

    /** @test */
    public function tenant_original_retention_does_not_imply_platform_timed_retention(): void
    {
        $auth = $this->authorizedTenant('gov-retention-decoupled');
        Settings::put(DocumentIntelligence::SETTINGS_GROUP, [
            'processing_enabled' => true,
            'allowed_document_types' => ['delivery_note'],
            'retention_mode' => DocumentIntelligence::RETENTION_DO_NOT_RETAIN,
        ]);

        $payload = $this->governance($auth['token']);

        $this->assertSame(DocumentIntelligence::RETENTION_DO_NOT_RETAIN, $payload['document_intelligence']['retention_mode']);
        $this->assertFalse($payload['document_intelligence']['retains_original_in_document_center']);
        $this->assertTrue($payload['policy']['enabled']);
        $this->assertSame(365, $payload['policy']['retention_days']);
    }

    /** @return array<string, mixed> */
    private function governance(string $token): array
    {
        return $this->withToken($token)->getJson('/api/document-governance')->assertOk()['data'];
    }

    private function seedDocumentAi(bool $engineEnabled, ?string $primary, string $processingMode = 'async'): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai',
            'provider' => $primary,
            'enabled' => $engineEnabled,
            'configuration' => [
                'engine_enabled' => $engineEnabled,
                'processing_mode' => $processingMode,
                'primary_provider' => $primary,
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
                        'api_key' => self::GEMINI_SECRET,
                        'model' => 'gemini-test',
                        'connection_timeout_seconds' => 15,
                        'processing_timeout_seconds' => 90,
                        'max_attempts' => 1,
                        'allow_document_sending' => true,
                    ],
                ],
            ],
        ]);
    }

    private function seedWorkerHeartbeat(): void
    {
        \App\Models\PlatformRuntimeHeartbeat::create([
            'component' => 'document-worker',
            'instance_id' => 'test-worker',
            'status' => 'online',
            'metadata' => ['queue' => 'documents'],
            'last_seen_at' => now('UTC'),
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
            'gov-readiness-test',
            (string) Str::uuid(),
        );

        return [...$auth, 'branch_id' => $branchId];
    }
}

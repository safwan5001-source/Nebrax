<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentProviderAttempt;
use App\Models\Partner;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationSetting;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentExtractionNormalizer;
use App\Services\DocumentCenter\DocumentExtractionService;
use App\Services\DocumentCenter\DocumentFileScanService;
use App\Services\DocumentCenter\DocumentMatchingContext;
use App\Services\DocumentCenter\DocumentMatchingService;
use App\Services\DocumentCenter\DocumentProcessingService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\EntitlementGrantService;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use App\Support\DocumentTypeCatalog;
use App\Support\DocumentWorkflowStatus;
use App\Support\Settings;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class DocumentExtractionProviderTest extends TestCase
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

        $raw = (string) DB::table('platform_integration_settings')->where('integration_key', 'document_ai')->value('configuration');
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
        $raw = (string) DB::table('platform_integration_settings')->where('integration_key', 'document_ai')->value('configuration');
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
    public function provider_connection_testing_is_network_silent_when_the_code_level_gate_is_locked(): void
    {
        config()->set('document_center.ai.provider_network_enabled', false);
        Http::fake();
        [, $token] = $this->platformToken(['platform:read', 'platform:manage']);

        $this->withToken($token)->postJson('/api/platform/integrations/document_ai/test', [
            'provider' => 'openai',
        ])->assertOk()->assertJsonPath('data.ok', false);

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
    public function google_gemini_uses_a_secret_header_and_persists_normalized_evidence_without_a_secret_url(): void
    {
        $geminiKey = 'gemini-test-secret-not-in-url';
        $setting = PlatformIntegrationSetting::query()->where('integration_key', 'document_ai')->firstOrFail();
        $configuration = $setting->configuration;
        $configuration['primary_provider'] = 'google_gemini';
        $configuration['providers']['google_gemini'] = [
            'enabled' => true,
            'api_key' => $geminiKey,
            'model' => 'gemini-test',
            'connection_timeout_seconds' => 15,
            'processing_timeout_seconds' => 90,
            'max_attempts' => 1,
            'allow_document_sending' => true,
        ];
        $setting->provider = 'google_gemini';
        $setting->configuration = $configuration;
        $setting->save();

        $auth = $this->authorizedTenant('extraction-gemini');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();
        $this->bindCleanScanner();
        $scanJob->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [[
                    'content' => ['parts' => [['text' => json_encode($this->providerPayload('purchase_invoice'), JSON_THROW_ON_ERROR)]]],
                ]],
                'usageMetadata' => ['promptTokenCount' => 77, 'candidatesTokenCount' => 19],
            ]),
        ]);
        $this->queuedExtractionJob()->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentExtractionService::class));

        $expectedUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent';
        Http::assertSent(function (Request $request) use ($geminiKey, $expectedUrl): bool {
            return $request->url() === $expectedUrl
                && $request->hasHeader('x-goog-api-key', $geminiKey)
                && ! str_contains($request->url(), $geminiKey)
                && parse_url($request->url(), PHP_URL_QUERY) === null;
        });

        $result = DocumentExtractionResult::firstOrFail();
        $this->assertSame('document-schema-v1', $result->schema_version);
        $this->assertSame('google_gemini', $result->provider_key);
        $this->assertSame(10000, $result->normalized_payload['fields']['subtotal_minor']);
        $this->assertDatabaseHas('document_provider_usage_events', ['provider_key' => 'google_gemini', 'input_tokens' => 77, 'output_tokens' => 19]);
        $raw = (string) DB::table('platform_integration_settings')->where('integration_key', 'document_ai')->value('configuration');
        $this->assertStringNotContainsString($geminiKey, $raw);
        $this->assertStringNotContainsString($geminiKey, json_encode($result->normalized_payload, JSON_THROW_ON_ERROR));
    }

    /**
     * يحرس عقد Gemini بنيوياً على الطلب الفعلي المُرسَل — لا على استجابة Http::fake
     * المصطنعة، فلا يبقى انكسار المخطط مخفياً خلفه كما حدث في الإنتاج: كل عقدة
     * `type` قيمة واحدة لا مصفوفة، `additionalProperties` غائبة تماماً، وكل عقدة
     * `array` تحمل `items`.
     *
     * @test
     */
    public function google_gemini_extraction_request_uses_a_single_type_nullable_schema_with_items_on_every_array(): void
    {
        $this->configureGeminiProvider();
        $auth = $this->authorizedTenant('extraction-gemini-schema-shape');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();
        $this->bindCleanScanner();
        $scanJob->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [['content' => ['parts' => [['text' => json_encode($this->providerPayload('purchase_invoice'), JSON_THROW_ON_ERROR)]]]]],
                'usageMetadata' => ['promptTokenCount' => 5, 'candidatesTokenCount' => 3],
            ]),
        ]);
        $this->queuedExtractionJob()->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentExtractionService::class));

        Http::assertSent(function (Request $request): bool {
            $body = $request->data();
            $this->assertSame('application/json', $body['generationConfig']['responseMimeType'] ?? null);
            $this->assertArrayHasKey('responseSchema', $body['generationConfig'] ?? []);
            $this->assertGeminiSchemaShape($body['generationConfig']['responseSchema']);

            return true;
        });
    }

    /**
     * يثبّت مصفوفة `jsonSchema()` المشتركة كما هي — يستهلكها OpenAI بوضع
     * `strict: true` (يفرض `additionalProperties: false` وتعبير القابلية للـ
     * null بمصفوفة `type`) وAnthropic (JSON Schema عادي). أي تعديل لاحق على
     * `jsonSchema()` نفسها يكسر هذا الاختبار عمداً — الإصلاح الخاص بـGemini في
     * `geminiResponseSchema()` وحدها.
     *
     * @test
     */
    public function the_shared_json_schema_still_uses_type_arrays_and_additional_properties_for_openai_and_anthropic(): void
    {
        $schema = DocumentExtractionNormalizer::jsonSchema();

        $this->assertFalse($schema['additionalProperties']);
        $this->assertSame(['string', 'null'], $schema['properties']['document_type']['type']);
        $this->assertSame(['string', 'null'], $schema['properties']['language']['type']);
        $this->assertSame(['string', 'null'], $schema['properties']['confidence']['type']);
    }

    /**
     * @test
     */
    public function gemini_response_schema_never_reintroduces_a_type_array_or_additional_properties_anywhere(): void
    {
        $this->assertGeminiSchemaShape(DocumentExtractionNormalizer::geminiResponseSchema());
    }

    /**
     * يعيد إنتاج عطل الإنتاج بالضبط: Gemini يرفض طلب الاستخراج الحقيقي
     * (400/INVALID_ARGUMENT) رغم نجاح اختبار الاتصال. يثبت أن الرمز الآمن
     * الجديد `provider_request_invalid` يُسجَّل دون تسريب نص Google الأصلي.
     *
     * @test
     */
    public function a_gemini_invalid_argument_rejection_is_classified_safely_without_leaking_the_upstream_message(): void
    {
        $this->configureGeminiProvider();
        $auth = $this->authorizedTenant('extraction-gemini-invalid-argument');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();
        $this->bindCleanScanner();
        $scanJob->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        $upstreamMessage = 'Invalid JSON payload received. Unknown name "type" at \'generation_config.response_schema.properties[0].value\': Cannot find field.';
        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'error' => ['code' => 400, 'message' => $upstreamMessage, 'status' => 'INVALID_ARGUMENT'],
            ], 400),
        ]);
        $this->queuedExtractionJob()->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentExtractionService::class));

        $attempt = DocumentProviderAttempt::firstOrFail();
        $this->assertSame('failed', $attempt->status);
        $this->assertSame('provider_request_invalid', $attempt->error_code);
        $this->assertStringNotContainsString('Unknown name', (string) $attempt->error_message_safe);
        $this->assertStringNotContainsString($upstreamMessage, (string) $attempt->error_message_safe);
        $this->assertSame(0, DocumentExtractionResult::count());
        $this->assertSame(DocumentWorkflowStatus::FAILED, DocumentBatch::findOrFail($batch['id'])->status);
    }

    /**
     * تفضيلٌ آمن: رفضٌ بلا `error.status` معروف يبقى بالرمز العام الحالي —
     * لا يتغيّر سلوك الأخطاء الآمن القائم إلا لحالة `INVALID_ARGUMENT` المصنَّفة
     * صراحةً.
     *
     * @test
     */
    public function a_gemini_rejection_without_a_recognized_google_status_keeps_the_existing_generic_safe_code(): void
    {
        $this->configureGeminiProvider();
        $auth = $this->authorizedTenant('extraction-gemini-unclassified-rejection');
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();
        $this->bindCleanScanner();
        $scanJob->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        Http::fake(['generativelanguage.googleapis.com/*' => Http::response('', 400)]);
        $this->queuedExtractionJob()->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentExtractionService::class));

        $this->assertSame('provider_request_rejected', DocumentProviderAttempt::firstOrFail()->error_code);
    }

    /** @param array<string, mixed> $schema */
    private function assertGeminiSchemaShape(array $schema, string $path = '$'): void
    {
        $this->assertArrayNotHasKey('additionalProperties', $schema, "additionalProperties must never appear in a Gemini responseSchema node ({$path}).");
        if (array_key_exists('type', $schema)) {
            $this->assertIsString($schema['type'], "Gemini responseSchema `type` must be a single string, not a union array ({$path}).");
            if ($schema['type'] === 'array') {
                $this->assertArrayHasKey('items', $schema, "A Gemini responseSchema array node must declare `items` ({$path}).");
            }
        }
        foreach (($schema['properties'] ?? []) as $name => $property) {
            if (is_array($property)) {
                $this->assertGeminiSchemaShape($property, "{$path}.properties.{$name}");
            }
        }
        if (is_array($schema['items'] ?? null)) {
            $this->assertGeminiSchemaShape($schema['items'], "{$path}.items");
        }
    }

    private function configureGeminiProvider(string $apiKey = 'gemini-test-secret'): void
    {
        $setting = PlatformIntegrationSetting::query()->where('integration_key', 'document_ai')->firstOrFail();
        $configuration = $setting->configuration;
        $configuration['primary_provider'] = 'google_gemini';
        $configuration['providers']['google_gemini'] = [
            'enabled' => true,
            'api_key' => $apiKey,
            'model' => 'gemini-test',
            'connection_timeout_seconds' => 15,
            'processing_timeout_seconds' => 90,
            'max_attempts' => 1,
            'allow_document_sending' => true,
        ];
        $setting->provider = 'google_gemini';
        $setting->configuration = $configuration;
        $setting->save();
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

    /** @test */
    public function document_matching_normalized_evidence_is_validated_idempotently_without_creating_business_records(): void
    {
        $auth = $this->authorizedTenant('matching-validation');
        Partner::create(['type' => 'supplier', 'name' => 'مورد تجريبي', 'vat_number' => '310000000000003', 'is_active' => true]);
        Product::create(['name' => 'خدمة اختبار', 'sku' => 'SERVICE-42', 'barcode' => '998877', 'unit' => 'piece', 'is_active' => true]);
        $batch = $this->batchWithFile($auth['token']);
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $this->bindCleanScanner();
        $this->queuedScanJob()->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        $payload = $this->providerPayload('purchase_invoice');
        $payload['fields']['price_includes_tax'] = false;
        $payload['lines'] = [[
            'description' => 'خدمة اختبار', 'sku' => 'SERVICE-42', 'barcode' => '998877', 'unit' => 'piece', 'quantity' => '1',
            'unit_price_minor' => 10000, 'discount_minor' => 0, 'tax_amount_minor' => 1500, 'total_minor' => 11500, 'tax_rate' => '15',
        ]];
        $payload['fields']['subtotal_minor'] = 10000;
        $payload['fields']['tax_amount_minor'] = 1500;
        $payload['fields']['total_amount_minor'] = 11500;
        Http::fake(['api.openai.com/*' => Http::response(['output_text' => json_encode($payload, JSON_THROW_ON_ERROR), 'usage' => ['input_tokens' => 11, 'output_tokens' => 7]])]);
        $this->queuedExtractionJob()->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentExtractionService::class));

        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($auth['branch_id']);
        $result = DocumentExtractionResult::firstOrFail();
        $service = app(DocumentMatchingService::class);
        try {
            $service->match($result, new DocumentMatchingContext($auth['tenant_id'], $auth['branch_id'], 'sales_invoice'));
            $this->fail('A mismatched document type must be rejected before persisting matching evidence.');
        } catch (\LogicException) {
            $this->assertDatabaseCount('document_match_results', 0);
            $this->assertDatabaseCount('document_issues', 0);
        }

        $context = new DocumentMatchingContext($auth['tenant_id'], $auth['branch_id'], 'purchase_invoice');
        $firstReport = $service->match($result, $context);
        $secondReport = $service->match($result, $context);

        $this->assertCount(3, $firstReport->results);
        $this->assertCount(3, $secondReport->results);
        $this->assertSame($firstReport->results[0]['matched_id'], $secondReport->results[0]['matched_id']);
        $this->assertDatabaseCount('document_match_results', 3);
        $this->assertDatabaseHas('document_match_results', ['document_extraction_result_id' => $result->id, 'subject_type' => 'counterparty', 'status' => 'suggested']);
        $this->assertDatabaseHas('document_match_candidates', ['strategy' => 'exact_tax_id', 'score_basis_points' => 10000]);
        $this->assertDatabaseMissing('invoices', ['tenant_id' => $auth['tenant_id']]);
        $this->assertDatabaseMissing('purchases', ['tenant_id' => $auth['tenant_id']]);
        $this->assertDatabaseMissing('journal_entries', ['tenant_id' => $auth['tenant_id']]);
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

    private function queuedScanJob(): ScanDocumentFile
    {
        $job = null;
        Queue::assertPushed(ScanDocumentFile::class, function (ScanDocumentFile $queued) use (&$job): bool {
            $job = $queued;

            return true;
        });

        return $job;
    }

    private function queuedExtractionJob(): ExtractDocumentFile
    {
        $job = null;
        Queue::assertPushed(ExtractDocumentFile::class, function (ExtractDocumentFile $queued) use (&$job): bool {
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
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'document-center-pr4-test', (string) Str::uuid());
        // بوّابة المستأجر (PR #630): تفعيل المعالجة الذكية وإتاحة كل الأنواع — الشرط
        // المسبق الجديد لوصول المستند إلى المزود. الاحتفاظ يبقى على افتراضه (مستقلّ).
        Settings::put('document_intelligence', [
            'processing_enabled' => true,
            'allowed_document_types' => DocumentTypeCatalog::all(),
        ]);

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

    /** @return array{PlatformAdministrator,string} */
    private function platformToken(array $abilities): array
    {
        $administrator = PlatformAdministrator::create([
            'name' => 'مدير تكاملات المنصة',
            'email' => 'pr4-integrations@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return [$administrator, $administrator->createToken('platform-console', $abilities)->plainTextToken];
    }
}

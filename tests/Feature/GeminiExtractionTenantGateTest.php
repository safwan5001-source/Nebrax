<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
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

/**
 * ═══════════════════════════════════════════════════════════════
 *  بوّابة المستأجر (PR #630) على مسار استخراج Gemini الحقيقي
 * ═══════════════════════════════════════════════════════════════
 *  لا يصل مستند إلى المزود إلا حين: تفعيل المعالجة الذكية للمستأجر **و** إدراج
 *  نوعه في الأنواع المسموح بها — فوق سياسة المنصة (المحرك/الشبكة/المزود). لا
 *  بوّابة استحقاق/خطة/قائمة سماح؛ كل المستأجرين مؤهّلون في هذه المرحلة.
 *
 *  ولا يتوقف الاستخراج على سياسة الاحتفاظ بالأصل، ولا يغيّرها.
 *
 *  تشغيل: php artisan test --filter=GeminiExtractionTenantGateTest
 */
class GeminiExtractionTenantGateTest extends TestCase
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
        // الاختبار وحده يفتح حارس الشبكة مع HTTP fake؛ يبقى الافتراضي false في التطبيق.
        config()->set('document_center.ai.provider_network_enabled', true);
        Queue::fake();
        $this->configureGeminiPlatform();
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** المعالجة معطّلة للمستأجر ⇒ لا يصل المستند إلى المزود، ويبقى في المركز. */
    /** @test */
    public function extraction_is_skipped_when_tenant_processing_is_disabled(): void
    {
        $auth = $this->tenant('gate-off', processingEnabled: false, allowedTypes: ['purchase_invoice', 'delivery_note']);
        Http::fake();
        $batch = $this->batchWithFile($auth['token'], 'purchase_invoice');
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();

        $this->runScan();

        Queue::assertNotPushed(ExtractDocumentFile::class);
        Http::assertNothingSent();
        // المستند لم يتعطّل: لم ينتقل إلى فشل، ولا نتيجة استخراج له.
        $this->assertNotSame(DocumentWorkflowStatus::FAILED, DocumentBatch::findOrFail($batch['id'])->status);
        $this->assertDatabaseCount('document_extraction_results', 0);
    }

    /** النوع خارج قائمة المسموح ⇒ لا استخراج، وإن كانت المعالجة مفعّلة. */
    /** @test */
    public function extraction_is_skipped_when_document_type_is_not_allowed(): void
    {
        $auth = $this->tenant('gate-type', processingEnabled: true, allowedTypes: ['purchase_invoice']);
        Http::fake();
        $batch = $this->batchWithFile($auth['token'], 'delivery_note');
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();

        $this->runScan();

        Queue::assertNotPushed(ExtractDocumentFile::class);
        Http::assertNothingSent();
        $this->assertDatabaseCount('document_extraction_results', 0);
    }

    /**
     * مفعّلة + النوع مسموح ⇒ يصل سند التسليم إلى Gemini، وتُمثَّل القيم المكتوبة
     * بخط اليد وغير المؤكّدة بأمان بلا فبركة، ثم تنتقل الحزمة إلى المراجعة.
     *
     * @test
     */
    public function allowed_delivery_note_reaches_gemini_and_represents_handwritten_uncertain_fields(): void
    {
        $auth = $this->tenant('gate-on', processingEnabled: true, allowedTypes: ['delivery_note']);
        $batch = $this->batchWithFile($auth['token'], 'delivery_note');
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $this->runScan();

        Http::fake([
            'generativelanguage.googleapis.com/*' => Http::response([
                'candidates' => [[
                    'content' => ['parts' => [['text' => json_encode($this->handwrittenDeliveryNotePayload(), JSON_THROW_ON_ERROR)]]],
                ]],
                'usageMetadata' => ['promptTokenCount' => 64, 'candidatesTokenCount' => 22],
            ]),
        ]);

        $this->queuedExtractionJob()->handle(
            app(TenantContext::class), app(BranchContext::class),
            app(DocumentProcessingService::class), app(DocumentExtractionService::class),
        );

        $result = DocumentExtractionResult::firstOrFail();
        $payload = $result->normalized_payload;
        $this->assertSame('google_gemini', $result->provider_key);
        $this->assertSame('delivery_note', $payload['document_type']);
        // القيمة المكتوبة بخط اليد محفوظة مع مصدرها وثقتها.
        $this->assertSame('DN-1507', $payload['fields']['document_number']);
        $this->assertSame('handwritten', $payload['field_evidence']['document_number']['source']);
        $this->assertSame(5500, $payload['field_evidence']['document_number']['confidence_basis_points']);
        // القيمة المفقودة (رمز العميل) لم تُفبرَك.
        $this->assertNull($payload['fields']['recipient_tax_number']);
        // السطر المكتوب بخط اليد يحمل ثقته ومصدره.
        $this->assertSame('1507', $payload['lines'][0]['quantity']);
        $this->assertSame('handwritten', $payload['lines'][0]['source']);
        // الحزمة انتقلت إلى المراجعة البشرية (لا اعتماد صامت).
        $this->assertSame(DocumentWorkflowStatus::NEEDS_REVIEW, DocumentBatch::findOrFail($batch['id'])->status);
        // لا قيد ولا حركة مخزون.
        $this->assertDatabaseMissing('journal_entries', ['tenant_id' => $auth['tenant_id']]);
        $this->assertDatabaseMissing('stock_movements', ['tenant_id' => $auth['tenant_id']]);
    }

    /** تعطيلٌ بين الجدولة والتشغيل ⇒ العامل يفشل بأمان بلا استدعاء المزود. */
    /** @test */
    public function extraction_fails_closed_when_tenant_disables_processing_after_queueing(): void
    {
        $auth = $this->tenant('gate-race', processingEnabled: true, allowedTypes: ['purchase_invoice']);
        $batch = $this->batchWithFile($auth['token'], 'purchase_invoice');
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $this->runScan();
        $extractionJob = $this->queuedExtractionJob();

        // المستأجر يعطّل المعالجة بعد الجدولة.
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('document_intelligence', ['processing_enabled' => false]);

        Http::fake();
        $extractionJob->handle(
            app(TenantContext::class), app(BranchContext::class),
            app(DocumentProcessingService::class), app(DocumentExtractionService::class),
        );

        Http::assertNothingSent();
        $this->assertDatabaseCount('document_extraction_results', 0);
        $this->assertSame(DocumentWorkflowStatus::FAILED, DocumentBatch::findOrFail($batch['id'])->status);
    }

    /** عزل الأسرار: توكن المستأجر لا يبلغ تكاملات المنصة، ولا يرى سرّ Gemini. */
    /** @test */
    public function tenant_apis_cannot_reach_platform_provider_secrets(): void
    {
        $auth = $this->tenant('gate-secrets', processingEnabled: true, allowedTypes: ['purchase_invoice']);

        // مسار تكاملات المنصة لا يقبل توكن مستأجر (يُحجب بـ 403).
        $this->withToken($auth['token'])->getJson('/api/platform/integrations')->assertForbidden();

        // إعدادات الذكاء المستندي للمستأجر لا تحوي أي مفتاح/سر مزود.
        $body = $this->withToken($auth['token'])->getJson('/api/document-intelligence-settings')->assertOk()->json();
        $encoded = json_encode($body, JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('api_key', $encoded);
        $this->assertStringNotContainsString('gemini-secret', $encoded);
    }

    // ─────────────────────────── Helpers ───────────────────────────

    private function tenant(string $slug, bool $processingEnabled, array $allowedTypes): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']), 'document_center.core',
            \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::ADDON,
            now('UTC')->subMinute(), null, 'gemini-gate-test', (string) Str::uuid(),
        );
        Settings::put('document_intelligence', [
            'processing_enabled' => $processingEnabled,
            'allowed_document_types' => $allowedTypes,
        ]);

        return [...$auth, 'branch_id' => $branchId];
    }

    private function batchWithFile(string $token, string $documentType): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => $documentType])->assertCreated()->json('data');
        $this->withToken($token)->post(
            "/api/document-batches/{$batch['id']}/files",
            ['file' => UploadedFile::fake()->createWithContent('doc.png', $this->png)],
            ['Accept' => 'application/json'],
        )->assertCreated();

        return $batch;
    }

    private function runScan(): void
    {
        $this->app->bind(DocumentSafetyScanner::class, fn () => new class implements DocumentSafetyScanner
        {
            public function scan($stream): DocumentScanStatus { return DocumentScanStatus::CLEAN; }

            public function ping(): bool { return true; }

            public function providerName(): string { return 'test-clean-scanner'; }
        });

        $job = null;
        Queue::assertPushed(ScanDocumentFile::class, function (ScanDocumentFile $queued) use (&$job): bool {
            $job = $queued;

            return true;
        });
        $job->handle(
            app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class),
            app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class),
            app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class),
        );
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

    private function configureGeminiPlatform(): void
    {
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_processing', 'provider' => 'redis', 'enabled' => true,
            'configuration' => ['max_attempts' => 3, 'timeout_seconds' => 90, 'backoff_seconds' => [30, 120, 300]],
        ]);
        PlatformIntegrationSetting::create([
            'integration_key' => 'malware_scanner', 'provider' => 'clamav_tcp', 'enabled' => true,
            'configuration' => ['host' => 'clamav.internal', 'port' => 3310, 'timeout_seconds' => 10],
        ]);
        PlatformIntegrationSetting::create([
            'integration_key' => 'document_ai', 'provider' => 'google_gemini', 'enabled' => true,
            'configuration' => [
                'engine_enabled' => true, 'primary_provider' => 'google_gemini', 'fallback_enabled' => false,
                'fallback_providers' => [], 'confidence_threshold_percent' => 0, 'default_language' => 'ar',
                'max_files_per_batch' => 10, 'max_pages_per_file' => 100, 'max_file_size_bytes' => 10485760, 'test_mode' => true,
                'providers' => [
                    'openai' => [], 'anthropic' => [],
                    'google_gemini' => ['enabled' => true, 'api_key' => 'gemini-secret-key', 'model' => 'gemini-test', 'connection_timeout_seconds' => 15, 'processing_timeout_seconds' => 90, 'max_attempts' => 1, 'allow_document_sending' => true],
                ],
            ],
        ]);
    }

    /** @return array<string, mixed> سند تسليم بخط اليد: أرقام يدوية، ومصدر متمايز، وقيمة مفقودة. */
    private function handwrittenDeliveryNotePayload(): array
    {
        return [
            'document_type' => 'delivery_note',
            'language' => 'ar',
            'confidence' => '0.4200',
            'fields' => [
                'document_number' => 'DN-1507',
                'document_number_evidence' => ['confidence' => '0.5500', 'source' => 'handwritten', 'page_number' => 1],
                'document_date' => '2026-08-24',
                'recipient_name' => 'عميل الميدان',
                'recipient_name_evidence' => ['confidence' => '0.6000', 'source' => 'mixed', 'page_number' => 1],
                // رمز العميل غير مقروء ⇒ يبقى فارغاً (لا فبركة).
                'recipient_tax_number' => null,
                'external_reference' => 'PO-88',
            ],
            'lines' => [[
                'description' => 'ديزل',
                'quantity' => '1507',
                'unit' => 'لتر',
                'confidence' => '0.4000',
                'source' => 'handwritten',
                'page_number' => 1,
            ]],
            'warnings' => ['خط يدوي منخفض الوضوح على الكمية'],
        ];
    }
}

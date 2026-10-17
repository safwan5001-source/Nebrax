<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Jobs\DocumentCenter\ExtractDocumentFile;
use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentExtractionService;
use App\Services\DocumentCenter\DocumentFileScanService;
use App\Services\DocumentCenter\DocumentProcessingService;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\EntitlementGrantService;
use App\Services\PlatformIntegrationResolver;
use App\Support\DocumentScanStatus;
use App\Support\DocumentTypeCatalog;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * مسار مركز المستندات الكامل للاختبارات (AI-07): رفع ← فحص ← استخراج بمزوّد Anthropic مُحاكى. يُستعمل في اختبارات
 * قياس الاستخراج ودورة المستند الكاملة؛ لا شبكة (Http::fake) ولا أسرار حقيقية.
 *
 * يتطلب الصنف المستعمل `InteractsWithApi` (registerTenant) و`Queue::fake()` قبل أول مساعد.
 */
trait InteractsWithDocumentPipeline
{
    private const DOC_KEY = 'sk-ant-api03-CANARY-DOC-EXTRACTION-KEY';
    private const DOC_MODEL = 'claude-doc-test-1';
    private const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

    private string $png = '';

    private function bootDocumentPipeline(): void
    {
        Storage::fake('local');
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('queue.default', 'redis');
        config()->set('document_center.ai.provider_network_enabled', true);
        Queue::fake();
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
        $this->configureAnthropicExtractionPlatform();
    }

    private function configureAnthropicExtractionPlatform(): void
    {
        PlatformIntegrationSetting::updateOrCreate(['integration_key' => 'document_processing'], ['provider' => 'redis', 'enabled' => true,
            'configuration' => ['max_attempts' => 3, 'timeout_seconds' => 90, 'backoff_seconds' => [30, 120, 300]]]);
        PlatformIntegrationSetting::updateOrCreate(['integration_key' => 'malware_scanner'], ['provider' => 'clamav_tcp', 'enabled' => true,
            'configuration' => ['host' => 'clamav.internal', 'port' => 3310, 'timeout_seconds' => 10]]);
        PlatformIntegrationSetting::updateOrCreate(['integration_key' => 'document_ai'], ['provider' => 'anthropic', 'enabled' => true, 'configuration' => [
            'engine_enabled' => true, 'primary_provider' => 'anthropic', 'fallback_enabled' => false, 'fallback_providers' => [],
            'confidence_threshold_percent' => 0, 'default_language' => 'ar', 'max_files_per_batch' => 10, 'max_pages_per_file' => 100,
            'max_file_size_bytes' => 10485760, 'test_mode' => true,
            'providers' => [
                'openai' => [], 'google_gemini' => [],
                'anthropic' => ['enabled' => true, 'api_key' => self::DOC_KEY, 'model' => self::DOC_MODEL, 'connection_timeout_seconds' => 15,
                    'processing_timeout_seconds' => 90, 'max_attempts' => 1, 'allow_document_sending' => true],
            ],
        ]]);
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

    /** @return array<string,mixed> tenant مسجَّل مع الفرع وصلاحية مركز المستندات وبوّابة المعالجة الذكية. */
    private function documentTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'doc-center-ai07-test', (string) Str::uuid());
        Settings::put('document_intelligence', ['processing_enabled' => true, 'allowed_document_types' => DocumentTypeCatalog::all()]);

        return [...$auth, 'branch_id' => $branchId];
    }

    /** @return array<string,mixed> */
    private function batchWithFile(string $token, string $type = 'purchase_invoice'): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => $type])->assertCreated()->json('data');
        $this->withToken($token)->post("/api/document-batches/{$batch['id']}/files", ['file' => UploadedFile::fake()->createWithContent('invoice.png', $this->png)], ['Accept' => 'application/json'])->assertCreated();

        return $batch;
    }

    /** يكمل الدفعة ويشغّل الفحص (نظيف) ويعيد مهمة الاستخراج المصفوفة جاهزة. */
    private function completeAndScan(string $token, array $batch): ExtractDocumentFile
    {
        $this->withToken($token)->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();
        $scanJob = $this->queuedScanJob();
        $this->bindCleanScanner();
        $scanJob->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentStorageService::class), app(DocumentSafetyScanner::class), app(DocumentFileScanService::class), app(PlatformIntegrationResolver::class), app(DocumentExtractionService::class));

        return $this->queuedExtractionJob();
    }

    private function runExtraction(ExtractDocumentFile $job): void
    {
        $job->handle(app(TenantContext::class), app(BranchContext::class), app(DocumentProcessingService::class), app(DocumentExtractionService::class));
    }

    /** @return array<string,mixed> ردّ Messages API بأداة `submit_document_extraction` (المسار القائم). */
    private function anthropicExtractionResponse(array $payload, int $in = 4200, int $out = 900): array
    {
        return ['id' => 'msg_doc', 'type' => 'message', 'role' => 'assistant', 'stop_reason' => 'tool_use',
            'content' => [['type' => 'tool_use', 'id' => 'toolu_doc', 'name' => 'submit_document_extraction', 'input' => $payload]],
            'usage' => ['input_tokens' => $in, 'output_tokens' => $out]];
    }

    /** @return array<string,mixed> */
    private function extractionPayload(string $documentType = 'purchase_invoice'): array
    {
        return [
            'document_type' => $documentType, 'language' => 'ar', 'confidence' => '0.8700',
            'fields' => ['issuer_name' => 'مورد تجريبي', 'issuer_tax_number' => '310000000000003', 'recipient_name' => 'نبراكس', 'recipient_tax_number' => null,
                'document_number' => 'PI-42', 'document_date' => '2026-08-24', 'currency' => 'SAR', 'subtotal' => '100.00', 'tax_amount' => '15.00', 'total_amount' => '115.00'],
            'lines' => [['description' => 'خدمة اختبار', 'quantity' => '1', 'unit_price' => '100.00', 'total' => '100.00', 'tax_rate' => '15%']],
            'warnings' => [],
        ];
    }
}

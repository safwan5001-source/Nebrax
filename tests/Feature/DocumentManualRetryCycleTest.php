<?php

namespace Tests\Feature;

use App\Jobs\DocumentCenter\ScanDocumentFile;
use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentFileScanExceptionAdmission;
use App\Models\DocumentGovernanceEvent;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
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

/**
 * دلالات إعادة المحاولة اليدوية: max_attempts الخاص بالمزوّد يحكم فقط ميزانية
 * محاولات الدورة الواحدة، وليس عدد ضغطات إعادة المحاولة اليدوية على مدى عمر
 * المعالجة. حدّ منفصل (document_center.processing.manual_retry_max_cycles)
 * مُشتقّ من document_governance_events يحكم دورات retry المقبولة.
 */
class DocumentManualRetryCycleTest extends TestCase
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
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** @test */
    public function an_extraction_run_that_already_exhausted_its_provider_attempt_budget_can_still_retry_and_the_budget_resets(): void
    {
        $this->configurePlatform('sync');
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('cycle-reset');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $file->fill(['scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC')])->save();
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction',
            // الدورة الأصلية استنفدت ميزانية المزوّد (max_attempts=2 في configurePlatform).
            'status' => DocumentProcessingStatus::FAILED, 'attempt_count' => 2,
            'queued_at' => now('UTC'), 'finished_at' => now('UTC'),
            'error_code' => 'extraction_failed', 'error_message_safe' => 'فشل سابق آمن.',
        ]);
        $historical = [];
        foreach ([1, 2] as $sequence) {
            $historical[] = DocumentProviderAttempt::create([
                'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id,
                'sequence' => $sequence, 'provider_key' => 'google_gemini', 'model' => 'gemini-test', 'status' => 'failed',
                'error_code' => 'provider_unavailable', 'error_message_safe' => 'خدمة Google Gemini غير متاحة مؤقتاً.',
                'page_count' => 1, 'started_at' => now('UTC'), 'finished_at' => now('UTC'),
            ]);
        }
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response($this->geminiResponse())]);

        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->fresh()->updated_at->toIso8601String(),
        ])->assertStatus(202);

        $fresh = $run->fresh();
        $this->assertSame(DocumentProcessingStatus::SUCCEEDED, $fresh->status);
        // لو لم يُعَد ضبط attempt_count لكانت 3 (2 قديمة + claim واحد) — القيمة 1 تثبت
        // أن الدورة الجديدة بدأت بميزانية محاولات خاصة بها من الصفر.
        $this->assertSame(1, $fresh->attempt_count);
        // المحاولات التاريخية باقية بلا حذف ولا تعديل — دليل تدقيق دائم.
        foreach ($historical as $attempt) {
            $this->assertSame('failed', $attempt->fresh()->status);
            $this->assertSame('provider_unavailable', $attempt->fresh()->error_code);
        }
        $this->assertSame(2, DocumentProviderAttempt::where('document_processing_run_id', $run->id)->where('status', 'failed')->count());
        $this->assertSame(1, DocumentProviderAttempt::where('document_processing_run_id', $run->id)->where('status', 'succeeded')->count());
        $this->assertDatabaseHas('document_governance_events', [
            'document_processing_run_id' => $run->id, 'action' => 'retry_queued',
        ]);
        // SYNC: التنفيذ حدث ضمن نفس الطلب — لا اعتماد على عامل خلفية لهذه الدورة.
        Queue::assertNothingPushed();
    }

    /** @test */
    public function the_manual_retry_cycle_limit_is_enforced_independently_of_provider_attempt_budget_and_a_rejected_retry_never_resets_the_counter(): void
    {
        $this->configurePlatform('sync');
        config()->set('queue.default', 'sync');
        config()->set('document_center.processing.manual_retry_max_cycles', 2);
        $auth = $this->authorizedTenant('cycle-limit');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $file->fill(['scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC')])->save();
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction',
            'status' => DocumentProcessingStatus::FAILED, 'attempt_count' => 0,
            'queued_at' => now('UTC'), 'finished_at' => now('UTC'),
            'error_code' => 'extraction_failed', 'error_message_safe' => 'فشل سابق آمن.',
        ]);
        // كل محاولة مزوّد تفشل — الدورة تبقى قابلة لإعادة محاولة يدوية أخرى من ناحية
        // ميزانية المزوّد وحدها (max_attempts=2 لم يُستنفد كاملاً)، لعزل أثر حد الدورات.
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response([], 500)]);

        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->fresh()->updated_at->toIso8601String(),
        ])->assertStatus(202);
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);

        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->fresh()->updated_at->toIso8601String(),
        ])->assertStatus(202);
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);
        $attemptCountAfterSecondCycle = $run->fresh()->attempt_count;
        $this->assertLessThan(2, $attemptCountAfterSecondCycle, 'ميزانية المزوّد داخل الدورة لم تُستنفد — الرفض التالي سببه حد الدورات فقط.');

        // الدورة الثالثة: حد إعادة المحاولة اليدوية (2) بلغ سقفه، بصرف النظر عن أن
        // ميزانية محاولات المزوّد داخل الدورة الأخيرة لم تُستهلك بالكامل.
        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->fresh()->updated_at->toIso8601String(),
        ])->assertStatus(422)->assertJsonPath('data.code', DocumentRetryService::CODE_LIMIT_REACHED);

        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);
        // الرفض لا يُعيد ضبط attempt_count — يبقى كما كان بعد الدورة الثانية بالضبط.
        $this->assertSame($attemptCountAfterSecondCycle, $run->fresh()->attempt_count);
        $this->assertSame(2, DocumentGovernanceEvent::where('document_processing_run_id', $run->id)->where('action', 'retry_queued')->count());
        $this->assertDatabaseHas('document_governance_events', [
            'document_processing_run_id' => $run->id, 'action' => 'retry_rejected', 'reason_code' => DocumentRetryService::CODE_LIMIT_REACHED,
        ]);
    }

    /** @test */
    public function a_scan_exception_admitted_pending_file_retries_through_an_exhausted_provider_budget_without_ever_becoming_fake_clean(): void
    {
        $this->configurePlatform('sync');
        PlatformIntegrationSetting::query()->where('integration_key', 'malware_scanner')->update(['enabled' => false]);
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('cycle-scan-exception');
        $this->grantScanException($auth['tenant_id']);
        [$batch, $file] = $this->batchWithFile($auth['token']);
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($auth['branch_id']);
        $this->assertTrue(app(DocumentFileScanAdmissionService::class)->authorize($file));
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction',
            'status' => DocumentProcessingStatus::FAILED, 'attempt_count' => 2,
            'queued_at' => now('UTC'), 'finished_at' => now('UTC'),
            'error_code' => 'extraction_failed', 'error_message_safe' => 'فشل سابق آمن.',
        ]);
        Http::fake(['generativelanguage.googleapis.com/*' => Http::response($this->geminiResponse())]);

        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->fresh()->updated_at->toIso8601String(),
        ])->assertStatus(202);

        $this->assertSame(DocumentProcessingStatus::SUCCEEDED, $run->fresh()->status);
        // الملف لم يتحول CLEAN مزيّفاً — يبقى PENDING محكوماً بالإسناد الثابت وحده.
        $this->assertSame(DocumentScanStatus::PENDING, $file->fresh()->scan_status);
        $this->assertSame(1, DocumentFileScanExceptionAdmission::withoutGlobalScopes()->where('document_file_id', $file->id)->count());
    }

    /** @test */
    public function an_infected_file_is_denied_by_retry_even_with_manual_cycles_remaining(): void
    {
        $this->configurePlatform('sync');
        config()->set('queue.default', 'sync');
        $auth = $this->authorizedTenant('cycle-unsafe-blocked');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $file->fill(['scan_status' => DocumentScanStatus::INFECTED])->save();
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction',
            'status' => DocumentProcessingStatus::FAILED, 'attempt_count' => 0,
            'queued_at' => now('UTC'), 'finished_at' => now('UTC'),
            'error_code' => 'extraction_failed', 'error_message_safe' => 'فشل سابق آمن.',
        ]);

        $this->withToken($auth['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->fresh()->updated_at->toIso8601String(),
        ])->assertStatus(422)->assertJsonPath('data.code', DocumentRetryService::CODE_NOT_ALLOWED);

        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);
        $this->assertSame(DocumentScanStatus::INFECTED, $file->fresh()->scan_status);
    }

    /** @test */
    public function a_safety_scan_run_that_exhausted_its_automatic_job_attempt_budget_can_still_retry_and_the_budget_resets(): void
    {
        $auth = $this->authorizedTenant('cycle-scan-stage');
        [$batch, $file] = $this->batchWithFile($auth['token']);
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'safety_scan',
            // == processingPolicy()['max_attempts'] أدناه — استنفدت الدورة الأصلية ميزانيتها.
            'status' => DocumentProcessingStatus::FAILED, 'attempt_count' => 3,
            'queued_at' => now('UTC'), 'finished_at' => now('UTC'),
            'error_code' => 'scanner_unavailable', 'error_message_safe' => 'فشل سابق آمن.',
        ]);
        $settings = \Mockery::mock(PlatformIntegrationResolver::class);
        $settings->shouldReceive('processingPolicy')->andReturn(['max_attempts' => 3, 'backoff_seconds' => [1], 'timeout_seconds' => 30]);
        $settings->shouldReceive('documentProcessingMode')->andReturn('async');
        $settings->shouldReceive('documentProcessingIsAuthoritativelyDisabled')->andReturn(false);
        $settings->shouldReceive('activeConfiguration')->with('malware_scanner')->andReturn(['enabled' => true]);
        config()->set('queue.default', 'redis');

        $result = (new DocumentRetryService($settings, app(DocumentStorageService::class), app(DocumentWorkflowService::class), app(DocumentFileScanAdmissionService::class)))
            ->retry($run, null);

        $this->assertTrue($result['accepted']);
        // Queue::fake() في setUp يمنع claim() من التنفيذ الفعلي؛ القيمة الصفرية تثبت
        // إعادة الضبط عند القبول مباشرة (لا تراكم من الدورة السابقة المستنفدة).
        $this->assertSame(0, $result['run']->attempt_count);
        Queue::assertPushed(ScanDocumentFile::class, 1);
    }

    private function configurePlatform(string $mode): void
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
                'engine_enabled' => true, 'processing_mode' => $mode, 'primary_provider' => 'google_gemini',
                'fallback_enabled' => false, 'fallback_providers' => [], 'confidence_threshold_percent' => 0,
                'default_language' => 'ar', 'max_files_per_batch' => 10, 'max_pages_per_file' => 100,
                'max_file_size_bytes' => 10485760, 'test_mode' => true,
                'providers' => [
                    'openai' => [], 'anthropic' => [],
                    'google_gemini' => [
                        'enabled' => true, 'api_key' => 'gemini-secret-key', 'model' => 'gemini-test',
                        'connection_timeout_seconds' => 15, 'processing_timeout_seconds' => 90,
                        'max_attempts' => 2, 'allow_document_sending' => true,
                    ],
                ],
            ],
        ]);
    }

    private function grantScanException(string $tenantId): PlatformDocumentFileScanException
    {
        $admin = PlatformAdministrator::create([
            'name' => 'مدير استثناء الفحص', 'email' => 'scan-exception-'.Str::uuid().'@nebrax.test', 'password' => 'platform-password-123',
        ]);

        return PlatformDocumentFileScanException::create([
            'tenant_id' => $tenantId, 'reason' => 'temporary scanner outage', 'granted_by' => $admin->id, 'granted_at' => now('UTC'),
        ]);
    }

    /** @return array{0:DocumentBatch,1:DocumentFile} */
    private function batchWithFile(string $token): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data');
        $this->withToken($token)->post("/api/document-batches/{$batch['id']}/files", [
            'file' => UploadedFile::fake()->createWithContent('invoice.png', $this->png),
        ], ['Accept' => 'application/json'])->assertCreated();

        return [DocumentBatch::findOrFail($batch['id']), DocumentFile::query()->where('document_batch_id', $batch['id'])->firstOrFail()];
    }

    private function authorizedTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'manual-retry-cycle-test', (string) Str::uuid());
        Settings::put('document_intelligence', [
            'processing_enabled' => true,
            'allowed_document_types' => DocumentTypeCatalog::all(),
        ]);

        return [...$auth, 'branch_id' => $branchId];
    }

    /** @return array<string, mixed> */
    private function geminiResponse(): array
    {
        $payload = [
            'document_type' => 'purchase_invoice', 'language' => 'ar', 'confidence' => '0.8700',
            'fields' => [
                'issuer_name' => 'مورد تجريبي', 'issuer_tax_number' => '310000000000003', 'document_number' => 'PI-42',
                'document_date' => '2026-08-24', 'currency' => 'SAR', 'subtotal' => '100.00', 'tax_amount' => '15.00', 'total_amount' => '115.00',
            ],
            'lines' => [['description' => 'خدمة اختبار', 'quantity' => '1', 'unit_price' => '100.00', 'total' => '100.00', 'tax_rate' => '15%']],
            'warnings' => [],
        ];

        return [
            'candidates' => [['content' => ['parts' => [['text' => json_encode($payload, JSON_THROW_ON_ERROR)]]]]],
            'usageMetadata' => ['promptTokenCount' => 11, 'candidatesTokenCount' => 7],
        ];
    }
}

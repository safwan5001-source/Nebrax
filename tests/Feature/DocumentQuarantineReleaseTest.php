<?php

namespace Tests\Feature;

use App\Contracts\DocumentSafetyScanner;
use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentWorkflowEvent;
use App\Models\PlatformIntegrationSetting;
use App\Models\Tenant;
use App\Services\EntitlementGrantService;
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
use Tests\TestCase;

/**
 * AWJ-HORIZON-MEDIA-STORAGE S14 — الحزمة المحجورة بسبب فشل الفحص تعود إلى RECEIVING عند نجاح
 * إعادة الفحص الرسمية لكل ملفاتها، ولا يُفرَج أبداً عن حزمة فيها ملف مصاب. وروابط التنزيل https خلف الحافة.
 */
class DocumentQuarantineReleaseTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private string $png;

    private bool $scannerDown = true;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        config()->set('queue.default', 'sync');
        Queue::fake();
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
        PlatformIntegrationSetting::create(['integration_key' => 'malware_scanner', 'provider' => 'clamav_tcp', 'enabled' => true, 'configuration' => ['host' => 'clamav.internal', 'port' => 3310, 'timeout_seconds' => 10]]);
        PlatformIntegrationSetting::create(['integration_key' => 'document_ai', 'provider' => 'google_gemini', 'enabled' => false, 'configuration' => ['processing_mode' => 'sync']]);
        $this->app->bind(DocumentSafetyScanner::class, fn () => $this->scanner());
    }

    /** @test */
    public function a_scanner_failure_quarantine_is_released_to_receiving_after_a_successful_official_retry(): void
    {
        $a = $this->tenant('qr-a');
        $batch = $this->batchWithFiles($a, [$this->png]);

        $this->assertSame(DocumentWorkflowStatus::QUARANTINED, DocumentBatch::withoutGlobalScopes()->findOrFail($batch)->status);
        $file = DocumentFile::withoutGlobalScopes()->where('document_batch_id', $batch)->firstOrFail();
        $this->assertSame(DocumentScanStatus::FAILED, $file->scan_status);
        $this->as($a)->getJson("/api/document-files/{$file->id}/download-url")->assertStatus(422);

        $this->scannerDown = false;
        $this->retry($a, $file)->assertStatus(202);

        $this->assertSame(DocumentScanStatus::CLEAN, $file->fresh()->scan_status);
        $this->assertSame(DocumentWorkflowStatus::RECEIVING, DocumentBatch::withoutGlobalScopes()->findOrFail($batch)->status);
        $this->assertTrue(DocumentWorkflowEvent::withoutGlobalScopes()
            ->where('document_batch_id', $batch)->where('event', 'quarantine_released_after_clean_rescan')->exists());
        $this->as($a)->getJson("/api/document-files/{$file->id}/download-url")->assertOk();
        // المستخدم يُكمل صراحةً: لا إكمال تلقائي.
        $this->as($a)->postJson("/api/document-batches/{$batch}/complete")->assertOk()->assertJsonPath('data.status', 'received');
    }

    /** @test */
    public function a_batch_with_an_infected_file_is_never_released_even_if_another_file_rescans_clean(): void
    {
        $a = $this->tenant('qr-b');
        $batch = $this->batchWithFiles($a, [$this->png, $this->png . $this->eicar()]);

        $files = DocumentFile::withoutGlobalScopes()->where('document_batch_id', $batch)->orderBy('created_at')->get();
        $this->assertSame(DocumentScanStatus::FAILED, $files[0]->scan_status);
        $this->assertSame(DocumentScanStatus::INFECTED, $files[1]->scan_status);

        $this->scannerDown = false;
        $this->retry($a, $files[0])->assertStatus(202);

        $this->assertSame(DocumentScanStatus::CLEAN, $files[0]->fresh()->scan_status);
        $this->assertSame(DocumentScanStatus::INFECTED, $files[1]->fresh()->scan_status);
        $this->assertSame(DocumentWorkflowStatus::QUARANTINED, DocumentBatch::withoutGlobalScopes()->findOrFail($batch)->status);
        $this->as($a)->getJson("/api/document-files/{$files[1]->id}/download-url")->assertStatus(422);
        $this->assertFalse(DocumentWorkflowEvent::withoutGlobalScopes()->where('event', 'quarantine_released_after_clean_rescan')->exists());
    }

    /** @test */
    public function download_urls_are_https_behind_the_edge_and_still_validate_on_the_scheme_the_app_sees(): void
    {
        $a = $this->tenant('qr-c');
        $this->scannerDown = false;
        $batch = $this->batchWithFiles($a, [$this->png]);
        $file = DocumentFile::withoutGlobalScopes()->where('document_batch_id', $batch)->firstOrFail();
        $this->assertSame(DocumentScanStatus::CLEAN, $file->scan_status);

        $plain = $this->as($a)->getJson("/api/document-files/{$file->id}/download-url")->assertOk()->json('url');
        $this->assertStringStartsWith('http://', $plain);

        $edge = $this->as($a)->withHeader('X-Forwarded-Proto', 'https')->getJson("/api/document-files/{$file->id}/download-url")->assertOk()->json('url');
        $this->assertStringStartsWith('https://', $edge);

        // التوقيع صالح على ما يراه التطبيق (http) رغم أن العميل استعمل https.
        $this->as($a)->get('http://' . substr($edge, strlen('https://')))->assertOk();
    }

    private function retry(array $a, DocumentFile $file)
    {
        $run = DocumentProcessingRun::withoutGlobalScopes()->where('document_file_id', $file->id)->firstOrFail();

        return $this->as($a)->postJson("/api/document-processing-runs/{$run->id}/retry", ['version' => $run->updated_at->toIso8601String()]);
    }

    /** @param list<string> $contents */
    private function batchWithFiles(array $a, array $contents): string
    {
        $batch = $this->as($a)->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data.id');
        foreach ($contents as $i => $content) {
            $this->as($a)->post("/api/document-batches/{$batch}/files", [
                'file' => UploadedFile::fake()->createWithContent("f{$i}.png", $content),
            ], ['Accept' => 'application/json'])->assertCreated();
        }
        $this->as($a)->postJson("/api/document-batches/{$batch}/complete")->assertOk();

        return $batch;
    }

    private function eicar(): string
    {
        return 'X5O!P%@AP[4\PZX54(P^)7CC)7}$' . 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
    }

    private function scanner(): DocumentSafetyScanner
    {
        $test = $this;

        return new class($test) implements DocumentSafetyScanner
        {
            public function __construct(private readonly DocumentQuarantineReleaseTest $test)
            {
            }

            public function scan($stream): DocumentScanStatus
            {
                $content = (string) stream_get_contents($stream);
                if (str_contains($content, 'EICAR-STANDARD')) {
                    return DocumentScanStatus::INFECTED;
                }
                if ($this->test->down()) {
                    throw new \RuntimeException('Malware scanner is unavailable.');
                }

                return DocumentScanStatus::CLEAN;
            }

            public function ping(): bool
            {
                return true;
            }

            public function providerName(): string
            {
                return 'test-scanner';
            }
        };
    }

    public function down(): bool
    {
        return $this->scannerDown;
    }

    private function as(array $a): static
    {
        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();

        return $this->withToken($a['token']);
    }

    /** @return array{tenant_id:string,token:string,branch_id:string} */
    private function tenant(string $slug): array
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
            'qr-test',
            (string) Str::uuid(),
        );
        app(TenantContext::class)->forget();
        app(BranchContext::class)->forget();

        return [...$auth, 'branch_id' => $branchId];
    }
}

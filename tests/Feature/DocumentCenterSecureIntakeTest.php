<?php

namespace Tests\Feature;

use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\Tenant;
use App\Services\DocumentCenter\DocumentFileScanService;
use App\Services\EntitlementGrantService;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class DocumentCenterSecureIntakeTest extends TestCase
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
        config()->set('document_center.intake.max_files_per_batch', 10);
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** @test */
    public function an_authorized_manual_upload_is_inspected_hashed_stored_privately_and_completed(): void
    {
        $auth = $this->authorizedTenant('secure-intake-a');
        $batch = $this->createBatch($auth['token'], ['source_type' => 'whatsapp']);

        $response = $this->upload($auth['token'], $batch['id'], $this->image('invoice.png'))
            ->assertCreated()
            ->assertJsonPath('data.mime_type', 'image/png')
            ->assertJsonPath('data.page_count', 1)
            ->assertJsonPath('data.scan_status', 'pending')
            ->assertJsonMissingPath('data.object_key')
            ->assertJsonMissingPath('data.sha256')
            ->json('data');

        $file = DocumentFile::findOrFail($response['id']);
        $this->assertSame(hash('sha256', $this->png), $file->sha256);
        $this->assertStringStartsWith("tenants/{$auth['tenant_id']}/branches/", $file->object_key);
        Storage::disk('local')->assertExists($file->object_key);
        $this->assertSame('manual', DocumentBatch::findOrFail($batch['id'])->source_type);
        $this->assertSame(DocumentWorkflowStatus::RECEIVING, DocumentBatch::findOrFail($batch['id'])->status);

        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")
            ->assertOk()
            ->assertJsonPath('data.status', 'received');
    }

    /** @test */
    public function duplicate_content_and_spoofed_mime_are_rejected_before_a_second_object_is_persisted(): void
    {
        $auth = $this->authorizedTenant('secure-intake-b');
        $first = $this->createBatch($auth['token']);
        $second = $this->createBatch($auth['token']);

        $this->upload($auth['token'], $first['id'], $this->image('first.png'))->assertCreated();
        $this->upload($auth['token'], $second['id'], $this->image('renamed.png'))->assertStatus(422);
        $this->upload(
            $auth['token'],
            $second['id'],
            UploadedFile::fake()->createWithContent('fake.pdf', 'this is not a pdf')
        )->assertStatus(422);

        $this->assertSame(1, DocumentFile::count());
        $this->assertCount(1, Storage::disk('local')->allFiles());
    }

    /** @test */
    public function a_valid_pdf_is_counted_and_the_page_limit_fails_closed(): void
    {
        $auth = $this->authorizedTenant('secure-intake-pdf');
        $batch = $this->createBatch($auth['token']);
        $pdf = base64_decode(
            'JVBERi0xLjQKMSAwIG9iago8PAovVHlwZSAvQ2F0YWxvZwovUGFnZXMgMiAwIFIKPj4KZW5kb2JqCjIgMCBvYmoKPDwKL1R5cGUgL1BhZ2VzCi9LaWRzIFszIDAgUl0KL0NvdW50IDEKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL1R5cGUgL1BhZ2UKL1BhcmVudCAyIDAgUgovTWVkaWFCb3ggWzAgMCA2MTIgNzkyXQovQ29udGVudHMgNCAwIFIKPj4KZW5kb2JqCjQgMCBvYmoKPDwKL0xlbmd0aCAwCj4+CnN0cmVhbQoKZW5kc3RyZWFtCmVuZG9iagp4cmVmCjAgNQowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMDkgMDAwMDAgbiAKMDAwMDAwMDA1OCAwMDAwMCBuIAowMDAwMDAwMTE1IDAwMDAwIG4gCjAwMDAwMDAyMTQgMDAwMDAgbiAKdHJhaWxlcgo8PAovU2l6ZSA1Ci9Sb290IDEgMCBSCj4+CnN0YXJ0eHJlZgoyNjQKJSVFT0YK',
            true,
        );

        $this->upload(
            $auth['token'],
            $batch['id'],
            UploadedFile::fake()->createWithContent('invoice.pdf', $pdf),
        )->assertCreated()
            ->assertJsonPath('data.mime_type', 'application/pdf')
            ->assertJsonPath('data.page_count', 1);

        config()->set('document_center.intake.max_pdf_pages', 0);
        $other = $this->createBatch($auth['token']);
        $this->upload(
            $auth['token'],
            $other['id'],
            UploadedFile::fake()->createWithContent('too-many.pdf', $pdf."\n"),
        )->assertStatus(422);
    }

    /** @test */
    public function unsafe_path_control_and_bidi_characters_are_removed_from_an_otherwise_valid_unicode_filename(): void
    {
        $auth = $this->authorizedTenant('secure-intake-safe-unicode-name');
        $batch = $this->createBatch($auth['token']);
        $unsafeName = "../مستند\u{202E}\r\nآمن.png";

        $response = $this->upload($auth['token'], $batch['id'], $this->image($unsafeName))
            ->assertCreated()
            ->json('data');

        $this->assertSame('مستندآمن.png', $response['original_name']);
        $this->assertSame('مستندآمن.png', DocumentFile::findOrFail($response['id'])->original_name);
        $this->assertStringNotContainsString("\r", $response['original_name']);
        $this->assertStringNotContainsString("\n", $response['original_name']);
        $this->assertStringNotContainsString("\u{202E}", $response['original_name']);
    }

    /** @test */
    public function pending_files_cannot_be_downloaded_and_clean_files_use_a_short_lived_signed_route(): void
    {
        $auth = $this->authorizedTenant('secure-intake-c');
        $batch = $this->createBatch($auth['token']);
        $fileId = $this->upload($auth['token'], $batch['id'], $this->image('receipt.png'))
            ->assertCreated()->json('data.id');

        $this->withToken($auth['token'])->getJson("/api/document-files/{$fileId}/download-url")
            ->assertStatus(422);

        $file = DocumentFile::findOrFail($fileId);
        app(DocumentFileScanService::class)->record($file, DocumentScanStatus::CLEAN, 'test-scanner');
        $signed = $this->withToken($auth['token'])->getJson("/api/document-files/{$fileId}/download-url")
            ->assertOk()
            ->assertJsonStructure(['url', 'expires_at']);
        $url = $signed->json('url');
        $expiresAt = CarbonImmutable::parse($signed->json('expires_at'));
        $remainingSeconds = now('UTC')->diffInSeconds($expiresAt, false);
        $this->assertGreaterThan(0, $remainingSeconds);
        $this->assertLessThanOrEqual(900, $remainingSeconds);
        $this->assertStringContainsString($fileId, (string) parse_url($url, PHP_URL_PATH));
        $this->assertStringNotContainsString($batch['id'], (string) parse_url($url, PHP_URL_PATH));
        $relative = (string) parse_url($url, PHP_URL_PATH).'?'.(string) parse_url($url, PHP_URL_QUERY);

        $download = $this->withToken($auth['token'])->get($relative)
            ->assertOk()
            ->assertHeader('Content-Type', 'image/png')
            ->assertHeader('Content-Disposition', 'attachment; filename=receipt.png')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $cacheControl = (string) $download->headers->get('Cache-Control');
        $this->assertStringContainsString('private', $cacheControl);
        $this->assertStringContainsString('no-store', $cacheControl);
        $this->assertStringContainsString('max-age=0', $cacheControl);
        $this->withToken($auth['token'])->get("/api/document-files/{$fileId}/download")
            ->assertForbidden();
    }

    /** @test */
    public function infected_or_failed_scans_fail_closed_and_quarantine_the_received_batch(): void
    {
        $auth = $this->authorizedTenant('secure-intake-d');
        $batch = $this->createBatch($auth['token']);
        $fileId = $this->upload($auth['token'], $batch['id'], $this->image('unsafe.png'))
            ->assertCreated()->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch['id']}/complete")->assertOk();

        $file = app(DocumentFileScanService::class)->record(
            DocumentFile::findOrFail($fileId),
            DocumentScanStatus::INFECTED,
            'test-scanner',
        );

        $this->assertSame(DocumentScanStatus::INFECTED, $file->scan_status);
        $this->assertSame(DocumentWorkflowStatus::QUARANTINED, DocumentBatch::findOrFail($batch['id'])->status);
        $this->withToken($auth['token'])->getJson("/api/document-files/{$fileId}/download-url")
            ->assertStatus(422);
    }

    /** @test */
    public function branch_scopes_permissions_entitlements_and_file_limits_are_enforced(): void
    {
        $a = $this->authorizedTenant('secure-intake-e');
        $batch = $this->createBatch($a['token']);
        config()->set('document_center.intake.max_files_per_batch', 1);
        $this->upload($a['token'], $batch['id'], $this->image('one.png'))->assertCreated();
        $this->upload($a['token'], $batch['id'], $this->differentImage('two.png'))->assertStatus(422);

        $b = $this->authorizedTenant('secure-intake-f');
        $this->upload($b['token'], $batch['id'], $this->differentImage('foreign.png'))->assertNotFound();

        $staffToken = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@secure-intake-e.test');
        $this->withToken($staffToken)->postJson('/api/document-batches', ['document_type' => 'expense'])
            ->assertForbidden();

        $withoutGrant = $this->registerTenant('secure-intake-no-grant', 'owner@secure-intake-no-grant.test');
        $this->withToken($withoutGrant['token'])->postJson('/api/document-batches', ['document_type' => 'expense'])
            ->assertForbidden();
    }

    private function authorizedTenant(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            $tenant,
            'document_center.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON,
            now('UTC')->subMinute(),
            null,
            'document-center-pr2-test',
            (string) Str::uuid(),
        );

        return $auth;
    }

    private function createBatch(string $token, array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/document-batches', [
            'document_type' => 'purchase_invoice',
            ...$extra,
        ])->assertCreated()->json('data');
    }

    private function upload(string $token, string $batchId, UploadedFile $file)
    {
        return $this->withToken($token)->post("/api/document-batches/{$batchId}/files", [
            'file' => $file,
        ], ['Accept' => 'application/json']);
    }

    private function image(string $name): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $this->png);
    }

    private function differentImage(string $name): UploadedFile
    {
        $bytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAAB0L9bPAAAADUlEQVR42mP8z8BQDwAFgQH/q842WQAAAABJRU5ErkJggg==', true);

        return UploadedFile::fake()->createWithContent($name, $bytes);
    }
}

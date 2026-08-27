<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentGovernanceEvent;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Services\EntitlementGrantService;
use App\Support\DocumentProcessingStatus;
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

class DocumentCenterIsolationMatrixTest extends TestCase
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
        config()->set('queue.default', 'sync');
        Queue::fake();
        $this->png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true);
    }

    /** @test */
    public function tenant_b_cannot_read_or_mutate_any_sensitive_document_center_resource_owned_by_tenant_a(): void
    {
        $a = $this->authorizedTenant('isolation-a');
        [$batch, $file] = $this->batchWithFile($a['token']);
        [$run, $result] = $this->evidenceFor($batch, $file);
        $b = $this->authorizedTenant('isolation-b');
        $this->withToken($b['token'])->getJson("/api/document-batches/{$batch->id}/review")->assertNotFound();
        $this->withToken($b['token'])->getJson("/api/document-files/{$file->id}/download-url")->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->updated_at->toIso8601String(),
        ])->assertNotFound();
        $this->withToken($b['token'])->postJson('/api/document-retention-holds', [
            'document_batch_id' => $batch->id,
            'reason_code' => 'legal_review',
        ])->assertNotFound();
        $this->withToken($b['token'])->postJson('/api/document-redactions', [
            'document_extraction_result_id' => $result->id,
            'field_path' => 'fields.document_number',
            'reason_code' => 'privacy_request',
        ])->assertNotFound();
        $this->withToken($b['token'])->getJson("/api/document-batches/{$batch->id}/diagnostics")->assertNotFound();

        $audit = $this->withToken($b['token'])->get('/api/document-audit/export')->assertOk()->streamedContent();
        $this->assertStringNotContainsString($batch->id, $audit);
        $this->assertStringNotContainsString($file->id, $audit);
        $this->assertDatabaseMissing('document_governance_events', ['document_batch_id' => $batch->id]);
        $this->assertDatabaseMissing('document_governance_events', ['document_file_id' => $file->id]);
        $this->assertDatabaseHas('document_governance_events', ['tenant_id' => $b['tenant_id'], 'action' => 'audit_exported']);
        $this->assertSame(DocumentProcessingStatus::FAILED, $run->fresh()->status);
        $this->assertDatabaseCount('journal_entries', 0);
        Queue::assertNothingPushed();
    }

    /** @test */
    public function switching_to_another_branch_cannot_turn_a_direct_document_uuid_into_cross_branch_access(): void
    {
        $a = $this->authorizedTenant('isolation-branch');
        [$batch, $file] = $this->batchWithFile($a['token']);
        [$run, $result] = $this->evidenceFor($batch, $file);
        $branchA2 = $this->withToken($a['token'])->postJson('/api/branches', ['name' => 'فرع A2'])->assertCreated()->json('data.id');
        $a2 = $this->withToken($a['token'])->withHeaders(['X-Branch-Id' => $branchA2]);
        $beforeEvents = DocumentGovernanceEvent::withoutGlobalScopes()->count();

        $a2->getJson("/api/document-batches/{$batch->id}/review")->assertNotFound();
        $a2->getJson("/api/document-files/{$file->id}/download-url")->assertNotFound();
        $a2->postJson("/api/document-processing-runs/{$run->id}/retry", [
            'version' => $run->updated_at->toIso8601String(),
        ])->assertNotFound();
        $a2->postJson('/api/document-retention-holds', [
            'document_batch_id' => $batch->id,
            'reason_code' => 'legal_review',
        ])->assertNotFound();
        $a2->postJson('/api/document-redactions', [
            'document_extraction_result_id' => $result->id,
            'field_path' => 'fields.document_number',
            'reason_code' => 'privacy_request',
        ])->assertNotFound();
        $a2->getJson("/api/document-batches/{$batch->id}/diagnostics")->assertNotFound();

        $this->assertSame($beforeEvents, DocumentGovernanceEvent::withoutGlobalScopes()->count());
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function tenant_and_platform_tokens_cannot_be_reused_across_the_separate_console_boundaries(): void
    {
        $tenant = $this->authorizedTenant('isolation-platform');
        $platform = PlatformAdministrator::create([
            'name' => 'Platform isolation admin',
            'email' => 'platform-isolation@nebrax.test',
            'password' => 'platform-password-123',
        ]);
        $platformToken = $platform->createToken('platform-read', ['platform:read'])->plainTextToken;

        $this->withToken($tenant['token'])->getJson('/api/platform/document-operations')->assertForbidden();
        $this->withToken($platformToken)->getJson('/api/document-operations')->assertForbidden();
        $this->withToken($platformToken)->getJson('/api/platform/document-operations')->assertOk();
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @return array{0:DocumentBatch,1:DocumentFile} */
    private function batchWithFile(string $token): array
    {
        $batch = $this->withToken($token)->postJson('/api/document-batches', ['document_type' => 'purchase_invoice'])->assertCreated()->json('data');
        $this->withToken($token)->post("/api/document-batches/{$batch['id']}/files", [
            'file' => UploadedFile::fake()->createWithContent('isolation.png', $this->png),
        ], ['Accept' => 'application/json'])->assertCreated();

        return [DocumentBatch::findOrFail($batch['id']), DocumentFile::query()->where('document_batch_id', $batch['id'])->firstOrFail()];
    }

    /** @return array{0:DocumentProcessingRun,1:DocumentExtractionResult} */
    private function evidenceFor(DocumentBatch $batch, DocumentFile $file): array
    {
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'stage' => 'extraction',
            'status' => DocumentProcessingStatus::FAILED,
            'attempt_count' => 0,
            'queued_at' => now('UTC'),
            'finished_at' => now('UTC'),
            'error_code' => 'safe_fixture_failure',
            'error_message_safe' => 'Safe fixture failure.',
        ]);
        $attempt = DocumentProviderAttempt::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'sequence' => 1,
            'provider_key' => 'test',
            'model' => 'test',
            'status' => 'failed',
            'page_count' => 1,
            'started_at' => now('UTC'),
            'finished_at' => now('UTC'),
        ]);

        return [$run, DocumentExtractionResult::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'test',
            'model' => 'test',
            'schema_version' => 'document-schema-v1',
            'normalized_payload' => ['schema_version' => 'document-schema-v1', 'fields' => ['document_number' => 'ISOLATION-PRIVATE'], 'lines' => []],
            'extracted_at' => now('UTC'),
        ])];
    }

    /** @return array{tenant_id:string,token:string,branch_id:string} */
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
            'pr13-isolation-test',
            (string) Str::uuid(),
        );

        return [...$auth, 'branch_id' => $branchId];
    }
}

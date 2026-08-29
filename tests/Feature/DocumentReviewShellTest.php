<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\EntitlementGrantService;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DocumentReviewShellTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function review_endpoint_returns_shell_payload_for_processing_batch_without_extraction_result(): void
    {
        $fixture = $this->processingFixture(DocumentWorkflowStatus::PROCESSING);

        $this->withToken($fixture['token'])->withHeader('X-Branch-Id', $fixture['branch_id'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->assertJsonPath('data.review_mode', 'shell')
            ->assertJsonPath('data.processing_summary.workflow_status', DocumentWorkflowStatus::PROCESSING->value)
            ->assertJsonPath('data.capabilities.review_shell', true)
            ->assertJsonPath('data.capabilities.review', false)
            ->assertJsonPath('data.fields', [])
            ->assertJsonPath('data.lines', []);
    }

    /** @test */
    public function review_endpoint_returns_shell_payload_for_failed_batch_without_extraction_result(): void
    {
        $fixture = $this->processingFixture(DocumentWorkflowStatus::FAILED);

        $this->withToken($fixture['token'])->withHeader('X-Branch-Id', $fixture['branch_id'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->assertJsonPath('data.review_mode', 'shell')
            ->assertJsonPath('data.processing_summary.workflow_status', DocumentWorkflowStatus::FAILED->value)
            ->assertJsonPath('data.processing_summary.diagnostics_url', '/documents/'.$fixture['batch']->id.'/diagnostics');
    }

    /**
     * @return array{token: string, branch_id: string, batch: DocumentBatch}
     */
    private function processingFixture(DocumentWorkflowStatus $status): array
    {
        $auth = $this->registerTenant('doc-review-shell-'.$status->value, "owner@doc-review-shell-{$status->value}.test");
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']),
            'document_center.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON,
            now('UTC')->subMinute(),
            null,
            'document-review-shell-test',
            (string) Str::uuid(),
        );

        $actor = User::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();
        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual', 'created_by' => $actor->id]);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'shell_receiving', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVED, 'shell_received', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::QUEUED, 'shell_queued', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::PROCESSING, 'shell_processing', 'user', $actor->id);
        if ($status === DocumentWorkflowStatus::FAILED) {
            $batch = $workflow->transition($batch, DocumentWorkflowStatus::FAILED, 'shell_failed', 'user', $actor->id);
        }

        $file = DocumentFile::create([
            'document_batch_id' => $batch->id,
            'storage_profile' => 'platform',
            'object_key' => "test/{$batch->id}/invoice.pdf",
            'original_name' => 'invoice.pdf',
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => str_repeat('c', 64),
            'scan_status' => DocumentScanStatus::CLEAN,
            'scanned_at' => now('UTC'),
        ]);
        DocumentProcessingRun::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'stage' => 'extraction',
            'status' => $status === DocumentWorkflowStatus::FAILED ? DocumentProcessingStatus::FAILED : DocumentProcessingStatus::RUNNING,
            'attempt_count' => 1,
            'queued_at' => now('UTC'),
            'started_at' => now('UTC'),
            'finished_at' => $status === DocumentWorkflowStatus::FAILED ? now('UTC') : null,
        ]);

        return ['token' => $auth['token'], 'branch_id' => $branchId, 'batch' => $batch->fresh()];
    }
}

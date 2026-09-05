<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Services\DocumentCenter\DocumentProcessingStatusProjector;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Tests\TestCase;

class DocumentProcessingStatusProjectorTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function a_pending_file_still_projects_safety_check_pending_while_the_batch_is_still_in_flight(): void
    {
        $this->setUpTenant('projector-in-flight');
        $projector = app(DocumentProcessingStatusProjector::class);

        foreach ([DocumentWorkflowStatus::RECEIVED, DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::PROCESSING] as $status) {
            $batch = $this->batchAt($status);
            $file = $this->pendingFile($batch);

            $result = $projector->project($batch, $file, new Collection(), true);

            $this->assertSame('safety_check_pending', $result['key'], "expected safety_check_pending while batch is {$status->value}");
        }
    }

    /** @test */
    public function a_pending_exception_admitted_file_no_longer_hides_real_progress_once_the_batch_advances(): void
    {
        $this->setUpTenant('projector-advanced');
        $projector = app(DocumentProcessingStatusProjector::class);

        $cases = [
            [DocumentWorkflowStatus::NEEDS_REVIEW, 'needs_review'],
            [DocumentWorkflowStatus::REVIEWED, 'reviewed'],
            [DocumentWorkflowStatus::READY_FOR_DRAFT, 'ready_for_draft'],
            [DocumentWorkflowStatus::DRAFT_CREATED, 'draft_created'],
        ];

        foreach ($cases as [$status, $expectedKey]) {
            $batch = $this->batchAt($status);
            $file = $this->pendingFile($batch);

            $result = $projector->project($batch, $file, new Collection(), true);

            $this->assertSame($expectedKey, $result['key'], "expected {$expectedKey} for workflow status {$status->value}, not a stale safety_check_pending");
            $this->assertNotSame('safety_check_pending', $result['key']);
        }
    }

    private function setUpTenant(string $slug): void
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
    }

    private function batchAt(DocumentWorkflowStatus $target): DocumentBatch
    {
        $batch = DocumentBatch::create(['document_type' => 'delivery_note', 'source_type' => 'manual']);
        $workflow = app(DocumentWorkflowService::class);

        $path = [
            DocumentWorkflowStatus::RECEIVING,
            DocumentWorkflowStatus::RECEIVED,
        ];
        if ($target !== DocumentWorkflowStatus::RECEIVED) {
            $path[] = DocumentWorkflowStatus::QUEUED;
        }
        if (! in_array($target, [DocumentWorkflowStatus::RECEIVED, DocumentWorkflowStatus::QUEUED], true)) {
            $path[] = DocumentWorkflowStatus::PROCESSING;
        }
        if (! in_array($target, [DocumentWorkflowStatus::RECEIVED, DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::PROCESSING], true)) {
            $path[] = DocumentWorkflowStatus::NEEDS_REVIEW;
        }
        if (in_array($target, [DocumentWorkflowStatus::REVIEWED, DocumentWorkflowStatus::READY_FOR_DRAFT], true)) {
            $path[] = $target;
        }
        if ($target === DocumentWorkflowStatus::DRAFT_CREATED) {
            $path[] = DocumentWorkflowStatus::READY_FOR_DRAFT;
            $path[] = DocumentWorkflowStatus::CREATING_DRAFT;
            $path[] = DocumentWorkflowStatus::DRAFT_CREATED;
        }

        foreach ($path as $status) {
            $batch = $workflow->transition($batch, $status, 'projector_test_transition', 'system', null);
        }

        return $batch;
    }

    private function pendingFile(DocumentBatch $batch): DocumentFile
    {
        return DocumentFile::create([
            'document_batch_id' => $batch->id,
            'storage_profile' => 'platform',
            'object_key' => "test/{$batch->id}/".uniqid('delivery-note-').'.pdf',
            'original_name' => 'delivery-note.pdf',
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => hash('sha256', uniqid('', true)),
            'scan_status' => DocumentScanStatus::PENDING,
        ]);
    }
}

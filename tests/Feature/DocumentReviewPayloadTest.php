<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
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

class DocumentReviewPayloadTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function review_payload_exposes_lines_warnings_and_processing_summary_without_raw_provider_payload(): void
    {
        $auth = $this->registerTenant('review-payload', 'owner@review-payload.test');
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
            'review-payload-test',
            (string) Str::uuid(),
        );

        $actor = User::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();
        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual', 'created_by' => $actor->id]);
        $batch = app(DocumentWorkflowService::class)->transition($batch, DocumentWorkflowStatus::NEEDS_REVIEW, 'review_payload_test', 'user', $actor->id);

        $file = DocumentFile::create([
            'document_batch_id' => $batch->id,
            'storage_profile' => 'platform',
            'object_key' => "test/{$batch->id}/invoice.pdf",
            'original_name' => 'invoice.pdf',
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => str_repeat('b', 64),
            'scan_status' => DocumentScanStatus::CLEAN,
            'scanned_at' => now('UTC'),
        ]);
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'stage' => 'extraction',
            'status' => DocumentProcessingStatus::SUCCEEDED,
            'attempt_count' => 1,
            'queued_at' => now('UTC'),
            'started_at' => now('UTC'),
            'finished_at' => now('UTC'),
        ]);
        $attempt = DocumentProviderAttempt::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'sequence' => 1,
            'provider_key' => 'test_fixture',
            'model' => 'local',
            'status' => 'succeeded',
            'page_count' => 1,
            'started_at' => now('UTC'),
            'finished_at' => now('UTC'),
        ]);
        $result = DocumentExtractionResult::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'test_fixture',
            'model' => 'local',
            'schema_version' => 1,
            'detected_document_type' => 'purchase_invoice',
            'detected_language' => 'ar',
            'confidence_basis_points' => 9400,
            'normalized_payload' => [
                'fields' => ['document_number' => 'PI-99', 'document_date' => '2026-08-24'],
                'lines' => [[
                    'description' => 'صمام صناعي',
                    'sku' => 'VAL-1',
                    'quantity' => '2',
                    'unit_price_minor' => 5000,
                    'tax_amount_minor' => 1500,
                    'total_minor' => 11500,
                    'page_number' => 1,
                    'confidence_basis_points' => 9100,
                ]],
                'warnings' => ['تنبيه اختباري من الاستخراج'],
            ],
            'extracted_at' => now('UTC'),
        ]);
        $productMatch = DocumentMatchResult::create([
            'document_batch_id' => $batch->id,
            'document_extraction_result_id' => $result->id,
            'subject_type' => 'product',
            'subject_key' => 'lines.0.product',
            'status' => 'suggested',
            'strategy' => 'sku',
            'score_basis_points' => 9000,
            'explanation_codes' => ['fixture'],
        ]);
        DocumentMatchCandidate::create([
            'document_match_result_id' => $productMatch->id,
            'candidate_type' => 'product',
            'candidate_id' => $actor->id,
            'rank' => 1,
            'score_basis_points' => 9000,
            'strategy' => 'sku',
            'explanation_codes' => ['fixture'],
            'snapshot' => ['name' => 'صمام', 'sku' => 'VAL-1', 'is_active' => true],
        ]);

        $response = $this->withToken($auth['token'])
            ->withHeader('X-Branch-Id', $branchId)
            ->getJson("/api/document-batches/{$batch->id}/review")
            ->assertOk();

        $response->assertJsonPath('data.lines.0.index', 0)
            ->assertJsonPath('data.lines.0.description', 'صمام صناعي')
            ->assertJsonPath('data.lines.0.product_match_id', $productMatch->id)
            ->assertJsonPath('data.warnings.0', 'تنبيه اختباري من الاستخراج')
            ->assertJsonPath('data.processing_summary.scan_status', DocumentScanStatus::CLEAN->value)
            ->assertJsonPath('data.processing_summary.download_available', true)
            ->assertJsonMissing(['raw_payload', 'provider_key', 'object_key']);

        $encoded = json_encode($response->json(), JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString('test_fixture', (string) $encoded);
    }
}

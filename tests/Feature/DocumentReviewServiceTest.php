<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
use App\Models\DocumentReviewAction;
use App\Models\User;
use App\Services\DocumentCenter\DocumentReviewService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Models\Tenant;
use Illuminate\Support\Str;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\DocumentCenter\StaleDocumentReviewVersion;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DocumentReviewServiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function change_confirm_and_resolve_append_audited_decisions_and_bump_the_review_version(): void
    {
        $fixture = $this->reviewFixture('review-service-decisions');
        $service = app(DocumentReviewService::class);

        $change = $service->change(
            $fixture['batch'],
            $fixture['result'],
            $fixture['version'],
            'fields.document_number',
            'PI-43',
            'تصحيح رقم الفاتورة بعد مراجعة الدليل.',
            $fixture['actor']->id,
        );
        $this->assertSame('PI-42', $change->before_value['value']);
        $this->assertSame('PI-43', $change->after_value['value']);
        $this->assertSame($fixture['version'] + 1, $change->review_version);

        $confirmed = $service->confirm(
            $fixture['match'],
            $fixture['candidate']->id,
            $fixture['version'] + 1,
            'مطابقة المورد مقبولة بعد التحقق اليدوي.',
            $fixture['actor']->id,
        );
        $this->assertSame('confirmed', $confirmed->status);
        $this->assertSame($fixture['candidate']->candidate_id, $confirmed->matched_id);

        $resolved = $service->resolve(
            $fixture['issue'],
            $fixture['version'] + 2,
            'التحذير موثق ولا يمنع الاستمرار.',
            $fixture['actor']->id,
        );
        $this->assertSame('resolved', $resolved->status);
        $this->assertSame($fixture['actor']->id, $resolved->resolved_by);

        $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'version' => $fixture['version'] + 3]);
        $this->assertSame(3, DocumentReviewAction::query()->where('document_batch_id', $fixture['batch']->id)->count());
        $this->assertDatabaseHas('document_review_actions', ['action' => 'change', 'actor_id' => $fixture['actor']->id, 'review_version' => $fixture['version'] + 1]);
        $this->assertDatabaseHas('document_review_actions', ['action' => 'match_confirmed', 'actor_id' => $fixture['actor']->id, 'review_version' => $fixture['version'] + 2]);
        $this->assertDatabaseHas('document_review_actions', ['action' => 'issue_resolved', 'actor_id' => $fixture['actor']->id, 'review_version' => $fixture['version'] + 3]);
    }

    /** @test */
    public function review_service_rejects_stale_versions_inactive_candidates_and_invalid_edit_values(): void
    {
        $fixture = $this->reviewFixture('review-service-guards', false);
        $service = app(DocumentReviewService::class);

        try {
            $service->change(
                $fixture['batch'],
                $fixture['result'],
                $fixture['version'] - 1,
                'fields.document_number',
                'PI-43',
                'اختبار تعارض النسخة.',
                $fixture['actor']->id,
            );
            $this->fail('A stale review version must be rejected.');
        } catch (StaleDocumentReviewVersion) {
            $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'version' => $fixture['version']]);
        }

        foreach ([
            // subtotal_minor ليس ضمن EDITABLE إطلاقاً — على النقيض من
            // issuer_name/recipient_name اللذين أصبحا قابلين للتعديل صراحةً.
            ['target' => 'fields.subtotal_minor', 'value' => 'غير مسموح'],
            ['target' => 'lines.0.unit_price_minor', 'value' => '100.25'],
        ] as $invalid) {
            try {
                $service->change(
                    $fixture['batch'],
                    $fixture['result'],
                    $fixture['version'],
                    $invalid['target'],
                    $invalid['value'],
                    'اختبار قيد قيمة المراجعة.',
                    $fixture['actor']->id,
                );
                $this->fail('Invalid review edits must be rejected.');
            } catch (ValidationException) {
                $this->assertDatabaseCount('document_review_changes', 0);
            }
        }
    }

    /** @test */
    public function review_service_rejects_inactive_candidates_without_mutating_the_match_or_version(): void
    {
        $fixture = $this->reviewFixture('review-service-inactive', false);

        try {
            app(DocumentReviewService::class)->confirm(
                $fixture['match'],
                $fixture['candidate']->id,
                $fixture['version'],
                'محاولة تأكيد مرشح معطل.',
                $fixture['actor']->id,
            );
            $this->fail('Inactive candidates must not be confirmable.');
        } catch (ValidationException) {
            $this->assertDatabaseHas('document_match_results', ['id' => $fixture['match']->id, 'status' => 'suggested']);
            $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'version' => $fixture['version']]);
            $this->assertDatabaseCount('document_review_actions', 0);
        }
    }

    /** @test */
    public function financial_revalidation_closes_only_a_recomputed_tax_issue_then_allows_audited_idempotent_completion(): void
    {
        $fixture = $this->reviewFixture('review-service-financial-path', true, true);
        $service = app(DocumentReviewService::class);
        $taxIssue = DocumentIssue::create([
            'document_batch_id' => $fixture['batch']->id,
            'document_extraction_result_id' => $fixture['result']->id,
            'subject_key' => 'header.tax_amount_minor',
            'code' => 'tax_total_mismatch',
            'severity' => 'blocking',
            'status' => 'open',
            'safe_message' => 'إجمالي الضريبة لا يطابق مجموع السطور.',
        ]);

        try {
            $service->resolve($taxIssue, $fixture['version'], 'لا يجوز إخفاء الفشل المالي يدويًا.', $fixture['actor']->id);
            $this->fail('Blocking tax issues require revalidation.');
        } catch (ValidationException) {
            $this->assertDatabaseHas('document_issues', ['id' => $taxIssue->id, 'status' => 'open']);
        }

        $service->change($fixture['batch'], $fixture['result'], $fixture['version'], 'lines.0.tax_amount_minor', 1500, 'تصحيح ضريبة السطر من الدليل.', $fixture['actor']->id);
        $service->change($fixture['batch'], $fixture['result'], $fixture['version'] + 1, 'lines.0.total_minor', 11500, 'تصحيح إجمالي السطر من الدليل.', $fixture['actor']->id);
        $service->revalidateFinancial($fixture['batch'], $fixture['result'], $fixture['version'] + 2, 'إعادة تحقق مالي بعد تصحيح القيم.', $fixture['actor']->id);
        $this->assertDatabaseHas('document_issues', ['id' => $taxIssue->id, 'status' => 'resolved', 'resolved_by' => $fixture['actor']->id]);
        $this->assertDatabaseHas('document_review_actions', ['action' => 'financial_revalidated', 'reason' => 'إعادة تحقق مالي بعد تصحيح القيم.', 'review_version' => $fixture['version'] + 3]);

        $matches = [$fixture['match']];
        foreach ([['lines.0.product', 'product'], ['lines.0.unit', 'unit']] as [$key, $type]) {
            $match = DocumentMatchResult::create([
                'document_batch_id' => $fixture['batch']->id,
                'document_extraction_result_id' => $fixture['result']->id,
                'subject_type' => $type,
                'subject_key' => $key,
                'status' => 'suggested',
                'strategy' => 'fixture',
                'score_basis_points' => 9000,
                'explanation_codes' => ['fixture'],
            ]);
            DocumentMatchCandidate::create([
                'document_match_result_id' => $match->id,
                'candidate_type' => $type,
                'candidate_id' => $fixture['actor']->id,
                'rank' => 1,
                'score_basis_points' => 9000,
                'strategy' => 'fixture',
                'explanation_codes' => ['fixture'],
                'snapshot' => ['name' => "{$type} fixture", 'is_active' => true],
            ]);
            $matches[] = $match;
        }
        $version = $fixture['version'] + 3;
        foreach ($matches as $match) {
            $candidateId = $match->candidates()->value('id');
            $service->confirm($match, $candidateId, $version++, 'تأكيد مطابقات الإكمال.', $fixture['actor']->id);
        }

        $completed = $service->complete($fixture['batch'], $fixture['result'], $version, 'اكتملت مراجعة الفاتورة بعد إعادة التحقق المالي.', $fixture['actor']->id);
        $this->assertSame(DocumentWorkflowStatus::READY_FOR_DRAFT, $completed->status);
        $this->assertDatabaseHas('document_review_actions', ['action' => 'review_completed', 'actor_id' => $fixture['actor']->id, 'reason' => 'اكتملت مراجعة الفاتورة بعد إعادة التحقق المالي.', 'review_version' => $version + 1]);
        $events = \App\Models\DocumentWorkflowEvent::query()->where('document_batch_id', $fixture['batch']->id)->count();
        $actions = DocumentReviewAction::query()->where('document_batch_id', $fixture['batch']->id)->where('action', 'review_completed')->count();
        $again = $service->complete($completed, $fixture['result'], 1, 'سبب لا ينبغي تسجيله مرة ثانية.', $fixture['actor']->id);
        $this->assertSame(DocumentWorkflowStatus::READY_FOR_DRAFT, $again->status);
        $this->assertSame($events, \App\Models\DocumentWorkflowEvent::query()->where('document_batch_id', $fixture['batch']->id)->count());
        $this->assertSame($actions, DocumentReviewAction::query()->where('document_batch_id', $fixture['batch']->id)->where('action', 'review_completed')->count());
    }

    /** @test */
    public function complete_review_endpoint_requires_reason_before_mutating_workflow(): void
    {
        $auth = $this->registerTenant('review-complete-reason', 'owner@review-complete-reason.test');
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'review-reason-test', (string) Str::uuid());
        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual']);

        $this->withToken($auth['token'])->postJson("/api/document-batches/{$batch->id}/complete-review", ['expected_version' => 1], ['X-Branch-Id' => $branchId])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['reason']);
        $this->assertDatabaseHas('document_batches', ['id' => $batch->id, 'status' => DocumentWorkflowStatus::DRAFT->value, 'version' => 1]);
    }

    /** @test */
    public function completion_rejects_incomplete_review_evidence_without_creating_business_transactions(): void
    {
        $fixture = $this->reviewFixture('review-service-readiness', false);

        try {
            app(DocumentReviewService::class)->complete(
                $fixture['batch'],
                $fixture['result'],
                $fixture['version'],
                'لا يمكن الإكمال قبل اكتمال دليل المطابقة والتحقق المالي.',
                $fixture['actor']->id,
            );
            $this->fail('Incomplete evidence must not become ready for draft.');
        } catch (ValidationException) {
            $this->assertDatabaseHas('document_batches', [
                'id' => $fixture['batch']->id,
                'status' => DocumentWorkflowStatus::NEEDS_REVIEW->value,
                'version' => $fixture['version'],
            ]);
            $this->assertDatabaseCount('document_review_actions', 0);
            $this->assertDatabaseMissing('invoices', ['tenant_id' => $fixture['batch']->tenant_id]);
            $this->assertDatabaseMissing('purchases', ['tenant_id' => $fixture['batch']->tenant_id]);
            $this->assertDatabaseMissing('journal_entries', ['tenant_id' => $fixture['batch']->tenant_id]);
        }
    }

    /**
     * @return array{batch: DocumentBatch, result: DocumentExtractionResult, match: DocumentMatchResult, candidate: DocumentMatchCandidate, issue: DocumentIssue, actor: User, version: int}
     */
    private function reviewFixture(string $slug, bool $activeCandidate = true, bool $financialMismatch = false): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $branchId = Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branchId);
        $actor = User::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();

        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual', 'created_by' => $actor->id]);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'review_test_receiving', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVED, 'review_test_received', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::NEEDS_REVIEW, 'review_test_needs_review', 'user', $actor->id);

        $file = DocumentFile::create([
            'document_batch_id' => $batch->id,
            'storage_profile' => 'platform',
            'object_key' => "test/{$batch->id}/invoice.pdf",
            'original_name' => 'invoice.pdf',
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => str_repeat('a', 64),
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
                'fields' => ['document_number' => 'PI-42', 'document_date' => '2026-08-24', 'currency' => 'SAR', 'price_includes_tax' => false, 'subtotal_minor' => 10000, 'tax_amount_minor' => 1500, 'total_amount_minor' => 11500],
                'lines' => [['quantity' => '1', 'unit_price_minor' => 10000, 'discount_minor' => 0, 'tax_amount_minor' => $financialMismatch ? 0 : 1500, 'total_minor' => $financialMismatch ? 10000 : 11500, 'tax_rate' => '15']],
            ],
            'extracted_at' => now('UTC'),
        ]);
        $match = DocumentMatchResult::create([
            'document_batch_id' => $batch->id,
            'document_extraction_result_id' => $result->id,
            'subject_type' => 'header',
            'subject_key' => 'header.counterparty',
            'status' => 'suggested',
            'strategy' => 'exact_name',
            'score_basis_points' => 9400,
            'explanation_codes' => ['fixture'],
        ]);
        $candidate = DocumentMatchCandidate::create([
            'document_match_result_id' => $match->id,
            'candidate_type' => 'partner',
            'candidate_id' => $actor->id,
            'rank' => 1,
            'score_basis_points' => 9400,
            'strategy' => 'exact_name',
            'explanation_codes' => ['fixture'],
            'snapshot' => ['name' => 'مورد اختباري', 'is_active' => $activeCandidate],
        ]);
        $issue = DocumentIssue::create([
            'document_batch_id' => $batch->id,
            'document_extraction_result_id' => $result->id,
            'subject_key' => 'header.purchase_order',
            'code' => 'missing_purchase_order',
            'severity' => 'warning',
            'status' => 'open',
            'safe_message' => 'لا يوجد رقم أمر شراء في دليل المستند.',
        ]);

        return ['batch' => $batch, 'result' => $result, 'match' => $match, 'candidate' => $candidate, 'issue' => $issue, 'actor' => $actor, 'version' => $batch->version];
    }
}

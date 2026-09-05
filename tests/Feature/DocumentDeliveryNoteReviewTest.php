<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
use App\Models\DocumentReviewAction;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DocumentCenter\DocumentReviewService;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\EntitlementGrantService;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\DocumentWorkflowStatusGroup;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DocumentDeliveryNoteReviewTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function a_valid_delivery_note_review_completes_to_reviewed_not_ready_for_draft(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-complete');

        $completed = app(DocumentReviewService::class)->complete(
            $fixture['batch'],
            $fixture['result'],
            $fixture['version'],
            'اكتملت مراجعة سند التسليم.',
            $fixture['actor']->id,
        );

        $this->assertSame(DocumentWorkflowStatus::REVIEWED, $completed->status);
        $this->assertDatabaseHas('document_batches', [
            'id' => $fixture['batch']->id,
            'status' => DocumentWorkflowStatus::REVIEWED->value,
        ]);
        $this->assertDatabaseHas('document_review_actions', [
            'document_batch_id' => $fixture['batch']->id,
            'action' => 'review_completed',
        ]);
    }

    /** @test */
    public function document_number_absence_alone_does_not_block_delivery_note_completion(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-no-number', documentNumber: null);

        $completed = app(DocumentReviewService::class)->complete(
            $fixture['batch'],
            $fixture['result'],
            $fixture['version'],
            'رقم المستند غير متاح، بقية الدليل مكتملة.',
            $fixture['actor']->id,
        );

        $this->assertSame(DocumentWorkflowStatus::REVIEWED, $completed->status);
    }

    /** @test */
    public function missing_delivery_date_rejects_completion_safely(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-no-date', documentDate: null);

        $this->assertReadinessRejected($fixture, 'missing delivery date');
    }

    /** @test */
    public function missing_both_issuer_and_recipient_rejects_completion_safely(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-no-party', issuerName: null, recipientName: null);

        $this->assertReadinessRejected($fixture, 'missing both parties');
    }

    /** @test */
    public function zero_lines_rejects_delivery_note_completion_safely(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-no-lines', lines: []);

        $this->assertReadinessRejected($fixture, 'zero lines');
    }

    /** @test */
    public function a_line_missing_quantity_rejects_delivery_note_completion_safely(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-no-qty', lines: [
            ['description' => 'صندوق أدوات', 'unit' => 'piece'],
        ]);

        $this->assertReadinessRejected($fixture, 'line missing quantity');
    }

    /** @test */
    public function completing_a_delivery_note_review_creates_no_accounting_inventory_or_master_data_records(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-no-side-effects');

        app(DocumentReviewService::class)->complete(
            $fixture['batch'],
            $fixture['result'],
            $fixture['version'],
            'اكتملت المراجعة دون أي أثر محاسبي أو مخزني.',
            $fixture['actor']->id,
        );

        $tenantId = $fixture['batch']->tenant_id;
        $this->assertDatabaseMissing('invoices', ['tenant_id' => $tenantId]);
        $this->assertDatabaseMissing('purchases', ['tenant_id' => $tenantId]);
        $this->assertDatabaseMissing('expenses', ['tenant_id' => $tenantId]);
        $this->assertDatabaseMissing('journal_entries', ['tenant_id' => $tenantId]);
        $this->assertDatabaseMissing('stock_movements', ['tenant_id' => $tenantId]);
        $this->assertDatabaseMissing('document_transaction_links', ['document_batch_id' => $fixture['batch']->id]);
    }

    /** @test */
    public function reviewed_belongs_to_the_completed_status_group_not_ready(): void
    {
        $this->assertContains('reviewed', DocumentWorkflowStatusGroup::statusesFor('completed'));
        $this->assertNotContains('reviewed', DocumentWorkflowStatusGroup::statusesFor('ready'));
    }

    /** @test */
    public function delivery_note_review_hides_invoice_only_fields_and_purchase_order_number_even_when_extracted(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-presentation');

        $review = $this->withToken($fixture['token'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->json('data');

        $fieldKeys = array_column($review['fields'], 'key');
        $this->assertContains('document_number', $fieldKeys);
        $this->assertContains('document_date', $fieldKeys);
        $this->assertContains('issuer_name', $fieldKeys);
        $this->assertNotContains('purchase_order_number', $fieldKeys);
        $this->assertNotContains('currency', $fieldKeys);
        $this->assertNotContains('subtotal_minor', $fieldKeys);
        $this->assertNotContains('tax_amount_minor', $fieldKeys);
        $this->assertNotContains('total_amount_minor', $fieldKeys);

        $lineFieldKeys = array_column($review['lines'][0]['fields'], 'key');
        $this->assertContains('description', $lineFieldKeys);
        $this->assertContains('quantity', $lineFieldKeys);
        $this->assertNotContains('unit_price_minor', $lineFieldKeys);
        $this->assertNotContains('total_minor', $lineFieldKeys);
    }

    /** @test */
    public function purchase_invoice_review_still_shows_the_full_field_set_unchanged(): void
    {
        $auth = $this->registerTenant('purchase-invoice-presentation-unchanged', 'owner@purchase-invoice-presentation-unchanged.test');
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
            'delivery-note-review-test-regression',
            (string) Str::uuid(),
        );
        $actor = User::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();
        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual', 'created_by' => $actor->id]);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'receiving', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVED, 'received', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::NEEDS_REVIEW, 'needs_review', 'user', $actor->id);
        $file = DocumentFile::create([
            'document_batch_id' => $batch->id, 'storage_profile' => 'platform', 'object_key' => "test/{$batch->id}/invoice.pdf",
            'original_name' => 'invoice.pdf', 'declared_mime' => 'application/pdf', 'detected_mime' => 'application/pdf',
            'size_bytes' => 128, 'page_count' => 1, 'sha256' => str_repeat('e', 64), 'scan_status' => DocumentScanStatus::CLEAN, 'scanned_at' => now('UTC'),
        ]);
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction', 'status' => DocumentProcessingStatus::SUCCEEDED,
            'attempt_count' => 1, 'queued_at' => now('UTC'), 'started_at' => now('UTC'), 'finished_at' => now('UTC'),
        ]);
        $attempt = DocumentProviderAttempt::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'sequence' => 1,
            'provider_key' => 'test_fixture', 'model' => 'local', 'status' => 'succeeded', 'page_count' => 1, 'started_at' => now('UTC'), 'finished_at' => now('UTC'),
        ]);
        DocumentExtractionResult::create([
            'document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id,
            'document_provider_attempt_id' => $attempt->id, 'provider_key' => 'test_fixture', 'model' => 'local', 'schema_version' => 1,
            'detected_document_type' => 'purchase_invoice', 'detected_language' => 'ar', 'confidence_basis_points' => 9400,
            'normalized_payload' => [
                'fields' => ['document_number' => 'PI-1', 'purchase_order_number' => 'PO-1', 'currency' => 'SAR', 'subtotal_minor' => 100, 'tax_amount_minor' => 15, 'total_amount_minor' => 115],
                'lines' => [['description' => 'صنف', 'quantity' => '1', 'unit_price_minor' => 100, 'total_minor' => 100]],
            ],
            'extracted_at' => now('UTC'),
        ]);

        $review = $this->withToken($auth['token'])
            ->getJson("/api/document-batches/{$batch->id}/review")
            ->assertOk()
            ->json('data');

        $fieldKeys = array_column($review['fields'], 'key');
        $this->assertContains('purchase_order_number', $fieldKeys);
        $this->assertContains('currency', $fieldKeys);
        $this->assertContains('subtotal_minor', $fieldKeys);
        $lineFieldKeys = array_column($review['lines'][0]['fields'], 'key');
        $this->assertContains('unit_price_minor', $lineFieldKeys);
        $this->assertContains('total_minor', $lineFieldKeys);
    }

    private function assertReadinessRejected(array $fixture, string $because): void
    {
        try {
            app(DocumentReviewService::class)->complete(
                $fixture['batch'],
                $fixture['result'],
                $fixture['version'],
                'محاولة إكمال مراجعة دليل ناقص.',
                $fixture['actor']->id,
            );
            $this->fail("Incomplete delivery note evidence ({$because}) must not complete review.");
        } catch (ValidationException) {
            $this->assertDatabaseHas('document_batches', [
                'id' => $fixture['batch']->id,
                'status' => DocumentWorkflowStatus::NEEDS_REVIEW->value,
                'version' => $fixture['version'],
            ]);
            $this->assertDatabaseCount('document_review_actions', 0);
        }
    }

    /**
     * @return array{batch: DocumentBatch, result: DocumentExtractionResult, actor: User, version: int}
     */
    private function deliveryNoteFixture(
        string $slug,
        ?string $documentNumber = 'DN-77',
        ?string $documentDate = '2026-08-24',
        ?string $issuerName = 'مورد تجريبي',
        ?string $recipientName = null,
        ?array $lines = null,
    ): array {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
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
            'delivery-note-review-test',
            (string) Str::uuid(),
        );
        $actor = User::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();

        $batch = DocumentBatch::create(['document_type' => 'delivery_note', 'source_type' => 'manual', 'created_by' => $actor->id]);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'review_test_receiving', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVED, 'review_test_received', 'user', $actor->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::NEEDS_REVIEW, 'review_test_needs_review', 'user', $actor->id);

        $file = DocumentFile::create([
            'document_batch_id' => $batch->id,
            'storage_profile' => 'platform',
            'object_key' => "test/{$batch->id}/delivery-note.pdf",
            'original_name' => 'delivery-note.pdf',
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => str_repeat('c', 64),
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
            'detected_document_type' => 'delivery_note',
            'detected_language' => 'ar',
            'confidence_basis_points' => 9200,
            'normalized_payload' => [
                'fields' => [
                    'document_number' => $documentNumber,
                    'document_date' => $documentDate,
                    'issuer_name' => $issuerName,
                    'recipient_name' => $recipientName,
                    // حقولٌ فوترية بحتة — يجب أن تختفي من عرض سند التسليم مهما
                    // احتوت الاستخراجَ الخام، فلا يكفي غيابها ليثبت التصفية.
                    'purchase_order_number' => 'PO-9001',
                    'currency' => 'SAR',
                    'subtotal_minor' => 10000,
                    'tax_amount_minor' => 1500,
                    'total_amount_minor' => 11500,
                ],
                'lines' => $lines ?? [
                    ['description' => 'صندوق أدوات', 'unit' => 'piece', 'quantity' => '2', 'unit_price_minor' => 5000, 'total_minor' => 10000],
                ],
            ],
            'extracted_at' => now('UTC'),
        ]);

        return ['batch' => $batch, 'result' => $result, 'actor' => $actor, 'version' => $batch->version, 'token' => $auth['token']];
    }
}

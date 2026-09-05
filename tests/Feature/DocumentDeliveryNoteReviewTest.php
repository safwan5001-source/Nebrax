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
use App\Services\DocumentCenter\DocumentReviewReadinessPolicy;
use App\Services\DocumentCenter\DocumentReviewService;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\DocumentCenter\ReviewedDocumentProjector;
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
    public function document_number_is_now_required_and_its_absence_blocks_completion(): void
    {
        // قرار المالك النهائي: رقم السند أصبح إلزامياً (لم يعد اختيارياً كما
        // كان في التصميم السابق) — من الخمسة المطلوبة صراحة.
        $fixture = $this->deliveryNoteFixture('delivery-note-no-number', documentNumber: null);

        $this->assertReadinessRejected($fixture, 'missing document number');
    }

    /** @test */
    public function missing_delivery_date_rejects_completion_safely(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-no-date', documentDate: null);

        $this->assertReadinessRejected($fixture, 'missing delivery date');
    }

    /** @test */
    public function an_issuer_name_alone_never_satisfies_the_customer_requirement(): void
    {
        // نبراس الطموح هو المُصدِر المعتاد لهذه المستندات؛ قبول issuer_name
        // بديلاً عن recipient_name كان سيمرّر الجاهزية دون استخراج/مراجعة
        // العميل الحقيقي أصلاً. issuer_name يبقى دليلاً معروضاً وقابلاً
        // للتعديل، لكنه لا يُرضي شرط العميل مهما كان موجوداً.
        $fixture = $this->deliveryNoteFixture('delivery-note-issuer-only', issuerName: 'نبراس الطموح', recipientName: null);

        $this->assertReadinessRejected($fixture, 'issuer present but recipient missing');
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
    public function a_zero_or_negative_or_non_numeric_quantity_never_satisfies_readiness(): void
    {
        // مستأجرٌ واحد يُعاد استخدامه لكل الحالات — حدّ `register` (3 بالدقيقة
        // لكل IP) لا يتحمّل تسجيلاً منفصلاً لكل قيمة كمية غير صالحة.
        $auth = $this->registerTenant('delivery-note-bad-qty', 'owner@delivery-note-bad-qty.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set(Branch::query()->where('tenant_id', $auth['tenant_id'])->value('id'));
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL,
            EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'delivery-note-review-test', (string) Str::uuid(),
        );
        $actor = User::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();

        $cases = ['zero' => '0', 'negative' => '-5', 'non-numeric' => 'غير مقروء', 'empty-string' => ''];
        foreach ($cases as $label => $badQuantity) {
            $fixture = $this->deliveryNoteResult($actor, lines: [
                ['description' => 'ديزل', 'quantity' => $badQuantity],
            ]);

            $this->assertReadinessRejected($fixture, "non-positive quantity ({$label})");
        }
    }

    /** @test */
    public function signature_stamp_and_noise_lines_without_a_quantity_never_satisfy_readiness_even_when_a_description_exists(): void
    {
        // الوصف موجود (الـ normalizer لا يحذف السطر) لكنه لا يحمل كميةً حقيقية
        // — يجب ألا يُرقّى ضجيجٌ كهذا إلى دليل تجاري صالح لتمرير الجاهزية.
        $fixture = $this->deliveryNoteFixture('delivery-note-noise-only', lines: [
            ['description' => 'توقيع المستلم'],
            ['description' => 'ختم الشركة'],
        ]);

        $this->assertReadinessRejected($fixture, 'noise lines with no quantity');
    }

    /** @test */
    public function a_quantity_only_line_with_no_description_satisfies_readiness_and_is_never_silently_discarded(): void
    {
        // سطر بلا وصف (منتج هذا التدفق ثابت = ديزل) يجب أن ينجو من التطبيع
        // ويُرضي شرط الكمية — لا حذف صامت ولا رفض بسبب غياب وصف لا معنى له هنا.
        $fixture = $this->deliveryNoteFixture('delivery-note-qty-only-line', lines: [
            ['description' => null, 'quantity' => '4000'],
        ]);

        $completed = app(DocumentReviewService::class)->complete(
            $fixture['batch'],
            $fixture['result'],
            $fixture['version'],
            'سطر بكمية فقط بلا وصف — يكتمل بلا مشكلة.',
            $fixture['actor']->id,
        );

        $this->assertSame(DocumentWorkflowStatus::REVIEWED, $completed->status);
        $this->assertSame('4000', $fixture['result']->fresh()->normalized_payload['lines'][0]['quantity']);
        $this->assertNull($fixture['result']->fresh()->normalized_payload['lines'][0]['description']);
    }

    /** @test */
    public function a_noise_line_coexisting_with_a_real_quantity_line_does_not_block_completion_and_remains_visible(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-noise-plus-real', lines: [
            ['description' => 'توقيع المستلم'],
            ['quantity' => '1500'],
        ]);

        $completed = app(DocumentReviewService::class)->complete(
            $fixture['batch'],
            $fixture['result'],
            $fixture['version'],
            'سطر ضجيج بجانب سطر كمية حقيقي — الإكمال ينجح والسطران يبقيان مرئيين.',
            $fixture['actor']->id,
        );

        $this->assertSame(DocumentWorkflowStatus::REVIEWED, $completed->status);
        $this->assertCount(2, $fixture['result']->fresh()->normalized_payload['lines']);
    }

    /** @test */
    public function readiness_gaps_report_every_missing_item_and_disappear_once_corrected(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-gaps-api', documentNumber: null, documentDate: null, issuerName: 'نبراس الطموح', recipientName: null, lines: []);

        $gaps = app(DocumentReviewReadinessPolicy::class)->deliveryNoteGaps(
            $fixture['result']->normalized_payload['fields'],
            $fixture['result']->normalized_payload['lines'],
        );
        $codes = array_column($gaps, 'code');

        $this->assertContains('delivery_note_document_number_missing', $codes);
        $this->assertContains('delivery_note_document_date_missing', $codes);
        $this->assertContains('delivery_note_customer_missing', $codes);
        $this->assertContains('delivery_note_quantity_missing', $codes);

        $review = $this->withToken($fixture['token'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->json('data');
        $this->assertSame($codes, array_column($review['readiness_gaps'], 'code'));

        app(DocumentReviewService::class)->change($fixture['batch']->fresh(), $fixture['result'], $fixture['version'], 'fields.recipient_name', 'عميل تجريبي', 'تصحيح اسم العميل.', $fixture['actor']->id);
        $review = $this->withToken($fixture['token'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->json('data');
        $this->assertNotContains('delivery_note_customer_missing', array_column($review['readiness_gaps'], 'code'));
    }

    /** @test */
    public function issuer_and_recipient_name_are_human_editable_for_delivery_notes(): void
    {
        $fixture = $this->deliveryNoteFixture('delivery-note-edit-customer', recipientName: null);

        $change = app(DocumentReviewService::class)->change(
            $fixture['batch'],
            $fixture['result'],
            $fixture['version'],
            'fields.recipient_name',
            'عميل تمّت مراجعته يدوياً',
            'العميل غير مستخرَج آلياً؛ أُدخل يدوياً بعد المراجعة.',
            $fixture['actor']->id,
        );

        $this->assertSame('field', $change->target_type);
        $this->assertSame('عميل تمّت مراجعته يدوياً', app(ReviewedDocumentProjector::class)->value($fixture['result']->fresh(), 'fields.recipient_name'));

        $completed = app(DocumentReviewService::class)->complete(
            $fixture['batch']->fresh(),
            $fixture['result'],
            $fixture['version'] + 1,
            'اكتملت المراجعة بعد إدخال العميل يدوياً.',
            $fixture['actor']->id,
        );
        $this->assertSame(DocumentWorkflowStatus::REVIEWED, $completed->status);
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
        ?string $issuerName = 'نبراس الطموح',
        ?string $recipientName = 'عميل تجريبي',
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

        return [
            ...$this->deliveryNoteResult($actor, $documentNumber, $documentDate, $issuerName, $recipientName, $lines),
            'token' => $auth['token'],
        ];
    }

    /**
     * يبني دفعة/دليل سند تسليم تحت مستأجرٍ مسجَّل بالفعل — بلا أي تسجيل جديد.
     * يُستعمَل مباشرة حين يحتاج اختبار واحد عدة دفعات (كحلقة قيم كمية غير
     * صالحة) دون استهلاك حدّ `register` (٣ بالدقيقة لكل IP) عدة مرات.
     *
     * @return array{batch: DocumentBatch, result: DocumentExtractionResult, actor: User, version: int}
     */
    private function deliveryNoteResult(
        User $actor,
        ?string $documentNumber = 'DN-77',
        ?string $documentDate = '2026-08-24',
        ?string $issuerName = 'نبراس الطموح',
        ?string $recipientName = 'عميل تجريبي',
        ?array $lines = null,
    ): array {
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
            // فريد لكل استدعاء — تحقُّق (tenant_id, branch_id, sha256, size_bytes)
            // يرفض تكراره حين يُعاد استعمال مستأجر واحد لعدة دفعات في اختبار واحد.
            'sha256' => hash('sha256', $batch->id),
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

        return ['batch' => $batch, 'result' => $result, 'actor' => $actor, 'version' => $batch->version];
    }
}

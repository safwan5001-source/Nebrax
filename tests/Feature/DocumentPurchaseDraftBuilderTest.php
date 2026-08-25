<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CostCenter;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
use App\Models\DocumentTransactionLink;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Models\UnitTemplate;
use App\Services\DocumentCenter\DocumentReviewMutationGate;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\DocumentCenter\PurchaseDocumentDraftBuilder;
use App\Services\EntitlementGrantService;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class DocumentPurchaseDraftBuilderTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function purchase_draft_endpoint_requires_authentication(): void
    {
        $this->postJson('/api/document-batches/00000000-0000-0000-0000-000000000000/create-purchase-draft', [
            'expected_version' => 1,
            'reason' => 'طلب مسودة موثق.',
        ])->assertUnauthorized();
    }

    /** @test */
    public function it_creates_and_replays_a_purchase_draft_through_the_protected_api_without_exposing_evidence(): void
    {
        $fixture = $this->readyFixture();
        $payload = [
            'expected_version' => $fixture['batch']->version,
            'reason' => 'إنشاء مسودة مشتريات من الدليل المراجع.',
            'warehouse_id' => $fixture['warehouse']->id,
        ];

        $created = $this->withToken($fixture['token'])->postJson("/api/document-batches/{$fixture['batch']->id}/create-purchase-draft", $payload)
            ->assertCreated()
            ->assertJsonPath('data.transaction_type', 'purchase')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.idempotent_replay', false)
            ->assertJsonMissing(['object_key' => "fixtures/purchase-draft-builder/purchase.pdf"]);

        $purchaseId = $created->json('data.purchase_id');
        $this->assertIsString($purchaseId);
        $this->withToken($fixture['token'])->postJson("/api/document-batches/{$fixture['batch']->id}/create-purchase-draft", $payload)
            ->assertOk()
            ->assertJsonPath('data.purchase_id', $purchaseId)
            ->assertJsonPath('data.idempotent_replay', true);
        $this->assertDatabaseCount('purchases', 1);
        $this->assertDatabaseCount('document_transaction_links', 1);
    }

    /** @test */
    public function purchase_draft_endpoint_rejects_a_stale_review_version_without_creating_state(): void
    {
        $fixture = $this->readyFixture();

        $this->withToken($fixture['token'])->postJson("/api/document-batches/{$fixture['batch']->id}/create-purchase-draft", [
            'expected_version' => $fixture['batch']->version + 1,
            'reason' => 'هذه النسخة قديمة ولا تصلح للبناء.',
            'warehouse_id' => $fixture['warehouse']->id,
        ])->assertStatus(409)->assertJsonPath('message', 'stale_review_version');
        $this->assertDatabaseCount('purchases', 0);
        $this->assertDatabaseCount('document_transaction_links', 0);
        $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'ready_for_draft']);
    }

    /** @test */
    public function it_builds_a_purchase_draft_from_tax_inclusive_reviewed_evidence(): void
    {
        $fixture = $this->readyFixture('1', 'purchase-draft-builder', true);

        $created = app(PurchaseDocumentDraftBuilder::class)->build(
            $fixture['batch'],
            $fixture['batch']->version,
            'إنشاء مسودة شاملة الضريبة من الدليل المراجع.',
            $fixture['warehouse']->id,
            null,
            $fixture['actor']->id,
        );

        $this->assertDatabaseHas('purchases', [
            'id' => $created['purchase_id'],
            'tax_inclusive' => true,
            'subtotal' => 10000,
            'tax_amount' => 1500,
            'total' => 11500,
            'status' => 'draft',
        ]);
    }

    /** @test */
    public function it_builds_one_purchase_draft_from_confirmed_review_evidence_without_posting_or_stock_effect(): void
    {
        $fixture = $this->readyFixture();
        $builder = app(PurchaseDocumentDraftBuilder::class);

        $created = $builder->build(
            $fixture['batch'],
            $fixture['batch']->version,
            'إنشاء مسودة مشتريات من الدليل المراجع.',
            $fixture['warehouse']->id,
            null,
            $fixture['actor']->id,
        );

        $this->assertSame('draft', $created['status']);
        $this->assertFalse($created['idempotent_replay']);
        $this->assertDatabaseHas('purchases', [
            'id' => $created['purchase_id'],
            'partner_id' => $fixture['partner']->id,
            'warehouse_id' => $fixture['warehouse']->id,
            'status' => 'draft',
            'subtotal' => 10000,
            'tax_amount' => 1500,
            'total' => 11500,
            'received_status' => 'pending',
        ]);
        $this->assertDatabaseHas('purchase_lines', [
            'purchase_id' => $created['purchase_id'],
            'product_id' => $fixture['product']->id,
            'quantity' => 1,
            'unit_price' => 10000,
            'line_tax' => 1500,
            'line_total' => 11500,
        ]);
        $this->assertDatabaseHas('document_transaction_links', [
            'document_batch_id' => $fixture['batch']->id,
            'transaction_type' => 'purchase',
            'transaction_id' => $created['purchase_id'],
            'status' => 'created',
        ]);
        $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'draft_created']);
        $this->assertDatabaseCount('journal_entries', 0);
        $this->assertDatabaseCount('journal_lines', 0);
        $this->assertDatabaseCount('stock_movements', 0);

        $replayed = $builder->build($fixture['batch'], 1, 'إعادة محاولة آمنة.', $fixture['warehouse']->id, null, $fixture['actor']->id);
        $this->assertTrue($replayed['idempotent_replay']);
        $this->assertSame($created['purchase_id'], $replayed['purchase_id']);
        $this->assertSame(1, DocumentTransactionLink::query()->count());
        $this->assertDatabaseCount('purchases', 1);

        $this->expectException(\LogicException::class);
        $link = DocumentTransactionLink::query()->sole();
        $link->status = 'tampered';
        $link->save();
    }

    /** @test */
    public function it_accepts_an_active_visible_cost_center_without_client_control_of_the_purchase_data(): void
    {
        $fixture = $this->readyFixture();
        $costCenter = CostCenter::create([
            'code' => 'DOC-CC-001',
            'name' => 'مركز تكلفة الدليل',
            'is_active' => true,
        ]);

        $created = app(PurchaseDocumentDraftBuilder::class)->build(
            $fixture['batch'],
            $fixture['batch']->version,
            'ربط مركز تكلفة قائم ومعتمد.',
            $fixture['warehouse']->id,
            $costCenter->id,
            $fixture['actor']->id,
        );

        $this->assertDatabaseHas('purchases', [
            'id' => $created['purchase_id'],
            'cost_center_id' => $costCenter->id,
            'status' => 'draft',
        ]);
    }

    /** @test */
    public function purchase_draft_endpoint_rejects_a_role_without_the_distinct_build_permission(): void
    {
        $fixture = $this->readyFixture();
        $token = $this->tokenForRole($fixture['tenant_id'], 'staff', 'staff@purchase-draft-builder.test');

        $this->withToken($token)->postJson("/api/document-batches/{$fixture['batch']->id}/create-purchase-draft", [
            'expected_version' => $fixture['batch']->version,
            'reason' => 'لا تملك هذه الصلاحية المقيدة حق البناء.',
            'warehouse_id' => $fixture['warehouse']->id,
        ])->assertForbidden();
        $this->assertDatabaseCount('purchases', 0);
        $this->assertDatabaseCount('document_transaction_links', 0);
    }

    /** @test */
    public function it_rejects_fractional_quantities_without_creating_partial_purchase_or_link(): void
    {
        $fixture = $this->readyFixture('1.5');

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        try {
            app(PurchaseDocumentDraftBuilder::class)->build($fixture['batch'], $fixture['batch']->version, 'لا يسمح المجال الحالي بكمية كسرية.', $fixture['warehouse']->id, null, $fixture['actor']->id);
        } finally {
            $this->assertDatabaseCount('purchases', 0);
            $this->assertDatabaseCount('document_transaction_links', 0);
            $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'ready_for_draft']);
        }
    }

    /** @test */
    public function it_rejects_zero_quantities_without_partial_state(): void
    {
        $this->assertUnsupportedQuantity('0');
    }

    /** @test */
    public function it_rejects_negative_quantities_without_partial_state(): void
    {
        $this->assertUnsupportedQuantity('-1');
    }

    /** @test */
    public function it_rejects_out_of_range_quantities_without_partial_state(): void
    {
        $this->assertUnsupportedQuantity('1000001');
    }

    /** @test */
    public function it_rejects_overflow_sized_quantities_without_partial_state(): void
    {
        $this->assertUnsupportedQuantity('999999999999999999999999');
    }

    private function assertUnsupportedQuantity(string $quantity): void
    {
        $fixture = $this->readyFixture($quantity);

        try {
            app(PurchaseDocumentDraftBuilder::class)->build($fixture['batch'], $fixture['batch']->version, 'الكمية يجب أن تكون صحيحة ومدعومة.', $fixture['warehouse']->id, null, $fixture['actor']->id);
            $this->fail('The unsupported quantity must fail closed.');
        } catch (\Illuminate\Validation\ValidationException) {
            $this->assertDatabaseCount('purchases', 0);
            $this->assertDatabaseCount('document_transaction_links', 0);
            $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'ready_for_draft']);
        }
    }

    /** @test */
    public function it_rejects_an_inactive_confirmed_supplier_without_state_changes(): void
    {
        $fixture = $this->readyFixture();
        $fixture['partner']->update(['is_active' => false]);

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        try {
            app(PurchaseDocumentDraftBuilder::class)->build($fixture['batch'], $fixture['batch']->version, 'المورد المؤكد غير نشط.', $fixture['warehouse']->id, null, $fixture['actor']->id);
        } finally {
            $this->assertDatabaseCount('purchases', 0);
            $this->assertDatabaseCount('document_transaction_links', 0);
            $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'ready_for_draft']);
        }
    }

    /** @return array{batch:DocumentBatch,actor:\App\Models\User,partner:Partner,product:Product,warehouse:Warehouse,result:DocumentExtractionResult,token:string,tenant_id:string} */
    private function readyFixture(string $quantity = '1', string $tenantSlug = 'purchase-draft-builder', bool $taxInclusive = false): array
    {
        $email = "owner@{$tenantSlug}.test";
        $auth = $this->registerTenant($tenantSlug, $email);
        $branch = Branch::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branch->id);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'purchase-draft-builder-test', (string) \Illuminate\Support\Str::uuid());
        $actor = \App\Models\User::query()->where('tenant_id', $auth['tenant_id'])->where('email', $email)->firstOrFail();
        $partner = Partner::create(['type' => 'supplier', 'entity_type' => 'commercial', 'name' => 'مورد الاختبار', 'is_active' => true]);
        $template = UnitTemplate::create(['name' => 'قالب قطعة', 'base_unit' => 'piece', 'is_active' => true]);
        $product = Product::create(['sku' => 'TEST-001', 'name' => 'صنف الاختبار', 'unit' => 'piece', 'unit_template_id' => $template->id, 'is_active' => true, 'tax_rate' => 15]);
        $warehouse = Warehouse::create(['branch_id' => $branch->id, 'code' => 'WH-001', 'name' => 'مستودع الاختبار', 'is_default' => true, 'is_active' => true]);
        $batch = DocumentBatch::create(['document_type' => 'purchase_invoice', 'source_type' => 'manual', 'created_by' => $actor->id]);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'fixture_receiving', 'user', $actor->id, 'تهيئة الدليل.');
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVED, 'fixture_received', 'user', $actor->id, 'تهيئة الدليل.');
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::NEEDS_REVIEW, 'fixture_review', 'user', $actor->id, 'تهيئة الدليل.');

        $file = DocumentFile::create([
            'document_batch_id' => $batch->id,
            'original_name' => 'purchase.pdf',
            'object_key' => "fixtures/{$tenantSlug}/purchase.pdf",
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => hash('sha256', $tenantSlug),
            'scan_status' => DocumentScanStatus::CLEAN,
            'scanned_at' => now('UTC'),
        ]);
        $run = DocumentProcessingRun::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'stage' => 'extraction', 'status' => DocumentProcessingStatus::SUCCEEDED, 'attempt_count' => 1, 'queued_at' => now('UTC'), 'started_at' => now('UTC'), 'finished_at' => now('UTC')]);
        $attempt = DocumentProviderAttempt::create(['document_batch_id' => $batch->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'sequence' => 1, 'provider_key' => 'fixture', 'model' => 'local', 'status' => 'succeeded', 'page_count' => 1, 'started_at' => now('UTC'), 'finished_at' => now('UTC')]);
        $result = DocumentExtractionResult::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'fixture',
            'model' => 'local',
            'schema_version' => 1,
            'detected_document_type' => 'purchase_invoice',
            'detected_language' => 'ar',
            'confidence_basis_points' => 9900,
            'normalized_payload' => [
                'fields' => ['document_number' => 'SUP-100', 'document_date' => '2026-08-25', 'currency' => 'SAR', 'price_includes_tax' => $taxInclusive, 'subtotal_minor' => 10000, 'tax_amount_minor' => 1500, 'total_amount_minor' => 11500],
                'lines' => [['description' => 'صنف الاختبار', 'quantity' => $quantity, 'unit_price_minor' => $taxInclusive ? 11500 : 10000, 'discount_minor' => 0, 'tax_amount_minor' => 1500, 'total_minor' => 11500, 'tax_rate' => '15', 'unit' => 'piece']],
            ],
            'extracted_at' => now('UTC'),
        ]);
        $this->confirmedMatch($batch, $result, 'header', 'header.counterparty', 'partner', $partner->id);
        $this->confirmedMatch($batch, $result, 'product', 'lines.0.product', 'product', $product->id);
        $this->confirmedMatch($batch, $result, 'unit', 'lines.0.unit', 'product_unit', $product->id);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::READY_FOR_DRAFT, 'fixture_ready', 'user', $actor->id, 'المراجعة مكتملة.');

        $token = $auth['token'];
        $tenant_id = $auth['tenant_id'];

        return compact('batch', 'actor', 'partner', 'product', 'warehouse', 'result', 'token', 'tenant_id');
    }

    private function confirmedMatch(DocumentBatch $batch, DocumentExtractionResult $result, string $subjectType, string $subjectKey, string $matchedType, string $matchedId): void
    {
        $match = DocumentMatchResult::create([
            'document_batch_id' => $batch->id,
            'document_extraction_result_id' => $result->id,
            'subject_type' => $subjectType,
            'subject_key' => $subjectKey,
            'status' => 'suggested',
            'strategy' => 'fixture',
            'score_basis_points' => 10000,
            'explanation_codes' => ['fixture'],
        ]);
        DocumentMatchCandidate::create(['document_match_result_id' => $match->id, 'candidate_type' => $matchedType, 'candidate_id' => $matchedId, 'rank' => 1, 'score_basis_points' => 10000, 'strategy' => 'fixture', 'explanation_codes' => ['fixture'], 'snapshot' => ['unit_name' => 'piece', 'is_active' => true]]);
        DocumentReviewMutationGate::run(function () use ($match, $matchedType, $matchedId): void {
            $match->status = 'confirmed';
            $match->matched_type = $matchedType;
            $match->matched_id = $matchedId;
            $match->confirmed_at = now('UTC');
            $match->save();
        });
    }
}

<?php

namespace Tests\Feature;

use App\Contracts\CreatedDraftReference;
use App\Contracts\DraftBuildContext;
use App\Models\Branch;
use App\Models\CostCenter;
use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentIssue;
use App\Models\DocumentMatchCandidate;
use App\Models\DocumentMatchResult;
use App\Models\DocumentProcessingRun;
use App\Models\DocumentProviderAttempt;
use App\Models\DocumentTransactionLink;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\PurchaseService;
use App\Services\DocumentCenter\DocumentReviewMutationGate;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\DocumentCenter\PurchaseDocumentDraftBuilder;
use App\Services\DocumentCenter\PurchaseDraftBuildOptions;
use App\Services\EntitlementGrantService;
use App\Support\BranchSettings;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DocumentPurchaseDraftBuilderTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

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
            ->assertJsonMissingPath('data.normalized_payload')
            ->assertJsonMissingPath('data.object_key')
            ->assertJsonMissingPath('data.provider_metadata')
            ->assertJsonMissingPath('data.raw_provider_response')
            ->assertJsonMissing(['object_key' => 'fixtures/purchase-draft-builder/purchase.pdf']);

        $purchaseId = $created->json('data.transaction_id');
        $this->assertIsString($purchaseId);
        $this->withToken($fixture['token'])->postJson("/api/document-batches/{$fixture['batch']->id}/create-purchase-draft", $payload)
            ->assertOk()
            ->assertJsonPath('data.transaction_id', $purchaseId)
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
    public function purchase_draft_rejects_a_pending_governed_purge_without_financial_side_effects(): void
    {
        $fixture = $this->readyFixture();
        DocumentFile::query()->where('document_batch_id', $fixture['batch']->id)->update(['purge_pending_at' => now('UTC')]);

        $this->createDraftThroughApi($fixture)
            ->assertUnprocessable()
            ->assertJsonValidationErrors('batch');

        $this->assertNoDraftState($fixture);
        $this->assertDatabaseCount('journal_entries', 0);
    }

    /** @test */
    public function it_builds_a_purchase_draft_from_tax_inclusive_reviewed_evidence(): void
    {
        $fixture = $this->readyFixture('1', 'purchase-draft-builder', true);

        $created = $this->buildDraft($fixture, 'إنشاء مسودة شاملة الضريبة من الدليل المراجع.');

        $this->assertDatabaseHas('purchases', [
            'id' => $created->transactionId,
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

        $created = $this->buildDraft($fixture, 'إنشاء مسودة مشتريات من الدليل المراجع.');

        $this->assertSame('draft', $created->status);
        $this->assertFalse($created->idempotentReplay);
        $this->assertDatabaseHas('purchases', [
            'id' => $created->transactionId,
            'partner_id' => $fixture['partner']->id,
            'warehouse_id' => $fixture['warehouse']->id,
            'status' => 'draft',
            'subtotal' => 10000,
            'tax_amount' => 1500,
            'total' => 11500,
            'received_status' => 'pending',
        ]);
        $this->assertDatabaseHas('purchase_lines', [
            'purchase_id' => $created->transactionId,
            'product_id' => $fixture['product']->id,
            'quantity' => 1,
            'unit_price' => 10000,
            'line_tax' => 1500,
            'line_total' => 11500,
        ]);
        $this->assertDatabaseHas('document_transaction_links', [
            'document_batch_id' => $fixture['batch']->id,
            'transaction_type' => 'purchase',
            'transaction_id' => $created->transactionId,
            'status' => 'created',
        ]);
        $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'draft_created']);
        $this->assertDatabaseCount('journal_entries', 0);
        $this->assertDatabaseCount('journal_lines', 0);
        $this->assertDatabaseCount('stock_movements', 0);

        $replayed = $this->buildDraft($fixture, 'إعادة محاولة آمنة.', expectedVersion: 1);
        $this->assertTrue($replayed->idempotentReplay);
        $this->assertSame($created->transactionId, $replayed->transactionId);
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

        $created = $this->buildDraft($fixture, 'ربط مركز تكلفة قائم ومعتمد.', costCenterId: $costCenter->id);

        $this->assertDatabaseHas('purchases', [
            'id' => $created->transactionId,
            'cost_center_id' => $costCenter->id,
            'status' => 'draft',
        ]);
    }

    /** @test */
    public function purchase_draft_endpoint_rejects_a_foreign_tenant_warehouse_without_partial_state(): void
    {
        $fixture = $this->readyFixture();
        $foreign = $this->registerTenant('foreign-warehouse-document-draft', 'owner@foreign-warehouse-document-draft.test');
        $foreignBranch = Branch::query()->where('tenant_id', $foreign['tenant_id'])->firstOrFail();
        app(TenantContext::class)->set($foreign['tenant_id']);
        app(BranchContext::class)->set($foreignBranch->id);
        $foreignWarehouse = Warehouse::create(['branch_id' => $foreignBranch->id, 'code' => 'FOREIGN-WH', 'name' => 'مخزن أجنبي', 'is_active' => true]);
        app(TenantContext::class)->set($fixture['tenant_id']);
        app(BranchContext::class)->set($fixture['batch']->branch_id);

        $this->createDraftThroughApi($fixture, ['warehouse_id' => $foreignWarehouse->id])->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function purchase_draft_endpoint_rejects_a_warehouse_outside_the_reviewers_branch_and_warehouse_access(): void
    {
        $fixture = $this->readyFixture();
        $otherBranchId = $this->withToken($fixture['token'])->postJson('/api/branches', ['name' => 'فرع مخزن مقيّد'])->assertCreated()->json('data.id');
        $otherWarehouse = Warehouse::create(['branch_id' => $otherBranchId, 'code' => 'OTHER-WH', 'name' => 'مخزن فرع آخر', 'is_active' => true]);
        $reviewerToken = $this->tokenForRole($fixture['tenant_id'], 'owner', 'restricted-owner@purchase-draft-builder.test');
        $reviewer = User::query()->where('email', 'restricted-owner@purchase-draft-builder.test')->firstOrFail();
        $reviewer->branches()->attach($fixture['batch']->branch_id);
        $reviewer->warehouses()->attach($fixture['warehouse']->id);

        $this->createDraftThroughApi($fixture, ['warehouse_id' => $otherWarehouse->id], $reviewerToken)
            ->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function purchase_draft_endpoint_rejects_a_cost_center_hidden_by_branch_sharing_policy(): void
    {
        $fixture = $this->readyFixture();
        $otherBranchId = $this->withToken($fixture['token'])->postJson('/api/branches', ['name' => 'فرع مركز تكلفة مقيّد'])->assertCreated()->json('data.id');
        app(BranchContext::class)->set($otherBranchId);
        $costCenter = CostCenter::create(['code' => 'HIDDEN-CC', 'name' => 'مركز تكلفة فرع آخر', 'is_active' => true]);
        BranchSettings::merge(['share_cost_centers' => false]);
        app(BranchContext::class)->set($fixture['batch']->branch_id);

        $this->createDraftThroughApi($fixture, ['cost_center_id' => $costCenter->id])->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function purchase_draft_endpoint_rejects_active_rbac_when_document_center_entitlement_is_revoked(): void
    {
        $fixture = $this->readyFixture();
        app(EntitlementGrantService::class)->revokeGrantGroup(
            Tenant::findOrFail($fixture['tenant_id']),
            $fixture['entitlementGroup'],
        );

        $this->createDraftThroughApi($fixture)->assertForbidden();
        $this->assertNoDraftState($fixture);
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
    public function it_keeps_the_link_visible_and_replays_the_same_purchase_after_normal_posting(): void
    {
        $fixture = $this->readyFixture();
        $created = $this->buildDraft($fixture, 'أنشئ المسودة قبل ترحيلها الطبيعي.');
        $purchase = Purchase::query()->findOrFail($created->transactionId);

        app(PurchaseService::class)->post($purchase);

        $this->withToken($fixture['token'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->assertJsonPath('data.linked_purchase.transaction_id', $created->transactionId)
            ->assertJsonPath('data.linked_purchase.status', 'posted')
            ->assertJsonMissing(['purchase_draft' => null]);

        $replayed = $this->buildDraft($fixture, 'لا تنشئ معاملة ثانية بعد الترحيل.');
        $this->assertTrue($replayed->idempotentReplay);
        $this->assertSame('posted', $replayed->status);
        $this->assertSame($created->transactionId, $replayed->transactionId);
        $this->assertDatabaseCount('purchases', 1);
        $this->assertDatabaseCount('document_transaction_links', 1);
    }

    /** @test */
    public function it_rejects_deleting_a_document_linked_purchase_draft_with_a_clear_domain_message(): void
    {
        $fixture = $this->readyFixture();
        $created = $this->buildDraft($fixture, 'اربط المسودة بالدليل قبل اختبار الحذف.');

        $this->withToken($fixture['token'])
            ->deleteJson("/api/purchases/{$created->transactionId}")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'لا يمكن حذف مسودة مشتريات مرتبطة بمستند؛ استخدم الإلغاء أو الأرشفة وفق دورة المشتريات.');
        $this->assertDatabaseHas('purchases', ['id' => $created->transactionId, 'status' => 'draft']);
        $this->assertDatabaseCount('document_transaction_links', 1);
    }

    /** @test */
    public function it_uses_the_current_extraction_result_supplier_match_when_historical_confirmed_matches_exist(): void
    {
        $fixture = $this->readyFixture();
        $historicalPartner = Partner::create([
            'type' => 'supplier',
            'entity_type' => 'commercial',
            'name' => 'مورد تاريخي لا يجب استخدامه',
            'is_active' => true,
        ]);
        $historicalFile = DocumentFile::create([
            'document_batch_id' => $fixture['batch']->id,
            'original_name' => 'purchase-historical.pdf',
            'object_key' => 'fixtures/purchase-draft-builder/purchase-historical.pdf',
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => hash('sha256', 'purchase-draft-builder-historical'),
            'scan_status' => DocumentScanStatus::CLEAN,
            'scanned_at' => now('UTC')->subMinute(),
        ]);
        $run = DocumentProcessingRun::create([
            'document_batch_id' => $fixture['batch']->id,
            'document_file_id' => $historicalFile->id,
            'stage' => 'extraction',
            'status' => DocumentProcessingStatus::SUCCEEDED,
            'attempt_count' => 1,
            'queued_at' => now('UTC')->subMinute(),
            'started_at' => now('UTC')->subMinute(),
            'finished_at' => now('UTC')->subMinute(),
        ]);
        $attempt = DocumentProviderAttempt::create([
            'document_batch_id' => $fixture['batch']->id,
            'document_file_id' => $historicalFile->id,
            'document_processing_run_id' => $run->id,
            'sequence' => 2,
            'provider_key' => 'fixture-historical',
            'model' => 'local',
            'status' => 'succeeded',
            'page_count' => 1,
            'started_at' => now('UTC')->subMinute(),
            'finished_at' => now('UTC')->subMinute(),
        ]);
        $historical = DocumentExtractionResult::create([
            'document_batch_id' => $fixture['batch']->id,
            'document_file_id' => $historicalFile->id,
            'document_processing_run_id' => $run->id,
            'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'fixture-historical',
            'model' => 'local',
            'schema_version' => 1,
            'detected_document_type' => 'purchase_invoice',
            'detected_language' => 'ar',
            'confidence_basis_points' => 9900,
            'normalized_payload' => $fixture['result']->normalized_payload,
            'extracted_at' => now('UTC')->subMinute(),
        ]);
        $this->confirmedMatch($fixture['batch'], $historical, 'header', 'header.counterparty', 'partner', $historicalPartner->id);

        $created = $this->buildDraft($fixture, 'استخدم فقط دليل الاستخراج الحالي المقفل.');

        $this->assertDatabaseHas('purchases', [
            'id' => $created->transactionId,
            'partner_id' => $fixture['partner']->id,
        ]);
        $this->assertDatabaseMissing('purchases', ['partner_id' => $historicalPartner->id]);
    }

    /** @test */
    public function it_rejects_an_open_blocking_issue_even_when_the_batch_is_ready_for_draft(): void
    {
        $fixture = $this->readyFixture();
        DocumentIssue::create([
            'document_batch_id' => $fixture['batch']->id,
            'document_extraction_result_id' => $fixture['result']->id,
            'subject_key' => 'fields.total_amount_minor',
            'code' => 'tampered_blocking_issue',
            'severity' => 'blocking',
            'status' => 'open',
            'safe_message' => 'مشكلة مانعة مفتوحة.',
        ]);

        $this->createDraftThroughApi($fixture)->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function it_rejects_duplicate_confirmed_required_matches_without_partial_state(): void
    {
        $fixture = $this->readyFixture();
        $this->confirmedMatch($fixture['batch'], $fixture['result'], 'duplicate_header', 'header.counterparty', 'partner', $fixture['partner']->id);

        $this->createDraftThroughApi($fixture)->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function it_preserves_reviewed_line_discount_in_purchase_service_totals(): void
    {
        $fixture = $this->readyFixture(payloadOverrides: [
            'fields' => ['subtotal_minor' => 9000, 'tax_amount_minor' => 1350, 'total_amount_minor' => 10350],
            'line' => ['discount_minor' => 1000, 'tax_amount_minor' => 1350, 'total_minor' => 10350],
        ]);

        $created = $this->buildDraft($fixture, 'خصم سطر مراجع بالهللات.');
        $this->assertDatabaseHas('purchases', ['id' => $created->transactionId, 'subtotal' => 9000, 'tax_amount' => 1350, 'total' => 10350]);
        $this->assertDatabaseHas('purchase_lines', ['purchase_id' => $created->transactionId, 'line_discount' => 1000, 'line_total' => 10350]);
    }

    /** @test */
    public function it_rejects_header_discount_evidence_until_document_schema_supports_a_non_ambiguous_allocation(): void
    {
        $fixture = $this->readyFixture(payloadOverrides: [
            'fields' => ['discount_minor' => 1000, 'subtotal_minor' => 10000, 'tax_amount_minor' => 1350, 'total_amount_minor' => 10350],
        ]);

        $this->createDraftThroughApi($fixture)->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function it_rolls_back_everything_when_purchase_service_creation_throws(): void
    {
        $fixture = $this->readyFixture();
        $failing = \Mockery::mock(PurchaseService::class);
        $failing->shouldReceive('create')->once()->andThrow(new \RuntimeException('purchase_create_failed'));
        app()->instance(PurchaseService::class, $failing);

        try {
            $this->expectException(\RuntimeException::class);
            $this->buildDraft($fixture, 'فشل خدمة إنشاء الشراء يجب أن يتراجع كلياً.');
        } finally {
            app()->forgetInstance(PurchaseService::class);
            $this->assertNoDraftState($fixture);
        }
    }

    /** @test */
    public function it_rolls_back_everything_when_domain_totals_do_not_match_reviewed_evidence(): void
    {
        $fixture = $this->readyFixture();
        $realPurchaseService = app(PurchaseService::class);
        $mismatching = \Mockery::mock(PurchaseService::class);
        $mismatching->shouldReceive('create')->once()->andReturnUsing(function (array $data, array $items) use ($realPurchaseService): Purchase {
            $purchase = $realPurchaseService->create($data, $items);
            $purchase->update(['total' => $purchase->total + 2]);

            return $purchase->fresh('lines');
        });
        app()->instance(PurchaseService::class, $mismatching);

        try {
            $this->expectException(ValidationException::class);
            $this->buildDraft($fixture, 'فرق الإجمالي بعد خدمة المجال يجب أن يتراجع كلياً.');
        } finally {
            app()->forgetInstance(PurchaseService::class);
            $this->assertNoDraftState($fixture);
        }
    }

    /** @test */
    public function it_rejects_a_batch_that_is_not_ready_for_draft_without_partial_state(): void
    {
        $fixture = $this->readyFixture(markReady: false);

        $this->assertDraftBuildFailsClosed($fixture, 'المراجعة لم تكتمل بعد.', 'needs_review');
    }

    /** @test */
    public function it_rejects_a_non_purchase_invoice_document_type_without_partial_state(): void
    {
        $fixture = $this->readyFixture(documentType: 'expense');

        $this->assertDraftBuildFailsClosed($fixture, 'هذا النوع لا يبني مسودة شراء.');
    }

    /** @test */
    public function it_rejects_missing_required_confirmed_matches_without_partial_state(): void
    {
        $fixture = $this->readyFixture();
        $productMatch = DocumentMatchResult::query()
            ->where('document_extraction_result_id', $fixture['result']->id)
            ->where('subject_key', 'lines.0.product')
            ->sole();
        DocumentReviewMutationGate::run(function () use ($productMatch): void {
            $productMatch->status = 'rejected';
            $productMatch->matched_type = null;
            $productMatch->matched_id = null;
            $productMatch->save();
        });

        $this->assertDraftBuildFailsClosed($fixture, 'مطابقة المنتج الإلزامية غير مؤكدة.');
    }

    /** @test */
    public function it_rejects_an_inactive_confirmed_product_without_partial_state(): void
    {
        $fixture = $this->readyFixture();
        $fixture['product']->update(['is_active' => false]);

        $this->assertDraftBuildFailsClosed($fixture, 'المنتج المؤكد لم يعد نشطاً.');
    }

    /** @test */
    public function it_rejects_a_confirmed_unit_that_belongs_to_another_product(): void
    {
        $fixture = $this->readyFixture();
        $otherProduct = Product::create([
            'sku' => 'TEST-OTHER-001',
            'name' => 'منتج وحدته غير مطابقة',
            'unit' => 'piece',
            'unit_template_id' => $fixture['product']->unit_template_id,
            'is_active' => true,
            'tax_rate' => 15,
        ]);
        $unitMatch = DocumentMatchResult::query()
            ->where('document_extraction_result_id', $fixture['result']->id)
            ->where('subject_key', 'lines.0.unit')
            ->sole();
        DocumentReviewMutationGate::run(function () use ($unitMatch, $otherProduct): void {
            $unitMatch->matched_id = $otherProduct->id;
            $unitMatch->save();
        });

        $this->assertDraftBuildFailsClosed($fixture, 'الوحدة المؤكدة لا تخص المنتج المؤكد.');
    }

    /** @test */
    public function it_rejects_non_sar_reviewed_evidence_without_partial_state(): void
    {
        $fixture = $this->readyFixture('1', 'purchase-draft-builder-usd', false, 'USD');

        $this->assertDraftBuildFailsClosed($fixture, 'لا توجد سياسة تحويل عملة معتمدة.');
    }

    /** @test */
    public function it_rejects_fractional_quantities_without_creating_partial_purchase_or_link(): void
    {
        $fixture = $this->readyFixture('1.5');

        $this->expectException(ValidationException::class);
        try {
            $this->buildDraft($fixture, 'لا يسمح المجال الحالي بكمية كسرية.');
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

    /** @param array{batch:DocumentBatch,token:string,warehouse:Warehouse} $fixture */
    private function createDraftThroughApi(array $fixture, array $overrides = [], ?string $token = null): TestResponse
    {
        return $this->withToken($token ?? $fixture['token'])->postJson(
            "/api/document-batches/{$fixture['batch']->id}/create-purchase-draft",
            array_merge([
                'expected_version' => $fixture['batch']->version,
                'reason' => 'اختبار مسار إنشاء المسودة المحمي.',
                'warehouse_id' => $fixture['warehouse']->id,
            ], $overrides),
        );
    }

    /** @param array{batch:DocumentBatch} $fixture */
    private function assertNoDraftState(array $fixture): void
    {
        $this->assertDatabaseCount('purchases', 0);
        $this->assertDatabaseCount('document_transaction_links', 0);
        $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'ready_for_draft']);
    }

    /** @param array{batch:DocumentBatch,actor:User,warehouse:Warehouse} $fixture */
    private function buildDraft(array $fixture, string $reason, ?string $warehouseId = null, ?string $costCenterId = null, ?int $expectedVersion = null): CreatedDraftReference
    {
        return app(PurchaseDocumentDraftBuilder::class)->build(
            $fixture['batch'],
            new DraftBuildContext(
                expectedVersion: $expectedVersion ?? $fixture['batch']->version,
                reason: $reason,
                actorId: $fixture['actor']->id,
                options: new PurchaseDraftBuildOptions(
                    warehouseId: $warehouseId ?? $fixture['warehouse']->id,
                    costCenterId: $costCenterId,
                ),
            ),
        );
    }

    /** @param array{batch:DocumentBatch,actor:User,warehouse:Warehouse} $fixture */
    private function assertDraftBuildFailsClosed(array $fixture, string $reason, string $expectedStatus = 'ready_for_draft'): void
    {
        try {
            $this->buildDraft($fixture, $reason);
            $this->fail('The invalid reviewed evidence must fail closed.');
        } catch (ValidationException) {
            $this->assertDatabaseCount('purchases', 0);
            $this->assertDatabaseCount('document_transaction_links', 0);
            $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => $expectedStatus]);
        }
    }

    private function assertUnsupportedQuantity(string $quantity): void
    {
        $fixture = $this->readyFixture($quantity);

        try {
            $this->buildDraft($fixture, 'الكمية يجب أن تكون صحيحة ومدعومة.');
            $this->fail('The unsupported quantity must fail closed.');
        } catch (ValidationException) {
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

        $this->expectException(ValidationException::class);
        try {
            $this->buildDraft($fixture, 'المورد المؤكد غير نشط.');
        } finally {
            $this->assertDatabaseCount('purchases', 0);
            $this->assertDatabaseCount('document_transaction_links', 0);
            $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'ready_for_draft']);
        }
    }

    /** @return array{batch:DocumentBatch,actor:User,partner:Partner,product:Product,warehouse:Warehouse,result:DocumentExtractionResult,token:string,tenant_id:string} */
    private function readyFixture(string $quantity = '1', string $tenantSlug = 'purchase-draft-builder', bool $taxInclusive = false, string $currency = 'SAR', bool $markReady = true, string $documentType = 'purchase_invoice', array $payloadOverrides = []): array
    {
        $email = "owner@{$tenantSlug}.test";
        $auth = $this->registerTenant($tenantSlug, $email);
        $branch = Branch::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branch->id);
        $entitlementGroup = (string) Str::uuid();
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'purchase-draft-builder-test', (string) Str::uuid(), $entitlementGroup);
        $actor = User::query()->where('tenant_id', $auth['tenant_id'])->where('email', $email)->firstOrFail();
        $partner = Partner::create(['type' => 'supplier', 'entity_type' => 'commercial', 'name' => 'مورد الاختبار', 'is_active' => true]);
        $template = UnitTemplate::create(['name' => 'قالب قطعة', 'base_unit' => 'piece', 'is_active' => true]);
        $product = Product::create(['sku' => 'TEST-001', 'name' => 'صنف الاختبار', 'unit' => 'piece', 'unit_template_id' => $template->id, 'is_active' => true, 'tax_rate' => 15]);
        $warehouse = Warehouse::create(['branch_id' => $branch->id, 'code' => 'WH-001', 'name' => 'مستودع الاختبار', 'is_default' => true, 'is_active' => true]);
        $batch = DocumentBatch::create(['document_type' => $documentType, 'source_type' => 'manual', 'created_by' => $actor->id]);
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
                'fields' => array_merge([
                    'document_number' => 'SUP-100', 'document_date' => '2026-08-25', 'currency' => $currency,
                    'price_includes_tax' => $taxInclusive, 'subtotal_minor' => 10000,
                    'tax_amount_minor' => 1500, 'total_amount_minor' => 11500,
                ], $payloadOverrides['fields'] ?? []),
                'lines' => [array_merge([
                    'description' => 'صنف الاختبار', 'quantity' => $quantity,
                    'unit_price_minor' => $taxInclusive ? 11500 : 10000, 'discount_minor' => 0,
                    'tax_amount_minor' => 1500, 'total_minor' => 11500, 'tax_rate' => '15', 'unit' => 'piece',
                ], $payloadOverrides['line'] ?? [])],
            ],
            'extracted_at' => now('UTC'),
        ]);
        $this->confirmedMatch($batch, $result, 'header', 'header.counterparty', 'partner', $partner->id);
        $this->confirmedMatch($batch, $result, 'product', 'lines.0.product', 'product', $product->id);
        $this->confirmedMatch($batch, $result, 'unit', 'lines.0.unit', 'product_unit', $product->id);
        if ($markReady) {
            $batch = $workflow->transition($batch, DocumentWorkflowStatus::READY_FOR_DRAFT, 'fixture_ready', 'user', $actor->id, 'المراجعة مكتملة.');
        }

        $token = $auth['token'];
        $tenant_id = $auth['tenant_id'];

        return compact('batch', 'actor', 'partner', 'product', 'warehouse', 'result', 'token', 'tenant_id', 'entitlementGroup');
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

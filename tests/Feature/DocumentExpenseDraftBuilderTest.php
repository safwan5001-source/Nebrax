<?php

namespace Tests\Feature;

use App\Contracts\DraftBuildContext;
use App\Models\Account;
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
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ExpenseService;
use App\Services\DocumentCenter\DocumentReviewMutationGate;
use App\Services\DocumentCenter\DocumentWorkflowService;
use App\Services\DocumentCenter\ExpenseDocumentDraftBuilder;
use App\Services\DocumentCenter\ExpenseDraftBuildOptions;
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
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

class DocumentExpenseDraftBuilderTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        // المجموعة تبني عدة مستأجرين fixtures لاختبار العزل؛ ليس throttle موضوعها.
        $this->withoutMiddleware(ThrottleRequests::class);
    }

    /** @test */
    public function expense_draft_endpoint_requires_authentication(): void
    {
        $this->postJson('/api/document-batches/00000000-0000-0000-0000-000000000000/create-expense-draft', [
            'expected_version' => 1,
            'reason' => 'طلب مسودة مصروف موثق.',
            'account_id' => '00000000-0000-0000-0000-000000000000',
            'payment_method' => 'cash',
        ])->assertUnauthorized();
    }

    /** @test */
    public function it_creates_one_expense_draft_through_the_protected_api_replays_it_and_exposes_only_safe_link_data(): void
    {
        $fixture = $this->readyFixture();
        $payload = $this->payload($fixture);
        $forbidden = array_merge($payload, [
            // هذه القيم ليست خيارات؛ يجب رفضها بدل أن تصبح حقيقة للمعاملة.
            'amount' => 999999999,
            'tax_amount' => 999999999,
            'total' => 999999999,
            'tax_rate' => 99,
            'tenant_id' => '00000000-0000-0000-0000-000000000000',
            'branch_id' => '00000000-0000-0000-0000-000000000000',
        ]);
        $this->withToken($fixture['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $forbidden)
            ->assertUnprocessable();
        $this->assertNoDraftState($fixture);

        $created = $this->withToken($fixture['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $payload)
            ->assertCreated()
            ->assertJsonPath('data.transaction_type', 'expense')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.idempotent_replay', false)
            ->assertJsonMissingPath('data.normalized_payload')
            ->assertJsonMissingPath('data.object_key')
            ->assertJsonMissingPath('data.provider_metadata')
            ->assertJsonMissingPath('data.raw_provider_response')
            ->assertJsonMissing(['object_key' => 'fixtures/expense-draft-builder/expense.pdf']);

        $expenseId = $created->json('data.transaction_id');
        $this->assertIsString($expenseId);
        $this->assertDatabaseHas('expenses', [
            'id' => $expenseId,
            'account_id' => $fixture['account']->id,
            'partner_id' => $fixture['partner']->id,
            'amount' => 10000,
            'tax_rate' => 15,
            'tax_amount' => 1500,
            'total' => 11500,
            'status' => 'draft',
        ]);
        $this->assertDatabaseHas('document_transaction_links', [
            'document_batch_id' => $fixture['batch']->id,
            'transaction_type' => 'expense',
            'transaction_id' => $expenseId,
            'status' => 'created',
        ]);
        $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => 'draft_created']);
        $this->assertDatabaseCount('journal_entries', 0);
        $this->assertDatabaseCount('journal_lines', 0);
        $this->assertDatabaseCount('payments', 0);
        $this->assertDatabaseCount('stock_movements', 0);

        $this->withToken($fixture['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $payload)
            ->assertOk()
            ->assertJsonPath('data.transaction_id', $expenseId)
            ->assertJsonPath('data.idempotent_replay', true);
        $this->assertDatabaseCount('expenses', 1);
        $this->assertDatabaseCount('document_transaction_links', 1);

        $this->withToken($fixture['token'])
            ->getJson("/api/expenses/{$expenseId}")
            ->assertOk()
            ->assertJsonPath('data.document_linked', true)
            ->assertJsonPath('data.source_document_url', "/documents/{$fixture['batch']->id}")
            ->assertJsonMissing(['normalized_payload' => $fixture['result']->normalized_payload]);

        $this->withToken($fixture['token'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->assertJsonPath('data.linked_transaction.transaction_type', 'expense')
            ->assertJsonPath('data.linked_transaction.transaction_id', $expenseId)
            ->assertJsonPath('data.linked_transaction.status', 'draft')
            ->assertJsonPath('data.linked_transaction.url', "/expenses/{$expenseId}")
            ->assertJsonPath('data.linked_purchase', null)
            ->assertJsonMissing(['normalized_payload' => $fixture['result']->normalized_payload]);
    }

    /** @test */
    public function it_accepts_cash_bank_and_credit_but_requires_a_confirmed_supplier_for_credit(): void
    {
        foreach (['cash', 'bank', 'credit'] as $method) {
            $fixture = $this->readyFixture('expense-payment-'.$method);
            $created = $this->buildDraft($fixture, 'اختيار طريقة دفع مسموحة.', paymentMethod: $method);
            $this->assertDatabaseHas('expenses', [
                'id' => $created->transactionId,
                'payment_method' => $method,
                'partner_id' => $fixture['partner']->id,
                'status' => 'draft',
            ]);
            $this->assertDatabaseCount('journal_entries', 0);
            $this->assertDatabaseCount('payments', 0);
        }

        $fixture = $this->readyFixture('expense-credit-no-partner', withPartnerMatch: false);
        $this->assertBuildFailsClosed($fixture, 'لا يجوز إنشاء التزام مورد دون طرف مؤكد.', paymentMethod: 'credit');

        $fixture = $this->readyFixture('expense-invalid-payment');
        $this->withToken($fixture['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $this->payload($fixture, ['payment_method' => 'wallet']))
            ->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function it_enforces_rbac_and_document_center_write_entitlement_separately(): void
    {
        $fixture = $this->readyFixture('expense-entitlement');
        app(EntitlementGrantService::class)->revokeGrantGroup(Tenant::findOrFail($fixture['tenant_id']), $fixture['entitlementGroup']);

        $this->withToken($fixture['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $this->payload($fixture))
            ->assertForbidden();
        $this->assertNoDraftState($fixture);

        $fixture = $this->readyFixture('expense-rbac');
        $token = $this->tokenForRole($fixture['tenant_id'], 'staff', 'staff@expense-draft-builder.test');
        $this->withToken($token)
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $this->payload($fixture))
            ->assertForbidden();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function it_isolates_the_batch_and_master_data_by_tenant_and_branch(): void
    {
        $fixture = $this->readyFixture('expense-isolation');
        $foreign = $this->registerTenant('expense-foreign', 'owner@expense-foreign.test');
        $this->withToken($foreign['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $this->payload($fixture))
            ->assertNotFound();
        $this->assertNoDraftState($fixture);

        app(TenantContext::class)->set($foreign['tenant_id']);
        $foreignBranch = Branch::query()->where('tenant_id', $foreign['tenant_id'])->firstOrFail();
        app(BranchContext::class)->set($foreignBranch->id);
        $foreignCategory = ExpenseCategory::create(['name' => 'تصنيف أجنبي', 'is_active' => true]);
        app(TenantContext::class)->set($fixture['tenant_id']);
        app(BranchContext::class)->set($fixture['batch']->branch_id);

        $this->withToken($fixture['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $this->payload($fixture, ['category_id' => $foreignCategory->id]))
            ->assertUnprocessable();
        $this->assertNoDraftState($fixture);
    }

    /** @test */
    public function it_rejects_stale_non_ready_wrong_type_and_open_blocking_issue_without_partial_state(): void
    {
        $fixture = $this->readyFixture('expense-stale');
        $this->withToken($fixture['token'])
            ->postJson("/api/document-batches/{$fixture['batch']->id}/create-expense-draft", $this->payload($fixture, ['expected_version' => $fixture['batch']->version + 1]))
            ->assertConflict()
            ->assertJsonPath('message', 'stale_review_version');
        $this->assertNoDraftState($fixture);

        $fixture = $this->readyFixture('expense-not-ready', markReady: false);
        $this->assertBuildFailsClosed($fixture, 'المراجعة لم تكتمل بعد.', expectedStatus: 'needs_review');

        $fixture = $this->readyFixture('expense-wrong-type', documentType: 'purchase_invoice');
        $this->assertBuildFailsClosed($fixture, 'نوع الشراء لا يبني مصروفًا.', expectedStatus: 'ready_for_draft');

        $fixture = $this->readyFixture('expense-blocking');
        DocumentIssue::create([
            'document_batch_id' => $fixture['batch']->id,
            'document_extraction_result_id' => $fixture['result']->id,
            'subject_key' => 'fields.total_amount_minor',
            'code' => 'blocking_expense_evidence',
            'severity' => 'blocking',
            'status' => 'open',
            'safe_message' => 'مشكلة مانعة مفتوحة.',
        ]);
        $this->assertBuildFailsClosed($fixture, 'مشكلة مانعة يجب أن توقف البناء.');
    }

    /** @test */
    public function it_validates_account_category_cost_center_and_branch_account_assignment(): void
    {
        $fixture = $this->readyFixture('expense-account-inactive');
        $fixture['account']->update(['is_active' => false]);
        $this->assertBuildFailsClosed($fixture, 'الحساب غير النشط مرفوض.');

        $fixture = $this->readyFixture('expense-account-non-expense');
        $cash = Account::query()->where('code', '1110')->firstOrFail();
        $this->assertBuildFailsClosed($fixture, 'الحساب غير المصروف مرفوض.', accountId: $cash->id);

        $fixture = $this->readyFixture('expense-category');
        $inactiveCategory = ExpenseCategory::create(['name' => 'تصنيف معطل', 'is_active' => false]);
        $this->assertBuildFailsClosed($fixture, 'التصنيف المعطل مرفوض.', categoryId: $inactiveCategory->id);

        $fixture = $this->readyFixture('expense-cost-center');
        $inactiveCostCenter = CostCenter::create(['code' => 'EXP-CC-X', 'name' => 'مركز معطل', 'is_active' => false]);
        $this->assertBuildFailsClosed($fixture, 'مركز التكلفة المعطل مرفوض.', costCenterId: $inactiveCostCenter->id);

        $fixture = $this->readyFixture('expense-account-branch');
        BranchSettings::merge(['account_branch_scoping' => true]);
        $branch = Branch::query()->findOrFail($fixture['batch']->branch_id);
        $otherExpenseAccount = Account::create([
            'code' => '5999',
            'name' => 'حساب مصروف مقيّد',
            'type' => 'expense',
            'normal_balance' => 'debit',
            'is_group' => false,
            'is_active' => true,
        ]);
        $branch->accounts()->attach($fixture['account']->id, ['id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $fixture['tenant_id']]);
        $this->assertBuildFailsClosed($fixture, 'الحساب خارج تخصيص الفرع مرفوض.', accountId: $otherExpenseAccount->id);
    }

    /** @test */
    public function it_rejects_invalid_or_ambiguous_financial_evidence_and_accepts_explicit_inclusive_base(): void
    {
        $fixture = $this->readyFixture('expense-usd', currency: 'USD');
        $this->assertBuildFailsClosed($fixture, 'لا يوجد تحويل عملة في هذا المسار.');

        $fixture = $this->readyFixture('expense-zero', payloadOverrides: ['fields' => ['subtotal_minor' => 0, 'tax_amount_minor' => 0, 'total_amount_minor' => 0], 'line' => ['tax_rate' => '0']]);
        $this->assertBuildFailsClosed($fixture, 'الأساس صفر مرفوض.');

        $fixture = $this->readyFixture('expense-invalid-minor', payloadOverrides: ['fields' => ['subtotal_minor' => '10000']]);
        $this->assertBuildFailsClosed($fixture, 'المبلغ النصي غير مقبول.');

        $fixture = $this->readyFixture('expense-multiple-rate', payloadOverrides: ['lines' => [
            ['description' => 'أ', 'tax_rate' => '15'],
            ['description' => 'ب', 'tax_rate' => '0'],
        ]]);
        $this->assertBuildFailsClosed($fixture, 'عدة معدلات لا تتحول إلى رأس مصروف واحد.');

        $fixture = $this->readyFixture('expense-inclusive', taxInclusive: true);
        $created = $this->buildDraft($fixture, 'المستند الشامل يملك أساسًا مراجعًا صريحًا.');
        $this->assertDatabaseHas('expenses', ['id' => $created->transactionId, 'amount' => 10000, 'tax_amount' => 1500, 'total' => 11500]);

        $fixture = $this->readyFixture('expense-inclusive-ambiguous', taxInclusive: true, payloadOverrides: [
            'fields' => ['subtotal_minor' => 11500, 'tax_amount_minor' => 1500, 'total_amount_minor' => 11500],
        ]);
        $this->assertBuildFailsClosed($fixture, 'الأساس غير المتوازن في شامل الضريبة مرفوض.');
    }

    /** @test */
    public function it_rolls_back_when_expense_service_fails_or_returns_mismatched_totals(): void
    {
        $fixture = $this->readyFixture('expense-service-failure');
        $failing = \Mockery::mock(ExpenseService::class);
        $failing->shouldReceive('create')->once()->andThrow(new \RuntimeException('expense_create_failed'));
        app()->instance(ExpenseService::class, $failing);
        try {
            $this->expectException(\RuntimeException::class);
            $this->buildDraft($fixture, 'فشل الخدمة يجب أن يتراجع كليًا.');
        } finally {
            app()->forgetInstance(ExpenseService::class);
            $this->assertNoDraftState($fixture);
        }

        $fixture = $this->readyFixture('expense-total-mismatch');
        $real = app(ExpenseService::class);
        $mismatching = \Mockery::mock(ExpenseService::class);
        $mismatching->shouldReceive('create')->once()->andReturnUsing(function (array $data) use ($real): Expense {
            $expense = $real->create($data);
            $expense->update(['total' => $expense->total + 2]);

            return $expense->fresh();
        });
        app()->instance(ExpenseService::class, $mismatching);
        try {
            $this->expectException(ValidationException::class);
            $this->buildDraft($fixture, 'اختلاف إجمالي خدمة المجال يجب أن يتراجع كليًا.');
        } finally {
            app()->forgetInstance(ExpenseService::class);
            $this->assertNoDraftState($fixture);
        }
    }

    /** @test */
    public function it_uses_only_the_current_result_partner_link_remains_visible_after_posting_and_linked_draft_cannot_be_deleted(): void
    {
        $fixture = $this->readyFixture('expense-current-result');
        $historicalPartner = Partner::create(['type' => 'supplier', 'entity_type' => 'commercial', 'name' => 'مورد تاريخي', 'is_active' => true]);
        $historical = $this->historicalResult($fixture);
        $this->confirmedMatch($fixture['batch'], $historical, 'header', 'header.counterparty', 'partner', $historicalPartner->id);

        $created = $this->buildDraft($fixture, 'النتيجة الأحدث هي مصدر الطرف الوحيد.');
        $this->assertDatabaseHas('expenses', ['id' => $created->transactionId, 'partner_id' => $fixture['partner']->id]);

        $this->withToken($fixture['token'])->deleteJson("/api/expenses/{$created->transactionId}")
            ->assertUnprocessable()
            ->assertJsonPath('message', 'لا يمكن حذف مسودة مصروف مرتبطة بمستند مصدر.');
        $this->assertDatabaseHas('expenses', ['id' => $created->transactionId, 'status' => 'draft']);

        app(ExpenseService::class)->post(Expense::query()->findOrFail($created->transactionId));
        $this->withToken($fixture['token'])
            ->getJson("/api/document-batches/{$fixture['batch']->id}/review")
            ->assertOk()
            ->assertJsonPath('data.linked_transaction.transaction_id', $created->transactionId)
            ->assertJsonPath('data.linked_transaction.status', 'posted');

        $replay = $this->buildDraft($fixture, 'لا تنشئ مصروفًا ثانيًا بعد الترحيل.');
        $this->assertTrue($replay->idempotentReplay);
        $this->assertSame($created->transactionId, $replay->transactionId);
        $this->assertSame('posted', $replay->status);
    }

    /** @test */
    public function generalized_link_migration_refuses_purchase_only_rollback_when_expense_audit_links_exist(): void
    {
        $fixture = $this->readyFixture('expense-migration-guard');
        $this->buildDraft($fixture, 'ينشأ الرابط قبل اختبار حارس rollback.');
        $migration = require base_path('database/migrations/2025_01_01_000125_generalize_document_transaction_links.php');

        $this->expectException(\RuntimeException::class);
        $migration->down();
    }

    /** @return array<string,mixed> */
    private function payload(array $fixture, array $overrides = []): array
    {
        return array_merge([
            'expected_version' => $fixture['batch']->version,
            'reason' => 'اختبار مسار إنشاء مسودة Expense المحمي.',
            'account_id' => $fixture['account']->id,
            'payment_method' => 'cash',
        ], $overrides);
    }

    /** @param array<string,mixed> $fixture */
    private function buildDraft(array $fixture, string $reason, ?string $accountId = null, ?string $categoryId = null, ?string $costCenterId = null, string $paymentMethod = 'cash'): \App\Contracts\CreatedDraftReference
    {
        return app(ExpenseDocumentDraftBuilder::class)->build(
            $fixture['batch'],
            new DraftBuildContext(
                expectedVersion: $fixture['batch']->version,
                reason: $reason,
                actorId: $fixture['actor']->id,
                options: new ExpenseDraftBuildOptions(
                    accountId: $accountId ?? $fixture['account']->id,
                    categoryId: $categoryId,
                    costCenterId: $costCenterId,
                    paymentMethod: $paymentMethod,
                ),
            ),
        );
    }

    /** @param array<string,mixed> $fixture */
    private function assertBuildFailsClosed(array $fixture, string $reason, ?string $accountId = null, ?string $categoryId = null, ?string $costCenterId = null, string $paymentMethod = 'cash', string $expectedStatus = 'ready_for_draft'): void
    {
        try {
            $this->buildDraft($fixture, $reason, $accountId, $categoryId, $costCenterId, $paymentMethod);
            $this->fail('Invalid expense evidence or reference must fail closed.');
        } catch (ValidationException) {
            $this->assertNoDraftState($fixture, $expectedStatus);
        }
    }

    /** @param array<string,mixed> $fixture */
    private function assertNoDraftState(array $fixture, string $expectedStatus = 'ready_for_draft'): void
    {
        $this->assertSame(0, DB::table('expenses')->where('tenant_id', $fixture['tenant_id'])->count());
        $this->assertSame(0, DB::table('document_transaction_links')->where('tenant_id', $fixture['tenant_id'])->count());
        $this->assertDatabaseHas('document_batches', ['id' => $fixture['batch']->id, 'status' => $expectedStatus]);
    }

    /** @return array<string,mixed> */
    private function readyFixture(string $tenantSlug = 'expense-draft-builder', bool $taxInclusive = false, string $currency = 'SAR', bool $markReady = true, string $documentType = 'expense', array $payloadOverrides = [], bool $withPartnerMatch = true): array
    {
        $email = "owner@{$tenantSlug}.test";
        $auth = $this->registerTenant($tenantSlug, $email);
        $branch = Branch::query()->where('tenant_id', $auth['tenant_id'])->firstOrFail();
        app(TenantContext::class)->set($auth['tenant_id']);
        app(BranchContext::class)->set($branch->id);
        $entitlementGroup = (string) \Illuminate\Support\Str::uuid();
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($auth['tenant_id']), 'document_center.core', EntitlementAccessMode::FULL, EntitlementSourceType::ADDON, now('UTC')->subMinute(), null, 'expense-draft-builder-test', (string) \Illuminate\Support\Str::uuid(), $entitlementGroup);
        $actor = \App\Models\User::query()->where('tenant_id', $auth['tenant_id'])->where('email', $email)->firstOrFail();
        $account = Account::query()->where('code', '5130')->firstOrFail();
        $partner = Partner::create(['type' => 'supplier', 'entity_type' => 'commercial', 'name' => 'مورد المصروف', 'is_active' => true]);
        $batch = DocumentBatch::create(['document_type' => $documentType, 'source_type' => 'manual', 'created_by' => $actor->id]);
        $workflow = app(DocumentWorkflowService::class);
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVING, 'fixture_receiving', 'user', $actor->id, 'تهيئة دليل المصروف.');
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::RECEIVED, 'fixture_received', 'user', $actor->id, 'تهيئة دليل المصروف.');
        $batch = $workflow->transition($batch, DocumentWorkflowStatus::NEEDS_REVIEW, 'fixture_review', 'user', $actor->id, 'تهيئة دليل المصروف.');

        $file = DocumentFile::create([
            'document_batch_id' => $batch->id,
            'original_name' => 'expense.pdf',
            'object_key' => "fixtures/{$tenantSlug}/expense.pdf",
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
        $defaultLines = [[
            'description' => 'إيصال مصروف مراجع',
            'quantity' => '1',
            'unit_price_minor' => $taxInclusive ? 11500 : 10000,
            'tax_amount_minor' => 1500,
            'total_minor' => 11500,
            'tax_rate' => '15',
        ]];
        $result = DocumentExtractionResult::create([
            'document_batch_id' => $batch->id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'fixture',
            'model' => 'local',
            'schema_version' => 1,
            'detected_document_type' => $documentType,
            'detected_language' => 'ar',
            'confidence_basis_points' => 9900,
            'normalized_payload' => [
                'fields' => array_merge([
                    'issuer_name' => 'مورد المصروف',
                    'document_number' => 'EXP-100',
                    'document_date' => '2026-08-25',
                    'currency' => $currency,
                    'price_includes_tax' => $taxInclusive,
                    'subtotal_minor' => 10000,
                    'tax_amount_minor' => 1500,
                    'total_amount_minor' => 11500,
                ], $payloadOverrides['fields'] ?? []),
                'lines' => $payloadOverrides['lines'] ?? [array_merge($defaultLines[0], $payloadOverrides['line'] ?? [])],
            ],
            'extracted_at' => now('UTC'),
        ]);
        if ($withPartnerMatch) {
            $this->confirmedMatch($batch, $result, 'header', 'header.counterparty', 'partner', $partner->id);
        }
        if ($markReady) {
            $batch = $workflow->transition($batch, DocumentWorkflowStatus::READY_FOR_DRAFT, 'fixture_ready', 'user', $actor->id, 'المراجعة مكتملة.');
        }

        return compact('batch', 'actor', 'partner', 'account', 'result', 'branch', 'entitlementGroup') + ['token' => $auth['token'], 'tenant_id' => $auth['tenant_id']];
    }

    /** @param array<string,mixed> $fixture */
    private function historicalResult(array $fixture): DocumentExtractionResult
    {
        $file = DocumentFile::create([
            'document_batch_id' => $fixture['batch']->id,
            'original_name' => 'expense-historical.pdf',
            'object_key' => 'fixtures/expense-current-result/historical.pdf',
            'declared_mime' => 'application/pdf',
            'detected_mime' => 'application/pdf',
            'size_bytes' => 128,
            'page_count' => 1,
            'sha256' => hash('sha256', 'expense-current-result-historical'),
            'scan_status' => DocumentScanStatus::CLEAN,
            'scanned_at' => now('UTC')->subMinute(),
        ]);
        $run = DocumentProcessingRun::create(['document_batch_id' => $fixture['batch']->id, 'document_file_id' => $file->id, 'stage' => 'extraction', 'status' => DocumentProcessingStatus::SUCCEEDED, 'attempt_count' => 1, 'queued_at' => now('UTC')->subMinute(), 'started_at' => now('UTC')->subMinute(), 'finished_at' => now('UTC')->subMinute()]);
        $attempt = DocumentProviderAttempt::create(['document_batch_id' => $fixture['batch']->id, 'document_file_id' => $file->id, 'document_processing_run_id' => $run->id, 'sequence' => 2, 'provider_key' => 'fixture-historical', 'model' => 'local', 'status' => 'succeeded', 'page_count' => 1, 'started_at' => now('UTC')->subMinute(), 'finished_at' => now('UTC')->subMinute()]);

        return DocumentExtractionResult::create([
            'document_batch_id' => $fixture['batch']->id,
            'document_file_id' => $file->id,
            'document_processing_run_id' => $run->id,
            'document_provider_attempt_id' => $attempt->id,
            'provider_key' => 'fixture-historical',
            'model' => 'local',
            'schema_version' => 1,
            'detected_document_type' => 'expense',
            'detected_language' => 'ar',
            'confidence_basis_points' => 9900,
            'normalized_payload' => $fixture['result']->normalized_payload,
            'extracted_at' => now('UTC')->subMinute(),
        ]);
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
        DocumentMatchCandidate::create(['document_match_result_id' => $match->id, 'candidate_type' => $matchedType, 'candidate_id' => $matchedId, 'rank' => 1, 'score_basis_points' => 10000, 'strategy' => 'fixture', 'explanation_codes' => ['fixture'], 'snapshot' => ['is_active' => true]]);
        DocumentReviewMutationGate::run(function () use ($match, $matchedType, $matchedId): void {
            $match->status = 'confirmed';
            $match->matched_type = $matchedType;
            $match->matched_id = $matchedId;
            $match->confirmed_at = now('UTC');
            $match->save();
        });
    }
}

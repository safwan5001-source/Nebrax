<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Branch;
use App\Models\CashBankAccount;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\SupplierRefund;
use App\Models\SupplierRefundAllocation;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\ReturnService;
use App\Services\Accounting\SupplierRefundService;
use App\Support\DocumentNumberingCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ACC-RET-1 — تجزئة مرتجع المشتريات عن استرداد المورّد.
 *
 *  - المرتجع: مدين الموردين (`accounts_payable`) بلا أي حركة نقد.
 *  - الاسترداد: مدين الخزينة/البنك (CashBankAccount) ودائن الموردين، مخصَّصٌ
 *    بالكامل على مرتجعات مرحّلة، بلا استرداد زائد ولا تخصيص مكرر.
 *
 * تشغيل: php artisan test --filter=SupplierRefundTest
 */
class SupplierRefundTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected ReturnService $returns;
    protected SupplierRefundService $refunds;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = $this->makeTenant('nibras', 'نبراس الطموح');
        app(TenantContext::class)->set($this->tenant->id);

        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->returns  = app(ReturnService::class);
        $this->refunds  = app(SupplierRefundService::class);
    }

    private function makeTenant(string $slug, string $name): Tenant
    {
        $tenant = Tenant::create([
            'name' => $name, 'slug' => $slug, 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();

        return $tenant;
    }

    /** مرتجع مشتريات مرحّل بإجمالي معلوم (بضاعة متابَعة + ضريبة 15%). */
    private function postedPurchaseReturn(int $unitPrice = 10000, int $quantity = 2, ?Partner $supplier = null): ReturnDocument
    {
        $product = Product::create([
            'name' => 'بضاعة ' . uniqid(), 'track_inventory' => true,
            'quantity_on_hand' => 100, 'avg_cost' => $unitPrice,
        ]);

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => ($supplier ?? $this->supplier)->id],
            [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );

        return $this->returns->post($return);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }

    private function refundFor(ReturnDocument $return, int $amount, array $overrides = []): SupplierRefund
    {
        return $this->refunds->create(
            array_merge(['partner_id' => $return->partner_id, 'amount' => $amount, 'method' => 'cash'], $overrides),
            [['purchase_return_id' => $return->id, 'amount' => $amount]],
        );
    }

    // ─────────────────── قطع المسار النقدي من المرتجع ───────────────────

    /** @test */
    public function a_new_purchase_return_debits_payables_with_the_supplier_dimension_and_moves_no_cash(): void
    {
        $return = $this->postedPurchaseReturn();

        $entry = JournalEntry::with('lines.account')->findOrFail($return->journal_entry_id);
        $payable = $this->line($entry, '2110');

        $this->assertNotNull($payable);
        $this->assertSame(23000, (int) $payable->debit);           // 20000 + 15% ضريبة
        $this->assertSame(Partner::class, $payable->partner_type); // الذمّة موسومة بالمورّد
        $this->assertSame($this->supplier->id, $payable->partner_id);

        // لا نقد ولا بنك داخل المرتجع إطلاقاً.
        $this->assertNull($this->line($entry, '1110'));
        $this->assertNull($this->line($entry, '1120'));

        // المبالغ والاتجاهات لم تتغيّر: مخزون 20000 دائن + ضريبة مدخلات 3000 دائن.
        $this->assertSame(20000, (int) $this->line($entry, '1140')->credit);
        $this->assertSame(3000, (int) $this->line($entry, '1150')->credit);
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
    }

    /** @test */
    public function a_non_tracked_purchase_return_still_credits_expense_and_input_vat_only(): void
    {
        $service = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false]);

        $return = $this->returns->post($this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id],
            [['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15]]
        ));

        $entry = JournalEntry::with('lines.account')->findOrFail($return->journal_entry_id);
        $this->assertSame(23000, (int) $this->line($entry, '2110')->debit);
        $this->assertSame(20000, (int) $this->line($entry, '5150')->credit);
        $this->assertSame(3000, (int) $this->line($entry, '1150')->credit);
        $this->assertNull($this->line($entry, '1140'));
        $this->assertNull($this->line($entry, '1110'));
    }

    /** @test */
    public function historical_cash_purchase_returns_stay_readable_and_untouched(): void
    {
        // مرتجع تاريخي مرحّل على 1110 كما كان يفعل النظام قبل ACC-RET-1.
        $legacy = ReturnDocument::create([
            'number' => 'PRET-LEGACY-1', 'type' => 'purchase', 'partner_id' => $this->supplier->id,
            'payment_type' => 'cash', 'return_date' => now()->toDateString(), 'status' => 'posted',
            'subtotal' => 10000, 'tax_amount' => 1500, 'total' => 11500,
        ]);

        $fresh = ReturnDocument::findOrFail($legacy->id);
        $this->assertSame('cash', $fresh->payment_type);   // الحقل باقٍ ومقروء
        $this->assertSame('posted', $fresh->status);
        $this->assertSame(11500, (int) $fresh->total);
    }

    /** @test */
    public function the_api_rejects_a_new_cash_purchase_return_with_an_explicit_error(): void
    {
        $auth = $this->apiTenant();
        $supplier = $this->apiSupplier($auth['token']);
        $product = $this->apiProduct($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/returns', [
            'type' => 'purchase', 'partner_id' => $supplier, 'payment_type' => 'cash',
            'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertStatus(422)->assertJsonValidationErrors('payment_type');
    }

    /** @test */
    public function the_api_still_accepts_a_purchase_return_without_any_payment_type(): void
    {
        $auth = $this->apiTenant();
        $supplier = $this->apiSupplier($auth['token']);
        $product = $this->apiProduct($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/returns', [
            'type' => 'purchase', 'partner_id' => $supplier,
            'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();
    }

    // ─────────────────────── قيد استرداد المورّد ───────────────────────

    /** @test */
    public function posting_a_refund_debits_the_selected_cash_account_and_credits_payables(): void
    {
        $return = $this->postedPurchaseReturn();
        $refund = $this->refundFor($return, 23000);

        $posted = $this->refunds->post($refund);

        $this->assertSame('posted', $posted->status);
        $this->assertNotNull($posted->journal_entry_id);
        $this->assertNotNull($posted->posted_at);

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame(23000, (int) $this->line($entry, '1110')->debit);  // الخزينة الرئيسية
        $payable = $this->line($entry, '2110');
        $this->assertSame(23000, (int) $payable->credit);
        $this->assertSame(Partner::class, $payable->partner_type);
        $this->assertSame($this->supplier->id, $payable->partner_id);
        $this->assertSame(SupplierRefund::class, $entry->source_type);
        $this->assertSame($posted->id, $entry->source_id);
    }

    /** @test */
    public function a_bank_refund_debits_the_bank_account_not_the_cash_box(): void
    {
        $return = $this->postedPurchaseReturn();
        $refund = $this->refundFor($return, 23000, ['method' => 'bank']);

        $posted = $this->refunds->post($refund);
        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);

        $this->assertSame(23000, (int) $this->line($entry, '1120')->debit);
        $this->assertNull($this->line($entry, '1110'));
    }

    /** @test */
    public function a_mapped_payable_account_is_used_and_an_invalid_mapping_fails_closed(): void
    {
        $custom = Account::create([
            'tenant_id' => $this->tenant->id, 'code' => '2119', 'name' => 'موردون مخصص',
            'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true,
        ]);
        AccountRoleMapping::query()->where('role_key', 'accounts_payable')
            ->update(['account_id' => $custom->id]);

        $return = $this->postedPurchaseReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame(23000, (int) $this->line($entry, '2119')->credit);
        $this->assertNull($this->line($entry, '2110'));

        // التعيين يصبح غير صالح ← الترحيل يفشل مغلقاً بلا سقوط على 2110.
        $custom->update(['is_active' => false]);
        $second = $this->postedPurchaseReturnExpectingFailure();
        $this->assertNull($second);
    }

    /** ترحيل مرتجع بتعيين AP معطّل يجب أن يفشل — يعيد null عند الفشل المتوقّع. */
    private function postedPurchaseReturnExpectingFailure(): ?ReturnDocument
    {
        try {
            return $this->postedPurchaseReturn();
        } catch (RuntimeException) {
            return null;
        }
    }

    /** @test */
    public function a_refund_cannot_be_posted_to_an_inactive_cash_account(): void
    {
        $return = $this->postedPurchaseReturn();
        $refund = $this->refundFor($return, 23000);

        CashBankAccount::where('type', 'cash')->where('is_main', true)->first()
            ->forceFill(['is_active' => false])->save();

        $this->expectException(RuntimeException::class);
        $this->refunds->post($refund);
    }

    /** @test */
    public function a_refund_cannot_be_posted_when_deposit_is_not_allowed_for_the_actor(): void
    {
        $return = $this->postedPurchaseReturn();
        $refund = $this->refundFor($return, 23000);

        $cash = CashBankAccount::where('type', 'cash')->where('is_main', true)->first();
        $other = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'آخر', 'email' => 'other-deposit@acme.test',
            'password' => 'password123', 'role' => 'staff',
        ]);
        $cash->forceFill(['deposit_scope' => 'user', 'deposit_scope_subject' => $other->id])->save();

        $actor = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'denied-deposit@acme.test',
            'password' => 'password123', 'role' => 'accountant',
        ]);

        $this->expectException(RuntimeException::class);
        $this->refunds->post($refund, $actor);
    }

    /** @test */
    public function a_cash_method_cannot_select_a_bank_account(): void
    {
        $return = $this->postedPurchaseReturn();
        $bankAccountId = CashBankAccount::where('type', 'bank')->where('is_main', true)->first()->account_id;

        $this->expectException(RuntimeException::class);
        $this->refundFor($return, 23000, ['method' => 'cash', 'cash_account_id' => $bankAccountId]);
    }

    // ─────────────────────────── التخصيص ───────────────────────────

    /** @test */
    public function a_refund_must_be_fully_allocated(): void
    {
        $return = $this->postedPurchaseReturn();

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $this->supplier->id, 'amount' => 23000, 'method' => 'cash'],
            [['purchase_return_id' => $return->id, 'amount' => 10000]], // أقل من المبلغ
        );
    }

    /** @test */
    public function an_unallocated_refund_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $this->supplier->id, 'amount' => 23000, 'method' => 'cash'],
            [],
        );
    }

    /** @test */
    public function allocation_to_a_draft_return_is_rejected(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 10000]);
        $draft = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        );

        $this->expectException(RuntimeException::class);
        $this->refundFor($draft, 11500);
    }

    /** @test */
    public function allocation_to_a_sales_return_is_rejected(): void
    {
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 4000]);
        $salesReturn = $this->returns->post($this->returns->create(
            ['type' => 'sales', 'partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        ));

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $customer->id, 'amount' => 11500, 'method' => 'cash'],
            [['purchase_return_id' => $salesReturn->id, 'amount' => 11500]],
        );
    }

    /** @test */
    public function allocation_to_another_suppliers_return_is_rejected(): void
    {
        $return = $this->postedPurchaseReturn();
        $otherSupplier = Partner::create(['name' => 'مورد آخر', 'type' => 'supplier']);

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $otherSupplier->id, 'amount' => 23000, 'method' => 'cash'],
            [['purchase_return_id' => $return->id, 'amount' => 23000]],
        );
    }

    /** @test */
    public function the_same_return_cannot_be_allocated_twice_inside_one_refund(): void
    {
        $return = $this->postedPurchaseReturn();

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $this->supplier->id, 'amount' => 23000, 'method' => 'cash'],
            [
                ['purchase_return_id' => $return->id, 'amount' => 11500],
                ['purchase_return_id' => $return->id, 'amount' => 11500],
            ],
        );
    }

    /** @test */
    public function over_refunding_a_return_is_rejected(): void
    {
        $return = $this->postedPurchaseReturn(); // 23000

        $this->expectException(RuntimeException::class);
        $this->refundFor($return, 23001);
    }

    /** @test */
    public function a_second_refund_cannot_exceed_the_remaining_refundable_balance(): void
    {
        $return = $this->postedPurchaseReturn(); // 23000
        $this->refunds->post($this->refundFor($return, 20000));

        $this->assertSame(3000, $this->refunds->refundableBalance($return->fresh()));

        $this->expectException(RuntimeException::class);
        $this->refundFor($return, 3001);
    }

    /** @test */
    public function two_draft_refunds_cannot_both_post_beyond_the_return_balance(): void
    {
        $return = $this->postedPurchaseReturn(); // 23000

        // مسوّدتان أُنشئتا قبل ترحيل أيٍّ منهما: لا حجز عند الإنشاء، والحسم
        // النهائي داخل قفل الترحيل — الثانية تُرفض.
        $first  = $this->refundFor($return, 15000);
        $second = $this->refundFor($return, 15000);

        $this->refunds->post($first);

        $this->expectException(RuntimeException::class);
        $this->refunds->post($second);
    }

    /** @test */
    public function a_failed_post_leaves_no_journal_and_no_status_change(): void
    {
        $return = $this->postedPurchaseReturn();
        $first  = $this->refundFor($return, 15000);
        $second = $this->refundFor($return, 15000);
        $this->refunds->post($first);

        $entriesBefore = JournalEntry::query()->count();

        try {
            $this->refunds->post($second);
            $this->fail('كان يجب رفض الاسترداد الثاني.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $this->assertSame($entriesBefore, JournalEntry::query()->count());
        $this->assertSame('draft', $second->fresh()->status);
        $this->assertNull($second->fresh()->journal_entry_id);
    }

    /** @test */
    public function a_refund_can_be_split_across_two_returns_of_the_same_supplier(): void
    {
        $first  = $this->postedPurchaseReturn(10000, 2); // 23000
        $second = $this->postedPurchaseReturn(5000, 2);  // 11500

        $refund = $this->refunds->create(
            ['partner_id' => $this->supplier->id, 'amount' => 34500, 'method' => 'cash'],
            [
                ['purchase_return_id' => $first->id, 'amount' => 23000],
                ['purchase_return_id' => $second->id, 'amount' => 11500],
            ],
        );
        $posted = $this->refunds->post($refund);

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame(34500, (int) $this->line($entry, '1110')->debit);
        $this->assertSame(0, $this->refunds->refundableBalance($first->fresh()));
        $this->assertSame(0, $this->refunds->refundableBalance($second->fresh()));
    }

    /** @test */
    public function eligible_returns_exclude_fully_refunded_ones(): void
    {
        $open = $this->postedPurchaseReturn(10000, 2);   // 23000
        $done = $this->postedPurchaseReturn(5000, 2);    // 11500
        $this->refunds->post($this->refundFor($done, 11500));

        $eligible = collect($this->refunds->eligibleReturns($this->supplier->id));

        $this->assertTrue($eligible->contains('id', $open->id));
        $this->assertFalse($eligible->contains('id', $done->id));
        $this->assertSame(23000, $eligible->firstWhere('id', $open->id)['refundable']);
    }

    // ─────────────────────────── العكس ───────────────────────────

    /** @test */
    public function reversing_a_refund_reverses_the_original_entry_and_restores_the_balance(): void
    {
        $return = $this->postedPurchaseReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));
        $this->assertSame(0, $this->refunds->refundableBalance($return->fresh()));

        $reversed = $this->refunds->reverse($posted);

        $this->assertSame('reversed', $reversed->status);
        $this->assertNotNull($reversed->reversal_entry_id);
        $this->assertNotNull($reversed->reversed_at);

        // الرصيد القابل للاسترداد يعود كاملاً، وصفوف التخصيص تبقى تاريخاً.
        $this->assertSame(23000, $this->refunds->refundableBalance($return->fresh()));
        $this->assertSame(1, SupplierRefundAllocation::where('supplier_refund_id', $reversed->id)->count());
    }

    /** @test */
    public function reversal_uses_the_original_concrete_accounts_even_after_remapping(): void
    {
        $return = $this->postedPurchaseReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));

        // إعادة تعيين AP بعد الترحيل — يجب ألا تمسّ العكس إطلاقاً.
        $custom = Account::create([
            'tenant_id' => $this->tenant->id, 'code' => '2118', 'name' => 'موردون بديل',
            'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true,
        ]);
        AccountRoleMapping::query()->where('role_key', 'accounts_payable')->update(['account_id' => $custom->id]);

        $reversed = $this->refunds->reverse($posted);
        $entry = JournalEntry::with('lines.account')->findOrFail($reversed->reversal_entry_id);

        $this->assertSame(23000, (int) $this->line($entry, '2110')->debit); // الحساب الأصلي
        $this->assertSame(23000, (int) $this->line($entry, '1110')->credit);
        $this->assertNull($this->line($entry, '2118'));
    }

    /** @test */
    public function a_reversed_refund_frees_the_balance_for_a_new_refund(): void
    {
        $return = $this->postedPurchaseReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));
        $this->refunds->reverse($posted);

        $again = $this->refunds->post($this->refundFor($return, 23000));

        $this->assertSame('posted', $again->status);
        $this->assertSame(0, $this->refunds->refundableBalance($return->fresh()));
    }

    /** @test */
    public function a_draft_refund_cannot_be_reversed_and_a_posted_one_cannot_be_edited_or_deleted(): void
    {
        $return = $this->postedPurchaseReturn();
        $draft = $this->refundFor($return, 23000);

        try {
            $this->refunds->reverse($draft);
            $this->fail('كان يجب رفض عكس مسوّدة.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $posted = $this->refunds->post($draft);

        try {
            $this->refunds->update($posted, ['partner_id' => $this->supplier->id, 'amount' => 100], [
                ['purchase_return_id' => $return->id, 'amount' => 100],
            ]);
            $this->fail('كان يجب رفض تعديل مستند مرحّل.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $this->expectException(RuntimeException::class);
        $this->refunds->delete($posted);
    }

    /** @test */
    public function posting_the_same_refund_twice_creates_only_one_journal(): void
    {
        $return = $this->postedPurchaseReturn();
        $refund = $this->refundFor($return, 23000);

        $this->refunds->post($refund);
        $entries = JournalEntry::query()->count();

        try {
            $this->refunds->post($refund->fresh());
            $this->fail('كان يجب رفض الترحيل المزدوج.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $this->assertSame($entries, JournalEntry::query()->count());
    }

    // ─────────────────────── الترقيم والعزل ───────────────────────

    /** @test */
    public function numbering_uses_the_shared_document_layer_with_the_srf_prefix(): void
    {
        $first  = $this->postedPurchaseReturn(10000, 2);
        $second = $this->postedPurchaseReturn(5000, 2);

        $one = $this->refundFor($first, 23000);
        $two = $this->refundFor($second, 11500);

        $year = now()->format('Y');
        $this->assertSame("SRF-{$year}-00001", $one->number);
        $this->assertSame("SRF-{$year}-00002", $two->number);
        $this->assertTrue(DocumentNumberingCatalog::hasSeries('supplier_refund', 'default'));
    }

    /** @test */
    public function refunds_are_isolated_per_tenant(): void
    {
        $return = $this->postedPurchaseReturn();
        $this->refunds->post($this->refundFor($return, 23000));

        $other = $this->makeTenant('other', 'مؤسسة أخرى');
        app(TenantContext::class)->set($other->id);

        $this->assertSame(0, SupplierRefund::query()->count());
        $this->assertSame(0, SupplierRefundAllocation::query()->count());
        // مرتجع المستأجر الأول غير مرئي، فلا يمكن تخصيص استرداد عليه.
        $this->assertNull(ReturnDocument::find($return->id));
    }

    /** @test */
    public function a_refund_cannot_allocate_to_another_tenants_return(): void
    {
        $foreignReturn = $this->postedPurchaseReturn();

        $other = $this->makeTenant('other2', 'مؤسسة ثانية');
        app(TenantContext::class)->set($other->id);
        $otherSupplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);

        $this->expectException(RuntimeException::class);
        app(SupplierRefundService::class)->create(
            ['partner_id' => $otherSupplier->id, 'amount' => 23000, 'method' => 'cash'],
            [['purchase_return_id' => $foreignReturn->id, 'amount' => 23000]],
        );
    }

    /** @test */
    public function a_refund_keeps_the_branch_of_its_document_on_the_journal(): void
    {
        $branch = Branch::create(['code' => '00002', 'name' => 'فرع ثانٍ', 'is_main' => false]);
        $return = $this->postedPurchaseReturn();

        $refund = $this->refunds->create(
            ['partner_id' => $this->supplier->id, 'amount' => 23000, 'method' => 'cash', 'branch_id' => $branch->id],
            [['purchase_return_id' => $return->id, 'amount' => 23000]],
        );
        $posted = $this->refunds->post($refund);

        $this->assertSame($branch->id, $posted->branch_id);
        // بُعد الفرع يُوسَم على سطور القيد (لا على رأسه) — كل سطر يتبع فرع
        // المستند لا الفرع النشط وقت الترحيل.
        $entry = JournalEntry::with('lines')->findOrFail($posted->journal_entry_id);
        $this->assertNotEmpty($entry->lines);
        foreach ($entry->lines as $line) {
            $this->assertSame($branch->id, $line->branch_id);
        }
    }

    // ─────────────────────────── الصلاحيات ───────────────────────────

    /** @test */
    public function supplier_refund_permissions_are_independent_of_returns_permissions(): void
    {
        $this->assertContains('supplier_refunds.view', \App\Support\Rbac::PERMISSIONS);
        $this->assertContains('supplier_refunds.manage', \App\Support\Rbac::PERMISSIONS);

        $this->assertTrue(\App\Support\Rbac::allows('owner', 'supplier_refunds.manage'));
        $this->assertTrue(\App\Support\Rbac::allows('admin', 'supplier_refunds.manage'));
        // `returns.manage` وحدها لا تمنح تحريك نقد.
        $this->assertFalse(\App\Support\Rbac::allows('accountant', 'supplier_refunds.manage'));
        $this->assertFalse(\App\Support\Rbac::allows('staff', 'supplier_refunds.view'));
    }

    // ─────────────────────────── مساعدات API ───────────────────────────

    use InteractsWithApi;

    private function apiTenant(): array
    {
        return $this->registerTenant('api-ret', 'owner-ret@acme.test');
    }

    private function apiSupplier(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'مورد API', 'type' => 'supplier',
        ])->assertCreated()->json('data.id');
    }

    private function apiProduct(string $token): string
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج API', 'type' => 'good', 'sale_price' => 10000, 'track_inventory' => true,
        ])->assertCreated()->json('data.id');
    }
}

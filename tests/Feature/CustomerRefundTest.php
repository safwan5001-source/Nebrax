<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Branch;
use App\Models\CashBankAccount;
use App\Models\CreditNote;
use App\Models\CustomerRefund;
use App\Models\CustomerRefundAllocation;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\CustomerRefundService;
use App\Services\Accounting\ReturnService;
use App\Support\DocumentNumberingCatalog;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * PAY-V2-6B — استرداد العميل مستقل عن مرتجع المبيعات/الإشعار الدائن.
 *
 *  - المرتجع الآجل: دائن العملاء (1130 / دور accounts_receivable) بلا خروج نقد
 *    من هذا المستند المالي.
 *  - الاسترداد: مدين العملاء ودائن الخزينة/البنك، مخصَّصٌ بالكامل على تصحيحات
 *    مرحّلة أنشأت رصيد عميل، بلا استرداد زائد ولا تخصيص مكرر.
 *
 * تشغيل: php artisan test --filter=CustomerRefundTest
 */
class CustomerRefundTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected Tenant $tenant;
    protected Partner $customer;
    protected ReturnService $returns;
    protected CreditNoteService $notes;
    protected CustomerRefundService $refunds;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = $this->makeTenant('nibras-crf', 'نبراس الطموح');
        app(TenantContext::class)->set($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->returns  = app(ReturnService::class);
        $this->notes    = app(CreditNoteService::class);
        $this->refunds  = app(CustomerRefundService::class);
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

    /** مرتجع مبيعات آجل مرحّل بإجمالي معلوم (خدمة بلا مخزون + ضريبة 15%). */
    private function postedSalesReturn(int $unitPrice = 10000, int $quantity = 2, ?Partner $customer = null, string $paymentType = 'credit'): ReturnDocument
    {
        $product = Product::create([
            'name' => 'خدمة ' . uniqid(), 'type' => 'service', 'track_inventory' => false,
        ]);

        $return = $this->returns->create(
            [
                'type' => 'sales',
                'partner_id' => ($customer ?? $this->customer)->id,
                'payment_type' => $paymentType,
            ],
            [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );

        return $this->returns->post($return);
    }

    private function postedCreditNote(int $unitPrice = 10000, int $quantity = 1, ?Partner $customer = null, string $refundType = 'credit'): CreditNote
    {
        $note = $this->notes->create(
            [
                'type' => 'sales',
                'partner_id' => ($customer ?? $this->customer)->id,
                'refund_type' => $refundType,
                'reason' => 'تصحيح تجاري',
            ],
            [['description' => 'تصحيح', 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );

        return $this->notes->post($note);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }

    private function refundFor(ReturnDocument|CreditNote $source, int $amount, array $overrides = []): CustomerRefund
    {
        $kind = $source instanceof ReturnDocument
            ? CustomerRefundService::SOURCE_SALES_RETURN
            : CustomerRefundService::SOURCE_CREDIT_NOTE;

        return $this->refunds->create(
            array_merge(['partner_id' => $source->partner_id, 'amount' => $amount, 'method' => 'cash'], $overrides),
            [['source_type' => $kind, 'source_id' => $source->id, 'amount' => $amount]],
        );
    }

    /** ينفّذ الإغلاق داخل فرع كتابة محدد ثم يعيد السياق السابق. */
    private function onBranch(?string $branchId, callable $fn): mixed
    {
        $ctx = app(BranchContext::class);
        $previous = $ctx->id();
        $branchId === null ? $ctx->forget() : $ctx->set($branchId);
        try {
            return $fn();
        } finally {
            $previous === null ? $ctx->forget() : $ctx->set($previous);
        }
    }

    private function postedSalesReturnOnBranch(string $branchId, int $unitPrice = 10000, int $quantity = 2, ?Partner $customer = null): ReturnDocument
    {
        return $this->onBranch($branchId, fn () => $this->postedSalesReturn($unitPrice, $quantity, $customer));
    }

    private function postedCreditNoteOnBranch(string $branchId, int $unitPrice = 10000, int $quantity = 1, ?Partner $customer = null): CreditNote
    {
        return $this->onBranch($branchId, fn () => $this->postedCreditNote($unitPrice, $quantity, $customer));
    }

    // ─────────────────────── قيد استرداد العميل ───────────────────────

    /** @test */
    public function posting_a_refund_debits_receivable_and_credits_the_selected_cash_account(): void
    {
        $return = $this->postedSalesReturn();
        $this->assertSame('credit', $return->payment_type);

        $commercial = JournalEntry::with('lines.account')->findOrFail($return->journal_entry_id);
        $this->assertSame(23000, (int) $this->line($commercial, '1130')->credit);
        $this->assertSame(Partner::class, $this->line($commercial, '1130')->partner_type);
        $this->assertSame($this->customer->id, $this->line($commercial, '1130')->partner_id);
        $this->assertNull($this->line($commercial, '1110'));

        $refund = $this->refundFor($return, 23000);
        $posted = $this->refunds->post($refund);

        $this->assertSame('posted', $posted->status);
        $this->assertNotNull($posted->journal_entry_id);
        $this->assertNotNull($posted->posted_at);

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $receivable = $this->line($entry, '1130');
        $this->assertSame(23000, (int) $receivable->debit);
        $this->assertSame(Partner::class, $receivable->partner_type);
        $this->assertSame($this->customer->id, $receivable->partner_id);
        $this->assertSame(23000, (int) $this->line($entry, '1110')->credit);
        $this->assertSame(CustomerRefund::class, $entry->source_type);
        $this->assertSame($posted->id, $entry->source_id);

        $return->refresh();
        $this->assertSame('posted', $return->status);
        $this->assertSame(23000, (int) $return->total);
        $this->assertSame($commercial->id, $return->journal_entry_id);
        $this->assertSame(0, Payment::query()->count());
    }

    /** @test */
    public function a_bank_refund_credits_the_bank_account_not_the_cash_box(): void
    {
        $return = $this->postedSalesReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000, ['method' => 'bank']));
        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);

        $this->assertSame(23000, (int) $this->line($entry, '1120')->credit);
        $this->assertNull($this->line($entry, '1110'));
        $this->assertSame(23000, (int) $this->line($entry, '1130')->debit);
    }

    /** @test */
    public function a_mapped_receivable_account_is_used_and_an_invalid_mapping_fails_closed(): void
    {
        $custom = Account::create([
            'tenant_id' => $this->tenant->id, 'code' => '1139', 'name' => 'عملاء مخصص',
            'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true,
        ]);
        AccountRoleMapping::query()->where('role_key', 'accounts_receivable')
            ->update(['account_id' => $custom->id]);

        $return = $this->postedSalesReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame(23000, (int) $this->line($entry, '1139')->debit);
        $this->assertNull($this->line($entry, '1130'));

        $custom->update(['is_active' => false]);
        $secondReturn = $this->postedSalesReturn(5000, 2);
        $this->expectException(RuntimeException::class);
        $this->refunds->post($this->refundFor($secondReturn, 11500));
    }

    /** @test */
    public function a_refund_cannot_be_posted_to_an_inactive_cash_account(): void
    {
        $return = $this->postedSalesReturn();
        $refund = $this->refundFor($return, 23000);

        CashBankAccount::where('type', 'cash')->where('is_main', true)->first()
            ->forceFill(['is_active' => false])->save();

        $this->expectException(RuntimeException::class);
        $this->refunds->post($refund);
    }

    /** @test */
    public function a_refund_cannot_be_posted_when_withdraw_is_not_allowed_for_the_actor(): void
    {
        $return = $this->postedSalesReturn();
        $refund = $this->refundFor($return, 23000);

        $cash = CashBankAccount::where('type', 'cash')->where('is_main', true)->first();
        $other = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'آخر', 'email' => 'other-withdraw@acme.test',
            'password' => 'password123', 'role' => 'staff',
        ]);
        $cash->forceFill(['withdraw_scope' => 'user', 'withdraw_scope_subject' => $other->id])->save();

        $actor = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'محاسب', 'email' => 'denied-withdraw@acme.test',
            'password' => 'password123', 'role' => 'accountant',
        ]);

        $this->expectException(RuntimeException::class);
        $this->refunds->post($refund, $actor);
    }

    /** @test */
    public function a_cash_method_cannot_select_a_bank_account(): void
    {
        $return = $this->postedSalesReturn();
        $bankAccountId = CashBankAccount::where('type', 'bank')->where('is_main', true)->first()->account_id;

        $this->expectException(RuntimeException::class);
        $this->refundFor($return, 23000, ['method' => 'cash', 'cash_account_id' => $bankAccountId]);
    }

    // ─────────────────────────── التخصيص ───────────────────────────

    /** @test */
    public function a_refund_must_be_fully_allocated(): void
    {
        $return = $this->postedSalesReturn();

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 23000, 'method' => 'cash'],
            [['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 10000]],
        );
    }

    /** @test */
    public function an_unallocated_refund_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 23000, 'method' => 'cash'],
            [],
        );
    }

    /** @test */
    public function allocation_to_a_draft_return_is_rejected(): void
    {
        $product = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false]);
        $draft = $this->returns->create(
            ['type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        );

        $this->expectException(RuntimeException::class);
        $this->refundFor($draft, 11500);
    }

    /** @test */
    public function allocation_to_a_cash_sales_return_is_rejected(): void
    {
        $cashReturn = $this->postedSalesReturn(10000, 1, null, 'cash');

        $this->expectException(RuntimeException::class);
        $this->refundFor($cashReturn, 11500);
    }

    /** @test */
    public function allocation_to_a_purchase_return_is_rejected(): void
    {
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 10, 'avg_cost' => 4000]);
        $purchaseReturn = $this->returns->post($this->returns->create(
            ['type' => 'purchase', 'partner_id' => $supplier->id],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        ));

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 11500, 'method' => 'cash'],
            [['source_type' => 'sales_return', 'source_id' => $purchaseReturn->id, 'amount' => 11500]],
        );
    }

    /** @test */
    public function allocation_to_another_customers_return_is_rejected(): void
    {
        $return = $this->postedSalesReturn();
        $otherCustomer = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $otherCustomer->id, 'amount' => 23000, 'method' => 'cash'],
            [['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 23000]],
        );
    }

    /** @test */
    public function a_supplier_partner_cannot_receive_a_customer_refund(): void
    {
        $supplier = Partner::create(['name' => 'مورد فقط', 'type' => 'supplier']);
        $return = $this->postedSalesReturn();

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $supplier->id, 'amount' => 23000, 'method' => 'cash'],
            [['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 23000]],
        );
    }

    /** @test */
    public function the_same_return_cannot_be_allocated_twice_inside_one_refund(): void
    {
        $return = $this->postedSalesReturn();

        $this->expectException(RuntimeException::class);
        $this->refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 23000, 'method' => 'cash'],
            [
                ['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 11500],
                ['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 11500],
            ],
        );
    }

    /** @test */
    public function over_refunding_a_return_is_rejected(): void
    {
        $return = $this->postedSalesReturn();

        $this->expectException(RuntimeException::class);
        $this->refundFor($return, 23001);
    }

    /** @test */
    public function a_partial_refund_leaves_the_remaining_balance(): void
    {
        $return = $this->postedSalesReturn();
        $this->refunds->post($this->refundFor($return, 10000));

        $this->assertSame(13000, $this->refunds->refundableBalance($return->fresh()));
    }

    /** @test */
    public function a_second_refund_cannot_exceed_the_remaining_refundable_balance(): void
    {
        $return = $this->postedSalesReturn();
        $this->refunds->post($this->refundFor($return, 20000));

        $this->assertSame(3000, $this->refunds->refundableBalance($return->fresh()));

        $this->expectException(RuntimeException::class);
        $this->refundFor($return, 3001);
    }

    /** @test */
    public function multiple_partial_refunds_can_exhaust_the_balance(): void
    {
        $return = $this->postedSalesReturn();
        $this->refunds->post($this->refundFor($return, 10000));
        $this->refunds->post($this->refundFor($return, 13000));

        $this->assertSame(0, $this->refunds->refundableBalance($return->fresh()));
        $this->assertSame(2, CustomerRefund::query()->where('status', 'posted')->count());
    }

    /** @test */
    public function two_draft_refunds_cannot_both_post_beyond_the_return_balance(): void
    {
        $return = $this->postedSalesReturn();

        $first  = $this->refundFor($return, 15000);
        $second = $this->refundFor($return, 15000);

        $this->refunds->post($first);

        $this->expectException(RuntimeException::class);
        $this->refunds->post($second);
    }

    /** @test */
    public function a_failed_post_leaves_no_journal_and_no_status_change(): void
    {
        $return = $this->postedSalesReturn();
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
    public function a_refund_can_be_split_across_a_return_and_a_credit_note_of_the_same_customer(): void
    {
        $return = $this->postedSalesReturn(10000, 2); // 23000
        $note   = $this->postedCreditNote(10000, 1);  // 11500

        $refund = $this->refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 34500, 'method' => 'cash'],
            [
                ['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 23000],
                ['source_type' => 'credit_note', 'source_id' => $note->id, 'amount' => 11500],
            ],
        );
        $posted = $this->refunds->post($refund);

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame(34500, (int) $this->line($entry, '1110')->credit);
        $this->assertSame(34500, (int) $this->line($entry, '1130')->debit);
        $this->assertSame(0, $this->refunds->refundableBalance($return->fresh()));
        $this->assertSame(0, $this->refunds->refundableBalance($note->fresh()));
    }

    /** @test */
    public function a_posted_credit_note_is_an_eligible_source(): void
    {
        $note = $this->postedCreditNote(20000, 1); // 23000
        $posted = $this->refunds->post($this->refundFor($note, 23000));

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertSame(23000, (int) $this->line($entry, '1130')->debit);
        $this->assertSame(23000, (int) $this->line($entry, '1110')->credit);
        $this->assertSame(0, $this->refunds->refundableBalance($note->fresh()));
        $this->assertSame('posted', $note->fresh()->status);
        $this->assertSame(23000, (int) $note->fresh()->total);
    }

    /** @test */
    public function a_cash_credit_note_is_rejected(): void
    {
        $note = $this->postedCreditNote(10000, 1, null, 'cash');

        $this->expectException(RuntimeException::class);
        $this->refundFor($note, 11500);
    }

    /** @test */
    public function eligible_sources_exclude_fully_refunded_and_cash_documents(): void
    {
        $open = $this->postedSalesReturn(10000, 2);   // 23000
        $done = $this->postedSalesReturn(5000, 2);    // 11500
        $cash = $this->postedSalesReturn(10000, 1, null, 'cash');
        $this->refunds->post($this->refundFor($done, 11500));

        $eligible = collect($this->refunds->eligibleSources($this->customer->id));

        $this->assertTrue($eligible->contains('id', $open->id));
        $this->assertFalse($eligible->contains('id', $done->id));
        $this->assertFalse($eligible->contains('id', $cash->id));
        $this->assertSame(23000, $eligible->firstWhere('id', $open->id)['refundable']);
    }

    // ─────────────────────────── العكس ───────────────────────────

    /** @test */
    public function reversing_a_refund_reverses_the_original_entry_and_restores_the_balance(): void
    {
        $return = $this->postedSalesReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));
        $this->assertSame(0, $this->refunds->refundableBalance($return->fresh()));

        $reversed = $this->refunds->reverse($posted);

        $this->assertSame('reversed', $reversed->status);
        $this->assertNotNull($reversed->reversal_entry_id);
        $this->assertNotNull($reversed->reversed_at);

        $entry = JournalEntry::with('lines.account')->findOrFail($reversed->reversal_entry_id);
        $this->assertSame(23000, (int) $this->line($entry, '1130')->credit);
        $this->assertSame(23000, (int) $this->line($entry, '1110')->debit);

        $this->assertSame(23000, $this->refunds->refundableBalance($return->fresh()));
        $this->assertSame(1, CustomerRefundAllocation::where('customer_refund_id', $reversed->id)->count());
    }

    /** @test */
    public function reversal_uses_the_original_concrete_accounts_even_after_remapping(): void
    {
        $return = $this->postedSalesReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));

        $custom = Account::create([
            'tenant_id' => $this->tenant->id, 'code' => '1138', 'name' => 'عملاء بديل',
            'type' => 'asset', 'normal_balance' => 'debit', 'is_group' => false, 'is_active' => true,
        ]);
        AccountRoleMapping::query()->where('role_key', 'accounts_receivable')->update(['account_id' => $custom->id]);

        $reversed = $this->refunds->reverse($posted);
        $entry = JournalEntry::with('lines.account')->findOrFail($reversed->reversal_entry_id);

        $this->assertSame(23000, (int) $this->line($entry, '1130')->credit);
        $this->assertSame(23000, (int) $this->line($entry, '1110')->debit);
        $this->assertNull($this->line($entry, '1138'));
    }

    /** @test */
    public function a_reversed_refund_frees_the_balance_for_a_new_refund(): void
    {
        $return = $this->postedSalesReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));
        $this->refunds->reverse($posted);

        $again = $this->refunds->post($this->refundFor($return, 23000));

        $this->assertSame('posted', $again->status);
        $this->assertSame(0, $this->refunds->refundableBalance($return->fresh()));
    }

    /** @test */
    public function a_draft_refund_cannot_be_reversed_and_a_posted_one_cannot_be_edited_or_deleted(): void
    {
        $return = $this->postedSalesReturn();
        $draft = $this->refundFor($return, 23000);

        try {
            $this->refunds->reverse($draft);
            $this->fail('كان يجب رفض عكس مسوّدة.');
        } catch (RuntimeException) {
            // متوقّع
        }

        $posted = $this->refunds->post($draft);

        try {
            $this->refunds->update($posted, ['partner_id' => $this->customer->id, 'amount' => 100], [
                ['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 100],
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
        $return = $this->postedSalesReturn();
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

    /** @test */
    public function reversing_the_same_refund_twice_is_rejected(): void
    {
        $return = $this->postedSalesReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000));
        $this->refunds->reverse($posted);

        $this->expectException(RuntimeException::class);
        $this->refunds->reverse($posted->fresh());
    }

    // ─────────────────────── قفل الفترة ───────────────────────

    /** @test */
    public function posting_into_a_locked_period_is_rejected_with_no_journal(): void
    {
        $return = $this->postedSalesReturn();
        $refund = $this->refundFor($return, 23000, ['refund_date' => now()->toDateString()]);
        $entriesBefore = JournalEntry::query()->count();

        app(AccountingPeriodLockService::class)->create(
            now()->startOfMonth()->toDateString(),
            now()->endOfMonth()->toDateString(),
            'إقفال الفترة الحالية',
            null
        );

        try {
            $this->refunds->post($refund);
            $this->fail('كان يجب رفض الترحيل داخل فترة مقفلة.');
        } catch (AccountingPeriodLockedException $e) {
            $this->assertNotSame('', $e->getMessage());
        }

        $this->assertSame('draft', $refund->fresh()->status);
        $this->assertNull($refund->fresh()->journal_entry_id);
        $this->assertSame($entriesBefore, JournalEntry::query()->count());
        $this->assertSame(23000, $this->refunds->refundableBalance($return->fresh()));
    }

    /** @test */
    public function reversing_into_a_locked_period_is_rejected_without_changing_the_refund(): void
    {
        $return = $this->postedSalesReturn();
        $posted = $this->refunds->post($this->refundFor($return, 23000, [
            'refund_date' => now()->subMonth()->toDateString(),
        ]));

        app(AccountingPeriodLockService::class)->create(
            now()->startOfMonth()->toDateString(),
            now()->endOfMonth()->toDateString(),
            'إقفال الفترة الحالية',
            null
        );

        try {
            $this->refunds->reverse($posted, now()->toDateString(), 'عكس داخل فترة مقفلة');
            $this->fail('كان يجب رفض العكس داخل فترة مقفلة.');
        } catch (AccountingPeriodLockedException $e) {
            $this->assertNotSame('', $e->getMessage());
        }

        $posted->refresh();
        $this->assertSame('posted', $posted->status);
        $this->assertNull($posted->reversal_entry_id);
        $this->assertSame(0, $this->refunds->refundableBalance($return->fresh()));
    }

    // ─────────────────────── الترقيم والعزل ───────────────────────

    /** @test */
    public function numbering_uses_the_shared_document_layer_with_the_crf_prefix(): void
    {
        $first  = $this->postedSalesReturn(10000, 2);
        $second = $this->postedSalesReturn(5000, 2);

        $one = $this->refundFor($first, 23000);
        $two = $this->refundFor($second, 11500);

        $year = now()->format('Y');
        $this->assertSame("CRF-{$year}-00001", $one->number);
        $this->assertSame("CRF-{$year}-00002", $two->number);
        $this->assertTrue(DocumentNumberingCatalog::hasSeries('customer_refund', 'default'));
    }

    /** @test */
    public function refunds_are_isolated_per_tenant(): void
    {
        $return = $this->postedSalesReturn();
        $this->refunds->post($this->refundFor($return, 23000));

        $other = $this->makeTenant('other-crf', 'مؤسسة أخرى');
        app(TenantContext::class)->set($other->id);

        $this->assertSame(0, CustomerRefund::query()->count());
        $this->assertSame(0, CustomerRefundAllocation::query()->count());
        $this->assertNull(ReturnDocument::find($return->id));
    }

    /** @test */
    public function a_refund_cannot_allocate_to_another_tenants_return(): void
    {
        $foreignReturn = $this->postedSalesReturn();

        $other = $this->makeTenant('other-crf-2', 'مؤسسة ثانية');
        app(TenantContext::class)->set($other->id);
        $otherCustomer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        $this->expectException(RuntimeException::class);
        app(CustomerRefundService::class)->create(
            ['partner_id' => $otherCustomer->id, 'amount' => 23000, 'method' => 'cash'],
            [['source_type' => 'sales_return', 'source_id' => $foreignReturn->id, 'amount' => 23000]],
        );
    }

    /** @test */
    public function a_refund_cannot_use_another_tenants_cash_account(): void
    {
        $foreignCashId = CashBankAccount::where('type', 'cash')->where('is_main', true)->first()->account_id;
        $this->assertNotNull($foreignCashId);

        $other = $this->makeTenant('other-crf-cash', 'مؤسسة نقد');
        app(TenantContext::class)->set($other->id);
        $otherCustomer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $otherReturns = app(ReturnService::class);
        $product = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false]);
        $return = $otherReturns->post($otherReturns->create(
            ['type' => 'sales', 'partner_id' => $otherCustomer->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]]
        ));

        $this->expectException(RuntimeException::class);
        app(CustomerRefundService::class)->create(
            [
                'partner_id' => $otherCustomer->id,
                'amount' => 23000,
                'method' => 'cash',
                'cash_account_id' => $foreignCashId,
            ],
            [['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 23000]],
        );
    }

    /** @test */
    public function a_forged_tenant_id_on_create_is_overwritten_by_the_active_tenant(): void
    {
        $return = $this->postedSalesReturn();
        $other = Tenant::create([
            'name' => 'مزوّر', 'slug' => 'forged-crf', 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);

        $refund = $this->refunds->create(
            [
                'partner_id' => $this->customer->id,
                'amount' => 23000,
                'method' => 'cash',
                'tenant_id' => $other->id,
            ],
            [['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 23000]],
        );

        $this->assertSame($this->tenant->id, $refund->tenant_id);
        $this->assertNotSame($other->id, $refund->tenant_id);
    }

    /** @test */
    public function a_refund_inherits_the_source_branch_and_posts_the_journal_there(): void
    {
        $branch = Branch::create(['code' => '00002', 'name' => 'فرع ثانٍ', 'is_main' => false]);
        $return = $this->postedSalesReturnOnBranch($branch->id);

        $this->assertSame($branch->id, $return->branch_id);

        $refund = $this->refundFor($return, 23000);
        $this->assertSame($branch->id, $refund->branch_id);

        $posted = $this->refunds->post($refund);
        $this->assertSame($branch->id, $posted->branch_id);

        $entry = JournalEntry::with('lines')->findOrFail($posted->journal_entry_id);
        $this->assertNotEmpty($entry->lines);
        foreach ($entry->lines as $line) {
            $this->assertSame($branch->id, $line->branch_id);
        }
    }

    /** @test */
    public function an_explicit_refund_branch_that_does_not_match_the_source_is_rejected(): void
    {
        $sourceBranch = Branch::create(['code' => '00002', 'name' => 'فرع المصدر', 'is_main' => false]);
        $otherBranch = Branch::create(['code' => '00003', 'name' => 'فرع آخر', 'is_main' => false]);
        $return = $this->postedSalesReturnOnBranch($sourceBranch->id);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('فرع الاسترداد يجب أن يطابق فرع التصحيح التجاري المخصَّص.');
        $this->refundFor($return, 23000, ['branch_id' => $otherBranch->id]);
    }

    /** @test */
    public function a_writing_branch_context_that_does_not_match_the_source_is_rejected(): void
    {
        $sourceBranch = Branch::create(['code' => '00002', 'name' => 'فرع المصدر', 'is_main' => false]);
        $otherBranch = Branch::create(['code' => '00003', 'name' => 'فرع الكتابة', 'is_main' => false]);
        $return = $this->postedSalesReturnOnBranch($sourceBranch->id);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('فرع الاسترداد يجب أن يطابق فرع التصحيح التجاري المخصَّص.');
        $this->onBranch($otherBranch->id, fn () => $this->refundFor($return, 23000));
    }

    /** @test */
    public function allocation_across_sources_from_different_branches_is_rejected(): void
    {
        $branchA = Branch::create(['code' => '00002', 'name' => 'فرع أ', 'is_main' => false]);
        $branchB = Branch::create(['code' => '00003', 'name' => 'فرع ب', 'is_main' => false]);
        $return = $this->postedSalesReturnOnBranch($branchA->id, 10000, 2);
        $note = $this->postedCreditNoteOnBranch($branchB->id, 10000, 1);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لا يمكن تخصيص تصحيحات تجارية من فروع مختلفة في استرداد واحد.');
        $this->refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 34500, 'method' => 'cash'],
            [
                ['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 23000],
                ['source_type' => 'credit_note', 'source_id' => $note->id, 'amount' => 11500],
            ],
        );
    }

    /** @test */
    public function same_branch_return_and_credit_note_can_share_a_refund(): void
    {
        $branch = Branch::create(['code' => '00002', 'name' => 'فرع مشترك', 'is_main' => false]);
        $return = $this->postedSalesReturnOnBranch($branch->id, 10000, 2);
        $note = $this->postedCreditNoteOnBranch($branch->id, 10000, 1);

        $refund = $this->onBranch($branch->id, fn () => $this->refunds->create(
            ['partner_id' => $this->customer->id, 'amount' => 34500, 'method' => 'cash'],
            [
                ['source_type' => 'sales_return', 'source_id' => $return->id, 'amount' => 23000],
                ['source_type' => 'credit_note', 'source_id' => $note->id, 'amount' => 11500],
            ],
        ));
        $posted = $this->onBranch($branch->id, fn () => $this->refunds->post($refund));

        $this->assertSame($branch->id, $posted->branch_id);
        $entry = JournalEntry::with('lines')->findOrFail($posted->journal_entry_id);
        foreach ($entry->lines as $line) {
            $this->assertSame($branch->id, $line->branch_id);
        }
    }

    /** @test */
    public function posting_rejects_when_a_source_branch_no_longer_matches_the_refund(): void
    {
        $sourceBranch = Branch::create(['code' => '00002', 'name' => 'فرع المصدر', 'is_main' => false]);
        $otherBranch = Branch::create(['code' => '00003', 'name' => 'فرع محرَّف', 'is_main' => false]);
        $return = $this->postedSalesReturnOnBranch($sourceBranch->id);
        $refund = $this->refundFor($return, 23000);

        $return->forceFill(['branch_id' => $otherBranch->id])->save();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('فرع الاسترداد يجب أن يطابق فرع التصحيح التجاري المخصَّص.');
        $this->refunds->post($refund);
    }

    /** @test */
    public function eligible_sources_under_an_active_branch_do_not_include_other_branch_documents(): void
    {
        $branchA = Branch::create(['code' => '00002', 'name' => 'فرع أ', 'is_main' => false]);
        $branchB = Branch::create(['code' => '00003', 'name' => 'فرع ب', 'is_main' => false]);
        $onA = $this->postedSalesReturnOnBranch($branchA->id, 10000, 2);
        $onB = $this->postedSalesReturnOnBranch($branchB->id, 5000, 2);
        $unbranched = $this->postedSalesReturn(10000, 1);

        $visibleOnA = $this->onBranch($branchA->id, fn () => collect($this->refunds->eligibleSources($this->customer->id)));
        $this->assertTrue($visibleOnA->contains('id', $onA->id));
        $this->assertFalse($visibleOnA->contains('id', $onB->id));
        $this->assertFalse($visibleOnA->contains('id', $unbranched->id));

        $visibleOnB = $this->onBranch($branchB->id, fn () => collect($this->refunds->eligibleSources($this->customer->id)));
        $this->assertTrue($visibleOnB->contains('id', $onB->id));
        $this->assertFalse($visibleOnB->contains('id', $onA->id));

        $withoutContext = collect($this->refunds->eligibleSources($this->customer->id));
        $this->assertTrue($withoutContext->contains('id', $onA->id));
        $this->assertTrue($withoutContext->contains('id', $onB->id));
        $this->assertTrue($withoutContext->contains('id', $unbranched->id));
    }

    // ─────────────────────────── الصلاحيات و API ───────────────────────────

    /** @test */
    public function customer_refund_permissions_are_independent_of_returns_and_payments(): void
    {
        $this->assertContains('customer_refunds.view', \App\Support\Rbac::PERMISSIONS);
        $this->assertContains('customer_refunds.manage', \App\Support\Rbac::PERMISSIONS);

        $this->assertTrue(\App\Support\Rbac::allows('owner', 'customer_refunds.manage'));
        $this->assertTrue(\App\Support\Rbac::allows('admin', 'customer_refunds.manage'));
        $this->assertFalse(\App\Support\Rbac::allows('accountant', 'customer_refunds.manage'));
        $this->assertFalse(\App\Support\Rbac::allows('staff', 'customer_refunds.view'));
        $this->assertFalse(\App\Support\Rbac::allows('accountant', 'customer_refunds.view'));
    }

    /** @test */
    public function the_api_creates_and_posts_an_authorized_customer_refund(): void
    {
        $auth = $this->registerTenant('api-crf', 'owner-crf@acme.test');
        $customer = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل API', 'type' => 'customer',
        ])->assertCreated()->json('data.id');
        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'خدمة API', 'type' => 'service', 'sale_price' => 10000, 'track_inventory' => false,
        ])->assertCreated()->json('data.id');
        $returnId = $this->withToken($auth['token'])->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $customer, 'payment_type' => 'credit',
            'items' => [['product_id' => $product, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/returns/{$returnId}/post")->assertOk();

        $created = $this->withToken($auth['token'])->postJson('/api/customer-refunds', [
            'partner_id' => $customer,
            'amount' => 23000,
            'method' => 'cash',
            'allocations' => [[
                'source_type' => 'sales_return',
                'source_id' => $returnId,
                'amount' => 23000,
            ]],
        ])->assertCreated();

        $id = $created->json('data.id');
        $posted = $this->withToken($auth['token'])->postJson("/api/customer-refunds/{$id}/post")->assertOk();
        $this->assertSame('posted', $posted->json('data.status'));
        $this->assertNotNull($posted->json('data.journal_entry_id'));
    }

    /** @test */
    public function the_api_rejects_an_accountant_without_customer_refund_permission(): void
    {
        $auth = $this->registerTenant('api-crf-rbac', 'owner-crf-rbac@acme.test');
        $accountantToken = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc-crf@acme.test');

        $this->withToken($accountantToken)->getJson('/api/customer-refunds')->assertForbidden();
        $this->withToken($accountantToken)->postJson('/api/customer-refunds', [
            'partner_id' => $this->customer->id,
            'amount' => 23000,
            'method' => 'cash',
            'allocations' => [[
                'source_type' => 'sales_return',
                'source_id' => '00000000-0000-0000-0000-000000000001',
                'amount' => 23000,
            ]],
        ])->assertForbidden();
    }
}

<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ACC-3 — Sales + Payment Counterparty Account Routing.
 *
 * Invoice posting (accounts_receivable/sales_revenue/sales_shipping_revenue/
 * document_adjustment/tax_output/cogs/inventory_asset) and Payment counterparty
 * posting (accounts_receivable/accounts_payable) now consume
 * `AccountRoleResolver` instead of hardcoded ACC_* codes. LedgerService is
 * untouched; CashBankAccount stays the sole authority for the cash/bank side.
 *
 * تشغيل: php artisan test --filter=SalesPaymentAccountRoutingTest
 */
class SalesPaymentAccountRoutingTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected Partner $supplier;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-acc3', 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
    }

    private function customAccount(string $code, string $type = 'revenue', bool $group = false, bool $active = true): Account
    {
        return Account::create([
            'tenant_id' => $this->tenant->id, 'code' => $code, 'name' => "حساب مخصص {$code}",
            'type' => $type, 'normal_balance' => in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit',
            'is_group' => $group, 'is_active' => $active,
        ]);
    }

    private function map(string $role, string $accountId): void
    {
        app(AccountRoutingService::class)->setMapping($role, $accountId, null);
    }

    private function trackedProduct(string $code, int $qty = 10, int $avgCost = 4000): Product
    {
        return Product::create([
            'tenant_id' => $this->tenant->id, 'name' => "صنف {$code}", 'sku' => $code,
            'type' => 'good', 'track_inventory' => true,
            'quantity_on_hand' => $qty, 'avg_cost' => $avgCost,
        ]);
    }

    private function postCashInvoice(array $items, array $overrides = []): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            array_merge(['partner_id' => $this->customer->id, 'payment_type' => 'cash'], $overrides),
            $items
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function postCreditInvoice(array $items, array $overrides = []): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            array_merge(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], $overrides),
            $items
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function lineFor(JournalEntry $entry, string $accountId): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account_id === $accountId);
    }

    // ── 1. Unmapped role resolves the exact legacy account ─────────────────

    /** @test */
    public function unmapped_roles_resolve_to_the_exact_legacy_accounts(): void
    {
        $ar = Account::where('code', '1130')->first();
        $sales = Account::where('code', '4110')->first();

        $resolver = app(AccountRoleResolver::class);
        $this->assertSame($ar->id, $resolver->resolve('accounts_receivable')->id);
        $this->assertSame($sales->id, $resolver->resolve('sales_revenue')->id);
    }

    // ── 2. Mapped AR used on new credit invoice ─────────────────────────────

    /** @test */
    public function mapped_accounts_receivable_is_used_as_the_debit_on_a_new_credit_invoice(): void
    {
        $customAr = $this->customAccount('1135', 'asset');
        $this->map('accounts_receivable', $customAr->id);

        $invoice = $this->postCreditInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);

        $entry = $invoice->journalEntry()->with('lines')->first();
        $debit = $entry->lines->first(fn (JournalLine $l) => $l->debit > 0);
        $this->assertSame($customAr->id, $debit->account_id);
        $this->assertEquals(115000, $debit->debit);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
    }

    // ── 3/4. Sales revenue: tenant mapping vs product override precedence ──

    /** @test */
    public function mapped_sales_revenue_is_used_when_the_product_has_no_override(): void
    {
        $customSales = $this->customAccount('4115');
        $this->map('sales_revenue', $customSales->id);

        $invoice = $this->postCashInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $entry = $invoice->journalEntry()->with('lines')->first();

        $this->assertEquals(100000, $this->lineFor($entry, $customSales->id)?->credit);
    }

    /** @test */
    public function product_sales_account_override_wins_over_the_tenant_mapping(): void
    {
        $customSales = $this->customAccount('4116');
        $this->map('sales_revenue', $customSales->id);

        $productOverride = $this->customAccount('4117');
        $product = Product::create([
            'tenant_id' => $this->tenant->id, 'name' => 'منتج بحساب خاص', 'type' => 'service',
            'sales_account_id' => $productOverride->id,
        ]);

        $invoice = $this->postCashInvoice([['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $entry = $invoice->journalEntry()->with('lines')->first();

        $this->assertEquals(100000, $this->lineFor($entry, $productOverride->id)?->credit);
        $this->assertNull($this->lineFor($entry, $customSales->id));
    }

    // ── 5. Shipping ──────────────────────────────────────────────────────────

    /** @test */
    public function mapped_shipping_revenue_is_used_and_vat_amount_is_unchanged(): void
    {
        $customShipping = $this->customAccount('4135');
        $this->map('sales_shipping_revenue', $customShipping->id);

        $invoice = $this->postCashInvoice(
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            ['shipping' => 5000]
        );
        $entry = $invoice->journalEntry()->with('lines')->first();

        // شحن 5000 + ضريبة شحن 15% = 750، بلا تغيير في حساب الضريبة نفسه.
        $this->assertEquals(5000, $this->lineFor($entry, $customShipping->id)?->credit);
        $this->assertEquals(15750, $entry->lines->firstWhere('account_id', Account::where('code', '2120')->first()->id)?->credit);
    }

    // ── 6. Tax output ────────────────────────────────────────────────────────

    /** @test */
    public function mapped_tax_output_is_used_with_unchanged_vat_amount(): void
    {
        $customVat = $this->customAccount('2125', 'liability');
        $this->map('tax_output', $customVat->id);

        $invoice = $this->postCashInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
        $entry = $invoice->journalEntry()->with('lines')->first();

        $this->assertEquals(15000, $this->lineFor($entry, $customVat->id)?->credit);
        $this->assertNull(Account::where('code', '2120')->first()->balance);
    }

    // ── 7. Document adjustment: sign + non-taxable ──────────────────────────

    /** @test */
    public function mapped_document_adjustment_preserves_direction_for_a_positive_and_negative_value(): void
    {
        $customAdj = $this->customAccount('5175', 'expense');
        $this->map('document_adjustment', $customAdj->id);

        $gain = $this->postCashInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0]], ['adjustment' => 500]);
        $gainEntry = $gain->journalEntry()->with('lines')->first();
        $this->assertEquals(500, $this->lineFor($gainEntry, $customAdj->id)?->credit);
        $this->assertEquals(0, $this->lineFor($gainEntry, $customAdj->id)?->debit);

        $loss = $this->postCashInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0]], ['adjustment' => -500]);
        $lossEntry = $loss->journalEntry()->with('lines')->first();
        $this->assertEquals(500, $this->lineFor($lossEntry, $customAdj->id)?->debit);
        $this->assertEquals(0, $this->lineFor($lossEntry, $customAdj->id)?->credit);

        // غير خاضعة للضريبة: إجمالي الضريبة يبقى مطابقاً للسلع فقط (صفر هنا).
        $this->assertEquals(0, $gain->tax_amount);
        $this->assertEquals(0, $loss->tax_amount);
    }

    // ── 8/9/10. COGS + inventory asset: tenant mapping vs product override ─

    /** @test */
    public function mapped_cogs_and_inventory_asset_are_used_when_the_product_has_no_override(): void
    {
        $customCogs = $this->customAccount('5112', 'expense');
        $customInventory = $this->customAccount('1145', 'asset');
        $this->map('cogs', $customCogs->id);
        $this->map('inventory_asset', $customInventory->id);

        $product = $this->trackedProduct('ACC3-COGS-1', 10, 4000);
        $invoice = $this->postCashInvoice([['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 0]]);

        $cogsEntry = $invoice->cogsEntry()->with('lines')->first();
        $this->assertEquals(8000, $this->lineFor($cogsEntry, $customCogs->id)?->debit);
        $this->assertEquals(8000, $this->lineFor($cogsEntry, $customInventory->id)?->credit);
    }

    /** @test */
    public function product_cogs_account_override_wins_over_the_tenant_mapping(): void
    {
        $customCogs = $this->customAccount('5117', 'expense');
        $this->map('cogs', $customCogs->id);

        $productOverride = $this->customAccount('5118', 'expense');
        $product = $this->trackedProduct('ACC3-COGS-2', 10, 4000);
        $product->update(['cogs_account_id' => $productOverride->id]);

        $invoice = $this->postCashInvoice([['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 0]]);
        $cogsEntry = $invoice->cogsEntry()->with('lines')->first();

        $this->assertEquals(8000, $this->lineFor($cogsEntry, $productOverride->id)?->debit);
        $this->assertNull($this->lineFor($cogsEntry, $customCogs->id));
    }

    // ── 11/12. Cost center + branch/partner dimensions unchanged ───────────

    /** @test */
    public function cost_center_allocation_and_partner_dimension_are_unchanged_by_routing(): void
    {
        $customSales = $this->customAccount('4118');
        $this->map('sales_revenue', $customSales->id);
        $cc = CostCenter::create(['code' => 'CC-ACC3', 'name' => 'مركز ACC-3']);

        $invoice = $this->postCreditInvoice([[
            'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0,
            'cost_center_allocations' => [['cost_center_id' => $cc->id, 'mode' => 'percent', 'value' => 10000]],
        ]]);

        $entry = $invoice->journalEntry()->with('lines')->first();
        $revenueLine = $this->lineFor($entry, $customSales->id);
        $this->assertSame($cc->id, $revenueLine->cost_center_id);

        $debit = $entry->lines->first(fn (JournalLine $l) => $l->debit > 0);
        $this->assertSame($this->customer->id, $debit->partner_id);
        $this->assertSame(Partner::class, $debit->partner_type);
    }

    // ── 13. Invalid explicit mapping blocks posting; no journal created ────

    /** @test */
    public function an_invalid_sales_revenue_mapping_blocks_posting_before_any_journal_is_created(): void
    {
        $disabled = $this->customAccount('4119');
        $this->map('sales_revenue', $disabled->id);
        $disabled->update(['is_active' => false]);

        $before = JournalEntry::count();
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0]]
        );

        $this->expectException(RuntimeException::class);
        try {
            app(InvoiceService::class)->post($invoice);
        } finally {
            $this->assertSame($before, JournalEntry::count());
            $this->assertTrue($invoice->fresh()->isDraft());
        }
    }

    // ── 14. Invalid COGS mapping rolls back the whole posting transaction ──

    /** @test */
    public function an_invalid_cogs_mapping_rolls_back_the_already_built_sales_journal_too(): void
    {
        $disabledCogs = $this->customAccount('5119', 'expense');
        $this->map('cogs', $disabledCogs->id);
        $disabledCogs->update(['is_active' => false]);

        $product = $this->trackedProduct('ACC3-ROLLBACK', 10, 4000);
        $beforeEntries = JournalEntry::count();
        $beforeQty = $product->quantity_on_hand;

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0]]
        );

        try {
            app(InvoiceService::class)->post($invoice);
            $this->fail('كان يجب أن يفشل الترحيل بتعيين تكلفة معطّل.');
        } catch (RuntimeException) {
            // متوقع
        }

        // لا قيد مبيعات تُرك معلَّقاً، ولا مخزون خُفِّض، ولا حالة الفاتورة تغيّرت.
        $this->assertSame($beforeEntries, JournalEntry::count());
        $this->assertSame($beforeQty, $product->fresh()->quantity_on_hand);
        $this->assertTrue($invoice->fresh()->isDraft());
    }

    // ── 15. Remapping never mutates a previously posted journal ─────────────

    /** @test */
    public function remapping_sales_revenue_does_not_change_a_previously_posted_invoice_journal(): void
    {
        $defaultSales = Account::where('code', '4110')->first();
        $oldInvoice = $this->postCashInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0]]);

        $newSales = $this->customAccount('4111');
        $this->map('sales_revenue', $newSales->id);

        $newInvoice = $this->postCashInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0]]);

        $oldEntry = $oldInvoice->journalEntry()->with('lines')->first();
        $newEntry = $newInvoice->journalEntry()->with('lines')->first();

        $this->assertEquals(100000, $this->lineFor($oldEntry, $defaultSales->id)?->credit);
        $this->assertNull($this->lineFor($oldEntry, $newSales->id));
        $this->assertEquals(100000, $this->lineFor($newEntry, $newSales->id)?->credit);
    }

    // ── 16. Reversal uses the original concrete account, not current mapping ─

    /** @test */
    public function reversing_an_old_invoice_reverses_the_original_account_not_the_current_mapping(): void
    {
        $originalAr = Account::where('code', '1130')->first();
        $invoice = $this->postCreditInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0]]);
        $entry = $invoice->journalEntry;

        $newAr = $this->customAccount('1136', 'asset');
        $this->map('accounts_receivable', $newAr->id);

        $reversal = app(LedgerService::class)->reverse($entry->fresh('lines'));

        $reversedDebit = $reversal->lines->first(fn (JournalLine $l) => $l->credit > 0);
        $this->assertSame($originalAr->id, $reversedDebit->account_id);
        $this->assertNull($reversal->lines->first(fn (JournalLine $l) => $l->account_id === $newAr->id));
    }

    // ── 17/18. Payment counterparty routing + CashBankAccount preserved ────

    /** @test */
    public function customer_receipt_uses_the_mapped_receivable_account_and_the_resolved_cash_account(): void
    {
        $newAr = $this->customAccount('1137', 'asset');
        $this->map('accounts_receivable', $newAr->id);

        $payment = app(PaymentService::class)->create([
            'partner_id' => $this->customer->id, 'amount' => 115000, 'direction' => 'received', 'method' => 'cash',
        ]);
        $posted = app(PaymentService::class)->post($payment);
        $entry = $posted->journalEntry()->with('lines')->first();

        $cash = Account::where('code', '1110')->first();
        $this->assertEquals(115000, $this->lineFor($entry, $cash->id)?->debit);
        $this->assertEquals(115000, $this->lineFor($entry, $newAr->id)?->credit);
        $this->assertSame($this->customer->id, $this->lineFor($entry, $newAr->id)?->partner_id);
    }

    /** @test */
    public function supplier_payment_uses_the_mapped_payable_account_and_the_resolved_cash_account(): void
    {
        $newAp = $this->customAccount('2111', 'liability');
        $this->map('accounts_payable', $newAp->id);

        $payment = app(PaymentService::class)->create([
            'partner_id' => $this->supplier->id, 'amount' => 60000, 'direction' => 'paid', 'method' => 'cash',
        ]);
        $posted = app(PaymentService::class)->post($payment);
        $entry = $posted->journalEntry()->with('lines')->first();

        $cash = Account::where('code', '1110')->first();
        $this->assertEquals(60000, $this->lineFor($entry, $newAp->id)?->debit);
        $this->assertSame($this->supplier->id, $this->lineFor($entry, $newAp->id)?->partner_id);
        $this->assertEquals(60000, $this->lineFor($entry, $cash->id)?->credit);
    }

    // ── 20. Payment allocation/status unaffected by routing ─────────────────

    /** @test */
    public function partial_payment_status_and_remaining_are_unaffected_by_a_custom_receivable_mapping(): void
    {
        $newAr = $this->customAccount('1138', 'asset');
        $this->map('accounts_receivable', $newAr->id);

        $invoice = $this->postCreditInvoice([['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]); // 115000

        $payment = app(PaymentService::class)->create([
            'partner_id' => $this->customer->id, 'invoice_id' => $invoice->id, 'amount' => 50000,
        ]);
        app(PaymentService::class)->post($payment);

        $invoice->refresh();
        $this->assertSame(50000, $invoice->paid_amount);
        $this->assertSame('partial', $invoice->payment_status);
        $this->assertSame(65000, $invoice->remaining());
    }

    // ── 21. Tenant isolation ─────────────────────────────────────────────────

    /** @test */
    public function tenant_a_custom_mapping_does_not_affect_tenant_b_posting(): void
    {
        $customSales = $this->customAccount('4112');
        $this->map('sales_revenue', $customSales->id);

        $tenantB = Tenant::create(['name' => 'مستأجر ب', 'slug' => 'nibras-acc3-b', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);
        $customerB = Partner::create(['name' => 'عميل ب', 'type' => 'customer']);

        $invoiceB = app(InvoiceService::class)->create(
            ['partner_id' => $customerB->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0]]
        );
        $invoiceB = app(InvoiceService::class)->post($invoiceB);

        $entryB = $invoiceB->journalEntry()->with('lines')->first();
        $defaultSalesB = Account::where('code', '4110')->first();

        $this->assertEquals(100000, $this->lineFor($entryB, $defaultSalesB->id)?->credit);
        $this->assertNull($this->lineFor($entryB, $customSales->id));

        // معرّف حساب A لا يظهر أصلاً ضمن دليل B (عزل تام على مستوى tenant_id).
        $this->assertFalse(Account::whereKey($customSales->id)->exists());
    }
}

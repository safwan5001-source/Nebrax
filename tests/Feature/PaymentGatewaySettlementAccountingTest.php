<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\Tenant;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentGatewaySettlementService;
use App\Services\Accounting\PaymentReversalService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class PaymentGatewaySettlementAccountingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Partner $customer;

    private PaymentService $payments;

    private PaymentGatewaySettlementService $settlements;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة تسوية البوابات',
            'slug' => 'pay-v2-5-settlement',
            'vat_number' => '300000000000015',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل بوابة', 'type' => 'customer']);
        $this->payments = app(PaymentService::class);
        $this->settlements = app(PaymentGatewaySettlementService::class);
    }

    /** @test */
    public function gateway_collection_debits_clearing_and_preserves_gross_customer_payment(): void
    {
        $invoice = $this->postedInvoice(100000);
        $gateway = $this->gateway();

        $payment = $this->collectGateway($invoice, 115000, $gateway);

        $this->assertSame(115000, $payment->amount);
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame('paid', $invoice->fresh()->payment_status);

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertEquals(115000, $this->line($entry, '1170')->debit);
        $this->assertEquals(115000, $this->line($entry, '1130')->credit);
        $this->assertNull($this->line($entry, '1110'));
        $this->assertNull($this->line($entry, '1120'));
        $this->assertEquals(115000, Account::where('code', '1170')->first()->balance->balance);
        $this->assertEquals(0, Account::where('code', '1130')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function ordinary_cash_collection_still_debits_cash_when_no_gateway_is_linked(): void
    {
        $invoice = $this->postedInvoice(100000);
        $payment = $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 115000,
            'method' => 'cash',
        ]));

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertEquals(115000, $this->line($entry, '1110')->debit);
        $this->assertNull($this->line($entry, '1170'));
    }

    /** @test */
    public function settlement_posts_bank_fee_and_clears_gateway_receivable_without_changing_invoice(): void
    {
        $invoice = $this->postedInvoice(100000);
        $taxBefore = $invoice->tax_amount;
        $gateway = $this->gateway();
        $payment = $this->collectGateway($invoice, 115000, $gateway);
        $bank = $this->mainBank();

        $settlement = $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $bank->id,
            'provider_settlement_ref' => 'SET-1000',
            'settlement_date' => now()->toDateString(),
            'net_bank_amount' => 112000,
            'provider_fee_ex_tax' => 3000,
            'provider_fee_tax' => 0,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000, 'provider_event_ref' => 'EVT-1']],
        ]);

        $this->assertTrue($settlement->isPosted());
        $this->assertSame(115000, $settlement->gross_amount);
        $this->assertSame('stripe', $settlement->gateway_provider);
        $this->assertNotNull($settlement->journal_entry_id);
        $this->assertSame(115000, $payment->fresh()->amount);
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame($taxBefore, $invoice->fresh()->tax_amount);

        $entry = JournalEntry::with('lines.account')->findOrFail($settlement->journal_entry_id);
        $this->assertSame(PaymentGatewaySettlement::class, $entry->source_type);
        $this->assertEquals(112000, $this->line($entry, '1120')->debit);
        $this->assertEquals(3000, $this->line($entry, '5510')->debit);
        $this->assertEquals(115000, $this->line($entry, '1170')->credit);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(0, Account::where('code', '1170')->first()->balance->fresh()->balance);
        $this->assertEquals(112000, Account::where('code', '1120')->first()->balance->fresh()->balance);
        $this->assertEquals(3000, Account::where('code', '5510')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function reconciliation_mismatch_is_rejected_before_posting(): void
    {
        $invoice = $this->postedInvoice(100000);
        $gateway = $this->gateway();
        $payment = $this->collectGateway($invoice, 115000, $gateway);

        $journalsBefore = JournalEntry::count();

        try {
            $this->settlements->post([
                'payment_gateway_id' => $gateway->id,
                'cash_bank_account_id' => $this->mainBank()->id,
                'provider_settlement_ref' => 'SET-BAD',
                'net_bank_amount' => 100000,
                'provider_fee_ex_tax' => 3000,
                'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
            ]);
            $this->fail('Mismatched settlement was posted.');
        } catch (DomainException $e) {
            $this->assertStringContainsString('does not reconcile', $e->getMessage());
        }

        $this->assertSame($journalsBefore, JournalEntry::count());
        $this->assertSame(0, PaymentGatewaySettlement::count());
        $this->assertEquals(115000, Account::where('code', '1170')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function provider_fee_tax_is_rejected_rather_than_hard_coded(): void
    {
        $invoice = $this->postedInvoice(100000);
        $gateway = $this->gateway();
        $payment = $this->collectGateway($invoice, 115000, $gateway);

        $this->expectException(DomainException::class);
        $this->expectExceptionMessage('Provider fee tax posting is not authorized');

        $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-TAX',
            'net_bank_amount' => 112000,
            'provider_fee_ex_tax' => 2609,
            'provider_fee_tax' => 391,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ]);
    }

    /** @test */
    public function floating_point_amounts_are_rejected(): void
    {
        $this->expectException(DomainException::class);
        $this->expectExceptionMessage('floating point');

        $this->settlements->post([
            'payment_gateway_id' => $this->gateway()->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-FLOAT',
            'net_bank_amount' => 97.5,
            'provider_fee_ex_tax' => 2.5,
            'items' => [['payment_id' => 'x', 'gross_amount' => 100.0]],
        ]);
    }

    /** @test */
    public function batch_settlement_clears_multiple_gateway_payments(): void
    {
        $gateway = $this->gateway();
        $first = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);
        $second = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);

        $settlement = $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-BATCH',
            'net_bank_amount' => 224000,
            'provider_fee_ex_tax' => 6000,
            'items' => [
                ['payment_id' => $first->id, 'gross_amount' => 115000, 'provider_event_ref' => 'EVT-A'],
                ['payment_id' => $second->id, 'gross_amount' => 115000, 'provider_event_ref' => 'EVT-B'],
            ],
        ]);

        $this->assertCount(2, $settlement->items);
        $this->assertSame(230000, $settlement->gross_amount);
        $this->assertEquals(0, Account::where('code', '1170')->first()->balance->fresh()->balance);
        $this->assertEquals(224000, Account::where('code', '1120')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function partial_settlement_leaves_remaining_clearing_open(): void
    {
        $gateway = $this->gateway();
        $payment = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);

        $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-PART-1',
            'net_bank_amount' => 50000,
            'provider_fee_ex_tax' => 0,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 50000]],
        ]);

        $this->assertEquals(65000, Account::where('code', '1170')->first()->balance->fresh()->balance);
        $this->assertSame(115000, $payment->fresh()->amount);

        $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-PART-2',
            'net_bank_amount' => 63000,
            'provider_fee_ex_tax' => 2000,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 65000]],
        ]);

        $this->assertEquals(0, Account::where('code', '1170')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function split_tender_fees_only_the_gateway_portion(): void
    {
        $invoice = $this->postedInvoice(100000);
        $gateway = $this->gateway();

        $cash = $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 40000,
            'method' => 'cash',
        ]));
        $card = $this->collectGateway($invoice, 75000, $gateway);

        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame('paid', $invoice->fresh()->payment_status);

        $cashEntry = JournalEntry::with('lines.account')->findOrFail($cash->journal_entry_id);
        $this->assertEquals(40000, $this->line($cashEntry, '1110')->debit);
        $this->assertNull($this->line($cashEntry, '1170'));

        $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-SPLIT',
            'net_bank_amount' => 73000,
            'provider_fee_ex_tax' => 2000,
            'items' => [['payment_id' => $card->id, 'gross_amount' => 75000]],
        ]);

        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertEquals(2000, Account::where('code', '5510')->first()->balance->fresh()->balance);
        $this->assertEquals(40000, Account::where('code', '1110')->first()->balance->fresh()->balance);
        $this->assertEquals(73000, Account::where('code', '1120')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function duplicate_provider_settlement_reference_is_idempotent(): void
    {
        $gateway = $this->gateway();
        $payment = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);
        $payload = [
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-IDEM',
            'net_bank_amount' => 112000,
            'provider_fee_ex_tax' => 3000,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ];

        $first = $this->settlements->post($payload);
        $second = $this->settlements->post($payload);

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, PaymentGatewaySettlement::count());
        $this->assertSame(1, JournalEntry::where('source_type', PaymentGatewaySettlement::class)->count());
    }

    /** @test */
    public function posted_settlement_financial_fields_are_immutable(): void
    {
        $gateway = $this->gateway();
        $payment = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);
        $settlement = $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-IMM',
            'net_bank_amount' => 112000,
            'provider_fee_ex_tax' => 3000,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ]);

        $this->expectException(DomainException::class);
        $this->expectExceptionMessage('immutable');
        $settlement->update(['net_bank_amount' => 1]);
    }

    /** @test */
    public function reversing_an_unsettled_gateway_payment_does_not_invent_a_fee_refund(): void
    {
        $invoice = $this->postedInvoice(100000);
        $gateway = $this->gateway();
        $payment = $this->collectGateway($invoice, 115000, $gateway);

        $reversed = app(PaymentReversalService::class)->reverse($payment, now()->toDateString(), 'إلغاء قبض بوابة');

        $this->assertTrue($reversed->isReversed());
        $this->assertSame(0, $invoice->fresh()->paid_amount);
        $this->assertEquals(0, Account::where('code', '1170')->first()->balance->fresh()->balance);
        $this->assertEquals(0, (int) (Account::where('code', '5510')->first()->balance?->balance ?? 0));
        $this->assertSame(0, PaymentGatewaySettlement::count());
    }

    /** @test */
    public function reversing_a_settled_gateway_payment_is_rejected_and_does_not_refund_the_fee(): void
    {
        $invoice = $this->postedInvoice(100000);
        $gateway = $this->gateway();
        $payment = $this->collectGateway($invoice, 115000, $gateway);
        $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-REV',
            'net_bank_amount' => 112000,
            'provider_fee_ex_tax' => 3000,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ]);

        try {
            app(PaymentReversalService::class)->reverse($payment);
            $this->fail('Settled payment was reversed.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('تسوية بوابة', $e->getMessage());
        }

        $this->assertSame('posted', $payment->fresh()->status);
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertEquals(3000, Account::where('code', '5510')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function period_lock_blocks_settlement_posting(): void
    {
        $gateway = $this->gateway();
        $payment = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);

        app(AccountingPeriodLockService::class)->create(
            now()->startOfMonth()->toDateString(),
            now()->endOfMonth()->toDateString(),
            'إقفال فترة التسوية',
            null
        );

        $this->expectException(RuntimeException::class);
        $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-LOCK',
            'settlement_date' => now()->toDateString(),
            'net_bank_amount' => 115000,
            'provider_fee_ex_tax' => 0,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ]);
    }

    /** @test */
    public function forged_tenant_id_on_settlement_is_replaced_by_active_context(): void
    {
        $foreign = Tenant::create(['name' => 'أجنبي', 'slug' => 'pay-v2-5-foreign']);
        $gateway = $this->gateway();
        $payment = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);

        $settlement = $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $this->mainBank()->id,
            'provider_settlement_ref' => 'SET-FORGE',
            'net_bank_amount' => 115000,
            'provider_fee_ex_tax' => 0,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ]);

        $this->assertSame($this->tenant->id, $settlement->tenant_id);
        $this->assertNotSame($foreign->id, $settlement->tenant_id);

        $this->expectException(DomainException::class);
        $settlement->forceFill(['tenant_id' => $foreign->id])->save();
    }

    /** @test */
    public function cross_tenant_gateway_payment_and_bank_references_are_rejected(): void
    {
        $gatewayA = $this->gateway();
        $paymentA = $this->collectGateway($this->postedInvoice(100000), 115000, $gatewayA);
        $bankA = $this->mainBank();

        $tenantB = Tenant::create(['name' => 'شركة باء', 'slug' => 'pay-v2-5-b']);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);
        $customerB = Partner::create(['name' => 'عميل باء', 'type' => 'customer']);
        $gatewayB = PaymentGateway::create([
            'provider' => PaymentGateway::PROVIDER_TAP,
            'name' => 'Tap باء',
        ]);
        $invoiceB = app(InvoiceService::class)->create(
            ['partner_id' => $customerB->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $invoiceB = app(InvoiceService::class)->post($invoiceB);
        $paymentB = $this->payments->post($this->payments->create([
            'partner_id' => $customerB->id,
            'invoice_id' => $invoiceB->id,
            'amount' => 115000,
            'method' => 'bank',
            'payment_gateway_id' => $gatewayB->id,
        ]));

        try {
            $this->settlements->post([
                'payment_gateway_id' => $gatewayA->id,
                'cash_bank_account_id' => $bankA->id,
                'provider_settlement_ref' => 'SET-XT-G',
                'net_bank_amount' => 115000,
                'items' => [['payment_id' => $paymentB->id, 'gross_amount' => 115000]],
            ]);
            $this->fail('Foreign gateway was accepted.');
        } catch (DomainException $e) {
            $this->assertStringContainsString('active tenant', $e->getMessage());
        }

        try {
            $this->settlements->post([
                'payment_gateway_id' => $gatewayB->id,
                'cash_bank_account_id' => $bankA->id,
                'provider_settlement_ref' => 'SET-XT-B',
                'net_bank_amount' => 115000,
                'items' => [['payment_id' => $paymentB->id, 'gross_amount' => 115000]],
            ]);
            $this->fail('Foreign bank was accepted.');
        } catch (DomainException $e) {
            $this->assertStringContainsString('active tenant', $e->getMessage());
        }

        try {
            $this->settlements->post([
                'payment_gateway_id' => $gatewayB->id,
                'cash_bank_account_id' => CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail()->id,
                'provider_settlement_ref' => 'SET-XT-P',
                'net_bank_amount' => 115000,
                'items' => [['payment_id' => $paymentA->id, 'gross_amount' => 115000]],
            ]);
            $this->fail('Foreign payment was accepted.');
        } catch (DomainException $e) {
            $this->assertStringContainsString('active tenant', $e->getMessage());
        }

        $this->assertSame(0, PaymentGatewaySettlement::count());
    }

    /** @test */
    public function missing_tenant_context_fails_safely(): void
    {
        $gateway = $this->gateway();
        $payment = $this->collectGateway($this->postedInvoice(100000), 115000, $gateway);
        $bankId = $this->mainBank()->id;
        app(TenantContext::class)->forget();

        $this->expectException(DomainException::class);
        $this->settlements->post([
            'payment_gateway_id' => $gateway->id,
            'cash_bank_account_id' => $bankId,
            'provider_settlement_ref' => 'SET-NOCTX',
            'net_bank_amount' => 115000,
            'items' => [['payment_id' => $payment->id, 'gross_amount' => 115000]],
        ]);
    }

    /** @test */
    public function linking_another_tenants_gateway_on_payment_create_is_rejected(): void
    {
        $gatewayA = $this->gateway();
        $tenantB = Tenant::create(['name' => 'باء', 'slug' => 'pay-v2-5-pay-b']);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);
        $customerB = Partner::create(['name' => 'عميل ب', 'type' => 'customer']);

        $this->expectException(RuntimeException::class);
        $this->payments->create([
            'partner_id' => $customerB->id,
            'amount' => 10000,
            'method' => 'bank',
            'payment_gateway_id' => $gatewayA->id,
        ]);
    }

    private function postedInvoice(int $unitPrice): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function gateway(): PaymentGateway
    {
        return PaymentGateway::create([
            'provider' => PaymentGateway::PROVIDER_STRIPE,
            'name' => 'Stripe الاختبار',
            'secret_key' => 'sk_test_must_not_snapshot',
        ]);
    }

    private function collectGateway(Invoice $invoice, int $amount, PaymentGateway $gateway): Payment
    {
        return $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => $amount,
            'method' => 'bank',
            'payment_gateway_id' => $gateway->id,
        ]));
    }

    private function mainBank(): CashBankAccount
    {
        app(\App\Services\Accounting\CashBankAccountService::class)->bootstrapDefaults();

        return CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail();
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }
}

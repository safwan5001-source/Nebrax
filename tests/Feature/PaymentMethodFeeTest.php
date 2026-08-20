<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Tenant;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PaymentService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class PaymentMethodFeeTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private PaymentService $payments;
    private Partner $customer;
    private Partner $supplier;
    private PaymentMethod $method;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة رسوم الدفع',
            'slug' => 'payment-fees',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        app(CashBankAccountService::class)->bootstrapDefaults();
        Settings::put('finance', ['payment_fee_application' => 'both']);

        $this->customer = Partner::create(['name' => 'عميل الرسوم', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد الرسوم', 'type' => 'supplier']);
        $bank = CashBankAccount::where('type', 'bank')->where('is_main', true)->firstOrFail();
        $expense = Account::where('code', '5150')->firstOrFail();
        $this->method = PaymentMethod::create([
            'name' => 'بطاقة رسوم',
            'settlement_type' => 'bank',
            'cash_bank_account_id' => $bank->id,
            'is_active' => true,
            'fees_enabled' => true,
            'fee_rate_bps' => 70, // 0.70%
            'fee_fixed_amount' => 0,
            'fee_min_amount' => 0,
            'fee_tax_rate' => 15,
            'fee_expense_account_id' => $expense->id,
        ]);
        $this->payments = app(PaymentService::class);
    }

    private function entryFor(Payment $payment): JournalEntry
    {
        return JournalEntry::with('lines.account')
            ->where('source_type', Payment::class)
            ->where('source_id', $payment->id)
            ->firstOrFail();
    }

    private function line(JournalEntry $entry, string $code): JournalLine
    {
        return $entry->lines->firstOrFail(fn (JournalLine $line) => $line->account->code === $code);
    }

    /** @test */
    public function received_payment_posts_net_bank_deposit_and_company_fee_with_input_vat(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id,
            'direction' => 'received',
            'amount' => 100000,
            'payment_method_id' => $this->method->id,
        ]);
        $posted = $this->payments->post($payment);
        $entry = $this->entryFor($posted);

        $this->assertSame($this->method->id, $posted->payment_method_id);
        $this->assertSame('بطاقة رسوم', $posted->payment_method_name);
        $this->assertSame(700, $posted->fee_amount);
        $this->assertSame(105, $posted->fee_tax_amount);
        $this->assertSame(100000, $entry->lines->sum('debit'));
        $this->assertSame(100000, $entry->lines->sum('credit'));
        $this->assertSame(99195, $this->line($entry, '1120')->debit);
        $this->assertSame(700, $this->line($entry, '5150')->debit);
        $this->assertSame(105, $this->line($entry, '1150')->debit);
        $this->assertSame(100000, $this->line($entry, '1130')->credit);
    }

    /** @test */
    public function paid_payment_posts_company_fee_and_tax_in_addition_to_supplier_settlement(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->supplier->id,
            'direction' => 'paid',
            'amount' => 100000,
            'payment_method_id' => $this->method->id,
        ]);
        $posted = $this->payments->post($payment);
        $entry = $this->entryFor($posted);

        $this->assertSame(100805, $entry->lines->sum('debit'));
        $this->assertSame(100805, $entry->lines->sum('credit'));
        $this->assertSame(100000, $this->line($entry, '2110')->debit);
        $this->assertSame(700, $this->line($entry, '5150')->debit);
        $this->assertSame(105, $this->line($entry, '1150')->debit);
        $this->assertSame(100805, $this->line($entry, '1120')->credit);
    }

    /** @test */
    public function fee_application_setting_can_suspend_fees_without_changing_the_payment_method(): void
    {
        Settings::put('finance', ['payment_fee_application' => 'none']);

        $payment = $this->payments->create([
            'partner_id' => $this->customer->id,
            'direction' => 'received',
            'amount' => 100000,
            'payment_method_id' => $this->method->id,
        ]);
        $posted = $this->payments->post($payment);
        $entry = $this->entryFor($posted);

        $this->assertSame(0, $posted->fee_amount);
        $this->assertSame(0, $posted->fee_tax_amount);
        $this->assertSame(100000, $this->line($entry, '1120')->debit);
        $this->assertSame(100000, $this->line($entry, '1130')->credit);
        $this->assertNull($entry->lines->first(fn (JournalLine $line) => $line->account->code === '5150'));
    }
}

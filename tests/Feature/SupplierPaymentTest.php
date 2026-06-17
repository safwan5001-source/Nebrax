<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PaymentService;
use App\Services\Accounting\PurchaseService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات سداد الموردين المخصَّص — النظير المحاسبي لتسوية المبيعات.
 * صرف لمورد يخصَّص لفاتورة مشتريات: مدين 2110 الموردون / دائن 1110/1120.
 * تشغيل:  php artisan test --filter=SupplierPaymentTest
 */
class SupplierPaymentTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected PaymentService $payments;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->payments = app(PaymentService::class);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** فاتورة مشتريات آجلة بإجمالي 46000 (40000 + 15%). */
    private function postedPurchase(int $unitPrice = 40000): Purchase
    {
        $purchase = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );
        return app(PurchaseService::class)->post($purchase);
    }

    private function pay(Purchase $purchase, int $amount, string $method = 'cash'): Payment
    {
        return $this->payments->post($this->payments->create([
            'partner_id'  => $this->supplier->id,
            'direction'   => 'paid',
            'method'      => $method,
            'purchase_id' => $purchase->id,
            'amount'      => $amount,
        ]));
    }

    /** @test */
    public function paying_a_supplier_settles_the_purchase_and_credits_cash(): void
    {
        $purchase = $this->postedPurchase(); // 46000
        $this->assertSame('unpaid', $purchase->payment_status);
        $this->assertEquals(46000, Account::where('code', '2110')->first()->balance->balance);

        $payment = $this->pay($purchase, 46000);

        // القيد: مدين 2110 الموردون (مربوط بالمورد) / دائن 1110 الصندوق — متوازن ومربوط بالمصدر
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Payment::class)
            ->where('source_id', $payment->id)
            ->firstOrFail();
        $this->assertSame($payment->id, $entry->source_id);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(46000, $this->line($entry, '2110')->debit);
        $this->assertEquals($this->supplier->id, $this->line($entry, '2110')->partner_id);
        $this->assertEquals(46000, $this->line($entry, '1110')->credit);

        // الفاتورة مدفوعة بالكامل ورصيد الموردين صفر
        $purchase->refresh();
        $this->assertSame('paid', $purchase->payment_status);
        $this->assertSame(46000, $purchase->paid_amount);
        $this->assertSame(0, $purchase->remaining());
        $this->assertEquals(0, Account::where('code', '2110')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function partial_supplier_payment_marks_purchase_partial(): void
    {
        $purchase = $this->postedPurchase(); // 46000

        $this->pay($purchase, 20000);

        $purchase->refresh();
        $this->assertSame('partial', $purchase->payment_status);
        $this->assertSame(20000, $purchase->paid_amount);
        $this->assertSame(26000, $purchase->remaining());
        $this->assertEquals(26000, Account::where('code', '2110')->first()->balance->balance);
    }

    /** @test */
    public function bank_supplier_payment_credits_the_bank_account(): void
    {
        $purchase = $this->postedPurchase();

        $payment = $this->pay($purchase, 46000, 'bank');

        $entry = $payment->journalEntry()->with('lines.account')->first();
        $this->assertEquals(46000, $this->line($entry, '1120')->credit); // البنك
        $this->assertNull($this->line($entry, '1110'));
    }

    /** @test */
    public function overpaying_a_supplier_beyond_remaining_is_rejected(): void
    {
        $purchase = $this->postedPurchase(); // 46000
        $this->pay($purchase, 40000);        // متبقٍ 6000

        $this->expectExceptionMessage('يتجاوز المتبقي');
        $this->pay($purchase, 10000);
    }

    /** @test */
    public function one_payment_allocated_across_two_purchases_settles_both(): void
    {
        $p1 = $this->postedPurchase(); // 46000
        $p2 = $this->postedPurchase(); // 46000

        $payment = $this->payments->create(
            ['partner_id' => $this->supplier->id, 'direction' => 'paid', 'amount' => 92000],
            [
                ['purchase_id' => $p1->id, 'amount' => 46000],
                ['purchase_id' => $p2->id, 'amount' => 46000],
            ]
        );
        $posted = $this->payments->post($payment);

        // قيد واحد متوازن: مدين 2110 بـ 92000 / دائن 1110 بـ 92000
        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals(92000, $entry->lines->sum('debit'));
        $this->assertEquals(92000, $entry->lines->sum('credit'));
        $this->assertEquals(92000, $this->line($entry, '2110')->debit);

        $this->assertSame('paid', $p1->refresh()->payment_status);
        $this->assertSame('paid', $p2->refresh()->payment_status);
        $this->assertEquals(0, Account::where('code', '2110')->first()->balance->balance);
    }

    /** @test */
    public function paying_a_purchase_of_another_supplier_is_rejected(): void
    {
        $purchase = $this->postedPurchase();
        $other    = Partner::create(['name' => 'مورد آخر', 'type' => 'supplier']);

        $payment = $this->payments->create([
            'partner_id'  => $other->id,
            'direction'   => 'paid',
            'purchase_id' => $purchase->id,
            'amount'      => 46000,
        ]);

        $this->expectExceptionMessage('لا تخص طرف السند');
        $this->payments->post($payment);
    }

    /** @test */
    public function paying_an_unposted_purchase_is_rejected(): void
    {
        $draft = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 40000]]
        ); // draft

        $payment = $this->payments->create([
            'partner_id'  => $this->supplier->id,
            'direction'   => 'paid',
            'purchase_id' => $draft->id,
            'amount'      => 46000,
        ]);

        $this->expectExceptionMessage('غير مرحّلة');
        $this->payments->post($payment);
    }
}

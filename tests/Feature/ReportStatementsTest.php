<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\PaymentService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات كشوف الحساب وأعمار الديون.
 * تشغيل:  php artisan test --filter=ReportStatementsTest
 */
class ReportStatementsTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected ReportService $reports;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->reports  = app(ReportService::class);
    }

    private function acc(string $code): string
    {
        return Account::where('code', $code)->first()->id;
    }

    /** @test */
    public function account_ledger_lists_movements_with_a_running_balance(): void
    {
        // بيع نقدي 1150 (الصندوق +115000) ثم مصروف نقدي 200 (الصندوق −20000)
        $inv = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($inv);

        app(LedgerService::class)->post([
            ['account_id' => $this->acc('5130'), 'debit'  => 20000],
            ['account_id' => $this->acc('1110'), 'credit' => 20000],
        ], ['description' => 'إيجار']);

        $ledger = $this->reports->accountLedger($this->acc('1110'));

        $this->assertCount(2, $ledger['rows']);
        $this->assertSame(0, $ledger['opening_balance']);
        $this->assertSame(115000, $ledger['rows'][0]['balance']); // بعد البيع
        $this->assertSame(95000,  $ledger['rows'][1]['balance']); // بعد المصروف
        $this->assertSame(95000,  $ledger['closing_balance']);
    }

    /** @test */
    public function account_ledger_respects_opening_balance_and_date_range(): void
    {
        app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'invoice_date' => '2025-01-10'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));
        app(LedgerService::class)->post([
            ['account_id' => $this->acc('5130'), 'debit'  => 20000],
            ['account_id' => $this->acc('1110'), 'credit' => 20000],
        ], ['entry_date' => '2025-02-10', 'description' => 'إيجار فبراير']);

        $ledger = $this->reports->accountLedger($this->acc('1110'), ['from' => '2025-02-01']);

        $this->assertSame(115000, $ledger['opening_balance']);   // حركة يناير ترحّل كرصيد افتتاحي
        $this->assertCount(1, $ledger['rows']);                  // فبراير فقط
        $this->assertSame(95000, $ledger['closing_balance']);
    }

    /** @test */
    public function partner_statement_tracks_invoice_then_payment(): void
    {
        $inv = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 2300
        );
        app(InvoiceService::class)->post($inv);

        app(PaymentService::class)->post(app(PaymentService::class)->create([
            'partner_id' => $this->customer->id, 'invoice_id' => $inv->id, 'amount' => 100000,
        ]));

        $st = $this->reports->partnerStatement($this->customer->id);

        $this->assertCount(2, $st['rows']);
        $this->assertSame(230000, $st['rows'][0]['debit']);   // الفاتورة
        $this->assertSame(230000, $st['rows'][0]['balance']);
        $this->assertSame(100000, $st['rows'][1]['credit']);  // التحصيل
        $this->assertSame(130000, $st['rows'][1]['balance']); // المتبقي
        $this->assertSame(130000, $st['closing_balance']);
    }

    /** @test */
    public function aging_buckets_receivables_and_excludes_paid(): void
    {
        $asOf = '2026-06-01';
        $mk = function (string $date) {
            $inv = app(InvoiceService::class)->create(
                ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'invoice_date' => $date],
                [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 115000
            );
            return app(InvoiceService::class)->post($inv);
        };

        $mk('2026-05-25'); // ~7 يوم  → b0_30
        $mk('2026-04-10'); // ~52 يوم → b31_60
        $mk('2026-01-01'); // ~151 يوم → b90_plus
        $paid = $mk('2026-05-20');
        app(PaymentService::class)->post(app(PaymentService::class)->create([
            'partner_id' => $this->customer->id, 'invoice_id' => $paid->id, 'amount' => 115000, // سداد كامل → يُستبعد
        ]));

        $aging = $this->reports->aging('receivable', ['as_of' => $asOf]);

        $this->assertCount(1, $aging['rows']);
        $row = $aging['rows'][0];
        $this->assertSame(115000, $row['b0_30']);
        $this->assertSame(115000, $row['b31_60']);
        $this->assertSame(0,      $row['b61_90']);
        $this->assertSame(115000, $row['b90_plus']);
        $this->assertSame(345000, $row['total']);          // المسدّدة مستبعدة
        $this->assertSame(345000, $aging['totals']['total']);
    }

    /** @test */
    public function aging_payable_reads_from_purchases(): void
    {
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $purchase = app(\App\Services\Accounting\PurchaseService::class)->create(
            ['partner_id' => $supplier->id, 'payment_type' => 'credit', 'purchase_date' => '2026-05-25'],
            [['quantity' => 10, 'unit_price' => 4000, 'tax_rate' => 15]] // 46000
        );
        app(\App\Services\Accounting\PurchaseService::class)->post($purchase);

        $aging = $this->reports->aging('payable', ['as_of' => '2026-06-01']);

        $this->assertSame('payable', $aging['type']);
        $this->assertSame(46000, $aging['totals']['total']);
        $this->assertSame(46000, $aging['rows'][0]['b0_30']);
    }
}

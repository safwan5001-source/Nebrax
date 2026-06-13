<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات ميزان المراجعة — يثبت أن التقرير يُحسب من القيود
 * ويتوازن دائماً (Σ مدين = Σ دائن) ويحترم العزل ونطاق التواريخ.
 * تشغيل:  php artisan test --filter=TrialBalanceTest
 */
class TrialBalanceTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected ReportService $reports;

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

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->reports  = app(ReportService::class);
    }

    /** @test */
    public function it_is_empty_and_balanced_with_no_entries(): void
    {
        $tb = $this->reports->trialBalance();

        $this->assertSame([], $tb['rows']);
        $this->assertSame(0, $tb['total_debit']);
        $this->assertSame(0, $tb['total_credit']);
        $this->assertTrue($tb['balanced']);
    }

    /** @test */
    public function it_reflects_a_posted_cash_invoice(): void
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 1150
        );
        app(InvoiceService::class)->post($invoice);

        $tb = $this->reports->trialBalance();

        $this->assertCount(3, $tb['rows']);
        $this->assertEquals(115000, $tb['total_debit']);
        $this->assertEquals(115000, $tb['total_credit']);
        $this->assertTrue($tb['balanced']);

        // الصندوق في عمود المدين، المبيعات والضريبة في عمود الدائن
        $byCode = collect($tb['rows'])->keyBy('code');
        $this->assertEquals(115000, $byCode['1110']['debit']);
        $this->assertEquals(0,      $byCode['1110']['credit']);
        $this->assertEquals(100000, $byCode['4110']['credit']);
        $this->assertEquals(15000,  $byCode['2120']['credit']);

        // مرتّب حسب الكود تصاعدياً
        $codes = array_column($tb['rows'], 'code');
        $sorted = $codes;
        sort($sorted);
        $this->assertSame($sorted, $codes);
    }

    /** @test */
    public function it_always_balances_across_multiple_transactions(): void
    {
        // فاتورة آجلة + تحصيل جزئي
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 2, 'unit_price' => 100000, 'tax_rate' => 15]] // 2300
        );
        app(InvoiceService::class)->post($invoice);

        $payment = app(PaymentService::class)->create([
            'partner_id' => $this->customer->id,
            'amount'     => 100000,
        ]);
        app(PaymentService::class)->post($payment);

        $tb = $this->reports->trialBalance();

        $this->assertTrue($tb['balanced']);
        $this->assertEquals($tb['total_debit'], $tb['total_credit']);
        $this->assertGreaterThan(0, $tb['total_debit']);
    }

    /** @test */
    public function it_respects_the_date_range(): void
    {
        $invoice = app(InvoiceService::class)->create(
            [
                'partner_id'   => $this->customer->id,
                'payment_type' => 'cash',
                'invoice_date' => '2025-01-15',
            ],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice);

        // ضمن النطاق
        $in = $this->reports->trialBalance(['from' => '2025-01-01', 'to' => '2025-01-31']);
        $this->assertEquals(115000, $in['total_debit']);

        // خارج النطاق → فارغ
        $out = $this->reports->trialBalance(['from' => '2025-02-01']);
        $this->assertSame([], $out['rows']);
        $this->assertTrue($out['balanced']);
    }

    /** @test */
    public function it_is_tenant_isolated(): void
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice);

        // مستأجر ثانٍ لا يرى أي حركة
        $tenantB = Tenant::create(['name' => 'شركة ثانية', 'slug' => 'other']);
        app(TenantContext::class)->set($tenantB->id);

        $tb = $this->reports->trialBalance();
        $this->assertSame([], $tb['rows']);
        $this->assertSame(0, $tb['total_debit']);
    }
}

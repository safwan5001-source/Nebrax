<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** تقارير المبيعات: قراءة فقط فوق الفواتير وسندات القبض المرحّلة. */
class SalesReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $customerA;
    private string $customerB;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        $this->customerA = $this->customer('عميل ألف');
        $this->customerB = $this->customer('عميل باء');
    }

    private function customer(string $name): string
    {
        return $this->withToken($this->token)->postJson('/api/partners', [
            'name' => $name,
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    private function product(string $name, string $sku): string
    {
        return $this->withToken($this->token)->postJson('/api/products', [
            'name' => $name,
            'sku' => $sku,
            'type' => 'good',
            'purchase_price' => 10000,
            'sale_price' => 20000,
            'track_inventory' => false,
        ])->assertCreated()['data']['id'];
    }

    private function employee(string $name): string
    {
        return $this->withToken($this->token)->postJson('/api/employees', [
            'name' => $name,
            'national_id' => '1234567890',
            'hire_date' => '2026-01-01',
            'basic_salary' => 800000,
        ])->assertCreated()['data']['id'];
    }

    /** @param array<int,array<string,mixed>> $items */
    private function postedInvoice(string $partnerId, array $items, array $extra = []): array
    {
        $invoice = $this->withToken($this->token)->postJson('/api/invoices', array_merge([
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'invoice_date' => '2026-02-10',
            'items' => $items,
        ], $extra))->assertCreated()['data'];

        $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        return $invoice;
    }

    private function report(string $query): array
    {
        return $this->withToken($this->token)->getJson("/api/reports/sales?{$query}")->assertOk()->json();
    }

    /** @test */
    public function it_filters_posted_sales_by_period_customer_product_and_salesperson(): void
    {
        $cement = $this->product('إسمنت', 'CEM-1');
        $steel = $this->product('حديد', 'STL-1');
        $salesperson = $this->employee('سارة إبراهيم');

        $this->postedInvoice($this->customerA, [
            ['product_id' => $cement, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0],
            ['product_id' => $steel, 'quantity' => 1, 'unit_price' => 300000, 'tax_rate' => 0],
        ], ['salesperson_id' => $salesperson]);
        $this->postedInvoice($this->customerB, [
            ['product_id' => $steel, 'quantity' => 1, 'unit_price' => 500000, 'tax_rate' => 0],
        ], ['invoice_date' => '2026-03-01']);

        $period = $this->report('view=period&interval=month&from=2026-02-01&to=2026-02-28');
        $this->assertSame('2026-02', $period['data'][0]['label']);
        $this->assertSame(1, $period['data'][0]['invoices']);
        $this->assertSame('4000.00', $period['data'][0]['amount']);

        $customer = $this->report("view=customer&customer_id={$this->customerA}");
        $this->assertCount(1, $customer['data']);
        $this->assertSame('عميل ألف', $customer['data'][0]['label']);
        $this->assertSame('4000.00', $customer['data'][0]['amount']);

        $products = $this->report("view=product&product_id={$steel}&salesperson_id={$salesperson}");
        $this->assertCount(1, $products['data']);
        $this->assertSame('حديد', $products['data'][0]['label']);
        $this->assertSame(1, $products['data'][0]['quantity']);
        $this->assertSame('3000.00', $products['data'][0]['amount']);

        $bySalesperson = $this->report("view=salesperson&salesperson_id={$salesperson}");
        $this->assertCount(1, $bySalesperson['data']);
        $this->assertSame('سارة إبراهيم', $bySalesperson['data'][0]['label']);
        $this->assertSame('4000.00', $bySalesperson['data'][0]['amount']);
    }

    /** @test */
    public function it_excludes_drafts_and_filters_by_payment_status(): void
    {
        $product = $this->product('قلم', 'PEN-1');
        $this->postedInvoice($this->customerA, [
            ['product_id' => $product, 'quantity' => 1, 'unit_price' => 200000, 'tax_rate' => 0],
        ], ['is_paid' => true, 'payment_method' => 'cash']);

        $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->customerA,
            'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 900000, 'tax_rate' => 0]],
        ])->assertCreated();

        $paid = $this->report('view=period&payment_status=paid');
        $this->assertSame(1, $paid['totals']['invoices']);
        $this->assertSame('2000.00', $paid['totals']['amount']);

        $unpaid = $this->report('view=period&payment_status=unpaid');
        $this->assertSame(0, $unpaid['totals']['invoices']);
    }

    /** @test */
    public function it_reports_posted_receipts_by_receipt_date_and_method(): void
    {
        $product = $this->product('دفتر', 'NOTE-1');
        $this->postedInvoice($this->customerA, [
            ['product_id' => $product, 'quantity' => 1, 'unit_price' => 250000, 'tax_rate' => 0],
        ], ['is_paid' => true, 'payment_method' => 'cash']);

        $report = $this->report('view=payments&interval=month&receipt_method=cash');
        $this->assertSame('posted_receipts', $report['scope']['source']);
        $this->assertSame(1, $report['totals']['receipts']);
        $this->assertSame('2500.00', $report['totals']['amount']);
    }

    /** @test */
    public function it_derives_gross_profit_without_writing_anything(): void
    {
        $product = $this->product('خدمة تركيب', 'SVC-1');
        $this->postedInvoice($this->customerA, [
            ['product_id' => $product, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0],
        ]);
        $entries = JournalEntry::count();

        $report = $this->report('view=profit&interval=month');

        $this->assertSame('1000.00', $report['totals']['revenue']);
        $this->assertSame('0.00', $report['totals']['cost']);
        $this->assertSame('1000.00', $report['totals']['profit']);
        $this->assertSame(10000, $report['totals']['margin_bp']);
        $this->assertSame($entries, JournalEntry::count());
    }

    /** @test */
    public function another_tenants_sales_are_invisible_and_invalid_filters_are_rejected(): void
    {
        $product = $this->product('مادة', 'MAT-1');
        $this->postedInvoice($this->customerA, [
            ['product_id' => $product, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0],
        ]);
        $other = $this->registerTenant('other', 'other@nibras.test');

        $this->assertSame([], $this->withToken($other['token'])
            ->getJson('/api/reports/sales?view=period')->assertOk()['data']);

        $this->withToken($this->token)->getJson('/api/reports/sales?view=drop;table')->assertStatus(422);
        $this->withToken($this->token)->getJson('/api/reports/sales?view=period&from=2026-02-02&to=2026-02-01')->assertStatus(422);
    }
}

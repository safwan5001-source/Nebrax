<?php

namespace Tests\Feature;

use App\Models\Appointment;
use App\Models\Branch;
use App\Models\Payment;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** تقارير العملاء التحليلية: قراءة فقط فوق فواتير البيع وسندات القبض والمواعيد. */
class CustomerReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $tenantId;
    private string $customerA;
    private string $customerB;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
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

    /** @param array<int,array<string,mixed>> $items */
    private function postedInvoice(string $partnerId, array $items, array $extra = [], ?string $branchId = null): array
    {
        $request = $this->withToken($this->token);
        if ($branchId !== null) {
            $request = $request->withHeader('X-Branch-Id', $branchId);
        }

        $invoice = $request->postJson('/api/invoices', array_merge([
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'invoice_date' => '2026-02-10',
            'items' => $items,
        ], $extra))->assertCreated()['data'];

        $postRequest = $this->withToken($this->token);
        if ($branchId !== null) {
            $postRequest->withHeader('X-Branch-Id', $branchId);
        }
        $postRequest->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        return $invoice;
    }

    /** @param array<string,mixed> $query */
    private function report(array $query): array
    {
        return $this->withToken($this->token)
            ->getJson('/api/reports/customers?' . http_build_query($query))
            ->assertOk()
            ->json();
    }

    /** @test */
    public function it_groups_posted_customer_sales_and_balances_with_customer_status_and_branch_filters(): void
    {
        $branch = Branch::create(['tenant_id' => $this->tenantId, 'code' => 'CUS-RPT-1', 'name' => 'فرع تقارير العملاء']);
        $this->postedInvoice($this->customerA, [
            ['quantity' => 1, 'unit_price' => 125000, 'tax_rate' => 0],
        ], [], $branch->id);
        $this->postedInvoice($this->customerB, [
            ['quantity' => 1, 'unit_price' => 300000, 'tax_rate' => 0],
        ], ['invoice_date' => '2026-03-01']);
        // المسودة ليست مبيعة ولا ذمة.
        $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->customerA,
            'items' => [['quantity' => 1, 'unit_price' => 900000, 'tax_rate' => 0]],
        ])->assertCreated();

        $sales = $this->report([
            'view' => 'sales',
            'customer_id' => $this->customerA,
            'branch_id' => [$branch->id],
            'from' => '2026-02-01',
            'to' => '2026-02-28',
            'payment_status' => 'unpaid',
        ]);
        $this->assertSame('posted_customer_invoices', $sales['scope']['source']);
        $this->assertCount(1, $sales['data']);
        $this->assertSame('عميل ألف', $sales['data'][0]['label']);
        $this->assertSame(1, $sales['data'][0]['invoices']);
        $this->assertSame('1250.00', $sales['data'][0]['amount']);

        $balances = $this->report(['view' => 'balances', 'customer_id' => $this->customerA]);
        $this->assertSame(1, $balances['totals']['invoices']);
        $this->assertSame('1250.00', $balances['totals']['balance']);
    }

    /** @test */
    public function it_reports_only_posted_customer_receipts_by_date_and_method(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        Payment::create([
            'tenant_id' => $this->tenantId,
            'number' => 'REC-RPT-1',
            'partner_id' => $this->customerA,
            'direction' => 'received',
            'method' => 'bank',
            'status' => 'posted',
            'payment_date' => '2026-02-15',
            'amount' => 125000,
        ]);
        Payment::create([
            'tenant_id' => $this->tenantId,
            'number' => 'REC-RPT-DRAFT',
            'partner_id' => $this->customerA,
            'direction' => 'received',
            'method' => 'bank',
            'status' => 'draft',
            'payment_date' => '2026-02-15',
            'amount' => 900000,
        ]);

        $report = $this->report(['view' => 'payments', 'interval' => 'month', 'payment_method' => 'bank']);
        $this->assertSame('posted_customer_receipts', $report['scope']['source']);
        $this->assertSame('2026-02', $report['data'][0]['label']);
        $this->assertSame(1, $report['totals']['receipts']);
        $this->assertSame('1250.00', $report['totals']['amount']);
    }

    /** @test */
    public function it_reports_customer_appointments_by_status_without_claiming_a_financial_source(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        Appointment::create([
            'tenant_id' => $this->tenantId,
            'partner_id' => $this->customerA,
            'title' => 'اجتماع متابعة',
            'appointment_at' => '2026-02-12 10:00:00',
            'status' => 'scheduled',
        ]);
        Appointment::create([
            'tenant_id' => $this->tenantId,
            'partner_id' => $this->customerA,
            'title' => 'زيارة مكتملة',
            'appointment_at' => '2026-02-14 10:00:00',
            'status' => 'done',
        ]);
        Appointment::create([
            'tenant_id' => $this->tenantId,
            'partner_id' => $this->customerB,
            'title' => 'موعد ملغي',
            'appointment_at' => '2026-02-15 10:00:00',
            'status' => 'cancelled',
        ]);

        $report = $this->report(['view' => 'appointments', 'customer_id' => $this->customerA]);
        $this->assertSame('customer_appointments', $report['scope']['source']);
        $this->assertCount(1, $report['data']);
        $this->assertSame(2, $report['data'][0]['appointments']);
        $this->assertSame(1, $report['data'][0]['scheduled']);
        $this->assertSame(1, $report['data'][0]['done']);
        $this->assertSame(0, $report['data'][0]['cancelled']);
    }

    /** @test */
    public function customer_report_data_is_tenant_isolated_and_invalid_filters_are_rejected(): void
    {
        $this->postedInvoice($this->customerA, [
            ['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0],
        ]);
        $other = $this->registerTenant('other-customer-report', 'other-customer-report@nibras.test');

        $this->assertSame([], $this->withToken($other['token'])
            ->getJson('/api/reports/customers?view=sales')->assertOk()['data']);

        $this->withToken($this->token)->getJson('/api/reports/customers?view=drop;table')->assertStatus(422);
        $this->withToken($this->token)->getJson('/api/reports/customers?view=appointments&appointment_status=archived')->assertStatus(422);
        $this->withToken($this->token)->getJson('/api/reports/customers?view=sales&from=2026-02-02&to=2026-02-01')->assertStatus(422);
    }
}

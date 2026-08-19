<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\Purchase;
use App\Models\User;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** تقارير المشتريات: قراءة فقط فوق فواتير الشراء وسندات الصرف المرحّلة. */
class PurchaseReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $tenantId;
    private string $supplierA;
    private string $supplierB;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant();
        $this->token = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        $this->supplierA = $this->supplier('مورد ألف');
        $this->supplierB = $this->supplier('مورد باء');
    }

    private function supplier(string $name): string
    {
        return $this->withToken($this->token)->postJson('/api/partners', [
            'name' => $name,
            'type' => 'supplier',
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

    /** @param array<int,array<string,mixed>> $items */
    private function postedPurchase(string $partnerId, array $items, array $extra = [], ?string $branchId = null): array
    {
        $request = $this->withToken($this->token);
        if ($branchId !== null) {
            $request = $request->withHeader('X-Branch-Id', $branchId);
        }

        $purchase = $request->postJson('/api/purchases', array_merge([
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'purchase_date' => '2026-02-10',
            'items' => $items,
        ], $extra))->assertCreated()['data'];

        $postRequest = $this->withToken($this->token);
        if ($branchId !== null) {
            $postRequest->withHeader('X-Branch-Id', $branchId);
        }
        $postRequest->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        return $purchase;
    }

    /** @param array<string,mixed> $query */
    private function report(array $query): array
    {
        return $this->withToken($this->token)
            ->getJson('/api/reports/purchases?' . http_build_query($query))
            ->assertOk()
            ->json();
    }

    /** @test */
    public function it_filters_posted_purchases_by_period_supplier_product_creator_status_and_branch(): void
    {
        $cement = $this->product('إسمنت', 'CEM-1');
        $steel = $this->product('حديد', 'STL-1');
        $employee = $this->withToken($this->token)->postJson('/api/employees', [
            'name' => 'سارة إبراهيم',
            'national_id' => '1234567890',
            'hire_date' => '2026-01-01',
            'basic_salary' => 800000,
        ])->assertCreated()['data'];

        $creator = User::where('tenant_id', $this->tenantId)->firstOrFail();
        $creator->update(['employee_id' => $employee['id']]);

        $branch = Branch::create(['tenant_id' => $this->tenantId, 'code' => 'RPT-1', 'name' => 'فرع التقارير']);
        $this->postedPurchase($this->supplierA, [
            ['product_id' => $cement, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0],
            ['product_id' => $steel, 'quantity' => 1, 'unit_price' => 300000, 'tax_rate' => 0],
        ], ['received_status' => 'pending'], $branch->id);
        $this->postedPurchase($this->supplierB, [
            ['product_id' => $steel, 'quantity' => 1, 'unit_price' => 500000, 'tax_rate' => 0],
        ], ['purchase_date' => '2026-03-01']);

        $period = $this->report([
            'view' => 'period', 'interval' => 'month', 'from' => '2026-02-01', 'to' => '2026-02-28',
            'branch_id' => [$branch->id],
        ]);
        $this->assertSame('2026-02', $period['data'][0]['label']);
        $this->assertSame(1, $period['data'][0]['purchases']);
        $this->assertSame('4000.00', $period['data'][0]['amount']);

        $supplier = $this->report(['view' => 'supplier', 'supplier_id' => $this->supplierA]);
        $this->assertCount(1, $supplier['data']);
        $this->assertSame('مورد ألف', $supplier['data'][0]['label']);
        $this->assertSame('4000.00', $supplier['data'][0]['amount']);

        $products = $this->report(['view' => 'product', 'product_id' => $steel, 'creator_id' => $creator->id, 'supplier_id' => $this->supplierA]);
        $this->assertCount(1, $products['data']);
        $this->assertSame('حديد', $products['data'][0]['label']);
        $this->assertSame(1, $products['data'][0]['quantity']);
        $this->assertSame('3000.00', $products['data'][0]['amount']);

        $byEmployee = $this->report(['view' => 'employee', 'creator_id' => $creator->id]);
        $this->assertCount(1, $byEmployee['data']);
        $this->assertSame('سارة إبراهيم', $byEmployee['data'][0]['label']);
        $this->assertSame('9000.00', $byEmployee['data'][0]['amount']);

        $pending = $this->report(['view' => 'period', 'received_status' => 'pending']);
        $this->assertSame(1, $pending['totals']['purchases']);
    }

    /** @test */
    public function it_excludes_drafts_and_reports_payment_status_and_supplier_balances(): void
    {
        $product = $this->product('قلم', 'PEN-1');
        $posted = $this->postedPurchase($this->supplierA, [
            ['product_id' => $product, 'quantity' => 1, 'unit_price' => 200000, 'tax_rate' => 0],
        ]);
        $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierA,
            'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 900000, 'tax_rate' => 0]],
        ])->assertCreated();

        $paid = $this->report(['view' => 'period', 'payment_status' => 'paid']);
        $this->assertSame(0, $paid['totals']['purchases']);

        $unpaid = $this->report(['view' => 'period', 'payment_status' => 'unpaid']);
        $this->assertSame(1, $unpaid['totals']['purchases']);
        $this->assertSame('2000.00', $unpaid['totals']['amount']);

        $balances = $this->report(['view' => 'balances']);
        $this->assertSame(1, $balances['totals']['purchases']);
        $this->assertSame('2000.00', $balances['totals']['balance']);

        $stored = Purchase::withoutGlobalScope(BranchScope::class)->findOrFail($posted['id']);
        $this->assertSame(User::where('tenant_id', $this->tenantId)->value('id'), $stored->created_by);
    }

    /** @test */
    public function it_reports_posted_supplier_payments_by_payment_date_and_method(): void
    {
        app(TenantContext::class)->set($this->tenantId);
        Payment::create([
            'tenant_id' => $this->tenantId,
            'number' => 'PAY-RPT-1',
            'partner_id' => $this->supplierA,
            'direction' => 'paid',
            'method' => 'bank',
            'status' => 'posted',
            'payment_date' => '2026-02-15',
            'amount' => 125000,
        ]);
        Payment::create([
            'tenant_id' => $this->tenantId,
            'number' => 'PAY-RPT-DRAFT',
            'partner_id' => $this->supplierA,
            'direction' => 'paid',
            'method' => 'bank',
            'status' => 'draft',
            'payment_date' => '2026-02-15',
            'amount' => 900000,
        ]);

        $report = $this->report(['view' => 'payments', 'interval' => 'month', 'payment_method' => 'bank']);
        $this->assertSame('posted_supplier_payments', $report['scope']['source']);
        $this->assertSame(1, $report['totals']['payments']);
        $this->assertSame('1250.00', $report['totals']['amount']);
    }

    /** @test */
    public function report_data_is_tenant_isolated_and_invalid_filters_are_rejected(): void
    {
        $product = $this->product('مادة', 'MAT-1');
        $this->postedPurchase($this->supplierA, [
            ['product_id' => $product, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 0],
        ]);
        $other = $this->registerTenant('other', 'other@nibras.test');

        $this->assertSame([], $this->withToken($other['token'])
            ->getJson('/api/reports/purchases?view=period')->assertOk()['data']);

        $this->withToken($this->token)->getJson('/api/reports/purchases?view=drop;table')->assertStatus(422);
        $this->withToken($this->token)->getJson('/api/reports/purchases?view=period&from=2026-02-02&to=2026-02-01')->assertStatus(422);
    }
}

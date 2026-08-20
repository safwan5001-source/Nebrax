<?php

namespace Tests\Feature;

use App\Models\CostCenter;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/** توزيع مركز تكلفة متعدد: السطر، القيد، والتقرير يقرأون لقطة واحدة متزنة. */
class InvoiceCostCenterAllocationTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'نبراس', 'slug' => 'nibras-allocations', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
    }

    /** @test */
    public function it_splits_sales_and_cogs_between_cost_centers_without_losing_a_halala(): void
    {
        $north = CostCenter::create(['code' => 'CC-N', 'name' => 'المنطقة الشمالية']);
        $south = CostCenter::create(['code' => 'CC-S', 'name' => 'المنطقة الجنوبية']);
        $customer = Partner::create(['name' => 'عميل التوزيع', 'type' => 'customer']);
        $product = Product::create([
            'name' => 'صنف متتبع', 'type' => 'good', 'sale_price' => 10000,
            'purchase_price' => 4000, 'track_inventory' => true,
        ]);
        app(InventoryService::class)->recordOpeningStock($product, 10);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [[
                'product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0,
                'cost_center_allocations' => [
                    ['cost_center_id' => $north->id, 'mode' => 'percent', 'value' => 6000],
                    ['cost_center_id' => $south->id, 'mode' => 'percent', 'value' => 4000],
                ],
            ]]
        );
        $this->assertSame(2, $invoice->lines->first()->costCenterAllocations()->count());
        $this->assertSame(10000, (int) $invoice->lines->first()->costCenterAllocations()->sum('amount'));

        $posted = app(InvoiceService::class)->post($invoice);
        $sales = $posted->journalEntry->lines()->where('account_id', \App\Models\Account::where('code', '4110')->value('id'))->get()->keyBy('cost_center_id');
        $cogs = $posted->cogsEntry->lines()->where('account_id', \App\Models\Account::where('code', '5110')->value('id'))->get()->keyBy('cost_center_id');

        $this->assertSame(6000, (int) $sales[$north->id]->credit);
        $this->assertSame(4000, (int) $sales[$south->id]->credit);
        $this->assertSame(2400, (int) $cogs[$north->id]->debit);
        $this->assertSame(1600, (int) $cogs[$south->id]->debit);
        $this->assertSame(10000, (int) $sales->sum('credit'));
        $this->assertSame(4000, (int) $cogs->sum('debit'));

        $report = app(ReportService::class)->costCenterProfitability();
        $northRow = collect($report['rows'])->firstWhere('cost_center_id', $north->id);
        $southRow = collect($report['rows'])->firstWhere('cost_center_id', $south->id);
        $this->assertSame(6000, $northRow['revenue']);
        $this->assertSame(2400, $northRow['expense']);
        $this->assertSame(4000, $southRow['revenue']);
        $this->assertSame(1600, $southRow['expense']);
    }

    /** @test */
    public function it_uses_the_exact_amount_snapshot_when_basis_points_round(): void
    {
        $first = CostCenter::create(['code' => 'CC-AMT-1', 'name' => 'مركز المبلغ الأول']);
        $second = CostCenter::create(['code' => 'CC-AMT-2', 'name' => 'مركز المبلغ الثاني']);
        $customer = Partner::create(['name' => 'عميل مبلغ', 'type' => 'customer']);
        $product = Product::create([
            'name' => 'صنف بمبلغ غير قابل للقسمة', 'type' => 'good', 'sale_price' => 10001,
            'purchase_price' => 10001, 'track_inventory' => true,
        ]);
        app(InventoryService::class)->recordOpeningStock($product, 1);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [[
                'product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10001, 'tax_rate' => 0,
                'cost_center_allocations' => [
                    ['cost_center_id' => $first->id, 'mode' => 'amount', 'value' => 3333],
                    ['cost_center_id' => $second->id, 'mode' => 'amount', 'value' => 6668],
                ],
            ]]
        );
        $posted = app(InvoiceService::class)->post($invoice);
        $sales = $posted->journalEntry->lines()->where('account_id', \App\Models\Account::where('code', '4110')->value('id'))->get()->keyBy('cost_center_id');
        $cogs = $posted->cogsEntry->lines()->where('account_id', \App\Models\Account::where('code', '5110')->value('id'))->get()->keyBy('cost_center_id');

        $this->assertSame(3333, (int) $sales[$first->id]->credit);
        $this->assertSame(6668, (int) $sales[$second->id]->credit);
        $this->assertSame(3333, (int) $cogs[$first->id]->debit);
        $this->assertSame(6668, (int) $cogs[$second->id]->debit);
    }

    /** @test */
    public function it_keeps_legacy_unallocated_revenue_and_cogs_cost_center_null(): void
    {
        $customer = Partner::create(['name' => 'عميل التوافق', 'type' => 'customer']);
        $product = Product::create([
            'name' => 'صنف بلا توزيع', 'type' => 'good', 'sale_price' => 10000,
            'purchase_price' => 4000, 'track_inventory' => true,
        ]);
        app(InventoryService::class)->recordOpeningStock($product, 1);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0]]
        );
        $posted = app(InvoiceService::class)->post($invoice);

        $sales = $posted->journalEntry->lines()->where('account_id', \App\Models\Account::where('code', '4110')->value('id'))->sole();
        $cogs = $posted->cogsEntry->lines()->where('account_id', \App\Models\Account::where('code', '5110')->value('id'))->sole();
        $this->assertNull($sales->cost_center_id);
        $this->assertNull($cogs->cost_center_id);
    }

    /** @test */
    public function it_rejects_a_percentage_distribution_that_does_not_total_one_hundred_percent(): void
    {
        $first = CostCenter::create(['code' => 'CC-1', 'name' => 'أول']);
        $second = CostCenter::create(['code' => 'CC-2', 'name' => 'ثان']);
        $customer = Partner::create(['name' => 'عميل تحقق', 'type' => 'customer']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('100.00%');
        app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [[
                'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0,
                'cost_center_allocations' => [
                    ['cost_center_id' => $first->id, 'mode' => 'percent', 'value' => 5000],
                    ['cost_center_id' => $second->id, 'mode' => 'percent', 'value' => 4000],
                ],
            ]]
        );
    }
}

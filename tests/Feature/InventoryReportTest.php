<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\StockPermitLine;
use App\Models\Stocktake;
use App\Models\StocktakeLine;
use App\Models\Warehouse;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** تقارير المخزون: قراءة فقط فوق الرصيد الحالي والسجل الدائم والمستندات المرحّلة. */
class InventoryReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $tenantId;
    private Branch $branch;
    private Warehouse $warehouse;
    private Warehouse $targetWarehouse;
    private Product $product;
    private Product $zeroProduct;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('inventory-reports', 'inventory-reports@nibras.test');
        $this->token = $auth['token'];
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->branch = Branch::create([
            'tenant_id' => $this->tenantId,
            'code' => 'INV-RPT',
            'name' => 'فرع تقارير المخزون',
        ]);
        $this->warehouse = Warehouse::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'code' => 'INV-RPT-1',
            'name' => 'مخزن التقارير',
        ]);
        $this->targetWarehouse = Warehouse::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'code' => 'INV-RPT-2',
            'name' => 'مخزن الوجهة',
        ]);
        $this->product = Product::create([
            'tenant_id' => $this->tenantId,
            'name' => 'مضخة صناعية',
            'sku' => 'PUMP-RPT',
            'unit' => 'piece',
            'type' => 'good',
            'track_inventory' => true,
            'quantity_on_hand' => 10,
            'avg_cost' => 10000,
            'sale_price' => 15000,
            'reorder_level' => 3,
        ]);
        $this->zeroProduct = Product::create([
            'tenant_id' => $this->tenantId,
            'name' => 'صنف صفرّي',
            'sku' => 'ZERO-RPT',
            'unit' => 'piece',
            'type' => 'good',
            'track_inventory' => true,
            'quantity_on_hand' => 0,
            'avg_cost' => 9000,
        ]);

        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId,
            'product_id' => $this->product->id,
            'warehouse_id' => $this->warehouse->id,
            'quantity' => 10,
        ]);
        ProductWarehouseStock::create([
            'tenant_id' => $this->tenantId,
            'product_id' => $this->zeroProduct->id,
            'warehouse_id' => $this->warehouse->id,
            'quantity' => 0,
        ]);
    }

    /** @param array<string,mixed> $query */
    private function report(array $query): array
    {
        return $this->withToken($this->token)
            ->getJson('/api/reports/inventory?' . http_build_query($query))
            ->assertOk()
            ->json();
    }

    /** @test */
    public function it_reports_current_inventory_value_and_warehouse_quantities_without_allocating_value_to_warehouses(): void
    {
        $value = $this->report(['view' => 'value', 'hide_zero' => true]);

        $this->assertSame('current_tracked_products', $value['scope']['source']);
        $this->assertTrue($value['scope']['snapshot']);
        $this->assertCount(1, $value['data']);
        $this->assertSame('مضخة صناعية', $value['data'][0]['label']);
        $this->assertSame(10, $value['data'][0]['quantity']);
        $this->assertSame('100.00', $value['data'][0]['avg_cost']);
        $this->assertSame('1000.00', $value['data'][0]['stock_value']);
        $this->assertSame(1, $value['totals']['products']);
        $this->assertSame('1000.00', $value['totals']['stock_value']);

        $warehouses = $this->report([
            'view' => 'warehouses',
            'warehouse_id' => $this->warehouse->id,
            'product_id' => $this->product->id,
        ]);
        $this->assertSame('warehouse_stock_quantities', $warehouses['scope']['source']);
        $this->assertSame('مخزن التقارير', $warehouses['data'][0]['warehouse']);
        $this->assertSame('فرع تقارير المخزون', $warehouses['data'][0]['branch']);
        $this->assertSame(10, $warehouses['data'][0]['quantity']);
        $this->assertArrayNotHasKey('stock_value', $warehouses['data'][0]);
        $this->assertSame(10, $warehouses['totals']['quantity']);
    }

    /** @test */
    public function it_reports_permanent_stock_movements_with_date_product_warehouse_branch_and_type_filters(): void
    {
        StockMovement::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'warehouse_id' => $this->warehouse->id,
            'product_id' => $this->product->id,
            'type' => 'in',
            'quantity' => 10,
            'unit_cost' => 10000,
            'total_cost' => 100000,
            'balance_quantity' => 10,
            'movement_date' => '2026-03-01',
            'notes' => 'استلام مرحّل',
        ]);
        StockMovement::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'warehouse_id' => $this->warehouse->id,
            'product_id' => $this->product->id,
            'type' => 'out',
            'quantity' => 2,
            'unit_cost' => 10000,
            'total_cost' => 20000,
            'balance_quantity' => 8,
            'movement_date' => '2026-03-02',
            'notes' => 'صرف مرحّل',
        ]);

        $report = $this->report([
            'view' => 'movements',
            'from' => '2026-03-02',
            'to' => '2026-03-02',
            'product_id' => $this->product->id,
            'warehouse_id' => $this->warehouse->id,
            'branch_id' => [$this->branch->id],
            'movement_type' => 'out',
        ]);

        $this->assertSame('posted_stock_movements', $report['scope']['source']);
        $this->assertFalse($report['scope']['snapshot']);
        $this->assertCount(1, $report['data']);
        $this->assertSame('out', $report['data'][0]['type']);
        $this->assertSame(2, $report['data'][0]['quantity']);
        $this->assertSame('100.00', $report['data'][0]['unit_cost']);
        $this->assertSame('200.00', $report['data'][0]['total_cost']);
        $this->assertSame(8, $report['data'][0]['balance_quantity']);
        $this->assertSame(0, $report['totals']['in_quantity']);
        $this->assertSame(2, $report['totals']['out_quantity']);
        $this->assertSame('200.00', $report['totals']['out_cost']);
        $this->assertSame('200.00', $report['totals']['total_cost']);
    }

    /** @test */
    public function it_reports_only_posted_stock_permits_and_matches_transfer_from_its_source_or_target_warehouse(): void
    {
        $receipt = StockPermit::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'type' => 'receipt',
            'number' => 'SR-RPT-1',
            'warehouse_id' => $this->warehouse->id,
            'permit_date' => '2026-04-01',
            'status' => 'posted',
            'total_cost' => 100000,
        ]);
        StockPermitLine::create([
            'tenant_id' => $this->tenantId,
            'stock_permit_id' => $receipt->id,
            'product_id' => $this->product->id,
            'quantity' => 10,
            'unit_cost' => 10000,
            'line_cost' => 100000,
        ]);
        $transfer = StockPermit::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'type' => 'transfer',
            'number' => 'ST-RPT-1',
            'warehouse_id' => $this->warehouse->id,
            'target_warehouse_id' => $this->targetWarehouse->id,
            'permit_date' => '2026-04-02',
            'status' => 'posted',
            'total_cost' => 20000,
        ]);
        StockPermitLine::create([
            'tenant_id' => $this->tenantId,
            'stock_permit_id' => $transfer->id,
            'product_id' => $this->product->id,
            'quantity' => 2,
            'unit_cost' => 10000,
            'line_cost' => 20000,
        ]);
        $draft = StockPermit::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'type' => 'issue',
            'number' => 'SI-RPT-DRAFT',
            'warehouse_id' => $this->warehouse->id,
            'permit_date' => '2026-04-03',
            'status' => 'draft',
            'total_cost' => 900000,
        ]);
        StockPermitLine::create([
            'tenant_id' => $this->tenantId,
            'stock_permit_id' => $draft->id,
            'product_id' => $this->product->id,
            'quantity' => 90,
            'unit_cost' => 10000,
            'line_cost' => 900000,
        ]);

        $report = $this->report(['view' => 'operations', 'warehouse_id' => $this->targetWarehouse->id]);

        $this->assertSame('posted_stock_permits', $report['scope']['source']);
        $this->assertCount(1, $report['data']);
        $this->assertSame('ST-RPT-1', $report['data'][0]['number']);
        $this->assertSame('transfer', $report['data'][0]['type']);
        $this->assertSame('مخزن الوجهة', $report['data'][0]['target_warehouse']);
        $this->assertSame(2, $report['data'][0]['quantity']);
        $this->assertSame('200.00', $report['data'][0]['total_cost']);
    }

    /** @test */
    public function it_reports_posted_stocktake_differences_without_turning_an_uncounted_line_into_zero(): void
    {
        $posted = Stocktake::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'number' => 'STK-RPT-1',
            'warehouse_id' => $this->warehouse->id,
            'stocktake_date' => '2026-05-01',
            'status' => 'posted',
            'difference_value' => -20000,
        ]);
        StocktakeLine::create([
            'tenant_id' => $this->tenantId,
            'stocktake_id' => $posted->id,
            'product_id' => $this->product->id,
            'system_quantity' => 10,
            'counted_quantity' => 8,
            'unit_cost' => 10000,
            'difference_value' => -20000,
        ]);
        StocktakeLine::create([
            'tenant_id' => $this->tenantId,
            'stocktake_id' => $posted->id,
            'product_id' => $this->zeroProduct->id,
            'system_quantity' => 4,
            'counted_quantity' => null,
            'unit_cost' => 9000,
            'difference_value' => 0,
        ]);
        Stocktake::create([
            'tenant_id' => $this->tenantId,
            'branch_id' => $this->branch->id,
            'number' => 'STK-RPT-DRAFT',
            'warehouse_id' => $this->warehouse->id,
            'stocktake_date' => '2026-05-02',
            'status' => 'draft',
            'difference_value' => -900000,
        ]);

        $report = $this->report(['view' => 'stocktakes', 'product_id' => $this->product->id]);

        $this->assertSame('posted_stocktakes', $report['scope']['source']);
        $this->assertCount(1, $report['data']);
        $this->assertSame('STK-RPT-1', $report['data'][0]['number']);
        $this->assertSame(1, $report['data'][0]['counted_lines']);
        $this->assertSame(-2, $report['data'][0]['quantity_difference']);
        $this->assertSame('-200.00', $report['data'][0]['difference_value']);
        $this->assertSame('-200.00', $report['totals']['difference_value']);
    }

    /** @test */
    public function inventory_report_data_is_tenant_isolated_and_invalid_filters_are_rejected(): void
    {
        $other = $this->registerTenant('other-inventory-reports', 'other-inventory-reports@nibras.test');

        $this->assertSame([], $this->withToken($other['token'])
            ->getJson('/api/reports/inventory?view=value')->assertOk()['data']);

        $this->withToken($this->token)->getJson('/api/reports/inventory?view=turnover')->assertStatus(422);
        $this->withToken($this->token)->getJson('/api/reports/inventory?view=movements&movement_type=adjustment')->assertStatus(422);
        $this->withToken($this->token)->getJson('/api/reports/inventory?view=operations&operation_type=count')->assertStatus(422);
        $this->withToken($this->token)->getJson('/api/reports/inventory?view=stocktakes&from=2026-05-02&to=2026-05-01')->assertStatus(422);
    }
}

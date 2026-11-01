<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelInventoryCostState;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Services\Reporting\InventoryReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * FS-03: قيمة مخزون الوقود في تقرير القيمة من مجمّع التكلفة (لا كمية × avg_cost المقتطع إلى 0).
 * FS-04: الحركات العامة على منتج وقود مرفوضة؛ مجمّع التكلفة لا يكتبه إلا مسار الوقود.
 */
class FuelCostPoolIntegrityTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;

    /** 2.33 ر.س/ل = 233 هللة/ل = 0.233 هللة/مل: `intdiv` على الوحدة الصغرى يعطي 0. */
    private const RECEIVED_LITERS = '100.000';
    private const RECEIVED_QTY_ML = 100000;
    private const RECEIVED_COST_MINOR = 23300;

    /** @test */
    public function fuel_stock_value_in_the_inventory_report_comes_from_the_cost_pool(): void
    {
        $f = $this->fixtureWithStock();

        // الخلل الأصلي: المتوسط الصحيح المخزَّن على المنتج مقتطع إلى 0.
        $this->assertSame(0, (int) Product::findOrFail($f['product']->id)->avg_cost);

        $report = app(InventoryReportService::class)->report('value');
        $row = collect($report['rows'])->firstWhere('product_id', $f['product']->id);
        $this->assertNotNull($row);
        $this->assertSame(self::RECEIVED_QTY_ML, $row['quantity']);
        $this->assertSame(self::RECEIVED_COST_MINOR, $row['stock_value']);
        $this->assertSame('fuel_cost_pool', $row['value_basis']);
        $this->assertSame(self::RECEIVED_COST_MINOR, $report['totals']['stock_value']);
        // تتطابق مع حساب المخزون 1140 هللةً بهللة.
        $this->assertSame(self::RECEIVED_COST_MINOR, (int) FuelInventoryCostState::query()->sum('cost_pool_minor'));
    }

    /** @test */
    public function non_fuel_products_keep_the_average_cost_valuation(): void
    {
        $f = $this->fixtureWithStock();
        $plain = Product::findOrFail($this->withToken($f['token'])->postJson('/api/products', [
            'name' => 'منتج عادي', 'type' => 'good', 'unit' => 'pc', 'sale_price' => 9000, 'purchase_price' => 500, 'track_inventory' => true,
        ])->assertCreated()['data']['id']);
        app(InventoryService::class)->applyReceipt($plain, 10, 500, ['warehouse_id' => $f['warehouse']->id]);

        $rows = collect(app(InventoryReportService::class)->report('value')['rows']);
        $row = $rows->firstWhere('product_id', $plain->id);
        $this->assertSame(5000, $row['stock_value']);
        $this->assertSame('avg_cost', $row['value_basis']);
    }

    /** @test */
    public function a_warehouse_restricted_user_sees_the_pool_only_of_allowed_warehouses(): void
    {
        $f = $this->fixtureWithStock();
        $other = Warehouse::create(['name' => 'مخزن آخر', 'code' => 'WH-X', 'branch_id' => $f['branch']->id]);
        $role = Role::create(['tenant_id' => $f['tenant_id'], 'slug' => 'fuel-pool-viewer', 'name' => 'مشاهد', 'permissions' => ['reports.view'], 'is_system' => false]);
        $user = User::create(['tenant_id' => $f['tenant_id'], 'name' => 'مقيَّد', 'email' => 'pool-viewer@fuel.test', 'password' => 'password123', 'role' => $role->slug]);
        $user->warehouses()->attach($other->id);

        $this->actingAs($user);
        $row = collect(app(InventoryReportService::class)->report('value')['rows'])->firstWhere('product_id', $f['product']->id);
        $this->assertSame(0, $row['stock_value']);

        $user->warehouses()->sync([$f['warehouse']->id]);
        $this->actingAs($user->fresh());
        $row = collect(app(InventoryReportService::class)->report('value')['rows'])->firstWhere('product_id', $f['product']->id);
        $this->assertSame(self::RECEIVED_COST_MINOR, $row['stock_value']);
    }

    /** @test */
    public function a_generic_issue_or_receipt_on_a_fuel_product_is_rejected_and_leaves_the_pool_untouched(): void
    {
        $f = $this->fixtureWithStock();
        $inventory = app(InventoryService::class);
        $movements = StockMovement::count();

        $issue = $this->thrown(fn () => $inventory->applyIssue($f['product'], 40000, 0, ['warehouse_id' => $f['warehouse']->id]), 'الإخراج العام لمنتج وقود يجب أن يُرفض.');
        $this->assertStringContainsString('FUEL_POOL_MANAGED', $issue->getMessage());
        $receipt = $this->thrown(fn () => $inventory->applyReceipt($f['product'], 1000, 1, ['warehouse_id' => $f['warehouse']->id]), 'الاستلام العام لمنتج وقود يجب أن يُرفض.');
        $this->assertStringContainsString('FUEL_POOL_MANAGED', $receipt->getMessage());

        $this->assertSame($movements, StockMovement::count());
        $this->assertSame(self::RECEIVED_QTY_ML, (int) Product::findOrFail($f['product']->id)->quantity_on_hand);
        $state = FuelInventoryCostState::query()->firstOrFail();
        $this->assertSame(self::RECEIVED_QTY_ML, (int) $state->quantity_milliliters);
        $this->assertSame(self::RECEIVED_COST_MINOR, (int) $state->cost_pool_minor);
    }

    /** @test */
    public function posting_a_generic_invoice_with_a_fuel_product_line_is_rejected_without_stock_or_ledger_effect(): void
    {
        $f = $this->fixtureWithStock();
        $customer = $this->withToken($f['token'])->postJson('/api/partners', ['name' => 'عميل عام', 'type' => 'customer'])->assertCreated()['data']['id'];
        $invoice = $this->withToken($f['token'])->postJson('/api/invoices', [
            'partner_id' => $customer, 'tax_inclusive' => false,
            'items' => [['product_id' => $f['product']->id, 'quantity' => 40000, 'unit_price' => 1, 'tax_rate' => 0]],
        ])->assertCreated()['data'];
        $movements = StockMovement::count();

        $response = $this->withToken($f['token'])->postJson('/api/invoices/' . $invoice['id'] . '/post');
        $response->assertStatus(422);
        $this->assertStringContainsString('FUEL_POOL_MANAGED', (string) $response->json('message'));
        $this->assertSame($movements, StockMovement::count());
        $this->assertSame(self::RECEIVED_QTY_ML, (int) Product::findOrFail($f['product']->id)->quantity_on_hand);
        $this->assertSame('draft', $this->withToken($f['token'])->getJson('/api/invoices/' . $invoice['id'])->json('data.status'));
    }

    /** @test */
    public function only_the_fuel_services_may_pass_the_pool_marker_to_inventory(): void
    {
        $holders = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path(), \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if ($file->getExtension() === 'php' && str_contains((string) file_get_contents($file->getPathname()), 'FUEL_POOL_META')) {
                $holders[] = str_replace(app_path() . DIRECTORY_SEPARATOR, '', $file->getPathname());
            }
        }
        sort($holders);

        $this->assertSame([
            'Services' . DIRECTORY_SEPARATOR . 'Accounting' . DIRECTORY_SEPARATOR . 'InventoryService.php',
            'Services' . DIRECTORY_SEPARATOR . 'FuelReconciliationService.php',
            'Services' . DIRECTORY_SEPARATOR . 'FuelSaleService.php',
            'Services' . DIRECTORY_SEPARATOR . 'FuelSupplyReceivingService.php',
        ], $holders);
    }

    /** @return array<string,mixed> */
    private function fixtureWithStock(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();
        $product = Product::findOrFail($this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود قيمة mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1, 'purchase_price' => 1, 'track_inventory' => true,
        ])->assertCreated()['data']['id']);
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-POOL', 'name' => 'محطة المجمّع']);
        $fuel = FuelProduct::create(['product_id' => $product->id, 'code' => 'F-POOL', 'name' => 'وقود المجمّع']);
        $tank = FuelTank::create([
            'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
            'code' => 'T-POOL', 'name' => 'خزان المجمّع', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000,
        ]);
        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد المجمّع', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'مخزون مستلم غير مفوتر', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $ownerId = User::query()->value('id');
        app(FuelStationSettingsService::class)->putTenant(['grni_account_id' => $grni->id], User::findOrFail($ownerId), 'تهيئة GRNI للاختبار');

        $service = app(FuelSupplyReceivingService::class);
        $delivery = $service->createDelivery([
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'warehouse_id' => $warehouse->id,
            'supplier_id' => $supplier->id, 'dispatched_liters' => self::RECEIVED_LITERS, 'received_liters' => self::RECEIVED_LITERS,
            'received_total_cost_minor' => self::RECEIVED_COST_MINOR, 'delivery_note_number' => 'DN-POOL-1', 'idempotency_key' => 'pool-1',
            'received_at' => '2026-08-23 10:00:00', 'created_by' => $ownerId,
        ]);
        $service->approveDelivery($delivery, $ownerId);

        return ['token' => $auth['token'], 'tenant_id' => $auth['tenant_id'], 'branch' => $branch, 'warehouse' => $warehouse, 'product' => $product->fresh()];
    }
}

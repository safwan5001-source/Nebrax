<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelCostBasisService;
use App\Services\FuelStationSettingsService;
use App\Services\Accounting\InventoryService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FuelSaleApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function fuel_sale_api_enforces_exact_permissions_and_finalizes_only_from_the_server_price_source(): void
    {
        $fixture = $this->fixture();
        $base = '/api/fuel-stations';
        $this->withToken($fixture['token'])->getJson("{$base}/sales")->assertOk();

        $legacyRole = Role::create([
            'tenant_id' => $fixture['tenant_id'], 'slug' => 'legacy-fuel-sale-viewer', 'name' => 'عارض محطات قديم',
            'permissions' => ['fuel_stations.view'], 'is_system' => false,
        ]);
        $legacy = User::create([
            'tenant_id' => $fixture['tenant_id'], 'name' => 'عارض محدود', 'email' => 'legacy-fuel-sale-viewer@example.test',
            'password' => 'password123', 'role' => $legacyRole->slug,
        ]);
        $this->withToken($legacy->createToken('api')->plainTextToken)->getJson("{$base}/sales")->assertForbidden();

        $price = $this->withToken($fixture['token'])->postJson("{$base}/prices", [
            'fuel_station_id' => $fixture['station']->id,
            'fuel_product_id' => $fixture['fuelProduct']->id,
            'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(),
            'reason' => 'سعر API رسمي',
        ])->assertCreated()->assertJsonPath('data.price_per_liter_minor', 230)['data'];
        $this->assertSame($fixture['station']->id, $price['fuel_station_id']);

        $shift = $this->withToken($fixture['token'])->postJson("{$base}/shifts/open", [
            'fuel_station_id' => $fixture['station']->id, 'opening_float_minor' => 0, 'idempotency_key' => 'api-sale-shift',
        ])->assertCreated()['data'];
        $sale = $this->withToken($fixture['token'])->postJson("{$base}/sales", [
            'fuel_station_id' => $fixture['station']->id,
            'fuel_nozzle_id' => $fixture['nozzle']->id,
            'fuel_shift_id' => $shift['id'],
            'partner_id' => $fixture['customer']->id,
            'quantity_milliliters' => 1234,
            'idempotency_key' => 'api-sale-draft',
            // لا يملك العميل حق تمرير السعر أو الإجمالي؛ العقد لا يقبلهما أصلاً.
            'price_per_liter_minor' => 1,
            'gross_minor' => 1,
        ])->assertCreated()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.gross_minor', null)['data'];

        $final = $this->withToken($fixture['token'])->postJson("{$base}/sales/{$sale['id']}/finalize")
            ->assertOk()->assertJsonPath('data.status', 'finalized')
            ->assertJsonPath('data.price_per_liter_minor', 230)
            ->assertJsonPath('data.gross_minor', 284)
            ->assertJsonPath('data.fuel_price_tax_mode', 'tax_inclusive')
            ->assertJsonPath('data.invoice_tax_inclusive', true)
            ->assertJsonPath('data.invoice_total_minor', 284)['data'];
        $this->assertSame('half_up', $final['pricing']['rounding_policy']);
        $this->assertSame(1, FuelSale::count());
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-sale-api', 'owner-fuel-sale-api@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        Tenant::findOrFail($auth['tenant_id'])->update(['country' => 'SA']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL,
            EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_cycle_5_access', reason: 'اختبار Cycle 5.'
        );
        $warehouse = Warehouse::where('tenant_id', $auth['tenant_id'])->where('branch_id', $branch->id)->sole();
        $customer = Partner::create(['tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'name' => 'عميل API', 'type' => 'customer']);
        $product = Product::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'sku' => 'FUEL-SALE-API', 'name' => 'وقود API', 'unit' => 'mL', 'track_inventory' => true,
        ]);
        $fuelProduct = FuelProduct::create(['tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'code' => 'FUEL-SALE-API', 'name' => 'بنزين API']);
        $station = FuelStation::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'ST-SALE-API', 'name' => 'محطة بيع API',
        ]);
        $tank = FuelTank::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => 'TN-SALE-API', 'name' => 'خزان API', 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = FuelPump::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'P-SALE-API',
        ]);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => 'N-SALE-API',
        ]);
        app(FuelStationSettingsService::class)->putStationValues($station, [
            'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false, 'shift_supervisor_approval_required' => false,
        ], $actor, 'تهيئة API Cycle 5');
        app(FuelCostBasisService::class)->assertReady($fuelProduct, $warehouse);
        $movement = app(InventoryService::class)->applyReceipt($product, 10000, 100, [
            'warehouse_id' => $warehouse->id, 'source_type' => FuelProduct::class, 'source_id' => $fuelProduct->id,
        ], 1000000);
        app(FuelCostBasisService::class)->recordReceipt($fuelProduct, $warehouse, $movement, 10000, 1000000);

        return compact('actor', 'branch', 'warehouse', 'customer', 'product', 'fuelProduct', 'station', 'tank', 'pump', 'nozzle') + $auth;
    }
}

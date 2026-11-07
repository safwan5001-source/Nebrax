<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\EntitlementGrantService;
use App\Services\FuelCostBasisService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * FUEL-P1-1 — محطة بتجهيزين مستقلين (مضخة+خزان+فوهة ×2) على مجمّع مخزون واحد، ووردية مفتوحة وسعر ساري.
 * بيانات اصطناعية فقط؛ تُستعمل من اختبار الخدمة/الـAPI واختبار القفل على PostgreSQL.
 */
trait BuildsFuelEquipmentFixture
{
    /** @return array<string,mixed> */
    private function equipmentFixture(string $suffix = 'a'): array
    {
        $slug = 'fuel-equip-' . $suffix . '-' . Str::lower(Str::random(5));
        $auth = $this->registerTenant($slug, "owner-{$slug}@fuel-equip.test");
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_equipment_state', reason: 'اختبار حالة معدات البيع.',
        );
        Tenant::findOrFail($tenantId)->update(['country' => 'SA']);
        $branch = Branch::where('tenant_id', $tenantId)->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('branch_id', $branch->id)->sole();
        $customer = Partner::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'name' => 'عميل معدات', 'type' => 'customer']);
        $product = Product::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'sku' => 'FEQ-' . $slug, 'name' => 'بنزين معدات', 'unit' => 'mL', 'track_inventory' => true]);
        $fuelProduct = FuelProduct::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'code' => 'FEQ-' . $slug, 'name' => 'بنزين 91']);
        $station = FuelStation::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FEQS-' . $slug, 'name' => 'محطة معدات']);

        $sets = [];
        foreach ([1, 2] as $n) {
            $tank = FuelTank::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
                'code' => "T{$n}-{$slug}", 'name' => "خزان {$n}", 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
            ]);
            $pump = FuelPump::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => "P{$n}-{$slug}"]);
            $nozzle = FuelNozzle::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
                'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => "N{$n}-{$slug}",
            ]);
            $sets[$n] = compact('tank', 'pump', 'nozzle');
        }
        app(FuelCostBasisService::class)->assertReady($fuelProduct, $warehouse);
        $movement = app(InventoryService::class)->applyReceipt($product, 100000, 100, [
            'warehouse_id' => $warehouse->id, 'source_type' => FuelProduct::class, 'source_id' => $fuelProduct->id, 'notes' => 'رصيد اختبار', InventoryService::FUEL_POOL_META => true,
        ], 10000000);
        app(FuelCostBasisService::class)->recordReceipt($fuelProduct, $warehouse, $movement, 100000, 10000000);
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'سعر اختبار',
        ], $actor);
        $shift = app(FuelShiftService::class)->open(['fuel_station_id' => $station->id, 'opening_float_minor' => 0, 'idempotency_key' => 'shift-' . $slug], $actor);

        return [
            'tenant_id' => $tenantId, 'token' => $auth['token'], 'actor' => $actor, 'warehouse' => $warehouse, 'product' => $product, 'station' => $station,
            'customer' => $customer, 'shift' => $shift, 'a' => $sets[1], 'b' => $sets[2],
        ];
    }
}

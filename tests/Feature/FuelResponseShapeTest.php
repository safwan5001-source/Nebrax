<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelFleetDriver;
use App\Models\FuelFleetVehicle;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\PaymentMethod;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FS-35: استجابات الوقود بقوائم حقول صريحة (Resources) بدل النماذج الخام التي كانت تسرّب
 * مستخدماً كاملاً في `assignee`، وحسابات الأستاذ في طرق الدفع، و`tenant_id`/`created_by`، والجوال/الهيكل.
 */
class FuelResponseShapeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function work_order_assignee_exposes_only_id_and_name(): void
    {
        $f = $this->fixture();
        $assignee = User::create(['tenant_id' => $f['tenant_id'], 'name' => 'فني الصيانة', 'email' => 'tech@fuel-shape.test', 'password' => 'password123', 'role' => 'staff']);

        $created = $this->withToken($f['owner'])->postJson(self::BASE . '/maintenance/work-orders', [
            'fuel_station_id' => $f['station']->id, 'asset_type' => FuelTank::class, 'asset_id' => $f['tank']->id,
            'work_type' => 'corrective', 'title' => 'تسرب', 'assigned_to' => $assignee->id,
        ])->assertCreated()->json('data');
        $this->assertSame(['id', 'name'], array_keys($created['assignee']));

        $listed = $this->withToken($f['owner'])->getJson(self::BASE . '/maintenance')->assertOk()->json('data.work_orders.data.0.assignee');
        $this->assertSame(['id', 'name'], array_keys($listed));
        $this->assertSame('فني الصيانة', $listed['name']);
        $this->assertStringNotContainsString('tech@fuel-shape.test', (string) $this->withToken($f['owner'])->get(self::BASE . '/maintenance')->getContent());
    }

    /** @test */
    public function sale_payment_methods_expose_no_ledger_link_or_internal_settings(): void
    {
        $f = $this->fixture();
        $method = PaymentMethod::create(['name' => 'نقدي المحطة', 'settlement_type' => 'cash', 'is_active' => true]);
        app(FuelStationSettingsService::class)->putStation($f['station'], 'fuel_sales_allowed_payment_method_ids', [$method->id], User::query()->firstOrFail(), 'اختبار');

        $rows = $this->withToken($f['owner'])->getJson(self::BASE . '/stations/' . $f['station']->id . '/sale-payment-methods')->assertOk()->json('data');
        $this->assertCount(1, $rows);
        $this->assertSame(['id', 'is_active', 'name', 'name_en', 'settlement_type'], collect(array_keys($rows[0]))->sort()->values()->all());
    }

    /** @test */
    public function fleet_lists_hide_internal_columns_and_pii_from_non_managers(): void
    {
        $f = $this->fixture();
        FuelFleetVehicle::create(['tenant_id' => $f['tenant_id'], 'plate_number' => 'ABC-1', 'vin' => 'VIN-SECRET-1', 'status' => 'active']);
        FuelFleetDriver::create(['tenant_id' => $f['tenant_id'], 'name' => 'سائق', 'identifier' => 'DRV-1', 'mobile' => '+966500000001', 'status' => 'active']);

        $viewer = $this->withToken($f['viewer']);
        $vehicle = $viewer->getJson(self::BASE . '/fleet/vehicles')->assertOk()->json('data.0');
        $driver = $viewer->getJson(self::BASE . '/fleet/drivers')->assertOk()->json('data.0');
        foreach (['tenant_id', 'created_by', 'vin'] as $key) {
            $this->assertArrayNotHasKey($key, $vehicle, $key);
        }
        foreach (['tenant_id', 'created_by', 'mobile', 'employee_id'] as $key) {
            $this->assertArrayNotHasKey($key, $driver, $key);
        }
        $this->assertSame('ABC-1', $vehicle['plate_number']);
        $this->assertSame('DRV-1', $driver['identifier']);

        $manager = $this->withToken($f['owner']);
        $this->assertSame('VIN-SECRET-1', $manager->getJson(self::BASE . '/fleet/vehicles')->json('data.0.vin'));
        $this->assertSame('+966500000001', $manager->getJson(self::BASE . '/fleet/drivers')->json('data.0.mobile'));
        $this->assertArrayNotHasKey('tenant_id', $manager->getJson(self::BASE . '/fleet/drivers')->json('data.0'));
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-shape', 'owner@fuel-shape.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        $grants = app(EntitlementGrantService::class);
        foreach (['fuel_stations.core', 'fuel_stations.maintenance'] as $app) {
            $grants->grant($tenant, $app, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs35', reason: 'اختبار شكل الاستجابات.');
        }
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود شكل mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-SHAPE', 'name' => 'وقود شكل']);
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-SHAPE', 'name' => 'محطة الشكل']);
        $tank = FuelTank::create([
            'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
            'code' => 'T-SHAPE', 'name' => 'خزان الشكل', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000,
        ]);
        $role = Role::create(['tenant_id' => $tenantId, 'slug' => 'fuel-fleet-viewer', 'name' => 'مشاهد أسطول', 'permissions' => ['fuel.fleet.view'], 'is_system' => false]);
        $viewer = User::create(['tenant_id' => $tenantId, 'name' => 'مشاهد', 'email' => 'viewer@fuel-shape.test', 'password' => 'password123', 'role' => $role->slug]);

        return ['owner' => $auth['token'], 'tenant_id' => $tenantId, 'station' => $station, 'tank' => $tank, 'viewer' => $viewer->createToken('api')->plainTextToken];
    }
}

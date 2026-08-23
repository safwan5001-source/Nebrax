<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\Tenant;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationMasterDataService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class FuelStationMasterDataTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_builds_station_fuel_tank_pump_and_nozzle_master_data_with_consistent_branch_and_product_mapping(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $service = app(FuelStationMasterDataService::class);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $productId = $this->product($auth['token']);

        $station = $service->createStation([
            'branch_id' => $branch->id,
            'code' => 'FS-DMM-01',
            'name' => 'محطة الدمام الرئيسية',
            'city' => 'الدمام',
            'country_code' => 'sa',
            'timezone' => 'Asia/Riyadh',
            'operating_day_starts_at' => '00:00',
            'operating_hours' => ['sun' => [['from' => '00:00', 'to' => '23:59']]],
        ]);
        $fuel = $service->createFuelProduct([
            'product_id' => $productId,
            'code' => 'G95',
            'name' => 'بنزين 95',
            'density_kg_per_m3' => 755,
            'tax_category' => 'standard',
        ]);
        $tank = $service->createTank([
            'fuel_station_id' => $station->id,
            'fuel_product_id' => $fuel->id,
            'code' => 'T-95-01',
            'name' => 'خزان بنزين 95',
            'capacity_milliliters' => 5000000000,
            'safe_capacity_milliliters' => 4750000000,
            'minimum_level_milliliters' => 1000000000,
            'dead_stock_milliliters' => 100000000,
            'opening_volume_milliliters' => 2000000000,
            'atg_source_key' => 'atg-dmm-01',
            'calibration_points' => [
                ['level_millimeters' => 100, 'volume_milliliters' => 200000000],
                ['level_millimeters' => 500, 'volume_milliliters' => 1500000000],
            ],
        ]);
        $pump = $service->createPump([
            'fuel_station_id' => $station->id,
            'pump_number' => 'P-01',
            'controller_key' => 'fc-dmm-p01',
        ]);
        $nozzle = $service->createNozzle([
            'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id,
            'fuel_product_id' => $fuel->id,
            'nozzle_number' => 'N-01',
            'meter_opening_milliliters' => 12345000,
        ]);

        $this->assertSame($branch->id, $tank->branch_id);
        $this->assertSame($station->id, $nozzle->fuel_station_id);
        $this->assertSame($fuel->id, $nozzle->fuel_product_id);
        $this->assertSame(2, $tank->calibrationPoints()->count());
        $this->assertSame('SA', $station->country_code);
    }

    /** @test */
    public function it_rejects_a_nozzle_mapping_across_stations_or_with_a_mismatched_tank_fuel_product(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $service = app(FuelStationMasterDataService::class);
        $main = Branch::where('is_main', true)->firstOrFail();
        $second = Branch::create(['code' => '00002', 'name' => 'فرع ثانٍ', 'is_main' => false]);
        $product95 = $this->product($auth['token'], 'بنزين 95');
        $product91 = $this->product($auth['token'], 'بنزين 91');
        $fuel95 = $service->createFuelProduct(['product_id' => $product95, 'code' => 'G95', 'name' => 'بنزين 95']);
        $fuel91 = $service->createFuelProduct(['product_id' => $product91, 'code' => 'G91', 'name' => 'بنزين 91']);
        $a = $service->createStation(['branch_id' => $main->id, 'code' => 'FS-A', 'name' => 'محطة أ']);
        $b = $service->createStation(['branch_id' => $second->id, 'code' => 'FS-B', 'name' => 'محطة ب']);
        $tank = $service->createTank([
            'fuel_station_id' => $a->id, 'fuel_product_id' => $fuel95->id, 'code' => 'T-A', 'name' => 'خزان أ',
            'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = $service->createPump(['fuel_station_id' => $b->id, 'pump_number' => 'P-B']);

        $this->expectException(RuntimeException::class);
        $service->createNozzle([
            'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel91->id, 'nozzle_number' => 'N-B',
        ]);
    }

    /** @test */
    public function it_prevents_breaking_master_data_mappings_and_keeps_tenants_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        app(TenantContext::class)->set($a['tenant_id']);
        $service = app(FuelStationMasterDataService::class);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $productId = $this->product($a['token']);
        $station = $service->createStation(['branch_id' => $branch->id, 'code' => 'FS-ACME', 'name' => 'محطة أكمي']);
        $fuel = $service->createFuelProduct(['product_id' => $productId, 'code' => 'DIESEL', 'name' => 'ديزل']);
        $tank = $service->createTank([
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-D', 'name' => 'خزان ديزل',
            'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = $service->createPump(['fuel_station_id' => $station->id, 'pump_number' => 'P-1']);
        $service->createNozzle([
            'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => 'N-1',
        ]);

        $this->expectException(RuntimeException::class);
        $service->deleteTank($tank);
    }

    /** @test */
    public function station_master_data_is_not_visible_to_another_tenant(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        app(TenantContext::class)->set($a['tenant_id']);
        $branch = Branch::where('is_main', true)->firstOrFail();
        app(FuelStationMasterDataService::class)->createStation(['branch_id' => $branch->id, 'code' => 'FS-ACME', 'name' => 'محطة أكمي']);

        $b = $this->registerTenant('globex', 'owner@globex.test');
        app(TenantContext::class)->set($b['tenant_id']);

        $this->assertSame(0, FuelStation::query()->count());
        $this->assertSame(0, FuelProduct::query()->count());
        $this->assertSame(0, FuelTank::query()->count());
        $this->assertSame(0, FuelPump::query()->count());
        $this->assertSame(0, FuelNozzle::query()->count());
    }

    /** @test */
    public function api_requires_commercial_access_and_role_permission_then_serves_master_data_crud(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: true);
        $this->withToken($auth['token'])->getJson('/api/fuel-stations/stations')->assertStatus(403);
        $this->grantFoundation($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'fuel-stations-cycle1-staff@example.test');
        $this->withToken($staff)->getJson('/api/fuel-stations/stations')->assertStatus(403);

        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $station = $this->withToken($auth['token'])->postJson('/api/fuel-stations/stations', [
            'branch_id' => $branch->id, 'code' => 'FS-API-01', 'name' => 'محطة API', 'city' => 'الدمام',
        ])->assertCreated()->assertJsonPath('data.code', 'FS-API-01')['data'];
        $productId = $this->product($auth['token'], 'منتج API');
        $fuel = $this->withToken($auth['token'])->postJson('/api/fuel-stations/products', [
            'product_id' => $productId, 'code' => 'API-95', 'name' => 'بنزين API',
        ])->assertCreated()['data'];
        $tank = $this->withToken($auth['token'])->postJson('/api/fuel-stations/tanks', [
            'fuel_station_id' => $station['id'], 'fuel_product_id' => $fuel['id'], 'code' => 'T-API', 'name' => 'خزان API',
            'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ])->assertCreated()->assertJsonPath('data.branch_id', $branch->id)['data'];
        $pump = $this->withToken($auth['token'])->postJson('/api/fuel-stations/pumps', [
            'fuel_station_id' => $station['id'], 'pump_number' => 'P-API',
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson('/api/fuel-stations/nozzles', [
            'fuel_pump_id' => $pump['id'], 'fuel_tank_id' => $tank['id'], 'fuel_product_id' => $fuel['id'], 'nozzle_number' => 'N-API',
        ])->assertCreated()->assertJsonPath('data.fuel_station_id', $station['id']);

        $this->withToken($auth['token'])->deleteJson('/api/fuel-stations/tanks/' . $tank['id'])->assertStatus(422);
        $this->withToken($auth['token'])->getJson('/api/fuel-stations/nozzles')->assertOk()->assertJsonCount(1, 'data');
    }

    private function grantFoundation(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId),
            'fuel_stations.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'),
            grantReasonCode: 'test_cycle_1_access',
            reason: 'اختبار Cycle 1.',
        );
    }

    private function product(string $token, string $name = 'منتج وقود'): string
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => $name,
            'type' => 'good',
            'sale_price' => 1000,
            'purchase_price' => 500,
            'track_inventory' => true,
        ])->assertCreated()['data']['id'];
    }
}

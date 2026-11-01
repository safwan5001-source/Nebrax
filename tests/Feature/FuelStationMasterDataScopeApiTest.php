<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelStationDevice;
use App\Models\FuelStationIntegrationEvent;
use App\Models\FuelTank;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FS-05 (PR-2b): نطاق الفرع/المخزن للبيانات الرئيسية (محطات/خزانات/مضخات/فوهات) والأجهزة والأحداث والـworkspace.
 * هذه النماذج CompanyWide/BelongsToBranch بلا تصفية آلية، فكان مستخدم مقيَّد يقرأ ويعدّل ويحذف محطات خارج نطاقه.
 */
class FuelStationMasterDataScopeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function a_branch_restricted_user_neither_sees_nor_changes_another_branch_station_tree(): void
    {
        $f = $this->fixture();
        $token = $f['branch_user_token'];
        $b = $f['b'];

        // القراءة: قوائم تخلو من فرع آخر، والعرض بمعرّف = 404.
        $codes = fn (string $path) => collect($this->withToken($token)->getJson(self::BASE . $path)->assertOk()->json('data'))->pluck('code')->all();
        $this->assertSame(['FS-A', 'FS-A2'], $codes('/stations'));
        $this->assertNotContains('T-B', $codes('/tanks'));
        $this->assertCount(2, $this->withToken($token)->getJson(self::BASE . '/pumps')->json('data'));
        $this->assertCount(2, $this->withToken($token)->getJson(self::BASE . '/nozzles')->json('data'));
        $this->withToken($token)->getJson(self::BASE . '/stations/' . $b['station']->id)->assertNotFound();
        $this->withToken($token)->getJson(self::BASE . '/tanks/' . $b['tank']->id)->assertNotFound();
        $this->withToken($token)->getJson(self::BASE . '/pumps/' . $b['pump']->id)->assertNotFound();
        $this->withToken($token)->getJson(self::BASE . '/nozzles/' . $b['nozzle']->id)->assertNotFound();
        $workspace = collect($this->withToken($token)->getJson(self::BASE . '/workspace')->assertOk()->json('data.stations'))->pluck('code')->all();
        $this->assertSame(['FS-A', 'FS-A2'], $workspace);

        // الكتابة على فرع آخر = 404 دون أثر.
        $this->withToken($token)->putJson(self::BASE . '/stations/' . $b['station']->id, ['name' => 'اختراق'])->assertNotFound();
        $this->withToken($token)->deleteJson(self::BASE . '/stations/' . $b['station']->id)->assertNotFound();
        $this->withToken($token)->putJson(self::BASE . '/tanks/' . $b['tank']->id, ['name' => 'اختراق'])->assertNotFound();
        $this->withToken($token)->deleteJson(self::BASE . '/tanks/' . $b['tank']->id)->assertNotFound();
        $this->withToken($token)->putJson(self::BASE . '/pumps/' . $b['pump']->id, ['name' => 'اختراق'])->assertNotFound();
        $this->withToken($token)->deleteJson(self::BASE . '/nozzles/' . $b['nozzle']->id)->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/tanks', [
            'fuel_station_id' => $b['station']->id, 'fuel_product_id' => $f['fuel']->id, 'code' => 'T-HACK', 'name' => 'خزان', 'capacity_milliliters' => 1000, 'safe_capacity_milliliters' => 900,
        ])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/pumps', ['fuel_station_id' => $b['station']->id, 'pump_number' => 'P-HACK', 'name' => 'مضخة'])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/nozzles', [
            'fuel_pump_id' => $b['pump']->id, 'fuel_tank_id' => $b['tank']->id, 'fuel_product_id' => $f['fuel']->id, 'nozzle_number' => 'N-HACK',
        ])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/stations', ['branch_id' => $b['station']->branch_id, 'code' => 'FS-HACK', 'name' => 'محطة اختراق'])->assertNotFound();
        // نقل محطة نطاقه إلى فرع خارج نطاقه.
        $this->withToken($token)->putJson(self::BASE . '/stations/' . $f['a']['station']->id, ['branch_id' => $b['station']->branch_id])->assertNotFound();

        $this->assertSame('محطة FS-B', FuelStation::findOrFail($b['station']->id)->name);
        $this->assertNotNull(FuelTank::find($b['tank']->id));
        $this->assertNotNull(FuelNozzle::find($b['nozzle']->id));
        $this->assertNull(FuelStation::where('code', 'FS-HACK')->first());

        // وفي نطاقه يعمل كالمعتاد.
        $this->withToken($token)->putJson(self::BASE . '/stations/' . $f['a']['station']->id, ['code' => 'FS-A', 'name' => 'محطة أ معدّلة'])->assertOk();
        $this->withToken($token)->putJson(self::BASE . '/pumps/' . $f['a']['pump']->id, ['pump_number' => 'P-A', 'name' => 'مضخة أ معدلة'])->assertOk();
    }

    /** @test */
    public function a_warehouse_restricted_user_loses_stations_bound_to_other_warehouses(): void
    {
        $f = $this->fixture();
        $token = $f['warehouse_user_token'];

        $codes = collect($this->withToken($token)->getJson(self::BASE . '/stations')->assertOk()->json('data'))->pluck('code')->all();
        $this->assertSame(['FS-A'], $codes); // A2 وB مخزناهما خارج النطاق
        $this->withToken($token)->getJson(self::BASE . '/stations/' . $f['a2']['station']->id)->assertNotFound();
        $this->withToken($token)->putJson(self::BASE . '/stations/' . $f['a2']['station']->id, ['name' => 'اختراق'])->assertNotFound();
        $this->withToken($token)->putJson(self::BASE . '/tanks/' . $f['a2']['tank']->id, ['name' => 'اختراق'])->assertNotFound();
        $this->assertCount(1, $this->withToken($token)->getJson(self::BASE . '/tanks')->json('data'));
        $this->assertCount(1, $this->withToken($token)->getJson(self::BASE . '/nozzles')->json('data'));
        $this->assertSame(['FS-A'], collect($this->withToken($token)->getJson(self::BASE . '/workspace')->json('data.stations'))->pluck('code')->all());
    }

    /** @test */
    public function devices_and_integration_events_follow_the_same_station_scope(): void
    {
        $f = $this->fixture();
        $token = $f['branch_user_token'];
        $b = $f['b'];

        $keys = collect($this->withToken($token)->getJson(self::BASE . '/devices')->assertOk()->json('data'))->pluck('device_key')->all();
        $this->assertSame(['dev-a', 'dev-a2'], collect($keys)->sort()->values()->all());
        $this->withToken($token)->putJson(self::BASE . '/devices/' . $b['device']->id, ['name' => 'اختراق جهاز'])->assertNotFound();
        $this->withToken($token)->deleteJson(self::BASE . '/devices/' . $b['device']->id)->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/devices/' . $b['device']->id . '/simulate-event', [
            'type' => 'pump.status.changed', 'event_id' => 'hack-1', 'occurred_at' => now()->toIso8601String(), 'payload' => ['pump_reference' => 'P-01', 'status' => 'online'],
        ])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/integration-events/' . $b['event']->id . '/retry')->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/devices', [
            'fuel_station_id' => $b['station']->id, 'device_key' => 'dev-hack', 'name' => 'جهاز اختراق', 'device_type' => 'atg', 'adapter_key' => 'fake.atg',
        ])->assertNotFound();
        $this->assertNotNull(FuelStationDevice::find($b['device']->id));
        $this->assertNull(FuelStationDevice::where('device_key', 'dev-hack')->first());

        // المالك غير المقيَّد يرى الأجهزة الثلاثة بلا تغيير.
        $this->assertCount(3, $this->withToken($f['owner_token'])->getJson(self::BASE . '/devices')->json('data'));
        $this->assertCount(3, $this->withToken($f['owner_token'])->getJson(self::BASE . '/stations')->json('data'));
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-md-scope', 'owner@fuel-md-scope.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        $grants = app(EntitlementGrantService::class);
        foreach (['fuel_stations.core', 'fuel_stations.integrations'] as $app) {
            $grants->grant($tenant, $app, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs05_md_scope', reason: 'اختبار نطاق الماستر.');
        }

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-A2', 'branch_id' => $branchA->id]);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود ماستر mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-MD', 'name' => 'وقود ماستر']);

        $tree = function (Branch $branch, Warehouse $warehouse, string $code) use ($fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة FS-' . $code]);
            $tank = FuelTank::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000,
            ]);
            $pump = FuelPump::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'P-' . $code, 'name' => 'مضخة ' . $code]);
            $nozzle = FuelNozzle::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
                'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => 'N-' . $code,
            ]);
            $device = FuelStationDevice::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'device_key' => 'dev-' . strtolower($code),
                'name' => 'جهاز ' . $code, 'device_type' => 'atg', 'adapter_key' => 'fake.atg',
            ]);
            $event = FuelStationIntegrationEvent::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_station_device_id' => $device->id,
                'source_id' => $device->device_key, 'event_id' => 'ev-' . $code, 'event_type' => 'pump.status.changed',
                'occurred_at' => now(), 'checksum' => hash('sha256', 'ev-' . $code),
                'payload' => ['pump_reference' => 'P-01', 'status' => 'online'],
                'status' => FuelStationIntegrationEvent::STATUS_FAILED, 'received_at' => now(),
            ]);

            return compact('station', 'tank', 'pump', 'nozzle', 'device', 'event');
        };
        $a = $tree($branchA, $warehouseA, 'A');
        $a2 = $tree($branchA, $warehouseA2, 'A2');
        $b = $tree($branchB, $warehouseB, 'B');

        $role = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-md-manager', 'name' => 'مدير وقود مقيَّد',
            'permissions' => [
                'fuel_stations.view', 'fuel_stations.manage', 'fuel.device.view', 'fuel.device.manage',
                'fuel.integration.view', 'fuel.integration.ingest', 'fuel.integration.retry',
            ],
            'is_system' => false,
        ]);
        $branchUser = User::create(['tenant_id' => $tenantId, 'name' => 'مقيَّد بفرع', 'email' => 'branch-md@fuel.test', 'password' => 'password123', 'role' => $role->slug]);
        $branchUser->branches()->attach($branchA->id);
        $warehouseUser = User::create(['tenant_id' => $tenantId, 'name' => 'مقيَّد بمخزن', 'email' => 'warehouse-md@fuel.test', 'password' => 'password123', 'role' => $role->slug]);
        $warehouseUser->warehouses()->attach($warehouseA->id);

        return [
            'owner_token' => $auth['token'],
            'branch_user_token' => $branchUser->createToken('api')->plainTextToken,
            'warehouse_user_token' => $warehouseUser->createToken('api')->plainTextToken,
            'fuel' => $fuel, 'a' => $a, 'a2' => $a2, 'b' => $b,
        ];
    }
}

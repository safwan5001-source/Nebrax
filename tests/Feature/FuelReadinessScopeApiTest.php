<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FinancialControlAlert;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelStationSafetyInspection;
use App\Models\FuelStationWorkOrder;
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
 * FS-05 (PR-2c): نطاق الفرع/المخزن لسطح الجاهزية (صيانة، سلامة، تنبيهات، لوحة، تقارير).
 */
class FuelReadinessScopeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function a_branch_restricted_user_cannot_create_readiness_records_for_another_branch_station(): void
    {
        $f = $this->fixture();
        $token = $f['branch_user_token'];
        $b = $f['b'];

        $this->withToken($token)->postJson(self::BASE . '/maintenance/schedules', [
            'fuel_station_id' => $b['station']->id, 'asset_type' => FuelTank::class, 'asset_id' => $b['tank']->id,
            'name' => 'جدول اختراق', 'schedule_type' => 'calendar', 'interval_days' => 30,
        ])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/maintenance/work-orders', [
            'fuel_station_id' => $b['station']->id, 'asset_type' => FuelTank::class, 'asset_id' => $b['tank']->id,
            'work_type' => 'corrective', 'title' => 'أمر اختراق',
        ])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/safety/inspections', ['fuel_station_id' => $b['station']->id, 'inspection_type' => 'weekly'])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/safety/permits', ['fuel_station_id' => $b['station']->id, 'permit_type' => 'civil_defense', 'reference' => 'HACK-1'])->assertNotFound();
        $this->assertSame(0, FuelStationWorkOrder::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, FuelStationSafetyInspection::query()->withoutGlobalScopes()->count());

        // وفي محطة نطاقه يعمل.
        $this->withToken($token)->postJson(self::BASE . '/maintenance/work-orders', [
            'fuel_station_id' => $f['a']['station']->id, 'asset_type' => FuelTank::class, 'asset_id' => $f['a']['tank']->id,
            'work_type' => 'corrective', 'title' => 'أمر مشروع',
        ])->assertCreated();
        $this->withToken($token)->postJson(self::BASE . '/safety/inspections', ['fuel_station_id' => $f['a']['station']->id, 'inspection_type' => 'weekly'])->assertCreated();
    }

    /** @test */
    public function a_warehouse_restricted_user_cannot_see_or_transition_records_of_a_station_in_another_warehouse(): void
    {
        $f = $this->fixture();
        $owner = $f['owner_token'];
        $token = $f['warehouse_user_token'];
        $a2 = $f['a2'];

        $order = $this->withToken($owner)->postJson(self::BASE . '/maintenance/work-orders', [
            'fuel_station_id' => $a2['station']->id, 'asset_type' => FuelTank::class, 'asset_id' => $a2['tank']->id,
            'work_type' => 'corrective', 'title' => 'أمر محطة أ2',
        ])->assertCreated()->json('data');
        $inspection = $this->withToken($owner)->postJson(self::BASE . '/safety/inspections', ['fuel_station_id' => $a2['station']->id, 'inspection_type' => 'weekly'])->assertCreated()->json('data');
        $this->withToken($owner)->postJson(self::BASE . '/safety/permits', ['fuel_station_id' => $a2['station']->id, 'permit_type' => 'civil_defense', 'reference' => 'A2-1'])->assertCreated();

        // قوائم: المقيَّد لا يرى سجلات أ2، والمالك يراها.
        $this->assertCount(0, $this->withToken($token)->getJson(self::BASE . '/maintenance')->assertOk()->json('data.work_orders.data'));
        $this->assertCount(1, $this->withToken($owner)->getJson(self::BASE . '/maintenance')->assertOk()->json('data.work_orders.data'));
        $this->assertCount(0, $this->withToken($token)->getJson(self::BASE . '/safety')->assertOk()->json('data.inspections.data'));
        $this->assertCount(0, $this->withToken($token)->getJson(self::BASE . '/safety')->assertOk()->json('data.permits.data'));

        // تحويلات بمعرّف = 404.
        $this->withToken($token)->postJson(self::BASE . '/maintenance/work-orders/' . $order['id'] . '/transition', ['status' => 'triaged'])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/safety/inspections/' . $inspection['id'] . '/perform', [
            'findings' => [['checklist_key' => 'k', 'result' => 'pass', 'title' => 't']],
        ])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/safety/inspections/' . $inspection['id'] . '/verify')->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/safety/inspections/' . $inspection['id'] . '/close')->assertNotFound();

        // لوحة وتقارير تُقصر على المحطات المتاحة.
        $this->assertSame(0, $this->withToken($token)->getJson(self::BASE . '/dashboard')->assertOk()->json('data.open_work_orders'));
        $this->assertSame(1, $this->withToken($owner)->getJson(self::BASE . '/dashboard')->assertOk()->json('data.open_work_orders'));
        $this->assertSame([], $this->withToken($token)->getJson(self::BASE . '/reports/maintenance')->assertOk()->json('data.rows'));
        $this->assertNotSame([], $this->withToken($owner)->getJson(self::BASE . '/reports/maintenance')->assertOk()->json('data.rows'));
        $this->assertSame([], $this->withToken($token)->getJson(self::BASE . '/reports/devices')->assertOk()->json('data.rows'));
        // محطة مباشرة خارج النطاق = 404.
        $this->withToken($token)->getJson(self::BASE . '/reports/sales?station_id=' . $a2['station']->id)->assertNotFound();
        $this->withToken($token)->getJson(self::BASE . '/dashboard?station_id=' . $a2['station']->id)->assertNotFound();
    }

    /** @test */
    public function fuel_alerts_are_limited_to_the_users_allowed_branches(): void
    {
        $f = $this->fixture();
        $token = $f['branch_user_token'];
        $alertA = $this->alert($f['branch_a']->id, 'fp-a');
        $alertB = $this->alert($f['branch_b']->id, 'fp-b');

        $ids = collect($this->withToken($token)->getJson(self::BASE . '/alerts')->assertOk()->json('data.data'))->pluck('id')->all();
        $this->assertSame([$alertA->id], $ids);
        $this->assertCount(2, $this->withToken($f['owner_token'])->getJson(self::BASE . '/alerts')->assertOk()->json('data.data'));
        $this->withToken($token)->postJson(self::BASE . '/alerts/' . $alertB->id . '/acknowledge', ['note' => 'اختراق'])->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . '/alerts/' . $alertB->id . '/assign', ['assigned_to' => null])->assertNotFound();
        $this->assertSame('active', FinancialControlAlert::findOrFail($alertB->id)->status);
    }

    private function alert(string $branchId, string $fingerprint): FinancialControlAlert
    {
        return FinancialControlAlert::create([
            'branch_id' => $branchId, 'fingerprint' => $fingerprint, 'rule' => 'fuel.test_rule', 'severity' => 'high', 'status' => 'active',
            'title' => 'تنبيه وقود', 'description' => 'تنبيه لاختبار النطاق.', 'details' => [],
            'first_detected_at' => now(), 'last_detected_at' => now(),
        ]);
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-rd-scope', 'owner@fuel-rd-scope.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        $grants = app(EntitlementGrantService::class);
        foreach (['fuel_stations.core', 'fuel_stations.maintenance'] as $app) {
            $grants->grant($tenant, $app, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs05_rd_scope', reason: 'اختبار نطاق الجاهزية.');
        }

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-A2', 'branch_id' => $branchA->id]);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود جاهزية mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-RD', 'name' => 'وقود جاهزية']);

        $tree = function (Branch $branch, Warehouse $warehouse, string $code) use ($fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة FS-' . $code]);
            $tank = FuelTank::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000,
            ]);

            return compact('station', 'tank');
        };
        $a = $tree($branchA, $warehouseA, 'A');
        $a2 = $tree($branchA, $warehouseA2, 'A2');
        $b = $tree($branchB, $warehouseB, 'B');

        $role = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-rd-manager', 'name' => 'مدير جاهزية مقيَّد',
            'permissions' => [
                'fuel_stations.view', 'fuel.maintenance.view', 'fuel.maintenance.manage', 'fuel.maintenance.transition',
                'fuel.safety.view', 'fuel.safety.manage', 'fuel.safety.inspect', 'fuel.safety.verify',
                'fuel.alerts.view', 'fuel.alerts.manage', 'fuel.reports.view',
            ],
            'is_system' => false,
        ]);
        $branchUser = User::create(['tenant_id' => $tenantId, 'name' => 'مقيَّد بفرع', 'email' => 'branch-rd@fuel.test', 'password' => 'password123', 'role' => $role->slug]);
        $branchUser->branches()->attach($branchA->id);
        $warehouseUser = User::create(['tenant_id' => $tenantId, 'name' => 'مقيَّد بمخزن', 'email' => 'warehouse-rd@fuel.test', 'password' => 'password123', 'role' => $role->slug]);
        $warehouseUser->warehouses()->attach($warehouseA->id);

        return [
            'owner_token' => $auth['token'],
            'branch_user_token' => $branchUser->createToken('api')->plainTextToken,
            'warehouse_user_token' => $warehouseUser->createToken('api')->plainTextToken,
            'branch_a' => $branchA, 'branch_b' => $branchB, 'a' => $a, 'a2' => $a2, 'b' => $b,
        ];
    }
}

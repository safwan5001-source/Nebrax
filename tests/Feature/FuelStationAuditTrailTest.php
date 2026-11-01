<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelStationAuditEvent;
use App\Models\FuelTank;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationAuditTrail;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use Tests\TestCase;

/**
 * FS-22 (PR-12c): سجل تدقيق بالفاعل للبيانات الرئيسية والأجهزة — append-only، بلا أسرار، معزول بالمستأجر والنطاق.
 */
class FuelStationAuditTrailTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function master_data_and_device_changes_are_recorded_with_the_acting_user(): void
    {
        $f = $this->fixture();
        $o = $f['owner'];
        $token = $f['owner_token'];

        $stationId = $this->withToken($token)->postJson(self::BASE . '/stations', ['branch_id' => $f['branch']->id, 'code' => 'FS-AUD', 'name' => 'محطة التدقيق'])->assertCreated()->json('data.id');
        $tankId = $this->withToken($token)->postJson(self::BASE . '/tanks', [
            'fuel_station_id' => $stationId, 'fuel_product_id' => $f['fuel']->id, 'code' => 'T-AUD', 'name' => 'خزان', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000,
            'calibration_points' => [['level_millimeters' => 100, 'volume_milliliters' => 5000], ['level_millimeters' => 200, 'volume_milliliters' => 12000]],
        ])->assertCreated()->json('data.id');
        $pumpId = $this->withToken($token)->postJson(self::BASE . '/pumps', ['fuel_station_id' => $stationId, 'pump_number' => 'P-AUD', 'name' => 'مضخة'])->assertCreated()->json('data.id');
        $nozzleId = $this->withToken($token)->postJson(self::BASE . '/nozzles', [
            'fuel_pump_id' => $pumpId, 'fuel_tank_id' => $tankId, 'fuel_product_id' => $f['fuel']->id, 'nozzle_number' => 'N-AUD',
        ])->assertCreated()->json('data.id');
        $deviceId = $this->withToken($token)->postJson(self::BASE . '/devices', [
            'fuel_station_id' => $stationId, 'device_key' => 'dev-aud', 'name' => 'جهاز', 'device_type' => 'atg', 'adapter_key' => 'fake.atg',
        ])->assertCreated()->json('data.id');

        $events = FuelStationAuditEvent::query()->where('fuel_station_id', $stationId)->get()->keyBy('action');
        foreach (['station.created', 'tank.created', 'pump.created', 'nozzle.created', 'device.created'] as $action) {
            $this->assertTrue($events->has($action), $action);
            $this->assertSame($o->id, $events[$action]->actor_id, $action);
            $this->assertSame($f['tenant_id'], $events[$action]->tenant_id);
        }
        $this->assertSame($stationId, $events['station.created']->subject_id);
        $this->assertSame($tankId, $events['tank.created']->subject_id);
        $this->assertCount(2, $events['tank.created']->after['calibration_points']);

        // تعديل: الحقول المتغيّرة فقط.
        $this->withToken($token)->putJson(self::BASE . '/tanks/' . $tankId, ['capacity_milliliters' => 210000, 'safe_capacity_milliliters' => 200000])->assertOk();
        $updated = FuelStationAuditEvent::query()->where('action', 'tank.updated')->sole();
        $this->assertSame(['capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000], $updated->before);
        $this->assertSame(['capacity_milliliters' => 210000, 'safe_capacity_milliliters' => 200000], $updated->after);

        // ربط الفوهة بتعديل خزانها: يظهر في السجل.
        $this->withToken($token)->putJson(self::BASE . '/devices/' . $deviceId, ['name' => 'جهاز معدّل'])->assertOk();
        $this->assertSame(['name' => 'جهاز'], FuelStationAuditEvent::query()->where('action', 'device.updated')->sole()->before);

        // حذف: اللقطة الكاملة قبل الحذف.
        $this->withToken($token)->deleteJson(self::BASE . '/nozzles/' . $nozzleId)->assertSuccessful();
        $deleted = FuelStationAuditEvent::query()->where('action', 'nozzle.deleted')->sole();
        $this->assertSame('N-AUD', $deleted->before['nozzle_number']);
        $this->assertNull($deleted->after);
        $this->withToken($token)->deleteJson(self::BASE . '/devices/' . $deviceId)->assertSuccessful();
        $this->assertSame($o->id, FuelStationAuditEvent::query()->where('action', 'device.deleted')->sole()->actor_id);
    }

    /** @test */
    public function an_update_that_changes_nothing_or_fails_records_no_event(): void
    {
        $f = $this->fixture();
        $token = $f['owner_token'];
        $stationId = $this->withToken($token)->postJson(self::BASE . '/stations', ['branch_id' => $f['branch']->id, 'code' => 'FS-NOOP', 'name' => 'محطة'])->assertCreated()->json('data.id');
        $count = FuelStationAuditEvent::count();

        $this->withToken($token)->putJson(self::BASE . '/stations/' . $stationId, ['branch_id' => $f['branch']->id, 'code' => 'FS-NOOP', 'name' => 'محطة'])->assertOk(); // لا تغيير (حمولة كاملة: PUT الجزئي للمحطة FS-43 خارج الشريحة)
        $this->assertSame($count, FuelStationAuditEvent::count());

        $this->withToken($token)->postJson(self::BASE . '/stations', ['branch_id' => $f['branch']->id, 'code' => 'FS-NOOP', 'name' => 'مكرر'])->assertStatus(422); // رمز مكرر
        $this->assertSame($count, FuelStationAuditEvent::count());
    }

    /** @test */
    public function secrets_and_credentials_never_reach_the_trail(): void
    {
        $f = $this->fixture();
        $token = $f['owner_token'];
        $stationId = $this->withToken($token)->postJson(self::BASE . '/stations', ['branch_id' => $f['branch']->id, 'code' => 'FS-SEC', 'name' => 'محطة'])->assertCreated()->json('data.id');
        $deviceId = $this->withToken($token)->postJson(self::BASE . '/devices', [
            'fuel_station_id' => $stationId, 'device_key' => 'dev-sec', 'name' => 'جهاز', 'device_type' => 'atg', 'adapter_key' => 'fake.atg', 'credential_reference' => 'vault:secret/path-one',
        ])->assertCreated()->json('data.id');
        $this->withToken($token)->putJson(self::BASE . '/devices/' . $deviceId, ['credential_reference' => 'vault:secret/path-two'])->assertOk();

        $all = json_encode(FuelStationAuditEvent::query()->get(['before', 'after'])->toArray());
        $this->assertStringNotContainsString('path-one', $all);
        $this->assertStringNotContainsString('path-two', $all);
        $updated = FuelStationAuditEvent::query()->where('action', 'device.updated')->sole();
        $this->assertSame(['credential_reference' => FuelStationAuditTrail::REDACTED], $updated->before);
        $this->assertSame(['credential_reference' => FuelStationAuditTrail::REDACTED], $updated->after);

        // أي مفتاح يشبه سراً يُحجب بأي عمق.
        $device = \App\Models\FuelStationDevice::findOrFail($deviceId);
        app(FuelStationAuditTrail::class)->record('device.updated', $device, ['endpoint_metadata' => ['host' => 'a', 'api_key' => 'x']], ['endpoint_metadata' => ['host' => 'b', 'api_key' => 'y']], $f['owner']);
        $last = FuelStationAuditEvent::query()->latest('occurred_at')->latest('id')->get()->firstWhere(fn ($e) => isset($e->after['endpoint_metadata']));
        $this->assertSame(FuelStationAuditTrail::REDACTED, $last->after['endpoint_metadata']['api_key']);
        $this->assertSame('b', $last->after['endpoint_metadata']['host']);
    }

    /** @test */
    public function the_trail_is_append_only_in_the_model_and_in_the_database(): void
    {
        $f = $this->fixture();
        $this->withToken($f['owner_token'])->postJson(self::BASE . '/stations', ['branch_id' => $f['branch']->id, 'code' => 'FS-IMM', 'name' => 'محطة'])->assertCreated();
        $event = FuelStationAuditEvent::query()->firstOrFail();

        $this->expectModelException(fn () => $event->update(['reason' => 'tamper']), LogicException::class);
        $this->expectModelException(fn () => $event->delete(), LogicException::class);
        $this->expectModelException(fn () => DB::table('fuel_station_audit_events')->where('id', $event->id)->update(['action' => 'x']), QueryException::class);
        $this->expectModelException(fn () => DB::table('fuel_station_audit_events')->where('id', $event->id)->delete(), QueryException::class);
        $this->assertSame(1, DB::table('fuel_station_audit_events')->count());
    }

    /** @test */
    public function deleting_the_tenant_cascades_its_events_without_tripping_the_guard(): void
    {
        $f = $this->fixture();
        $this->withToken($f['owner_token'])->postJson(self::BASE . '/stations', ['branch_id' => $f['branch']->id, 'code' => 'FS-CAS', 'name' => 'محطة'])->assertCreated();
        $this->assertSame(1, DB::table('fuel_station_audit_events')->where('tenant_id', $f['tenant_id'])->count());

        DB::table('tenants')->where('id', $f['tenant_id'])->delete();

        $this->assertSame(0, DB::table('fuel_station_audit_events')->where('tenant_id', $f['tenant_id'])->count());
    }

    /** @test */
    public function events_never_leak_between_tenants(): void
    {
        $a = $this->fixture();
        $this->withToken($a['owner_token'])->postJson(self::BASE . '/stations', ['branch_id' => $a['branch']->id, 'code' => 'FS-TA', 'name' => 'محطة أ'])->assertCreated();

        $b = $this->fixture('b');
        $this->withToken($b['owner_token'])->postJson(self::BASE . '/stations', ['branch_id' => $b['branch']->id, 'code' => 'FS-TB', 'name' => 'محطة ب'])->assertCreated();

        $listB = $this->withToken($b['owner_token'])->getJson(self::BASE . '/audit-events')->assertOk()->json('data');
        $this->assertCount(1, $listB);
        $this->assertSame('station.created', $listB[0]['action']);
        $this->assertSame($b['owner']->id, $listB[0]['actor_id']);
        $this->assertStringNotContainsString('FS-TA', json_encode($listB));

        app(TenantContext::class)->set($a['tenant_id']);
        $this->assertSame(1, FuelStationAuditEvent::query()->withoutGlobalScope(\App\Tenancy\BranchScope::class)->count());
    }

    /** @test */
    public function reading_requires_manage_permission_and_respects_station_scope(): void
    {
        $f = $this->fixture();
        $token = $f['owner_token'];
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $own = $this->withToken($token)->postJson(self::BASE . '/stations', ['branch_id' => $f['branch']->id, 'code' => 'FS-OWN', 'name' => 'محطتي'])->assertCreated()->json('data.id');
        $other = $this->withToken($token)->postJson(self::BASE . '/stations', ['branch_id' => $branchB->id, 'code' => 'FS-OTH', 'name' => 'أخرى'])->assertCreated()->json('data.id');

        $viewerRole = Role::create(['tenant_id' => $f['tenant_id'], 'slug' => 'fuel-audit-viewer', 'name' => 'بلا إدارة', 'permissions' => ['fuel_stations.view'], 'is_system' => false]);
        $viewer = User::create(['tenant_id' => $f['tenant_id'], 'name' => 'عارض', 'email' => 'viewer@fuel-audit.test', 'password' => 'password123', 'role' => $viewerRole->slug]);
        $this->withToken($viewer->createToken('api')->plainTextToken)->getJson(self::BASE . '/audit-events')->assertForbidden();

        $managerRole = Role::create(['tenant_id' => $f['tenant_id'], 'slug' => 'fuel-audit-manager', 'name' => 'مدير فرع', 'permissions' => ['fuel_stations.view', 'fuel_stations.manage'], 'is_system' => false]);
        $manager = User::create(['tenant_id' => $f['tenant_id'], 'name' => 'مدير', 'email' => 'manager@fuel-audit.test', 'password' => 'password123', 'role' => $managerRole->slug]);
        $manager->branches()->attach($f['branch']->id);
        $managerToken = $manager->createToken('api')->plainTextToken;

        $seen = collect($this->withToken($managerToken)->getJson(self::BASE . '/audit-events')->assertOk()->json('data'))->pluck('fuel_station_id')->unique()->values()->all();
        $this->assertSame([$own], $seen);
        $this->withToken($managerToken)->getJson(self::BASE . '/audit-events?fuel_station_id=' . $other)->assertNotFound();

        // المالك: الفرع النشط يحكم (BranchScoped كأحداث الجاهزية) — الفرع الآخر عبر X-Branch-Id.
        $this->assertCount(1, $this->withToken($token)->withHeader('X-Branch-Id', $branchB->id)->getJson(self::BASE . '/audit-events?fuel_station_id=' . $other)->assertOk()->json('data'));
        $this->assertCount(1, $this->withToken($token)->getJson(self::BASE . '/audit-events?action=station.created')->assertOk()->json('data'));
        $this->withToken($token)->getJson(self::BASE . '/audit-events?subject_type=Hack')->assertStatus(422);
    }

    private function expectModelException(callable $operation, string $class): void
    {
        try {
            $operation();
        } catch (\Throwable $e) {
            $this->assertInstanceOf($class, $e);

            return;
        }
        $this->fail('كان يجب أن تُرفض العملية.');
    }

    /** @return array<string,mixed> */
    private function fixture(string $suffix = 'a'): array
    {
        $auth = $this->registerTenant('fuel-audit-' . $suffix, "owner@fuel-audit-{$suffix}.test", autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        $grants = app(EntitlementGrantService::class);
        foreach (['fuel_stations.core', 'fuel_stations.integrations'] as $app) {
            $grants->grant($tenant, $app, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs22', reason: 'اختبار سجل التدقيق.');
        }
        $branch = Branch::where('tenant_id', $tenantId)->where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('tenant_id', $tenantId)->where('is_default', true)->firstOrFail();
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود تدقيق mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-AUD-' . $suffix, 'name' => 'وقود تدقيق']);
        $owner = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();

        return ['tenant_id' => $tenantId, 'owner_token' => $auth['token'], 'owner' => $owner, 'branch' => $branch, 'warehouse' => $warehouse, 'fuel' => $fuel];
    }
}

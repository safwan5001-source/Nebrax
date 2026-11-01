<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelStation;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FS-09: سياسات AVI المحفوظة من شاشة الإعدادات كانت تُسقطها قواعد الطلب بصمت.
 * FS-10: قوائم المركبات/السائقين كانت ملفوفة {data: paginator} فيقرأ العميل data = كائناً لا مصفوفة.
 */
class FuelAviSettingsAndFleetApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    private const AVI_VALUES = [
        'avi_rfid_enabled' => true,
        'avi_driver_identity_required' => true,
        'avi_enforce_vehicle_tank_capacity' => false,
        'avi_min_refill_interval_seconds' => 1800,
        'avi_denial_window_seconds' => 600,
        'avi_repeated_denial_threshold' => 4,
        'avi_authorization_ttl_seconds' => 90,
    ];

    /** @test */
    public function tenant_avi_policy_values_are_validated_persisted_and_returned(): void
    {
        $token = $this->fixture()['token'];

        $response = $this->withToken($token)->putJson(self::BASE . '/settings', self::AVI_VALUES + ['reason' => 'سياسة AVI'])->assertOk();
        foreach (self::AVI_VALUES as $key => $value) {
            $this->assertSame($value, $response->json("data.{$key}"), $key);
        }

        // وتبقى بعد إعادة القراءة (ليست استجابة آنية فقط).
        $stored = $this->withToken($token)->getJson(self::BASE . '/settings')->assertOk();
        foreach (self::AVI_VALUES as $key => $value) {
            $this->assertSame($value, $stored->json("data.{$key}"), $key);
        }
    }

    /** @test */
    public function invalid_avi_policy_values_are_rejected(): void
    {
        $token = $this->fixture()['token'];

        $this->withToken($token)->putJson(self::BASE . '/settings', ['avi_rfid_enabled' => 'maybe'])->assertStatus(422);
        $this->withToken($token)->putJson(self::BASE . '/settings', ['avi_authorization_ttl_seconds' => 0])->assertStatus(422);
        $this->withToken($token)->putJson(self::BASE . '/settings', ['avi_denial_window_seconds' => -5])->assertStatus(422);
        $this->withToken($token)->putJson(self::BASE . '/settings', ['avi_min_refill_interval_seconds' => 'x'])->assertStatus(422);
    }

    /** @test */
    public function station_avi_overrides_are_persisted_and_null_clears_them(): void
    {
        $f = $this->fixture();
        $token = $f['token'];
        $url = self::BASE . '/stations/' . $f['station']->id . '/settings';

        $this->withToken($token)->putJson(self::BASE . '/settings', ['avi_authorization_ttl_seconds' => 120])->assertOk();
        $response = $this->withToken($token)->putJson($url, ['avi_authorization_ttl_seconds' => 45, 'avi_rfid_enabled' => true, 'reason' => 'تجاوز المحطة'])->assertOk();
        $this->assertSame(45, $response->json('data.avi_authorization_ttl_seconds'));
        $this->assertTrue($response->json('data.avi_rfid_enabled'));

        // null يزيل تجاوز المحطة فيعود لقيمة المستأجر.
        $cleared = $this->withToken($token)->putJson($url, ['avi_authorization_ttl_seconds' => null])->assertOk();
        $this->assertSame(120, $cleared->json('data.avi_authorization_ttl_seconds'));
    }

    /** @test */
    public function fleet_vehicle_and_driver_lists_expose_the_records_as_a_flat_data_array(): void
    {
        $token = $this->fixture()['token'];
        $this->withToken($token)->postJson(self::BASE . '/fleet/vehicles', ['plate_number' => 'ABC-1234', 'tank_capacity_milliliters' => 60000])->assertCreated();
        $this->withToken($token)->postJson(self::BASE . '/fleet/drivers', ['name' => 'سائق اختبار', 'identifier' => 'DRV-1'])->assertCreated();

        $vehicles = $this->withToken($token)->getJson(self::BASE . '/fleet/vehicles')->assertOk()->json('data');
        $this->assertIsList($vehicles);
        $this->assertCount(1, $vehicles);
        $this->assertSame('ABC-1234', $vehicles[0]['plate_number']);

        $drivers = $this->withToken($token)->getJson(self::BASE . '/fleet/drivers')->assertOk()->json('data');
        $this->assertIsList($drivers);
        $this->assertCount(1, $drivers);
        $this->assertSame('سائق اختبار', $drivers[0]['name']);
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-avi-api', 'owner@fuel-avi-api.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        app(EntitlementGrantService::class)->grant($tenant, 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs09_fs10', reason: 'اختبار إعدادات AVI والأسطول.');

        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-AVI', 'name' => 'محطة AVI']);

        return ['token' => $auth['token'], 'station' => $station];
    }
}

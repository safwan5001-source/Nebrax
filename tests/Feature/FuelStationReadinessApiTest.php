<?php

namespace Tests\Feature;

use App\Models\FuelStation;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FuelStationReadinessApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function readiness_routes_require_the_maintenance_capability_and_granular_permissions(): void
    {
        $fixture = $this->fixture();
        $base = '/api/fuel-stations';

        $limitedRole = Role::create([
            'tenant_id' => $fixture['tenant_id'], 'slug' => 'readiness-viewer', 'name' => 'عارض جاهزية محدود',
            'permissions' => ['fuel_stations.view'], 'is_system' => false,
        ]);
        $limited = User::create([
            'tenant_id' => $fixture['tenant_id'], 'name' => 'عارض محدود', 'email' => 'readiness-viewer@example.test',
            'password' => 'password123', 'role' => $limitedRole->slug,
        ]);
        $this->withToken($limited->createToken('api')->plainTextToken)->getJson("{$base}/maintenance")->assertForbidden();

        $this->withToken($fixture['token'])->getJson("{$base}/dashboard")->assertOk()
            ->assertJsonPath('data.data_boundary', 'finalized_sales_and_operational_evidence_only');
        $this->withToken($fixture['token'])->postJson("{$base}/maintenance/work-orders", [
            'fuel_station_id' => $fixture['station']->id, 'asset_type' => FuelStation::class, 'asset_id' => $fixture['station']->id,
            'work_type' => 'corrective', 'title' => 'أمر اختبار API',
        ])->assertCreated()->assertJsonPath('data.status', 'reported');
    }

    /** @return array{token:string,tenant_id:string,station:FuelStation} */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-readiness-api', 'owner-fuel-readiness-api@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $station = FuelStation::create(['code' => 'READY-API-01', 'name' => 'محطة API للجاهزية']);
        foreach (['fuel_stations.core', 'fuel_stations.maintenance'] as $capability) {
            app(EntitlementGrantService::class)->grant(
                $tenant, $capability, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
                CarbonImmutable::now('UTC'), grantReasonCode: 'test_cycle_9_access', reason: 'اختبار Cycle 9.'
            );
        }

        return ['token' => $auth['token'], 'tenant_id' => $tenant->id, 'station' => $station];
    }
}

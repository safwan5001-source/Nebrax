<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelStation;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FuelStationDeviceApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function device_registry_and_simulated_ingress_are_guarded_and_do_not_expose_credential_references(): void
    {
        $fixture = $this->fixture();
        $base = '/api/fuel-stations';

        $legacyRole = Role::create([
            'tenant_id' => $fixture['tenant_id'], 'slug' => 'device-viewer', 'name' => 'عارض أجهزة محدود',
            'permissions' => ['fuel_stations.view'], 'is_system' => false,
        ]);
        $legacy = User::create([
            'tenant_id' => $fixture['tenant_id'], 'name' => 'عارض محدود', 'email' => 'device-viewer@example.test',
            'password' => 'password123', 'role' => $legacyRole->slug,
        ]);
        $this->withToken($legacy->createToken('api')->plainTextToken)->getJson("{$base}/devices")->assertForbidden();

        $device = $this->withToken($fixture['token'])->postJson("{$base}/devices", [
            'fuel_station_id' => $fixture['station']->id,
            'device_key' => 'api-atg-01',
            'name' => 'ATG API',
            'device_type' => 'atg',
            'adapter_key' => 'fake.atg',
            'endpoint_metadata' => ['host' => 'simulated-gateway', 'port' => 0],
            'credential_reference' => 'vault:tests/api-atg-01',
        ])->assertCreated()
            ->assertJsonPath('data.device_key', 'api-atg-01')
            ->assertJsonMissingPath('data.credential_reference')['data'];

        $this->withToken($fixture['token'])->getJson("{$base}/devices")
            ->assertOk()->assertJsonPath('data.0.id', $device['id']);

        $event = $this->withToken($fixture['token'])->postJson("{$base}/devices/{$device['id']}/simulate-event", [
            'type' => 'reading',
            'event_id' => 'api-atg-reading-001',
            'occurred_at' => CarbonImmutable::now('UTC')->subSecond()->toIso8601String(),
            'sequence' => 1,
            'payload' => ['tank_reference' => 'tank-api', 'volume_milliliters' => 210000],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'processed')
            ->assertJsonPath('data.device.device_key', 'api-atg-01')['data'];

        $this->withToken($fixture['token'])->getJson("{$base}/integration-events?fuel_station_device_id={$device['id']}")
            ->assertOk()->assertJsonPath('data.0.id', $event['id']);
    }

    /** @return array{token:string,tenant_id:string,station:FuelStation} */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-device-api', 'owner-fuel-device-api@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $tenant->id)->sole();
        app(BranchContext::class)->set($branch->id);
        $station = FuelStation::create(['branch_id' => $branch->id, 'code' => 'DEV-API-01', 'name' => 'محطة أجهزة API']);

        foreach (['fuel_stations.core', 'fuel_stations.integrations'] as $capability) {
            app(EntitlementGrantService::class)->grant(
                $tenant, $capability, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
                CarbonImmutable::now('UTC'), grantReasonCode: 'test_cycle_8_access', reason: 'اختبار Cycle 8.'
            );
        }

        return ['token' => $auth['token'], 'tenant_id' => $tenant->id, 'station' => $station];
    }
}

<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FuelReconciliationApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function cycle_two_routes_require_commercial_access_and_fuel_stations_permission(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: true);
        $this->withToken($auth['token'])->getJson('/api/fuel-stations/readings')->assertStatus(403);
        $this->grantFoundation($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'fuel-cycle2-staff@example.test');

        $this->withToken($staff)->getJson('/api/fuel-stations/readings')->assertStatus(403);
        $this->withToken($staff)->putJson('/api/fuel-stations/settings', [
            'reconciliation_tolerance_absolute_milliliters' => 100,
        ])->assertStatus(403);
        $this->withToken($auth['token'])->getJson('/api/fuel-stations/settings')
            ->assertOk()
            ->assertJsonPath('data.reconciliation_tolerance_absolute_milliliters', 0);
    }

    /** @test */
    public function reading_resource_exposes_exact_milliliters_and_liters_after_authorized_creation(): void
    {
        $fixture = $this->fixture();
        $this->grantFoundation($fixture['tenant_id']);

        $this->withToken($fixture['token'])->postJson('/api/fuel-stations/readings', [
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'reading_type' => 'physical',
            'quantity_liters' => '10.125',
            'evidence_key' => 'api-evidence-1',
        ])->assertCreated()
            ->assertJsonPath('data.quantity_milliliters', 10125)
            ->assertJsonPath('data.quantity_liters', '10.125');
    }

    /** @test */
    public function tenant_settings_and_station_override_are_saved_through_the_audited_api(): void
    {
        $fixture = $this->fixture();
        $this->grantFoundation($fixture['tenant_id']);

        $this->withToken($fixture['token'])->putJson('/api/fuel-stations/settings', [
            'reconciliation_tolerance_absolute_milliliters' => 500,
            'reconciliation_tolerance_basis_points' => 25,
            'reason' => 'سياسة المستأجر',
        ])->assertOk()
            ->assertJsonPath('data.reconciliation_tolerance_absolute_milliliters', 500);
        $this->withToken($fixture['token'])->putJson('/api/fuel-stations/stations/' . $fixture['station']->id . '/settings', [
            'reconciliation_tolerance_absolute_milliliters' => 125,
            'reason' => 'سياسة المحطة',
        ])->assertOk()
            ->assertJsonPath('data.reconciliation_tolerance_absolute_milliliters', 125)
            ->assertJsonPath('data.reconciliation_tolerance_basis_points', 25);
    }

    /** @test */
    public function one_tenant_cannot_read_another_tenant_fuel_evidence(): void
    {
        $a = $this->fixture();
        $this->grantFoundation($a['tenant_id']);
        $this->withToken($a['token'])->postJson('/api/fuel-stations/readings', [
            'fuel_station_id' => $a['station']->id,
            'fuel_tank_id' => $a['tank']->id,
            'reading_type' => 'atg',
            'quantity_liters' => '10',
            'evidence_key' => 'tenant-a-atg-1',
        ])->assertCreated();

        $b = $this->registerTenant('globex', 'owner@globex-cycle2.test', autoEnableApplications: true);
        $this->grantFoundation($b['tenant_id']);
        $this->withToken($b['token'])->getJson('/api/fuel-stations/readings')
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    /** @return array{tenant_id: string, token: string, station: FuelStation, tank: FuelTank} */
    private function fixture(): array
    {
        $auth = $this->registerTenant(autoEnableApplications: true);
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود API mL',
            'type' => 'good',
            'unit' => 'mL',
            'sale_price' => 1000,
            'purchase_price' => 10,
            'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $station = FuelStation::create([
            'branch_id' => $branch->id,
            'warehouse_id' => $warehouse->id,
            'code' => 'FS-API',
            'name' => 'محطة API',
        ]);
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'API-ML', 'name' => 'وقود API']);
        $tank = FuelTank::create([
            'branch_id' => $branch->id,
            'fuel_station_id' => $station->id,
            'fuel_product_id' => $fuel->id,
            'code' => 'T-API',
            'name' => 'خزان API',
            'capacity_milliliters' => 200000,
            'safe_capacity_milliliters' => 190000,
        ]);

        return ['tenant_id' => $auth['tenant_id'], 'token' => $auth['token'], 'station' => $station, 'tank' => $tank];
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
            grantReasonCode: 'test_cycle_2_access',
            reason: 'اختبار Cycle 2.',
        );
    }
}

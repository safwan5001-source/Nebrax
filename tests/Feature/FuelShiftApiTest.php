<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Support\Rbac;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FuelShiftApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function shift_api_enforces_rbac_and_runs_operational_lifecycle_without_commercial_or_accounting_documents(): void
    {
        $fixture = $this->fixture();
        $base = '/api/fuel-stations/shifts';
        $this->withToken($fixture['token'])->getJson($base)->assertOk();

        $legacyViewRole = Role::create([
            'tenant_id' => $fixture['tenant_id'], 'slug' => 'legacy-fuel-viewer', 'name' => 'عارض قديم',
            'permissions' => ['fuel_stations.view'], 'is_system' => false,
        ]);
        $legacyViewer = User::create([
            'tenant_id' => $fixture['tenant_id'], 'name' => 'عارض قديم', 'email' => 'legacy-fuel-viewer@example.test',
            'password' => 'password123', 'role' => $legacyViewRole->slug,
        ]);
        $this->withToken($legacyViewer->createToken('api')->plainTextToken)->getJson($base)->assertForbidden();
        $viewRole = Role::create([
            'tenant_id' => $fixture['tenant_id'], 'slug' => 'fuel-shift-viewer', 'name' => 'عارض شفت',
            'permissions' => ['fuel.shift.view'], 'is_system' => false,
        ]);
        $viewer = User::create([
            'tenant_id' => $fixture['tenant_id'], 'name' => 'عارض شفت', 'email' => 'fuel-viewer@example.test',
            'password' => 'password123', 'role' => $viewRole->slug,
        ]);
        $viewerToken = $viewer->createToken('api')->plainTextToken;
        $this->assertTrue(Rbac::allows($viewRole->slug, 'fuel.shift.view'));
        $this->withToken($viewerToken)->getJson($base)->assertOk();
        $this->withToken($viewerToken)->postJson($base . '/open', [
            'fuel_station_id' => $fixture['station']->id, 'opening_float_minor' => 1000, 'idempotency_key' => 'viewer-forbidden',
        ])->assertForbidden();

        $opened = $this->withToken($fixture['token'])->postJson($base . '/open', [
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 1000,
            'active_terminal_keys' => ['pump-console-01'],
            'idempotency_key' => 'api-open-1',
        ])->assertCreated()->assertJsonPath('data.status', 'open')->assertJsonPath('data.station_id', $fixture['station']->id)['data'];
        $shiftId = $opened['id'];
        $this->withToken($fixture['token'])->postJson("{$base}/{$shiftId}/staff", [
            'user_id' => $fixture['actor']->id, 'role' => 'attendant',
        ])->assertCreated()->assertJsonCount(1, 'data.staff_assignments');
        $this->withToken($fixture['token'])->postJson("{$base}/{$shiftId}/meter-readings", [
            'fuel_nozzle_id' => $fixture['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 100000,
            'evidence_key' => 'api-meter-opening',
        ])->assertCreated()->assertJsonPath('data.meter_readings.0.reading_stage', 'opening');
        $this->withToken($fixture['token'])->postJson("{$base}/{$shiftId}/meter-readings", [
            'fuel_nozzle_id' => $fixture['nozzle']->id, 'reading_stage' => 'closing', 'meter_milliliters' => 105000,
            'evidence_key' => 'api-meter-closing',
        ])->assertCreated();
        $this->withToken($fixture['token'])->postJson("{$base}/{$shiftId}/cash-movements", [
            'type' => 'cash_in', 'amount_minor' => 200, 'reason' => 'فكة تشغيلية', 'idempotency_key' => 'api-cash-in',
        ])->assertCreated()->assertJsonPath('data.cash_movements.0.type', 'cash_in');
        $this->withToken($fixture['token'])->postJson("{$base}/{$shiftId}/close", [
            'counted_cash_minor' => 1100, 'closing_note' => 'عد نقدي تشغيلي',
        ])->assertOk()->assertJsonPath('data.status', 'closed')->assertJsonPath('data.operational_liters', '5')
            ->assertJsonPath('data.cash_variance.status', 'pending_review');
        $this->withToken($fixture['token'])->postJson("{$base}/{$shiftId}/cash-variance/review", [
            'note' => 'تمت مراجعة فرق النقد التشغيلي دون تسوية تلقائية.',
        ])->assertOk()->assertJsonPath('data.cash_variance.status', 'pending_review')
            ->assertJsonPath('data.cash_variance.reviewed_by', $fixture['actor']->id);
        $this->withToken($fixture['token'])->postJson("{$base}/{$shiftId}/approve", [
            'note' => 'اعتماد بلا فرق نقد',
        ])->assertOk()->assertJsonPath('data.status', 'approved');
        $this->withToken($fixture['token'])->getJson("{$base}/{$shiftId}")
            ->assertOk()->assertJsonPath('data.status', 'approved')->assertJsonCount(2, 'data.meter_readings');

        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, StockMovement::count());
        $this->withToken($fixture['token'])->putJson('/api/fuel-stations/settings', [
            'shift_mandatory_staff_assignment' => true,
            'shift_tank_tolerance_milliliters' => 25,
            'reason' => 'سياسة شفت API مدققة',
        ])->assertOk()->assertJsonPath('data.shift_mandatory_staff_assignment', true)->assertJsonPath('data.shift_tank_tolerance_milliliters', 25);
    }

    /** @return array{token:string,tenant_id:string,actor:User,station:FuelStation,nozzle:FuelNozzle} */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-shift-api', 'owner-fuel-shift-api@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($auth['tenant_id']),
            'fuel_stations.core',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'),
            grantReasonCode: 'test_cycle_4_access',
            reason: 'اختبار Cycle 4.',
        );
        $product = Product::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'sku' => 'FUEL-API-P', 'name' => 'منتج وقود API',
            'unit' => 'mL', 'track_inventory' => true,
        ]);
        $fuelProduct = FuelProduct::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'code' => 'FUEL-API', 'name' => 'بنزين API',
        ]);
        $station = FuelStation::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'code' => 'ST-API', 'name' => 'محطة API',
        ]);
        $tank = FuelTank::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => 'TN-API', 'name' => 'خزان API', 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = FuelPump::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'P-API',
        ]);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => 'N-API',
        ]);
        app(FuelStationSettingsService::class)->putStationValues($station, [
            'shift_opening_meter_reading_required' => false,
            'shift_closing_meter_reading_required' => false,
            'shift_opening_tank_reading_required' => false,
            'shift_closing_tank_reading_required' => false,
            'shift_mandatory_staff_assignment' => false,
            'shift_supervisor_approval_required' => false,
        ], $actor, 'تهيئة اختبار API');

        return compact('actor', 'station', 'nozzle') + $auth;
    }
}

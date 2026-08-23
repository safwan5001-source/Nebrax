<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FuelSupplyReceivingApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function cycle_three_routes_require_commercial_access_and_fuel_stations_permission(): void
    {
        $auth = $this->registerTenant(autoEnableApplications: true);
        $this->withToken($auth['token'])->getJson('/api/fuel-stations/deliveries')->assertStatus(403);
        $this->grantFoundation($auth['tenant_id']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'fuel-cycle3-staff@example.test');

        $this->withToken($staff)->getJson('/api/fuel-stations/deliveries')->assertStatus(403);
        $this->withToken($staff)->postJson('/api/fuel-stations/deliveries', [])->assertStatus(403);
    }

    /** @test */
    public function authorized_api_creates_and_approves_fuel_delivery_with_explicit_grni_resource_links(): void
    {
        $fixture = $this->fixture();
        $this->grantFoundation($fixture['tenant_id']);
        $this->withToken($fixture['token'])->putJson('/api/fuel-stations/settings', [
            'grni_account_id' => $fixture['grni']->id,
            'reason' => 'تعيين GRNI لاختبار Cycle 3',
        ])->assertOk()->assertJsonPath('data.grni_account_id', $fixture['grni']->id);

        $delivery = $this->withToken($fixture['token'])->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($fixture, 'api-delivery-1'))
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.received_milliliters', 10000)
            ->assertJsonPath('data.received_liters', '10')
            ->json('data');

        $this->withToken($fixture['token'])->postJson('/api/fuel-stations/deliveries/' . $delivery['id'] . '/approve')
            ->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.warehouse_id', $fixture['warehouse']->id)
            ->assertJsonPath('data.received_total_cost_minor', 2345);
    }

    /** @test */
    public function supplier_invoice_api_matches_an_approved_delivery_without_a_second_inventory_receipt(): void
    {
        $fixture = $this->fixture();
        $this->grantFoundation($fixture['tenant_id']);
        $this->withToken($fixture['token'])->putJson('/api/fuel-stations/settings', ['grni_account_id' => $fixture['grni']->id])->assertOk();
        $delivery = $this->withToken($fixture['token'])->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($fixture, 'api-match-delivery'))
            ->assertCreated()->json('data');
        $this->withToken($fixture['token'])->postJson('/api/fuel-stations/deliveries/' . $delivery['id'] . '/approve')->assertOk();

        $invoice = $this->withToken($fixture['token'])->postJson('/api/fuel-stations/supplier-invoices', [
            'supplier_id' => $fixture['supplier']->id,
            'invoice_number' => 'API-SUP-1',
            'invoice_date' => '2026-08-23',
            'currency' => 'SAR',
            'lines' => [[
                'fuel_product_id' => $fixture['fuel']->id,
                'quantity_liters' => '10.000',
                'value_minor' => 2345,
            ]],
        ])->assertOk()->assertJsonPath('data.status', 'unmatched')->json('data');

        $this->withToken($fixture['token'])->postJson('/api/fuel-stations/supplier-invoices/' . $invoice['id'] . '/matches', [
            'fuel_supplier_invoice_line_id' => $invoice['lines'][0]['id'],
            'fuel_delivery_id' => $delivery['id'],
            'quantity_liters' => '10.000',
            'idempotency_key' => 'api-match-1',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'matched')
            ->assertJsonPath('data.cleared_value_minor', 2345);
    }

    /** @test */
    public function one_tenant_cannot_read_another_tenant_fuel_deliveries(): void
    {
        $a = $this->fixture();
        $this->grantFoundation($a['tenant_id']);
        $this->withToken($a['token'])->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($a, 'tenant-a-delivery'))->assertCreated();

        $b = $this->registerTenant('globex-c3', 'owner@globex-cycle3.test', autoEnableApplications: true);
        $this->grantFoundation($b['tenant_id']);
        $this->withToken($b['token'])->getJson('/api/fuel-stations/deliveries')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @return array{tenant_id:string,token:string,station:FuelStation,tank:FuelTank,fuel:FuelProduct,warehouse:Warehouse,supplier:Partner,grni:Account} */
    private function fixture(): array
    {
        $auth = $this->registerTenant(autoEnableApplications: true);
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouse = Warehouse::where('is_default', true)->firstOrFail();
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود API Cycle 3 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-C3-API', 'name' => 'محطة API Cycle 3']);
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-C3-API', 'name' => 'وقود API Cycle 3']);
        $tank = FuelTank::create(['branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'code' => 'T-C3-API', 'name' => 'خزان API Cycle 3', 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000]);
        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد API Cycle 3', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI API Cycle 3', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);

        return compact('station', 'tank', 'fuel', 'warehouse', 'supplier', 'grni') + ['tenant_id' => $auth['tenant_id'], 'token' => $auth['token']];
    }

    /** @param array<string,mixed> $fixture @return array<string,mixed> */
    private function deliveryPayload(array $fixture, string $key): array
    {
        return [
            'fuel_station_id' => $fixture['station']->id,
            'fuel_tank_id' => $fixture['tank']->id,
            'fuel_product_id' => $fixture['fuel']->id,
            'warehouse_id' => $fixture['warehouse']->id,
            'supplier_id' => $fixture['supplier']->id,
            'dispatched_liters' => '10.000',
            'received_liters' => '10.000',
            'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $key,
            'idempotency_key' => $key,
        ];
    }

    private function grantFoundation(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_cycle_3_access', reason: 'اختبار Cycle 3.');
    }
}

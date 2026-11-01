<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelProduct;
use App\Models\FuelReconciliation;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\FuelTankReading;
use App\Models\Partner;
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
 * FS-05 (PR-2a): نطاق الفرع/المخزن لمسارات الاستلام والقراءات والتسوية.
 * `FuelStation` CompanyWide، فبلا حارس صريح كان مستخدم مقيَّد بفرع/مخزن يكتب على محطة خارج نطاقه.
 */
class FuelStationScopeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function a_branch_restricted_user_cannot_write_against_another_branch_station(): void
    {
        $f = $this->fixture();
        $token = $f['branch_user_token'];

        $this->withToken($token)->postJson('/api/fuel-stations/readings', $this->readingPayload($f['station_b'], $f['tank_b'], 'scope-b-1'))->assertNotFound();
        $this->withToken($token)->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($f, $f['station_b'], $f['tank_b'], $f['warehouse_b'], 'scope-b-1'))->assertNotFound();
        $this->withToken($token)->postJson('/api/fuel-stations/reconciliations', [
            'fuel_station_id' => $f['station_b']->id, 'fuel_tank_id' => $f['tank_b']->id,
        ])->assertNotFound();

        $this->assertSame(0, FuelTankReading::count());
        $this->assertSame(0, FuelDelivery::count());
        $this->assertSame(0, FuelReconciliation::count());

        // وفي نطاقه الخاص يعمل كالمعتاد (لا حجب زائد).
        $this->withToken($token)->postJson('/api/fuel-stations/readings', $this->readingPayload($f['station_a'], $f['tank_a'], 'scope-a-1'))->assertCreated();
        $this->withToken($token)->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'scope-a-1'))->assertCreated();
    }

    /** @test */
    public function a_warehouse_restricted_user_cannot_write_or_see_a_station_whose_warehouse_is_outside_their_scope(): void
    {
        $f = $this->fixture();
        $token = $f['warehouse_user_token'];

        $this->withToken($token)->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($f, $f['station_a2'], $f['tank_a2'], $f['warehouse_a2'], 'wh-out-1'))->assertNotFound();
        $this->withToken($token)->postJson('/api/fuel-stations/readings', $this->readingPayload($f['station_a2'], $f['tank_a2'], 'wh-out-1'))->assertNotFound();
        $this->assertSame(0, FuelDelivery::count());

        // المالك (غير مقيَّد) ينشئ استلاماً وتسوية في المخزن الخارج عن نطاق المقيَّد.
        $delivery = $this->withToken($f['owner_token'])->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($f, $f['station_a2'], $f['tank_a2'], $f['warehouse_a2'], 'wh-owner-1'))->assertCreated()->json('data');
        $reading = $this->withToken($f['owner_token'])->postJson('/api/fuel-stations/readings', $this->readingPayload($f['station_a2'], $f['tank_a2'], 'wh-owner-1'))->assertCreated()->json('data');
        $draft = $this->withToken($f['owner_token'])->postJson('/api/fuel-stations/reconciliations', [
            'fuel_station_id' => $f['station_a2']->id, 'fuel_tank_id' => $f['tank_a2']->id,
        ])->assertCreated()->json('data');

        $this->withToken($token)->getJson('/api/fuel-stations/deliveries')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($token)->getJson('/api/fuel-stations/deliveries/' . $delivery['id'])->assertNotFound();
        $this->withToken($token)->postJson('/api/fuel-stations/deliveries/' . $delivery['id'] . '/approve')->assertNotFound();
        $this->withToken($token)->getJson('/api/fuel-stations/readings')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($token)->getJson('/api/fuel-stations/reconciliations')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($token)->postJson('/api/fuel-stations/reconciliations/' . $draft['id'] . '/approve')->assertNotFound();
        $this->assertNotNull($reading['id']);

        // وهو نفسه يعمل على محطة مخزنه المسموح.
        $this->withToken($token)->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'wh-in-1'))->assertCreated();
        $this->withToken($token)->getJson('/api/fuel-stations/deliveries')->assertOk()->assertJsonCount(1, 'data');
        $this->assertSame('draft', FuelDelivery::where('id', $delivery['id'])->value('status'));
    }

    /** @test */
    public function matching_a_supplier_invoice_to_a_delivery_outside_the_users_warehouses_is_not_found(): void
    {
        $f = $this->fixture();
        $owner = $f['owner_token'];
        $delivery = $this->withToken($owner)->postJson('/api/fuel-stations/deliveries', $this->deliveryPayload($f, $f['station_a2'], $f['tank_a2'], $f['warehouse_a2'], 'match-1'))->assertCreated()->json('data');
        $this->withToken($owner)->postJson('/api/fuel-stations/deliveries/' . $delivery['id'] . '/approve')->assertOk();
        $invoice = $this->withToken($owner)->postJson('/api/fuel-stations/supplier-invoices', [
            'supplier_id' => $f['supplier']->id, 'invoice_number' => 'SCOPE-INV-1', 'invoice_date' => '2026-08-23', 'currency' => 'SAR',
            'lines' => [['fuel_product_id' => $f['fuel']->id, 'quantity_liters' => '10.000', 'value_minor' => 2345]],
        ])->assertOk()->json('data');

        $this->withToken($f['warehouse_user_token'])->postJson('/api/fuel-stations/supplier-invoices/' . $invoice['id'] . '/matches', [
            'fuel_supplier_invoice_line_id' => $invoice['lines'][0]['id'],
            'fuel_delivery_id' => $delivery['id'],
            'quantity_liters' => '10.000',
            'idempotency_key' => 'scope-match-1',
        ])->assertNotFound();
        $this->assertSame(0, \App\Models\FuelSupplierInvoiceMatch::count());

        // المالك غير المقيَّد يطابق بلا تغيير.
        $this->withToken($owner)->postJson('/api/fuel-stations/supplier-invoices/' . $invoice['id'] . '/matches', [
            'fuel_supplier_invoice_line_id' => $invoice['lines'][0]['id'],
            'fuel_delivery_id' => $delivery['id'],
            'quantity_liters' => '10.000',
            'idempotency_key' => 'scope-match-owner',
        ])->assertCreated();
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-scope', 'owner@fuel-scope.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fs05_scope', reason: 'اختبار نطاق الوقود.',
        );

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-A2', 'branch_id' => $branchA->id]);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود نطاق mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-SCOPE', 'name' => 'وقود نطاق']);

        $mk = function (Branch $branch, Warehouse $warehouse, string $code) use ($fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]);
            $tank = FuelTank::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000,
            ]);

            return [$station, $tank];
        };
        [$stationA, $tankA] = $mk($branchA, $warehouseA, 'A');
        [$stationA2, $tankA2] = $mk($branchA, $warehouseA2, 'A2');
        [$stationB, $tankB] = $mk($branchB, $warehouseB, 'B');

        $supplier = Partner::create(['branch_id' => $branchA->id, 'type' => 'supplier', 'name' => 'مورد النطاق', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI نطاق', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson('/api/fuel-stations/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار النطاق'])->assertOk();

        $role = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-scope-manager', 'name' => 'مدير وقود مقيَّد',
            'permissions' => ['fuel_stations.view', 'fuel_stations.manage'], 'is_system' => false,
        ]);
        $branchUser = User::create([
            'tenant_id' => $tenantId, 'name' => 'مقيَّد بفرع', 'email' => 'branch-user@fuel-scope.test',
            'password' => 'password123', 'role' => $role->slug,
        ]);
        $branchUser->branches()->attach($branchA->id);
        $warehouseUser = User::create([
            'tenant_id' => $tenantId, 'name' => 'مقيَّد بمخزن', 'email' => 'warehouse-user@fuel-scope.test',
            'password' => 'password123', 'role' => $role->slug,
        ]);
        $warehouseUser->warehouses()->attach($warehouseA->id);

        return [
            'owner_token' => $auth['token'],
            'branch_user_token' => $branchUser->createToken('api')->plainTextToken,
            'warehouse_user_token' => $warehouseUser->createToken('api')->plainTextToken,
            'fuel' => $fuel, 'supplier' => $supplier,
            'station_a' => $stationA, 'tank_a' => $tankA, 'warehouse_a' => $warehouseA,
            'station_a2' => $stationA2, 'tank_a2' => $tankA2, 'warehouse_a2' => $warehouseA2,
            'station_b' => $stationB, 'tank_b' => $tankB, 'warehouse_b' => $warehouseB,
        ];
    }

    /** @return array<string,mixed> */
    private function deliveryPayload(array $f, FuelStation $station, FuelTank $tank, Warehouse $warehouse, string $key): array
    {
        return [
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $f['fuel']->id,
            'warehouse_id' => $warehouse->id, 'supplier_id' => $f['supplier']->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $key, 'idempotency_key' => $key,
        ];
    }

    /** @return array<string,mixed> */
    private function readingPayload(FuelStation $station, FuelTank $tank, string $key): array
    {
        return [
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'reading_type' => 'physical',
            'quantity_liters' => '10.000', 'evidence_key' => 'ev-' . $key,
        ];
    }
}
